/*
 * GeneLab IoT — Bancada ESP32 (comunicação direta com Supabase)
 * =============================================================
 * - SUPABASE_URL e SUPABASE_ANON_KEY fixos no firmware (mesmo binário
 *   p/ todas as bancadas).
 * - No 1o boot, portal AP (WiFiManager) pede Wi-Fi + código de 6 dígitos.
 * - Firmware chama RPC public.bench_pair para trocar o código pelas
 *   credenciais reais (bancada_id + device_token) e salva em Preferences.
 * - Telemetria via RPC public.bench_push_telemetry (2s).
 * - Comandos via RPC public.bench_pull_commands (2s).
 * - WiFiClientSecure/HTTPClient globais + keep-alive p/ evitar
 *   fragmentação de heap.
 *
 * Bibliotecas:
 *   - WiFiManager (tzapu) >= 2.0.17
 *   - ArduinoJson (Benoit Blanchon) >= 7.0
 *   - Preferences (nativo ESP32)
 *
 * Board: ESP32 Dev Module (esp32 by Espressif >= 3.0)
 * =============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>            // NTP + horário local p/ timer das luzes
#include <sys/time.h>        // settimeofday (sincronizar system clock com DS3231)
#include <HTTPUpdate.h>      // OTA via HTTPS (v1.6.0)
#include <Wire.h>            // I2C p/ DS3231 (v1.8.0)
#include <RTClib.h>          // DS3231 opcional (v1.8.0)
#include <IRremoteESP8266.h> // Controle de ar-condicionado via IR (v2.1.0)
#include <IRsend.h>
#include <ir_LG.h>
#include <ir_Samsung.h>
#include <ir_Fujitsu.h>
#include <ir_Midea.h>
#include <ir_Electra.h>


// -------- Config Supabase (fixa no binário) --------
static const char* SUPABASE_URL = "https://ftfboqlapblxndizyaxy.supabase.co";
static const char* SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0ZmJvcWxhcGJseG5kaXp5YXh5Iiwicm9sZSI6ImFub24i"
  "LCJpYXQiOjE3ODMwODg5NTksImV4cCI6MjA5ODY2NDk1OX0."
  "ainxeRe7j4bfS5oHMJ3EbXihQ54N5jzfl_ySMa-2g_Y";

// -------- Pinagem --------
// V1 e V4 abrem juntas (par injecao)  -> controladas pelo mesmo GPIO
// V2 e V3 abrem juntas (par retorno)  -> controladas pelo mesmo GPIO
// V5 (alivio) REMOVIDA a partir da v1.9.2 — projeto não usa mais essa válvula.
static const int PIN_V1_V4 = 25;   // par injecao (V1 + V4)
static const int PIN_V2_V3 = 26;   // par retorno (V2 + V3)
// Aliases para manter compatibilidade da telemetria (v1..v4)
static const int PIN_V1 = PIN_V1_V4;
static const int PIN_V4 = PIN_V1_V4;
static const int PIN_V2 = PIN_V2_V3;
static const int PIN_V3 = PIN_V2_V3;

static const int PIN_LUZ       = 27;   // relé das luzes da bancada (timer HH:MM)
static const int PIN_LED = 2;
static const int PIN_RESET_BTN = 0;
static const int PIN_DS18B20 = 4;
static const int PIN_IR_LED = 32;   // LED IR p/ ar-condicionado (v2.1.0)

static const char* FIRMWARE_VERSION = "2.1.2";

// -------- IR (ar-condicionado) --------
// Estado local do ar (última decisão aplicada) — usado só para telemetria/debug.
IRsend irsend(PIN_IR_LED);
static bool ac_ligado_local = false;
static float ac_setpoint_local = 24.0;
static String ac_protocolo_local = "";

// -------- Polaridade dos relés (v1.9.5+) --------
// v1.9.5: mudado para ACTIVE_HIGH para uso com SSR industrial tipo Fotek
// SSR-xxDA (entrada 3–32 VDC) acionado direto pelo GPIO do ESP32 (3.3V).
// GPIO HIGH => corrente pelo LED do opto do SSR => carga LIGA.
// Se voltar a usar módulo "Low Level Trigger" de 4 canais, troque para true.
static const bool RELAY_ACTIVE_LOW = false;

// Macros (não geram protótipo automático no Arduino IDE — evita ordem de tipo).
#define RELAY_ON_LEVEL  (RELAY_ACTIVE_LOW ? LOW  : HIGH)
#define RELAY_OFF_LEVEL (RELAY_ACTIVE_LOW ? HIGH : LOW)
#define relayWrite(pin, on) digitalWrite((pin), (on) ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL)
#define relayRead(pin)      (digitalRead(pin) == RELAY_ON_LEVEL)



// -------- Sensor DS18B20 (temperatura da planta) --------
OneWire oneWire(PIN_DS18B20);
DallasTemperature dsSensor(&oneWire);
DeviceAddress g_ds18b20_addr;
bool g_tem_ds18b20 = false;
float g_temperatura_planta = NAN;
float g_ultima_temperatura_valida = NAN; // diagnóstico local; não é reenviada como leitura nova
float g_temperatura_publicada = NAN;   // último valor efetivamente enviado
bool  g_temperatura_valida = false;    // informa ao backend se a leitura atual é válida
const float TEMP_DELTA_PUSH = 0.2f;    // °C — variação que força telemetria imediata

// v1.9.9 — falha do sensor é leitura inválida real, não temperatura estável.
// DS18B20 pode ficar vários minutos com o mesmo valor em bancada estável; isso
// não deve apagar a temperatura nem reiniciar o barramento.
float         g_temp_ultimo_valor    = NAN;
bool          g_sensor_travado       = false;  // exposto na telemetria
uint32_t      g_temp_reinicios       = 0;      // contador de re-inits do barramento 1-Wire
uint8_t       g_temp_falhas_seguidas = 0;      // leituras inválidas consecutivas
uint8_t       g_temp_invalidas_consecutivas = 0; // falhas acumuladas até uma leitura boa

// -------- RTC DS3231 (opcional — v1.8.0) --------
// Ligação I²C padrão do ESP32: SDA=GPIO 21, SCL=GPIO 22, VCC=3.3V, GND=GND.
// Se o módulo não estiver presente, o firmware cai automaticamente no NTP+millis.
RTC_DS3231 g_rtc;
bool       g_tem_rtc          = false;   // detectado no boot
uint32_t   g_ultima_sync_rtc  = 0;       // millis() da última gravação NTP -> RTC

// -------- Estado --------
enum FaseCiclo { REPOUSO, INJETANDO, PAUSADO, RETORNANDO, ALIVIO, MANUAL, OFFLINE };

static const int MAX_LUZ_JANELAS = 8;
static const int MAX_HORARIOS    = 24;
static const char DEFAULT_TZ[]   = "<-03>3";   // America/Sao_Paulo (POSIX)
struct LuzJanela {
  char ligar[6];      // "HH:MM"
  char desligar[6];   // "HH:MM"
};

struct Config {
  uint32_t tempo_injecao_segundos   = 150;
  uint32_t tempo_pausa_segundos     = 60;
  uint32_t tempo_retorno_segundos   = 150;
  uint32_t tempo_alivio_segundos    = 10;
  // Fallback offline: se NUNCA sincronizou NTP, dispara ciclo a cada N horas
  // usando millis() a partir do 1º ciclo (ou boot).
  uint32_t intervalo_ciclo_horas    = 4;
  // Timer das luzes (fuso configurável em cfg.tz). Cada janela suporta
  // atravessar meia-noite (ex.: liga 20:00, desliga 06:00).
  uint8_t   luz_n                   = 1;
  LuzJanela luz_janelas[MAX_LUZ_JANELAS] = { { "06:00", "18:00" } };
  // Agendamento LOCAL dos ciclos (não depende do backend).
  uint8_t   horarios_n              = 4;
  char      horarios_disparo[MAX_HORARIOS][6] = {
    "06:00", "12:00", "18:00", "00:00"
  };
  // POSIX TZ string, ex.: "<-03>3" (BRT), "UTC0", "EST5EDT,M3.2.0,M11.1.0"
  char      tz[40]                  = "<-03>3";
  uint32_t  versao                  = 0;
};

struct Creds {
  String bancada_id;
  String device_token;
};

Config      cfg;
Creds       creds;
Preferences prefs;

FaseCiclo    fase = REPOUSO;
uint32_t     fase_inicio_ms = 0;
bool         pausado_manual = false;

char pairing_code_buf[8] = {0};

// -------- HTTP global (keep-alive) --------
WiFiClientSecure httpsClient;
HTTPClient       http;
bool             httpInit = false;

// -------- Utilidades --------
static const char* faseNome(FaseCiclo f) {
  switch (f) {
    case REPOUSO:    return "Repouso";
    case INJETANDO:  return "Injetando";
    case PAUSADO:    return "Pausado";
    case RETORNANDO: return "Retornando";
    case ALIVIO:     return "Alivio";
    case MANUAL:     return "Manual";
    case OFFLINE:    return "Offline";
  }
  return "Offline";
}

void escreverValvulas(bool v1, bool v2, bool v3, bool v4, bool /*v5*/) {
  // V1 e V4 compartilham GPIO (par injecao) -> abre se qualquer um pedir
  relayWrite(PIN_V1_V4, v1 || v4);
  // V2 e V3 compartilham GPIO (par retorno) -> abre se qualquer um pedir
  relayWrite(PIN_V2_V3, v2 || v3);
  // v5 ignorado (válvula removida do projeto na v1.9.2)
}


void aplicarFase(FaseCiclo f) {
  fase = f;
  fase_inicio_ms = millis();
  switch (f) {
    case INJETANDO:  escreverValvulas(true,  false, false, true,  false); break;
    case RETORNANDO: escreverValvulas(false, true,  true,  false, false); break;
    // ALIVIO mantido no enum para compat, mas sem fase ativa (V5 removida)
    default:         escreverValvulas(false, false, false, false, false); break;
  }
  Serial.printf("[FASE] %s\n", faseNome(f));
}


// -------- Timer das luzes --------
// Converte "HH:MM" -> minutos desde a meia-noite (-1 se inválido).
int hhmmParaMinutos(const char* s) {
  if (!s || strlen(s) < 4) return -1;
  int h = 0, m = 0;
  if (sscanf(s, "%d:%d", &h, &m) != 2) return -1;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

bool g_luz_ligada = false;

// Serializa cfg.luz_janelas em JSON compacto para persistir em Preferences.
String serializarLuzJanelas() {
  String out = "[";
  for (uint8_t i = 0; i < cfg.luz_n && i < MAX_LUZ_JANELAS; i++) {
    if (i) out += ',';
    out += "{\"ligar\":\"";
    out += cfg.luz_janelas[i].ligar;
    out += "\",\"desligar\":\"";
    out += cfg.luz_janelas[i].desligar;
    out += "\"}";
  }
  out += ']';
  return out;
}

// Copia janelas a partir de um JsonArrayConst (validando HH:MM).
void aplicarLuzJanelasJson(JsonArrayConst arr) {
  uint8_t n = 0;
  for (JsonVariantConst v : arr) {
    if (n >= MAX_LUZ_JANELAS) break;
    const char* lg = v["ligar"]    | (const char*)nullptr;
    const char* dl = v["desligar"] | (const char*)nullptr;
    if (!lg || !dl) continue;
    if (hhmmParaMinutos(lg) < 0 || hhmmParaMinutos(dl) < 0) continue;
    strncpy(cfg.luz_janelas[n].ligar,    lg, sizeof(cfg.luz_janelas[n].ligar) - 1);
    strncpy(cfg.luz_janelas[n].desligar, dl, sizeof(cfg.luz_janelas[n].desligar) - 1);
    cfg.luz_janelas[n].ligar[sizeof(cfg.luz_janelas[n].ligar) - 1] = 0;
    cfg.luz_janelas[n].desligar[sizeof(cfg.luz_janelas[n].desligar) - 1] = 0;
    n++;
  }
  if (n > 0) cfg.luz_n = n;   // mantem anterior se a lista veio vazia
}

bool janelaAtiva(const LuzJanela& j, int agora) {
  int on  = hhmmParaMinutos(j.ligar);
  int off = hhmmParaMinutos(j.desligar);
  if (on < 0 || off < 0 || on == off) return false;
  if (on < off)  return agora >= on && agora < off;
  return agora >= on || agora < off;    // atravessa meia-noite
}

void tickLuz() {
  struct tm ti;
  if (!getLocalTime(&ti, 50)) return;   // NTP ainda nao sincronizou
  int agora = ti.tm_hour * 60 + ti.tm_min;
  bool deveLigar = false;
  for (uint8_t i = 0; i < cfg.luz_n && i < MAX_LUZ_JANELAS; i++) {
    if (janelaAtiva(cfg.luz_janelas[i], agora)) { deveLigar = true; break; }
  }
  if (deveLigar != g_luz_ligada) {
    g_luz_ligada = deveLigar;
    relayWrite(PIN_LUZ, deveLigar);
    Serial.printf("[LUZ] %s (%02d:%02d) [%u janela(s)]\n",
                  deveLigar ? "ON" : "OFF",
                  ti.tm_hour, ti.tm_min, (unsigned)cfg.luz_n);
  }
}

// Forward decl: timers globais declarados abaixo.
extern unsigned long lastTelem;

// -------- Agendamento local dos ciclos (independente da internet) --------
// Guardas para não disparar o mesmo horário 2x nem sobrepor um ciclo em curso.
int  g_ultimo_disparo_min      = -1;   // minuto absoluto (dia*1440+min) do último disparo
uint32_t g_ultimo_disparo_ms   = 0;    // fallback quando NTP nunca sincronizou
bool     g_ntp_ja_sincronizou  = false;

void aplicarTz(const char* tz) {
  const char* z = (tz && *tz) ? tz : DEFAULT_TZ;
  setenv("TZ", z, 1);
  tzset();
}

// -------- DS3231 helpers (v1.8.0) --------
// Grava a hora do DS3231 no relógio de sistema do ESP32 (UTC).
// Assim `getLocalTime()` já retorna o horário correto mesmo sem NTP.
void carregarHoraDoRtc() {
  if (!g_tem_rtc) return;
  DateTime now = g_rtc.now();
  if (!now.isValid() || now.year() < 2024) {
    Serial.println("[RTC] hora inválida (bateria fraca?) — ignorando");
    return;
  }
  struct timeval tv;
  tv.tv_sec  = now.unixtime();
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  g_ntp_ja_sincronizou = true;   // temos hora confiável do RTC
  Serial.printf("[RTC] hora carregada do DS3231: %04u-%02u-%02u %02u:%02u:%02u UTC\n",
                now.year(), now.month(), now.day(),
                now.hour(), now.minute(), now.second());
}

// Depois que o NTP sincronizou, escreve a hora atual no DS3231 (uma vez por hora).
void sincronizarNtpParaRtc() {
  if (!g_tem_rtc) return;
  struct tm ti;
  if (!getLocalTime(&ti, 50)) return;
  // Só grava se o ano já for razoável (NTP confirmado).
  if (ti.tm_year + 1900 < 2024) return;
  uint32_t agora = millis();
  // 1ª vez ou a cada 1h.
  if (g_ultima_sync_rtc != 0 && (agora - g_ultima_sync_rtc) < 3600UL * 1000UL) return;
  time_t utc = time(nullptr);
  g_rtc.adjust(DateTime((uint32_t)utc));
  g_ultima_sync_rtc = agora;
  Serial.println("[RTC] DS3231 sincronizado a partir do NTP");
}

String serializarHorarios() {
  String out = "[";
  for (uint8_t i = 0; i < cfg.horarios_n && i < MAX_HORARIOS; i++) {
    if (i) out += ',';
    out += '"';
    out += cfg.horarios_disparo[i];
    out += '"';
  }
  out += ']';
  return out;
}

void aplicarHorariosJson(JsonArrayConst arr) {
  uint8_t n = 0;
  for (JsonVariantConst v : arr) {
    if (n >= MAX_HORARIOS) break;
    const char* s = v.as<const char*>();
    if (!s) continue;
    if (hhmmParaMinutos(s) < 0) continue;
    strncpy(cfg.horarios_disparo[n], s, 5);
    cfg.horarios_disparo[n][5] = 0;
    n++;
  }
  if (n > 0) cfg.horarios_n = n;
}

// Retorna true se `hhmm` (ex. "06:00") corresponde ao horário local atual.
bool horarioBate(const char* hhmm, const struct tm& ti) {
  int m = hhmmParaMinutos(hhmm);
  if (m < 0) return false;
  return (ti.tm_hour * 60 + ti.tm_min) == m;
}

// Dispara automaticamente o ciclo:
//  - Se NTP sincronizou: quando o relógio local bate em um horário programado.
//  - Fallback: se nunca sincronizou, dispara a cada intervalo_ciclo_horas horas.
void tickAgendaCiclo() {
  // Não sobrepor: só dispara quando está em REPOUSO e sem pausa manual.
  if (fase != REPOUSO || pausado_manual) return;

  struct tm ti;
  bool temHora = getLocalTime(&ti, 50);
  if (temHora) g_ntp_ja_sincronizou = true;

  if (temHora) {
    int minutoAbs = ti.tm_yday * 1440 + ti.tm_hour * 60 + ti.tm_min;
    if (minutoAbs == g_ultimo_disparo_min) return;   // já disparou neste minuto
    for (uint8_t i = 0; i < cfg.horarios_n && i < MAX_HORARIOS; i++) {
      if (horarioBate(cfg.horarios_disparo[i], ti)) {
        g_ultimo_disparo_min = minutoAbs;
        g_ultimo_disparo_ms  = millis();
        Serial.printf("[AGENDA] disparo local %02d:%02d (horario %s)\n",
                      ti.tm_hour, ti.tm_min, cfg.horarios_disparo[i]);
        aplicarFase(INJETANDO);
        lastTelem = 0;
        return;
      }
    }
    return;
  }

  // Sem NTP: fallback por intervalo (millis).
  uint32_t intervalo_ms = cfg.intervalo_ciclo_horas * 3600UL * 1000UL;
  if (intervalo_ms == 0) return;
  uint32_t agora = millis();
  if (g_ultimo_disparo_ms == 0 || (agora - g_ultimo_disparo_ms) >= intervalo_ms) {
    g_ultimo_disparo_ms = agora;
    Serial.printf("[AGENDA] disparo por intervalo (sem NTP) cada %uh\n",
                  (unsigned)cfg.intervalo_ciclo_horas);
    aplicarFase(INJETANDO);
    lastTelem = 0;
  }
}


// -------- Persistência --------
void carregarPrefs() {
  prefs.begin("genelab", true);
  creds.bancada_id   = prefs.getString("bid", "");
  creds.device_token = prefs.getString("tok", "");
  cfg.tempo_injecao_segundos = prefs.getUInt("t_inj",  150);
  cfg.tempo_pausa_segundos   = prefs.getUInt("t_pau",  60);
  cfg.tempo_retorno_segundos = prefs.getUInt("t_ret",  150);
  cfg.tempo_alivio_segundos  = prefs.getUInt("t_ali",  10);
  cfg.intervalo_ciclo_horas  = prefs.getUInt("t_int",  4);

  // Preferido: JSON completo de luz_janelas (v1.5.0+)
  String jj = prefs.getString("luz_jj", "");
  if (jj.length() > 0) {
    JsonDocument d;
    if (deserializeJson(d, jj) == DeserializationError::Ok && d.is<JsonArray>()) {
      aplicarLuzJanelasJson(d.as<JsonArrayConst>());
    }
  } else {
    // Compat: migra o par escalar (luz_on/luz_off) usado até a v1.4.0.
    String lon = prefs.getString("luz_on",  "06:00");
    String lof = prefs.getString("luz_off", "18:00");
    strncpy(cfg.luz_janelas[0].ligar,    lon.c_str(), sizeof(cfg.luz_janelas[0].ligar) - 1);
    strncpy(cfg.luz_janelas[0].desligar, lof.c_str(), sizeof(cfg.luz_janelas[0].desligar) - 1);
    cfg.luz_janelas[0].ligar[sizeof(cfg.luz_janelas[0].ligar) - 1] = 0;
    cfg.luz_janelas[0].desligar[sizeof(cfg.luz_janelas[0].desligar) - 1] = 0;
    cfg.luz_n = 1;
  }

  // v1.7.0+: horários locais de disparo + fuso configurável
  String hj = prefs.getString("hor_jj", "");
  if (hj.length() > 0) {
    JsonDocument d;
    if (deserializeJson(d, hj) == DeserializationError::Ok && d.is<JsonArray>()) {
      aplicarHorariosJson(d.as<JsonArrayConst>());
    }
  }
  String tzs = prefs.getString("tz", DEFAULT_TZ);
  strncpy(cfg.tz, tzs.c_str(), sizeof(cfg.tz) - 1);
  cfg.tz[sizeof(cfg.tz) - 1] = 0;

  cfg.versao                 = prefs.getUInt("cfgv",   0);
  prefs.end();
}

void salvarCreds() {
  prefs.begin("genelab", false);
  prefs.putString("bid", creds.bancada_id);
  prefs.putString("tok", creds.device_token);
  prefs.end();
}

void salvarConfig() {
  prefs.begin("genelab", false);
  prefs.putUInt("t_inj", cfg.tempo_injecao_segundos);
  prefs.putUInt("t_pau", cfg.tempo_pausa_segundos);
  prefs.putUInt("t_ret", cfg.tempo_retorno_segundos);
  prefs.putUInt("t_ali", cfg.tempo_alivio_segundos);
  prefs.putUInt("t_int", cfg.intervalo_ciclo_horas);
  prefs.putString("luz_jj", serializarLuzJanelas());
  prefs.remove("luz_on");   // limpa chaves antigas se existirem
  prefs.remove("luz_off");
  prefs.putString("hor_jj", serializarHorarios());
  prefs.putString("tz",     cfg.tz);
  prefs.putUInt("cfgv",  cfg.versao);
  prefs.end();
}

void apagarTudo() {
  prefs.begin("genelab", false);
  prefs.clear();
  prefs.end();
}

// -------- Portal AP (Wi-Fi + código de pareamento) --------
static const char PORTAL_HEAD[] PROGMEM =
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">"
  "<style>"
  ":root{--bg:#0b1220;--card:#111a2e;--border:#1f2b45;--text:#e6edf7;"
  "--muted:#8ea0be;--accent:#22c55e;--accent2:#16a34a;--danger:#ef4444;}"
  "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}"
  "html,body{margin:0;padding:0;background:radial-gradient(1200px 600px at 20% -10%,#152346 0%,#0b1220 55%),"
  "linear-gradient(180deg,#0b1220,#0a1020);color:var(--text);"
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,Arial,sans-serif;"
  "min-height:100vh;font-size:15px;line-height:1.45;}"
  ".wrap{max-width:440px;margin:0 auto;padding:28px 20px 40px;}"
  ".brand{display:flex;align-items:center;gap:12px;margin-bottom:22px;}"
  ".logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#22c55e,#0ea5e9);"
  "display:flex;align-items:center;justify-content:center;font-weight:800;color:#0b1220;font-size:20px;"
  "box-shadow:0 8px 22px rgba(34,197,94,.35);}"
  ".brand h1{margin:0;font-size:17px;font-weight:700;letter-spacing:.2px;}"
  ".brand p{margin:2px 0 0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.14em;}"
  ".card{background:linear-gradient(180deg,#111a2e,#0e1628);border:1px solid var(--border);"
  "border-radius:18px;padding:22px 20px;box-shadow:0 20px 40px rgba(0,0,0,.35);}"
  "h2,h3{margin:0 0 14px;font-weight:600;color:var(--text);font-size:16px;}"
  "label,.wm-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;"
  "display:block;margin:14px 0 6px;}"
  "input,select{width:100%;background:#0a1224;color:var(--text);border:1px solid var(--border);"
  "border-radius:12px;padding:12px 14px;font-size:15px;outline:none;transition:border .15s,box-shadow .15s;}"
  "input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(34,197,94,.18);}"
  "input[name='pair']{letter-spacing:.5em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;"
  "text-align:center;font-size:22px;font-weight:700;}"
  "button,input[type=submit],.btn,.msg a{appearance:none;border:0;cursor:pointer;"
  "background:linear-gradient(135deg,var(--accent),var(--accent2));color:#04140a;font-weight:700;"
  "padding:13px 16px;border-radius:12px;font-size:15px;width:100%;margin-top:16px;"
  "box-shadow:0 10px 22px rgba(34,197,94,.28);text-decoration:none;display:block;text-align:center;}"
  "button:active{transform:translateY(1px);}"
  ".msg{background:#0a1224;border:1px solid var(--border);border-radius:12px;padding:12px 14px;"
  "color:var(--muted);margin-top:12px;font-size:13px;}"
  ".q{color:var(--muted);}"
  "hr{border:0;border-top:1px solid var(--border);margin:18px 0;}"
  "a{color:#7dd3fc;}"
  ".footer{text-align:center;color:var(--muted);font-size:11px;margin-top:22px;letter-spacing:.08em;"
  "text-transform:uppercase;}"
  "</style>"
  "<div class=\"wrap\"><div class=\"brand\">"
  "<div class=\"logo\">G</div>"
  "<div><h1>GeneLab IoT</h1><p>Configuração da Bancada</p></div>"
  "</div><div class=\"card\">";

static const char PORTAL_FOOT[] PROGMEM =
  "</div><div class=\"footer\">ESP32 • Firmware 2.1.1</div></div>";

void abrirPortalWifi(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  wm.setClass("invert");
  wm.setTitle("GeneLab IoT — Bancada");
  wm.setCustomHeadElement(PORTAL_HEAD);
  wm.setCustomMenuHTML(PORTAL_FOOT);
  wm.setShowInfoUpdate(false);
  wm.setShowInfoErase(false);
  std::vector<const char*> menu = {"wifi","info","exit"};
  wm.setMenu(menu);

  WiFiManagerParameter param_pair(
    "pair", "Código de pareamento (6 dígitos)", "", 7,
    "pattern='\\d{6}' inputmode='numeric' maxlength='6' placeholder='000000'");
  wm.addParameter(&param_pair);

  const char* apName = "BancadaSetup";
  const char* apPass = "1234567890";

  if (forcar) {
    // Primeiro boot / reset manual — precisa abrir portal p/ receber SSID+código.
    wm.resetSettings();
    bool ok = wm.startConfigPortal(apName, apPass);
    if (!ok) {
      Serial.println("[WM] falha no portal; reiniciando…");
      delay(3000);
      ESP.restart();
    }
    strncpy(pairing_code_buf, param_pair.getValue(), sizeof(pairing_code_buf) - 1);
    pairing_code_buf[sizeof(pairing_code_buf) - 1] = 0;
    Serial.println("[WM] Wi-Fi conectado");
    return;
  }

  // Já pareado — NUNCA bloquear o boot. Se o Wi-Fi/internet estiver fora,
  // seguimos direto pro loop() e o firmware continua rodando ciclos + luz
  // offline usando o RTC/DS3231 (v2.1.1).
  WiFi.mode(WIFI_STA);
  WiFi.begin();   // usa SSID/senha salvos na NVS pelo WiFiManager
  Serial.print("[WM] tentando Wi-Fi salvo");
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < 15000UL) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WM] Wi-Fi conectado");
  } else {
    Serial.println("[WM] SEM Wi-Fi — seguindo offline (RTC + agenda local)");
    // AutoReconnect fica ligado no setup(); assim que a rede voltar, conecta sozinho.
  }
}

// -------- HTTPS (keep-alive, cliente global) --------
// Faz POST a /rest/v1/rpc/<fn> com o body JSON dado.
bool supabaseRpc(const char* fn, const String& body, String& outBody) {
  if (WiFi.status() != WL_CONNECTED) return false;

  if (!httpInit) {
    httpsClient.setInsecure(); // dev
    httpInit = true;
  }

  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + fn;
  if (!http.begin(httpsClient, url)) {
    Serial.printf("[HTTP] begin falhou %s\n", url.c_str());
    return false;
  }
  http.setReuse(true);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Connection", "keep-alive");

  int code = http.POST(body);
  outBody = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[RPC] %s => %d: %s\n", fn, code, outBody.c_str());
    return false;
  }
  return true;
}

// -------- Pareamento --------
bool parear(const char* code) {
  JsonDocument body;
  body["_pairing_code"] = code;
  String bodyStr;
  serializeJson(body, bodyStr);

  String resp;
  if (!supabaseRpc("bench_pair", bodyStr, resp)) {
    Serial.println("[PAIR] falha na chamada");
    return false;
  }

  JsonDocument r;
  if (deserializeJson(r, resp) != DeserializationError::Ok) {
    Serial.printf("[PAIR] json invalido: %s\n", resp.c_str());
    return false;
  }
  const char* bid = r["bancada_id"] | "";
  const char* tok = r["device_token"] | "";
  if (!*bid || !*tok) {
    Serial.printf("[PAIR] resposta sem creds: %s\n", resp.c_str());
    return false;
  }
  creds.bancada_id   = bid;
  creds.device_token = tok;
  salvarCreds();
  Serial.printf("[PAIR] OK bancada=%s\n", bid);
  return true;
}

// -------- Telemetria --------
uint32_t proxCicloSegRest() {
  if (pausado_manual) return 0;
  uint32_t alvo_ms = fase_inicio_ms + (uint64_t)cfg.intervalo_ciclo_horas * 3600UL * 1000UL;
  uint32_t agora = millis();
  if (agora >= alvo_ms) return 0;
  return (alvo_ms - agora) / 1000;
}

bool enviarTelemetria() {
  if (creds.device_token.length() == 0) return false;

  JsonDocument doc;
  doc["_bancada_id"]   = creds.bancada_id;
  doc["_device_token"] = creds.device_token;
  doc["_status"]       = faseNome(fase);
  JsonObject v = doc["_valvulas"].to<JsonObject>();
  v["v1"] = relayRead(PIN_V1);
  v["v2"] = relayRead(PIN_V2);
  v["v3"] = relayRead(PIN_V3);
  v["v4"] = relayRead(PIN_V4);
  v["v5"] = false;   // V5 removida do projeto (v1.9.2+)
  doc["_proximo_ciclo_segundos"] = proxCicloSegRest();
  doc["_firmware_version"]       = FIRMWARE_VERSION;


  doc["_tem_rtc"]                = g_tem_rtc;
  doc["_ip_local"]               = WiFi.localIP().toString();
  doc["_luz_ligada"]             = g_luz_ligada;
  doc["_sensor_travado"]         = g_sensor_travado;
  doc["_sensor_reinicios"]       = g_temp_reinicios;

  // v2.0.1: envia somente leitura real do DS18B20. Não reenvia temperatura
  // em cache como válida, porque isso fazia o dashboard parecer travado/atual.
  if (g_temperatura_valida && !isnan(g_temperatura_planta)) {
    doc["_temperatura_valida"] = true;
    doc["_temperatura_planta"] = g_temperatura_planta;
  } else {
    doc["_temperatura_valida"] = false;
    doc["_temperatura_planta"] = nullptr;
  }

  String body;
  serializeJson(doc, body);

  String resp;
  if (!supabaseRpc("bench_push_telemetry", body, resp)) return false;

  JsonDocument r;
  if (deserializeJson(r, resp) != DeserializationError::Ok) return false;
  uint32_t nova_ver = r["config_version"] | 0;
  if (nova_ver > cfg.versao) {
    JsonObject c = r["config"].as<JsonObject>();
    cfg.tempo_injecao_segundos = c["tempo_injecao_segundos"] | cfg.tempo_injecao_segundos;
    cfg.tempo_pausa_segundos   = c["tempo_pausa_segundos"]   | cfg.tempo_pausa_segundos;
    cfg.tempo_retorno_segundos = c["tempo_retorno_segundos"] | cfg.tempo_retorno_segundos;
    cfg.tempo_alivio_segundos  = c["tempo_alivio_segundos"]  | cfg.tempo_alivio_segundos;
    cfg.intervalo_ciclo_horas  = c["intervalo_ciclo_horas"]  | cfg.intervalo_ciclo_horas;
    JsonArrayConst arr = c["luz_janelas"].as<JsonArrayConst>();
    if (!arr.isNull()) aplicarLuzJanelasJson(arr);
    JsonArrayConst harr = c["horarios_disparo"].as<JsonArrayConst>();
    if (!harr.isNull()) aplicarHorariosJson(harr);
    const char* tzs = c["tz"] | (const char*)nullptr;
    if (tzs && *tzs) {
      strncpy(cfg.tz, tzs, sizeof(cfg.tz) - 1);
      cfg.tz[sizeof(cfg.tz) - 1] = 0;
      aplicarTz(cfg.tz);
    }
    cfg.versao = nova_ver;
    salvarConfig();
    Serial.printf("[CFG] atualizado p/ versão %u (%u horario(s), %u janela(s) de luz, tz=%s)\n",
                  (unsigned)nova_ver, (unsigned)cfg.horarios_n,
                  (unsigned)cfg.luz_n, cfg.tz);
  }
  return true;
}

// -------- Loop timers (declarados aqui p/ tratarComando poder forçar telemetria) --------
unsigned long lastTelem = 0, lastCmd = 0, lastTick = 0, lastTemp = 0;

// -------- Comandos --------
void tratarComando(JsonObject cmd) {
  const char* tipo = cmd["tipo"] | "";
  Serial.printf("[CMD] %s\n", tipo);
  if (strcmp(tipo, "FORCE_CYCLE") == 0) {
    pausado_manual = false;
    aplicarFase(INJETANDO);
    lastTelem = 0; // força telemetria no próximo loop
  } else if (strcmp(tipo, "PAUSE") == 0) {
    pausado_manual = true;
    aplicarFase(REPOUSO);
    lastTelem = 0;
  } else if (strcmp(tipo, "RESUME") == 0) {
    pausado_manual = false;
    lastTelem = 0;
  } else if (strcmp(tipo, "UPDATE_CONFIG") == 0) {
    JsonObject p = cmd["payload"].as<JsonObject>();
    cfg.tempo_injecao_segundos = p["tempo_injecao_segundos"] | cfg.tempo_injecao_segundos;
    cfg.tempo_pausa_segundos   = p["tempo_pausa_segundos"]   | cfg.tempo_pausa_segundos;
    cfg.tempo_retorno_segundos = p["tempo_retorno_segundos"] | cfg.tempo_retorno_segundos;
    cfg.tempo_alivio_segundos  = p["tempo_alivio_segundos"]  | cfg.tempo_alivio_segundos;
    cfg.intervalo_ciclo_horas  = p["intervalo_ciclo_horas"]  | cfg.intervalo_ciclo_horas;
    JsonArrayConst arr = p["luz_janelas"].as<JsonArrayConst>();
    if (!arr.isNull()) aplicarLuzJanelasJson(arr);
    JsonArrayConst harr = p["horarios_disparo"].as<JsonArrayConst>();
    if (!harr.isNull()) aplicarHorariosJson(harr);
    const char* tzs = p["tz"] | (const char*)nullptr;
    if (tzs && *tzs) {
      strncpy(cfg.tz, tzs, sizeof(cfg.tz) - 1);
      cfg.tz[sizeof(cfg.tz) - 1] = 0;
      aplicarTz(cfg.tz);
    }
    cfg.versao++;
    salvarConfig();
    Serial.printf("[CFG] UPDATE_CONFIG aplicado (%u horario(s), %u janela(s) de luz, tz=%s)\n",
                  (unsigned)cfg.horarios_n, (unsigned)cfg.luz_n, cfg.tz);
  } else if (strcmp(tipo, "SET_VALVE") == 0) {
    // Log bruto do payload para depuração no Monitor Serial
    String rawPayload;
    serializeJson(cmd["payload"], rawPayload);
    Serial.printf("[SET_VALVE] payload bruto: %s\n", rawPayload.c_str());

    JsonVariantConst pv = cmd["payload"];
    JsonObjectConst p;
    // Se o payload chegou como string JSON, tenta parsear de novo
    JsonDocument tmpDoc;
    if (pv.is<const char*>()) {
      const char* s = pv.as<const char*>();
      Serial.printf("[SET_VALVE] payload chegou como string, reparsing: %s\n", s);
      if (deserializeJson(tmpDoc, s) == DeserializationError::Ok) {
        p = tmpDoc.as<JsonObjectConst>();
      }
    } else {
      p = pv.as<JsonObjectConst>();
    }

    bool v1 = p["v1"] | false;
    bool v2 = p["v2"] | false;
    bool v3 = p["v3"] | false;
    bool v4 = p["v4"] | false;
    // v5 removida do projeto — ignorada mesmo se vier no payload
    (void)p["v5"];

    pausado_manual = true;      // interrompe ciclo automático
    fase = MANUAL;
    fase_inicio_ms = millis();
    escreverValvulas(v1, v2, v3, v4, false);

    Serial.printf("[SET_VALVE] aplicado -> V1=%d V2=%d V3=%d V4=%d\n",
                  v1, v2, v3, v4);
    Serial.printf("[SET_VALVE] GPIOs -> PIN_V1(%d)=%d PIN_V2(%d)=%d PIN_V3(%d)=%d PIN_V4(%d)=%d\n",
                  PIN_V1, relayRead(PIN_V1),
                  PIN_V2, relayRead(PIN_V2),
                  PIN_V3, relayRead(PIN_V3),
                  PIN_V4, relayRead(PIN_V4));


    lastTelem = 0; // publica novo estado das válvulas imediatamente
  } else if (strcmp(tipo, "AC_CONTROL") == 0) {
    // Payload: { acao: "on"|"off", modo: "cool", setpoint: 22, protocolo: "LG"|"SAMSUNG"|"FUJITSU"|"MIDEA"|"ELECTRA" }
    JsonVariantConst pv = cmd["payload"];
    JsonDocument tmpDoc;
    JsonObjectConst p;
    if (pv.is<const char*>()) {
      if (deserializeJson(tmpDoc, pv.as<const char*>()) == DeserializationError::Ok) {
        p = tmpDoc.as<JsonObjectConst>();
      }
    } else {
      p = pv.as<JsonObjectConst>();
    }
    const char* acao = p["acao"] | "off";
    const char* protocolo = p["protocolo"] | "LG";
    float setpoint = p["setpoint"] | 24.0f;
    bool ligar = (strcmp(acao, "on") == 0);

    Serial.printf("[AC] %s protocolo=%s setpoint=%.1f\n",
                  ligar ? "LIGAR" : "DESLIGAR", protocolo, setpoint);

    // Envia comando IR de acordo com o protocolo.
    // Cada fabricante tem seu próprio "state" — usamos os presets mais comuns
    // para modo COOL, fan auto, swing auto.
    if (strcasecmp(protocolo, "LG") == 0) {
      IRLgAc ac(PIN_IR_LED);
      ac.begin();
      ac.setModel(lg_ac_remote_model_t::GE6711AR2853M);
      if (ligar) {
        ac.on();
        ac.setMode(kLgAcCool);
        ac.setTemp((uint8_t)roundf(setpoint));
        ac.setFan(kLgAcFanAuto);
      } else {
        ac.off();
      }
      ac.send();
    } else if (strcasecmp(protocolo, "SAMSUNG") == 0) {
      IRSamsungAc ac(PIN_IR_LED);
      ac.begin();
      if (ligar) {
        ac.on();
        ac.setMode(kSamsungAcCool);
        ac.setTemp((uint8_t)roundf(setpoint));
        ac.setFan(kSamsungAcFanAuto);
      } else {
        ac.off();
      }
      ac.send();
    } else if (strcasecmp(protocolo, "FUJITSU") == 0) {
      IRFujitsuAC ac(PIN_IR_LED);
      ac.begin();
      if (ligar) {
        ac.setMode(kFujitsuAcModeCool);
        ac.setTemp((uint8_t)roundf(setpoint));
        ac.setFanSpeed(kFujitsuAcFanAuto);
        ac.setCmd(kFujitsuAcCmdTurnOn);
      } else {
        ac.setCmd(kFujitsuAcCmdTurnOff);
      }
      ac.send();
    } else if (strcasecmp(protocolo, "MIDEA") == 0 ||
               strcasecmp(protocolo, "ELECTROLUX") == 0) {
      IRMideaAC ac(PIN_IR_LED);
      ac.begin();
      if (ligar) {
        ac.on();
        ac.setMode(kMideaACCool);
        ac.setTemp((uint8_t)roundf(setpoint), true);
        ac.setFan(kMideaACFanAuto);
      } else {
        ac.off();
      }
      ac.send();
    } else if (strcasecmp(protocolo, "ELECTRA") == 0) {
      IRElectraAc ac(PIN_IR_LED);
      ac.begin();
      if (ligar) {
        ac.on();
        ac.setMode(kElectraAcCool);
        ac.setTemp((uint8_t)roundf(setpoint));
        ac.setFan(kElectraAcFanAuto);
      } else {
        ac.off();
      }
      ac.send();
    } else {
      Serial.printf("[AC] protocolo desconhecido: %s\n", protocolo);
    }

    ac_ligado_local = ligar;
    ac_setpoint_local = setpoint;
    ac_protocolo_local = String(protocolo);
    lastTelem = 0; // reporta estado na próxima telemetria
  } else if (strcmp(tipo, "OTA_UPDATE") == 0) {
    // Payload: { "url": "<https signed url>", "filename": "..." }
    JsonVariantConst pv = cmd["payload"];
    JsonDocument tmpDoc;
    JsonObjectConst p;
    if (pv.is<const char*>()) {
      if (deserializeJson(tmpDoc, pv.as<const char*>()) == DeserializationError::Ok) {
        p = tmpDoc.as<JsonObjectConst>();
      }
    } else {
      p = pv.as<JsonObjectConst>();
    }
    const char* url = p["url"] | "";
    if (!*url) {
      Serial.println("[OTA] payload sem 'url' — abortado");
      return;
    }
    Serial.printf("[OTA] iniciando download: %s\n", url);
    // Para atualizar com segurança: desliga válvulas e luzes.
    pausado_manual = true;
    escreverValvulas(false, false, false, false, false);
    relayWrite(PIN_LUZ, false);
    // Publica um último ping de telemetria antes de reiniciar.
    enviarTelemetria();

    WiFiClientSecure otaClient;
    otaClient.setInsecure();
    httpUpdate.rebootOnUpdate(true);
    // Piscar LED durante download
    httpUpdate.onProgress([](int cur, int total) {
      static uint32_t lastLog = 0;
      digitalWrite(PIN_LED, (cur / 8192) & 1 ? HIGH : LOW);
      if (millis() - lastLog > 1000) {
        lastLog = millis();
        Serial.printf("[OTA] %d / %d bytes (%d%%)\n",
                      cur, total, total > 0 ? (cur * 100 / total) : 0);
      }
    });
    t_httpUpdate_return ret = httpUpdate.update(otaClient, String(url));
    switch (ret) {
      case HTTP_UPDATE_FAILED:
        Serial.printf("[OTA] FALHOU: (%d) %s\n",
                      httpUpdate.getLastError(),
                      httpUpdate.getLastErrorString().c_str());
        pausado_manual = false;   // libera ciclo automático de novo
        digitalWrite(PIN_LED, HIGH);
        break;
      case HTTP_UPDATE_NO_UPDATES:
        Serial.println("[OTA] Sem atualização disponível");
        pausado_manual = false;
        break;
      case HTTP_UPDATE_OK:
        Serial.println("[OTA] OK — reiniciando…");
        // rebootOnUpdate(true) já cuidou do restart.
        break;
    }
  }
}


void puxarComandos() {
  if (creds.device_token.length() == 0) return;
  JsonDocument body;
  body["_bancada_id"]   = creds.bancada_id;
  body["_device_token"] = creds.device_token;
  String bodyStr;
  serializeJson(body, bodyStr);

  String resp;
  if (!supabaseRpc("bench_pull_commands", bodyStr, resp)) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  JsonArray arr = doc["comandos"].as<JsonArray>();
  for (JsonObject c : arr) tratarComando(c);
}

// -------- Máquina de estados --------
void tickCiclo() {
  if (fase == MANUAL) return;   // controle manual — nao interferir
  if (pausado_manual) { aplicarFase(REPOUSO); return; }
  uint32_t decorrido = (millis() - fase_inicio_ms) / 1000;
  switch (fase) {
    case REPOUSO:
      // Não dispara sozinho: o backend agenda os ciclos por horário
      // (America/Sao_Paulo) e envia FORCE_CYCLE via bench_pull_commands.
      break;
    case INJETANDO:
      if (decorrido >= cfg.tempo_injecao_segundos) aplicarFase(PAUSADO);
      break;
    case PAUSADO:
      if (decorrido >= cfg.tempo_pausa_segundos) aplicarFase(RETORNANDO);
      break;
    case RETORNANDO:
      // Retorno -> Repouso direto (fase ALIVIO removida com a V5 na v1.9.2)
      if (decorrido >= cfg.tempo_retorno_segundos) aplicarFase(REPOUSO);
      break;
    case ALIVIO:
      // Compat: se alguma bancada estiver nessa fase por config antiga, sai imediato
      aplicarFase(REPOUSO);
      break;

    case MANUAL: break;   // valvulas fixas ate novo comando
    case OFFLINE: break;
  }
}

// -------- Setup / Loop --------
void setup() {
  // BOOT-SAFE: em placas Low Level Trigger, o GPIO fica em HIGH-Z durante o
  // reset — o SSR interpreta como "quase LOW" e pode chavear brevemente.
  // Colocamos os pinos em OUTPUT + nível de "desligado" (HIGH em LLT) como
  // ABSOLUTA PRIMEIRA COISA, antes de Serial/sensores/rede.
  for (int p : {PIN_V1_V4, PIN_V2_V3, PIN_LUZ}) {
    pinMode(p, OUTPUT);
    relayWrite(p, false);
  }
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  g_luz_ligada = false;

  // IR: inicializa LED em nível baixo (transistor bloqueado).
  irsend.begin();
  pinMode(PIN_IR_LED, OUTPUT);
  digitalWrite(PIN_IR_LED, LOW);

  Serial.begin(115200);
  delay(200);
  Serial.printf("\n== GeneLab Bancada ESP32 v%s (direct-Supabase) ==\n", FIRMWARE_VERSION);
  Serial.printf("[RELAY] polaridade: ACTIVE_%s\n", RELAY_ACTIVE_LOW ? "LOW" : "HIGH");

  pinMode(PIN_RESET_BTN, INPUT_PULLUP);

  dsSensor.begin();
  dsSensor.setResolution(12);
  dsSensor.setWaitForConversion(true);  // v1.9.6: leitura bloqueante evita valor cacheado/antigo
  g_tem_ds18b20 = dsSensor.getAddress(g_ds18b20_addr, 0);
  Serial.printf("[TEMP] DS18B20 %s — sensores encontrados: %u\n",
                g_tem_ds18b20 ? "detectado" : "NAO detectado",
                (unsigned)dsSensor.getDeviceCount());

  // DS3231 opcional (I²C em SDA=21 / SCL=22). Se não responder, seguimos sem ele.
  Wire.begin();
  g_tem_rtc = g_rtc.begin();
  if (g_tem_rtc) {
    Serial.println("[RTC] DS3231 detectado no barramento I2C");
    if (g_rtc.lostPower()) {
      Serial.println("[RTC] perdeu energia — aguardando NTP p/ ajustar");
    }
  } else {
    Serial.println("[RTC] DS3231 não encontrado — usando NTP + millis()");
  }

  carregarPrefs();

  // Aplica fuso ANTES de ler a hora do RTC p/ que getLocalTime já retorne local.
  aplicarTz(cfg.tz);
  carregarHoraDoRtc();

  if (digitalRead(PIN_RESET_BTN) == LOW) {
    Serial.println("Botão RESET pressionado — apagando credenciais em 5s…");
    delay(5000);
    if (digitalRead(PIN_RESET_BTN) == LOW) {
      apagarTudo();
      creds = {};
      Serial.println("Preferences apagadas.");
    }
  }

  bool precisaParear = (creds.device_token.length() == 0);
  abrirPortalWifi(precisaParear);

  Serial.printf("Wi-Fi OK: %s\n", WiFi.localIP().toString().c_str());
  WiFi.setSleep(false);       // v1.9.8 — evita economia de Wi-Fi atrapalhar HTTP em fonte externa
  WiFi.setAutoReconnect(true);
  digitalWrite(PIN_LED, HIGH);

  // NTP com fuso America/Sao_Paulo (UTC-3, sem horário de verão).
  // Fuso vem das Preferences (persistido). Default: America/Sao_Paulo.
  aplicarTz(cfg.tz);
  configTzTime(cfg.tz, "pool.ntp.org", "time.google.com", "a.st1.ntp.br");

  if (precisaParear) {
    if (strlen(pairing_code_buf) != 6) {
      Serial.println("[PAIR] código ausente/ inválido; reiniciando p/ novo portal");
      delay(3000);
      ESP.restart();
    }
    bool ok = false;
    for (int i = 0; i < 3 && !ok; i++) {
      ok = parear(pairing_code_buf);
      if (!ok) delay(2000);
    }
    if (!ok) {
      Serial.println("[PAIR] falhou; apagando e reiniciando");
      apagarTudo();
      delay(2000);
      ESP.restart();
    }
  }

  aplicarFase(REPOUSO);
}

// (timers movidos para antes de tratarComando)

// Reinicia o barramento 1-Wire e re-inicializa o DS18B20 somente após leituras
// inválidas consecutivas. Valor estável não é tratado como erro.
void reiniciarBarramento1Wire() {
  Serial.printf("[TEMP] falhas consecutivas no sensor em %.4f °C — reiniciando 1-Wire (reinit #%u)\n",
                g_temp_ultimo_valor, (unsigned)(g_temp_reinicios + 1));
  oneWire.reset();
  dsSensor.begin();
  dsSensor.setResolution(12);
  dsSensor.setWaitForConversion(true);
  g_tem_ds18b20 = dsSensor.getAddress(g_ds18b20_addr, 0);
  Serial.printf("[TEMP] re-scan: %u sensor(es), primeiro=%s\n",
                (unsigned)dsSensor.getDeviceCount(),
                g_tem_ds18b20 ? "OK" : "NAO encontrado");
  g_temp_reinicios++;
}

void lerTemperatura() {
  // v2.0.1: leitura igual ao teste simples da IDE Arduino: converte o barramento
  // inteiro e lê o primeiro sensor por índice. Isso evita falso erro quando a
  // leitura por endereço retorna falha mesmo com o DS18B20 respondendo.
  dsSensor.requestTemperatures();
  float t = dsSensor.getTempCByIndex(0);
  bool valida = t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 125.0;

  if (valida) {
    bool estavaInvalida = !g_temperatura_valida;
    g_temperatura_planta = t;
    g_ultima_temperatura_valida = t;
    g_temperatura_valida = true;
    g_temp_falhas_seguidas = 0;
    g_temp_invalidas_consecutivas = 0;
    if (g_sensor_travado) {
      Serial.println("[TEMP] sensor voltou a responder");
      g_sensor_travado = false;
    }
    if (estavaInvalida) lastTelem = 0;
    Serial.printf("[TEMP] %.4f C\n", g_temperatura_planta);
  } else {
    g_temp_falhas_seguidas++;
    if (g_temp_invalidas_consecutivas < 255) g_temp_invalidas_consecutivas++;
    Serial.printf("[TEMP] leitura invalida (t=%.4f, falhas=%u, ultima=%.4f)\n",
                  t, (unsigned)g_temp_falhas_seguidas,
                  g_ultima_temperatura_valida);
    g_temperatura_planta = NAN;
    g_temperatura_valida = false;
    lastTelem = 0; // publica null/estado atual para não parecer congelado
    if (g_temp_falhas_seguidas >= 3) {
      g_sensor_travado = true;
      reiniciarBarramento1Wire();
      g_temp_falhas_seguidas = 0;
    }
  }

  // v1.9.9 — temperatura estável é uma leitura válida. Mantemos apenas o
  // último valor observado para diagnóstico/Serial, sem transformar em falha.
  if (!isnan(g_temperatura_planta)) {
    g_temp_ultimo_valor = g_temperatura_planta;
  }

  // v1.9.3 — push adaptativo por variação de temperatura.
  // Em REPOUSO a telemetria vai a cada 15s pra poupar tráfego, mas se a
  // temperatura mudar mais que TEMP_DELTA_PUSH desde o último envio, força
  // telemetria imediata pra que o dashboard reflita a mudança sem esperar.
  if (!isnan(g_temperatura_planta)) {
    if (isnan(g_temperatura_publicada) ||
        fabsf(g_temperatura_planta - g_temperatura_publicada) >= TEMP_DELTA_PUSH) {
      lastTelem = 0; // força push no próximo loop
    }
  }
}

void loop() {
  unsigned long now = millis();

  // v1.9.0 — intervalos adaptativos p/ suportar 100+ bancadas na mesma
  // instância Supabase. Em REPOUSO (>99% do tempo) reduz drasticamente
  // requisições; durante ciclo ativo / manual mantém responsividade.
  // v1.9.3 — leitura de temperatura sobe pra 3s e há push imediato por delta.
  bool ativo = (fase != REPOUSO) || pausado_manual;
  unsigned long intervaloTelem = ativo ? 2000UL  : 15000UL;  // 2s ativo / 15s parado (delta força push)
  unsigned long intervaloCmd   = ativo ? 1500UL  : 5000UL;   // 1.5s ativo / 5s parado

  if (now - lastTick > 1000)          { lastTick  = now; tickCiclo(); tickLuz(); tickAgendaCiclo(); sincronizarNtpParaRtc(); }
  if (now - lastTemp > 3000)          { lastTemp  = now; lerTemperatura(); }  // 3s p/ detectar variação rápido
  if (now - lastCmd  > intervaloCmd)  { lastCmd   = now; puxarComandos(); }
  if (now - lastTelem > intervaloTelem) {
    lastTelem = now;
    if (enviarTelemetria() && !isnan(g_temperatura_planta)) {
      g_temperatura_publicada = g_temperatura_planta; // marca somente o que foi publicado com sucesso
    }
  }

  static unsigned long btn_pressed_since = 0;
  if (digitalRead(PIN_RESET_BTN) == LOW) {
    if (btn_pressed_since == 0) btn_pressed_since = now;
    else if (now - btn_pressed_since > 5000) {
      Serial.println("Reset em runtime; reabrindo portal…");
      apagarTudo();
      ESP.restart();
    }
  } else {
    btn_pressed_since = 0;
  }
}
