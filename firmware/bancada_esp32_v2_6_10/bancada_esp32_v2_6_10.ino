/*
 * VitroCeres OS — Firmware unificado da Prateleira ESP32
 * =============================================================
 * v2.4.0 — MESMO binário controla, no mesmo ESP32:
 *   • Válvulas V1/V4 e V2/V3 (ciclo hidráulico)
 *   • Luzes da prateleira (timer HH:MM local, DS3231/NTP)
 *   • Temperatura da planta (DS18B20)
 *   • Ar-condicionado por IR (envio + aprendizado)
 *   • Sensor de CO2 SCD41 (I2C, opcional — mesmo bus do DS3231)
 *   • Balança HX711 + célula de carga (opcional)
 *
 * Cada periférico é AUTO-DETECTADO no boot. Se o hardware não estiver
 * presente, os ticks correspondentes ficam inertes — o mesmo firmware
 * roda em qualquer prateleira, com ou sem CO2/balança.
 *
 * Provisionamento pelo portal Wi-Fi (WiFiManager):
 *   - código de pareamento (6 dígitos) → bench_pair
 *   - device_token do sensor CO2 (opcional, tela "Sensores CO2")
 *   - device_token da balança (opcional, tela "Balanças")
 *   - identificador da muda ativa (opcional)
 *
 * Comunicação:
 *   - Prateleira/AC: RPC direta ao Supabase (bench_push_telemetry / _pull_commands)
 *   - CO2:  POST https://explantelab.lovable.app/api/public/co2/reading
 *   - Peso: POST https://explantelab.lovable.app/api/public/scale/reading
 *
 * Bibliotecas Arduino IDE:
 *   WiFiManager (tzapu), ArduinoJson, OneWire, DallasTemperature,
 *   RTClib, IRremoteESP8266, HX711 (bogde), Sensirion I2C SCD4x.
 * =============================================================
 */


#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_system.h>   // v2.4.7: esp_reset_reason() p/ distinguir boot por energia
#include <esp_task_wdt.h> // v2.5.9: watchdog armado apenas durante o OTA
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>            // NTP + horário local p/ timer das luzes
#include <esp_sntp.h>        // v2.5.6: confirma se o NTP realmente sincronizou
#include <sys/time.h>        // settimeofday (sincronizar system clock com DS3231)
#include <HTTPUpdate.h>      // OTA via HTTPS (v1.6.0)
#include <Wire.h>            // I2C p/ DS3231 (v1.8.0)
#include <RTClib.h>          // DS3231 opcional (v1.8.0)
#include <IRremoteESP8266.h> // Controle de ar-condicionado via IR (v2.1.0)
#include <IRsend.h>
#include <IRrecv.h>          // Aprendizado IR (v2.2.0)
#include <IRutils.h>
#include <ir_LG.h>
#include <ir_Samsung.h>
#include <ir_Fujitsu.h>
#include <ir_Midea.h>
#include <ir_Electra.h>
#include <ir_Whirlpool.h>    // Consul (grupo Whirlpool) — v2.1.4
#include <HX711.h>                  // Balança célula de carga (v2.4.0)
#include <SensirionI2cScd4x.h>      // Sensor CO2 SCD41 (biblioteca Sensirion v1.1.0+)


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
static const int PIN_DS18B20 = 14;  // v2.4.5: DATA do DS18B20 movido do GPIO 4 para o GPIO 14
static const int PIN_IR_LED = 32;   // LED IR p/ ar-condicionado (v2.1.0)
static const int PIN_IR_RX  = 33;   // Receptor IR VS1838B/TL1838 (v2.2.0)

// v2.5.2 / v2.5.3 — Botão físico de ciclo manual na caixa.
// Ligação: um lado do botão no GPIO 4, outro lado no GND (usa pull-up interno).
// v2.5.3: aperto CURTO (60 ms .. 2 s) INICIA o ciclo manual (se em REPOUSO);
// aperto LONGO (>= 2 s) CANCELA o ciclo em andamento e volta ao repouso com as
// válvulas fechadas. Isso evita cancelamento acidental. Funciona 100% offline.
static const int PIN_BOTAO_CICLO = 4;
static const unsigned long BOTAO_LONGO_MS = 2000;  // limiar do aperto longo

// v2.5.4 — LED de STATUS do ciclo (na caixa, ao lado do botão).
// Ligação: GPIO 19 -> resistor 330R -> anodo do LED; catodo no GND.
// Padrões de pisca (funcionam 100% offline):
//   Repouso ............... apagado (pulso curto de "vivo" a cada 3 s)
//   Injetando (auto) ...... 1 pisca lento  (500 ms ligado / 500 ms apagado)
//   Pausa ................. pisca curto    (150 ms a cada 2 s)
//   Retornando (auto) ..... pisca rápido   (150 ms / 150 ms)
//   Ciclo MANUAL (botão) .. LED aceso fixo durante todo o ciclo manual
//   Pausado (STOP) ........ 2 piscas curtas a cada 2 s
static const int  PIN_LED_CICLO = 19;
static const bool LED_CICLO_ACTIVE_LOW = false;  // true se o LED liga em GPIO LOW
#define ledCicloWrite(on) digitalWrite(PIN_LED_CICLO, \
  (on) ? (LED_CICLO_ACTIVE_LOW ? LOW : HIGH) : (LED_CICLO_ACTIVE_LOW ? HIGH : LOW))

// Marca que o ciclo atual foi iniciado pelo botão físico (ciclo manual).
static bool ciclo_manual_ativo = false;

// v2.4.0 — Balança HX711 (opcional, ativa se sensor responder)
static const int PIN_HX_DOUT = 16;
static const int PIN_HX_SCK  = 17;
// v2.4.0 — SCD41 usa mesmo barramento I2C do DS3231 (SDA=21 / SCL=22).

static const char* FIRMWARE_VERSION = "2.6.10";

// -------- IR (ar-condicionado) --------
// Estado local do ar (última decisão aplicada) — usado só para telemetria/debug.
IRsend irsend(PIN_IR_LED);
static bool ac_ligado_local = false;
static float ac_setpoint_local = 24.0;
static String ac_protocolo_local = "";

// -------- IR RX (aprendizado — v2.2.0) --------
static const uint16_t IR_CAPTURE_BUFFER = 1024;   // ACs mandam ~200 pulsos
static const uint8_t  IR_CAPTURE_TIMEOUT_MS = 50; // gap p/ fechar frame
static const uint16_t IR_MIN_UNKNOWN_SIZE = 12;
IRrecv irrecv(PIN_IR_RX, IR_CAPTURE_BUFFER, IR_CAPTURE_TIMEOUT_MS, true);
static bool          ir_learn_ativo = false;
static String        ir_learn_ar_id = "";
static String        ir_learn_modo  = "cool";  // v2.3.0 — 'cool' ou 'heat'
static unsigned long ir_learn_deadline_ms = 0;

// -------- Polaridade dos relés (v1.9.5+) --------
// Polaridade do acionamento dos relés/SSR das VÁLVULAS.
// true  => ACTIVE_LOW : GPIO LOW liga a carga (módulos "Low Level Trigger").
// false => ACTIVE_HIGH: GPIO HIGH liga a carga (SSR industrial tipo Fotek).
static const bool RELAY_ACTIVE_LOW = true;

// Polaridade INDEPENDENTE do relé da LUZ (GPIO 27).
// >>> AQUI se inverte a lógica da luz sem mexer nas válvulas. <<<
// true  => GPIO 27 em LOW  liga a luz
// false => GPIO 27 em HIGH liga a luz
static const bool LUZ_ACTIVE_LOW = false;


// Macros (não geram protótipo automático no Arduino IDE — evita ordem de tipo).
#define RELAY_ON_LEVEL  (RELAY_ACTIVE_LOW ? LOW  : HIGH)
#define RELAY_OFF_LEVEL (RELAY_ACTIVE_LOW ? HIGH : LOW)
#define relayWrite(pin, on) digitalWrite((pin), (on) ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL)
#define relayRead(pin)      (digitalRead(pin) == RELAY_ON_LEVEL)

#define LUZ_ON_LEVEL  (LUZ_ACTIVE_LOW ? LOW  : HIGH)
#define LUZ_OFF_LEVEL (LUZ_ACTIVE_LOW ? HIGH : LOW)
#define luzWrite(on)  digitalWrite(PIN_LUZ, (on) ? LUZ_ON_LEVEL : LUZ_OFF_LEVEL)




// -------- Sensor DS18B20 (temperatura da planta) --------
OneWire oneWire(PIN_DS18B20);
DallasTemperature dsSensor(&oneWire);
DeviceAddress g_ds18b20_addr;
bool g_tem_ds18b20 = false;
float g_temperatura_planta = NAN;
float g_ultima_temperatura_valida = NAN; // diagnóstico local; não é reenviada como leitura nova
float g_temperatura_publicada = NAN;   // último valor efetivamente enviado
bool  g_temperatura_valida = false;    // informa ao backend se a leitura atual é válida
bool  g_sem_sensor_temp = false;       // v2.5.0: prateleira sem sensor de temperatura
uint16_t g_temp_sem_leitura_seguidas = 0;
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
bool       g_rtc_bat_fraca    = false;   // v2.4.6: OSF ligado => bateria CR2032 fraca/ausente
uint32_t   g_ultimo_check_bat = 0;       // millis() da última leitura do OSF
uint32_t   g_ultimo_save_epoch = 0;      // v2.4.7: millis() do último "carimbo" de hora na NVS
uint32_t   g_ultima_sync_rtc  = 0;       // millis() da última gravação NTP -> RTC
// v2.5.6 — diagnóstico da saúde do relógio (bateria CR2032):
//   g_rtc_hora_perdida : no boot o DS3231 voltou sem hora válida / retrocedeu.
//   g_rtc_desvio_seg   : desvio (s) entre a hora que o RTC marcava no boot e a
//                        hora real entregue pelo NTP. Desvio grande = bateria ruim.
bool       g_rtc_hora_perdida = false;
int32_t    g_rtc_desvio_seg   = 0;
bool       g_rtc_desvio_medido = false;
uint32_t   g_rtc_epoch_boot   = 0;       // unixtime lido do RTC no boot (0 = inválido)
uint32_t   g_rtc_epoch_boot_ms = 0;      // millis() no instante dessa leitura
// Desvio tolerado antes de considerar o relógio/bateria suspeitos.
const int32_t RTC_DESVIO_MAX_S = 120;

// -------- v2.6.0 — Diagnóstico de reinício / rede --------
// Objetivo: descobrir POR QUE a prateleira sai do ar (brownout na comutação da
// válvula 220 Vac x travamento de software). Tudo é publicado na telemetria.
static const char* g_reset_reason = "?";   // motivo do último boot
static uint32_t g_heap_min        = 0xFFFFFFFF; // menor heap livre visto
static uint32_t g_wifi_reconexoes = 0;     // quantas vezes o link caiu e voltou
// Watchdog global: se o loop travar, o ESP32 reinicia sozinho e retoma o ciclo
// pelo estado salvo na NVS (em vez de ficar horas com a válvula energizada).
static const uint32_t WDT_TIMEOUT_S = 30;
static bool g_wdt_armado = false;
// (as funções nomeResetReason()/armarWatchdogPadrao() ficam mais abaixo, depois
//  das declarações de tipos — o Arduino gera protótipos antes da 1ª função do
//  sketch, e ter função aqui quebrava a declaração de FaseCiclo/LuzJanela.)



// -------- SCD41 (CO2 ambiente — v2.4.0) --------
// Sensor opcional; se não responder no I2C, os ticks de CO2 ficam desabilitados.
SensirionI2cScd4x g_scd4x;
bool     g_tem_scd41         = false;
uint16_t g_co2_ppm           = 0;
float    g_scd41_temp_c      = NAN;
float    g_scd41_umid        = NAN;
uint32_t g_co2_soma          = 0;
uint16_t g_co2_amostras      = 0;
unsigned long g_ts_ultima_co2_leitura = 0;
unsigned long g_ts_ultimo_co2_envio   = 0;

// -------- HX711 balança (opcional — v2.4.0) --------
// Cada ESP32 pode ter uma balança + célula de carga ligados; o firmware detecta
// no boot e desabilita graciosamente se o HX711 não estiver presente. Cadastre
// a balança na tela "Balanças" do painel, copie o token e cole no portal Wi-Fi.
HX711 g_balanca;
bool  g_tem_hx711            = false;
float g_hx_fator_cal         = 1.0f;   // calibração da célula (NVS)
long  g_hx_zero_offset       = 0;      // tare (NVS)
float g_hx_peso_g            = 0.0f;
String g_muda_ident          = "";     // etiqueta da muda ativa (NVS)
String g_token_scale         = "";     // device_token da balança (NVS)
// Token do sensor de CO2 já embutido — não precisa digitar nada no portal.
#define CO2_TOKEN_FIXO "b4433f371faae217032b7703fd56d18e6a1931cd7a64a9ba"
String g_token_co2           = CO2_TOKEN_FIXO;  // device_token do sensor CO2 (fixo)
bool   g_hx_pode_amostrar    = false;
String g_hx_motivo_bloqueio  = "iniciando";
unsigned long g_ts_ultima_hx_leitura = 0;
unsigned long g_ts_ultimo_hx_status  = 0;
unsigned long g_ts_ultimo_hx_envio   = 0;

// URL base (mesmo host do painel) — endpoints públicos /api/public/*.
static const char* API_HOST = "https://explantelab.lovable.app";


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

// -------- v2.6.0 — motivo do último boot / watchdog global --------
static const char* nomeResetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "poweron";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_INT_WDT:  return "int_wdt";
    case ESP_RST_WDT:      return "wdt";
    case ESP_RST_PANIC:    return "panic";
    case ESP_RST_SW:       return "software";
    case ESP_RST_EXT:      return "botao_reset";
    case ESP_RST_DEEPSLEEP:return "deepsleep";
    case ESP_RST_SDIO:     return "sdio";
    default:               return "desconhecido";
  }
}

void armarWatchdogPadrao() {
  g_wdt_armado = (esp_task_wdt_init(WDT_TIMEOUT_S, true) == ESP_OK);
  if (g_wdt_armado) esp_task_wdt_add(NULL);
  Serial.printf("[WDT] watchdog global %s (%us)\n",
                g_wdt_armado ? "armado" : "FALHOU", (unsigned)WDT_TIMEOUT_S);
}

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

// v2.6.0 — Comutação ESCALONADA. Antes os dois pares mudavam no mesmo instante;
// desligar/ligar solenoides de 220 Vac juntos soma os transientes e é o momento
// exato em que a prateleira saía do ar. Agora desliga primeiro, espera ~150 ms
// e só então energiza o outro par.
void escreverValvulas(bool v1, bool v2, bool v3, bool v4, bool /*v5*/) {
  const bool inj = (v1 || v4);   // par injecao (V1 + V4) — GPIO 25
  const bool ret = (v2 || v3);   // par retorno (V2 + V3) — GPIO 26
  const bool inj_atual = relayRead(PIN_V1_V4);
  const bool ret_atual = relayRead(PIN_V2_V3);

  bool desligou = false;
  if (!inj && inj_atual) { relayWrite(PIN_V1_V4, false); desligou = true; }
  if (!ret && ret_atual) { relayWrite(PIN_V2_V3, false); desligou = true; }

  const bool vai_ligar = (inj && !inj_atual) || (ret && !ret_atual);
  if (desligou && vai_ligar) delay(150);   // separa os transientes

  if (inj && !inj_atual) relayWrite(PIN_V1_V4, true);
  if (ret && !ret_atual) relayWrite(PIN_V2_V3, true);
  // v5 ignorado (válvula removida do projeto na v1.9.2)
}


// Persistência do estado do ciclo em NVS (namespace "ciclo") — sobrevive a
// quedas de energia mesmo no meio da Injeção/Pausa/Retorno.
void persistirCiclo(FaseCiclo f) {
  Preferences p;
  p.begin("ciclo", false);
  p.putUChar("fase", (uint8_t)f);
  // Epoch UTC do início da fase (0 se relógio ainda não sincronizou).
  time_t nowEpoch = time(nullptr);
  if (nowEpoch < 1700000000) nowEpoch = 0;
  p.putULong("ini_epoch", (uint32_t)nowEpoch);
  p.end();
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
  if (f == REPOUSO) ciclo_manual_ativo = false;  // v2.5.4 — encerra sinalização manual
  persistirCiclo(f);
  Serial.printf("[FASE] %s\n", faseNome(f));
}

// Retoma o ciclo salvo em NVS após reboot. Se ainda estiver dentro da duração
// da fase (com base no relógio real), continua de onde parou; se já passou,
// avança fases até chegar em REPOUSO. Sem relógio válido, reinicia a fase.
void restaurarCiclo() {
  Preferences p;
  p.begin("ciclo", true);
  uint8_t  fsalva = p.getUChar("fase", (uint8_t)REPOUSO);
  uint32_t iniEp  = p.getULong("ini_epoch", 0);
  p.end();

  FaseCiclo f = (FaseCiclo)fsalva;
  if (f == REPOUSO || f == MANUAL || f == OFFLINE) { aplicarFase(REPOUSO); return; }

  time_t nowEp = time(nullptr);
  uint32_t decorrido = 0;
  if (iniEp > 0 && nowEp > 1700000000 && (uint32_t)nowEp > iniEp) {
    decorrido = (uint32_t)nowEp - iniEp;
  }
  // v2.4.8: sem relógio confiável (RTC sem bateria e NTP ainda indisponível)
  // não dá para saber quanto tempo passou — retomar reiniciaria a fase inteira.
  // Nesse caso vamos para REPOUSO e esperamos o próximo horário programado.
  if (decorrido == 0 && (iniEp == 0 || nowEp <= 1700000000)) {
    Serial.println("[CICLO] estado salvo ignorado: relogio invalido no boot -> REPOUSO");
    aplicarFase(REPOUSO);
    return;
  }
  Serial.printf("[CICLO] retomando %s (decorrido=%us)\n", faseNome(f), (unsigned)decorrido);

  // Avança fases consumindo o tempo decorrido
  while (true) {
    uint32_t dur = 0;
    switch (f) {
      case INJETANDO:  dur = cfg.tempo_injecao_segundos; break;
      case PAUSADO:    dur = cfg.tempo_pausa_segundos;   break;
      case RETORNANDO: dur = cfg.tempo_retorno_segundos; break;
      default:         aplicarFase(REPOUSO); return;
    }
    if (decorrido < dur) {
      // Retoma no meio da fase: ajusta fase_inicio_ms para refletir o decorrido.
      aplicarFase(f);
      fase_inicio_ms = millis() - (uint32_t)decorrido * 1000UL;
      return;
    }
    decorrido -= dur;
    // Próxima fase da máquina de estados
    if (f == INJETANDO)       f = PAUSADO;
    else if (f == PAUSADO)    f = RETORNANDO;
    else if (f == RETORNANDO) { aplicarFase(REPOUSO); return; }
    else                      { aplicarFase(REPOUSO); return; }
  }
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

unsigned long g_luz_teste_ate = 0;  // v2.5.8 — timer para teste de luz (millis)

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
  // v2.5.8 — Prioridade para o teste manual de 7s
  bool testeAtivo = (g_luz_teste_ate > 0 && millis() < g_luz_teste_ate);
  if (g_luz_teste_ate > 0 && !testeAtivo) {
    g_luz_teste_ate = 0; // teste expirou
    Serial.println("[LUZ] Teste de 7s finalizado");
  }

  struct tm ti;
  bool ntpOk = getLocalTime(&ti, 50);
  int agora = ntpOk ? (ti.tm_hour * 60 + ti.tm_min) : -1;
  
  bool deveLigar = testeAtivo;
  if (!deveLigar && ntpOk) {
    for (uint8_t i = 0; i < cfg.luz_n && i < MAX_LUZ_JANELAS; i++) {
      if (janelaAtiva(cfg.luz_janelas[i], agora)) { deveLigar = true; break; }
    }
  }

  if (deveLigar != g_luz_ligada) {
    g_luz_ligada = deveLigar;
    luzWrite(deveLigar);
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
// v2.4.8: o fallback por intervalo NUNCA pode disparar logo após o boot.
// Antes, com o relógio inválido (RTC sem bateria / sem NTP ainda), o teste
// "g_ultimo_disparo_ms == 0" fazia o ESP injetar imediatamente ao religar.
// Agora o boot conta como "último disparo" e ainda exigimos um período de
// carência para dar tempo do NTP/RTC entregar a hora certa.
const uint32_t BOOT_CARENCIA_MS = 10UL * 60UL * 1000UL;  // 10 min
uint32_t g_boot_ms             = 0;

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

// v2.4.7 — Saúde da bateria do DS3231 (detecção persistente).
// O DS3231 não mede a tensão da CR2032. Duas evidências indiretas são usadas:
//   1) OSF (Oscillator Stop Flag, bit 7 do reg. 0x0F): liga quando o oscilador
//      parou, ou seja, faltou VCC e a bateria não segurou o relógio.
//   2) "Carimbo de hora" salvo na NVS a cada 5 min: se, no boot, o RTC voltar
//      com uma hora ANTERIOR ao último carimbo (ou muito fora), ele perdeu a
//      hora — mesmo que o OSF já tenha sido limpo por um adjust() anterior.
// O resultado é gravado na NVS, porque adjust()/NTP limpa o OSF e o alerta
// sumiria no próximo boot mesmo com a bateria morta. O aviso só é zerado num
// boot por energia (ESP_RST_POWERON) em que ambas as evidências estejam OK.
bool lerOsfDs3231() {
  Wire.beginTransmission(0x68);
  Wire.write(0x0F);
  if (Wire.endTransmission() != 0) return false;
  // casts explícitos evitam o aviso de sobrecarga ambígua do Wire.h (ESP32 core)
  if (Wire.requestFrom((uint8_t)0x68, (uint8_t)1) != 1) return false;
  uint8_t status = Wire.read();
  return (status & 0x80) != 0;
}

// v2.4.9 — o OSF é "sticky": uma vez ligado, permanece ligado até ser zerado
// por software. Sem esta limpeza o aviso de bateria NUNCA sumia, mesmo depois
// de trocar a CR2032. Limpamos o bit após cada avaliação, para que uma nova
// ativação signifique de fato uma nova parada do oscilador.
void limparOsfDs3231() {
  Wire.beginTransmission(0x68);
  Wire.write(0x0F);
  if (Wire.endTransmission() != 0) return;
  if (Wire.requestFrom((uint8_t)0x68, (uint8_t)1) != 1) return;
  uint8_t status = Wire.read();
  if ((status & 0x80) == 0) return;
  Wire.beginTransmission(0x68);
  Wire.write(0x0F);
  Wire.write((uint8_t)(status & 0x7F));
  Wire.endTransmission();
}


static void salvarFlagBateriaRtc(bool fraca) {
  prefs.begin("genelab", false);
  prefs.putBool("rtc_bat", fraca);
  prefs.end();
}

static bool lerFlagBateriaRtc() {
  prefs.begin("genelab", true);
  bool v = prefs.getBool("rtc_bat", false);
  prefs.end();
  return v;
}

// Carimbo de hora — chamado periodicamente no loop quando a hora é confiável.
// v2.5.9 — Intervalo elevado de 5 min para 1 h. Cada carimbo é uma gravação
// física real na NVS (o epoch muda sempre), então 5 min significava ~105 mil
// escritas/ano no flash. Com 1 h o desgaste cai ~12x e o diagnóstico da bateria
// CR2032 continua igual: se o relógio retroceder após queda de energia, a
// comparação com o carimbo ainda detecta (a janela de incerteza vira 1 h).
static const uint32_t CARIMBO_RTC_INTERVALO_MS = 3600UL * 1000UL;

void salvarCarimboHoraRtc(bool forcar) {
  if (!g_tem_rtc) return;
  uint32_t agora = millis();
  if (!forcar && g_ultimo_save_epoch != 0 &&
      (agora - g_ultimo_save_epoch) < CARIMBO_RTC_INTERVALO_MS) return;
  DateTime now = g_rtc.now();
  if (!now.isValid() || now.year() < 2024) return;
  uint32_t ts = (uint32_t)now.unixtime();
  g_ultimo_save_epoch = agora;
  prefs.begin("genelab", false);
  // Evita escrita redundante quando o valor não mudou (ex.: RTC parado).
  if (prefs.getULong("rtc_ts", 0) != ts) prefs.putULong("rtc_ts", ts);
  prefs.end();
}

void tickCarimboHoraRtc() { salvarCarimboHoraRtc(false); }

// v2.5.6 — Desvio do RTC contra o NTP.
// O relógio pode voltar com uma hora "válida" (ex.: 2024) mas errada: nesse caso
// o OSF já foi limpo e a hora não é inválida, então nada era acusado. Aqui a
// hora que o DS3231 marcava no boot é comparada com a hora real do NTP.
void tickDesvioRtc() {
  if (!g_tem_rtc || g_rtc_desvio_medido) return;
  if (g_rtc_epoch_boot == 0) return;                 // sem hora no boot: já sinalizado
  // Só compara depois que o NTP REALMENTE sincronizou (senão a hora do sistema
  // ainda é a do próprio RTC e o desvio sairia sempre zero).
  if (sntp_get_sync_status() != SNTP_SYNC_STATUS_COMPLETED) return;
  time_t agora = time(nullptr);
  if (agora < 1700000000) return;

  uint32_t decorrido = (uint32_t)((millis() - g_rtc_epoch_boot_ms) / 1000UL);
  int64_t esperado = (int64_t)g_rtc_epoch_boot + (int64_t)decorrido;
  int32_t desvio = (int32_t)((int64_t)agora - esperado);

  g_rtc_desvio_seg = desvio;
  g_rtc_desvio_medido = true;

  int32_t abs_desvio = desvio < 0 ? -desvio : desvio;
  Serial.printf("[RTC] desvio contra NTP: %ld s (limite %ld s)\n",
                (long)desvio, (long)RTC_DESVIO_MAX_S);
  if (abs_desvio > RTC_DESVIO_MAX_S && !g_rtc_bat_fraca) {
    Serial.println("[RTC] bateria FRACA/AUSENTE — relógio voltou com hora errada");
    g_rtc_bat_fraca = true;
    salvarFlagBateriaRtc(true);
  }
}

// Avaliação completa, feita UMA vez no boot (antes de qualquer adjust()).
// v2.4.9: o OSF sozinho não condena mais a bateria no boot — ele é sticky e
// ficava ligado para sempre depois de uma queda, mantendo o alerta aceso mesmo
// com uma CR2032 nova. A prova real de bateria ruim é o RELÓGIO ter perdido a
// hora (inválida ou anterior ao carimbo). O OSF continua valendo em runtime.
void avaliarBateriaRtcNoBoot() {
  if (!g_tem_rtc) { g_rtc_bat_fraca = false; return; }

  bool osf = lerOsfDs3231();
  DateTime now = g_rtc.now();
  bool hora_ruim = !now.isValid() || now.year() < 2024;

  // v2.5.6 — guarda a hora que o RTC marcava no boot para comparar com o NTP.
  g_rtc_epoch_boot_ms = millis();
  g_rtc_epoch_boot    = hora_ruim ? 0 : (uint32_t)now.unixtime();
  g_rtc_desvio_medido = false;
  g_rtc_desvio_seg    = 0;

  prefs.begin("genelab", true);
  uint32_t ultimo_ts = prefs.getULong("rtc_ts", 0);
  prefs.end();

  // Relógio "andou para trás" em relação ao último carimbo => perdeu a hora.
  bool retrocedeu = false;
  if (!hora_ruim && ultimo_ts > 0) {
    uint32_t atual = (uint32_t)now.unixtime();
    if (atual + 60 < ultimo_ts) retrocedeu = true;
  }

  bool anterior = lerFlagBateriaRtc();
  bool poweron  = (esp_reset_reason() == ESP_RST_POWERON);
  bool falha    = hora_ruim || retrocedeu;

  bool fraca;
  if (falha) {
    fraca = true;                 // evidência direta de perda de hora
  } else if (poweron) {
    fraca = false;                // corte de energia real e o relógio manteve a hora
  } else if (!osf) {
    fraca = false;                // relógio íntegro e oscilador nunca parou desde o último check
  } else {
    fraca = anterior;             // reset de software: mantém o histórico
  }

  g_rtc_hora_perdida = falha;   // v2.5.6: exposto na telemetria

  Serial.printf("[RTC] bateria %s (OSF=%d hora_ruim=%d retrocedeu=%d poweron=%d anterior=%d)\n",
                fraca ? "FRACA/AUSENTE — trocar CR2032" : "OK",
                (int)osf, (int)hora_ruim, (int)retrocedeu, (int)poweron, (int)anterior);

  // Zera o flag sticky para que uma nova ativação signifique uma nova parada.
  limparOsfDs3231();

  g_rtc_bat_fraca = fraca;
  if (fraca != anterior) salvarFlagBateriaRtc(fraca);

  // v2.5.6 — o carimbo NÃO é mais apagado quando a bateria é julgada OK. Antes,
  // apagá-lo deixava o próximo boot sem referência para detectar que o relógio
  // retrocedeu. Ele passa a ser apenas atualizado pelo tickCarimboHoraRtc().
  g_ultimo_save_epoch = 0;   // força regravar o carimbo no primeiro tick
}

void tickBateriaRtc() {
  if (!g_tem_rtc) { g_rtc_bat_fraca = false; return; }
  uint32_t agora = millis();
  // Reavaliação leve a cada 10 minutos: só pode PIORAR (OSF ligou em runtime).
  if (g_ultimo_check_bat != 0 && (agora - g_ultimo_check_bat) < 600UL * 1000UL) return;
  g_ultimo_check_bat = agora;

  if (g_rtc_bat_fraca) return;
  if (lerOsfDs3231()) {
    Serial.println("[RTC] bateria FRACA/AUSENTE — OSF ligou em runtime");
    limparOsfDs3231();
    g_rtc_bat_fraca = true;
    salvarFlagBateriaRtc(true);
  }
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

// v2.4.8 — memória (NVS) do último disparo real, em epoch UTC.
// Serve para "recuperar" um horário que caiu durante a queda de energia/boot
// sem correr o risco de repetir um ciclo que já rodou.
uint32_t lerUltimoDisparoEpoch() {
  Preferences p;
  p.begin("ciclo", true);
  uint32_t v = p.getULong("ult_disp_ep", 0);
  p.end();
  return v;
}
void salvarUltimoDisparoEpoch(uint32_t ep) {
  Preferences p;
  p.begin("ciclo", false);
  p.putULong("ult_disp_ep", ep);
  p.end();
}

// Janela de recuperação: se o ESP estava reiniciando exatamente na hora de um
// ciclo, ele ainda dispara ao voltar, desde que dentro deste atraso.
const uint32_t AGENDA_CATCHUP_S = 15UL * 60UL;   // 15 min

// Dispara automaticamente o ciclo:
//  - Se NTP/RTC tem hora: quando o relógio local bate em um horário programado
//    (ou quando um horário foi perdido há menos de 15 min por queda/boot).
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
    time_t nowEp    = time(nullptr);
    int    minAgora = ti.tm_hour * 60 + ti.tm_min;
    for (uint8_t i = 0; i < cfg.horarios_n && i < MAX_HORARIOS; i++) {
      int mProg = hhmmParaMinutos(cfg.horarios_disparo[i]);
      if (mProg < 0) continue;

      bool bateAgora = (mProg == minAgora);

      // Recuperação de horário perdido (queda de energia / boot em cima da hora).
      bool recuperar = false;
      if (!bateAgora && nowEp > 1700000000) {
        int atrasoMin = minAgora - mProg;
        if (atrasoMin < 0) atrasoMin += 1440;                 // virou o dia
        uint32_t atrasoS = (uint32_t)atrasoMin * 60UL;
        if (atrasoS > 0 && atrasoS <= AGENDA_CATCHUP_S) {
          uint32_t horaProgEp = (uint32_t)nowEp - atrasoS - (uint32_t)ti.tm_sec;
          uint32_t ultEp      = lerUltimoDisparoEpoch();
          // só recupera se aquele horário ainda não tinha sido executado
          if (ultEp + 60 < horaProgEp) recuperar = true;
        }
      }

      if (bateAgora || recuperar) {
        g_ultimo_disparo_min = minutoAbs;
        g_ultimo_disparo_ms  = millis();
        if (nowEp > 1700000000) salvarUltimoDisparoEpoch((uint32_t)nowEp);
        Serial.printf("[AGENDA] disparo %s %02d:%02d (horario %s)\n",
                      recuperar ? "RECUPERADO" : "local",
                      ti.tm_hour, ti.tm_min, cfg.horarios_disparo[i]);
        aplicarFase(INJETANDO);
        lastTelem = 0;
        return;
      }
    }
    return;
  }


  // Sem NTP/RTC válido: fallback por intervalo (millis).
  // v2.4.8: só entra em ação depois da carência de boot e nunca dispara
  // imediatamente ao religar a energia.
  uint32_t intervalo_ms = cfg.intervalo_ciclo_horas * 3600UL * 1000UL;
  if (intervalo_ms == 0) return;
  uint32_t agora = millis();
  if ((agora - g_boot_ms) < BOOT_CARENCIA_MS) return;   // carência pós-boot
  if (g_ultimo_disparo_ms == 0) { g_ultimo_disparo_ms = agora; return; }
  if ((agora - g_ultimo_disparo_ms) >= intervalo_ms) {
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
  // v2.4.0 — tokens/mudas dos periféricos opcionais
  g_token_co2      = CO2_TOKEN_FIXO;   // fixo no firmware (ignora NVS antigo)
  g_token_scale    = prefs.getString("sc_tok",  "");
  g_muda_ident     = prefs.getString("sc_muda", "");
  g_hx_fator_cal   = prefs.getFloat ("hx_fat", 1.0f);
  g_hx_zero_offset = prefs.getLong  ("hx_zer", 0);
  prefs.end();
}

void salvarPerifericos() {
  prefs.begin("genelab", false);
  prefs.putString("co2_tok", g_token_co2);
  prefs.putString("sc_tok",  g_token_scale);
  prefs.putString("sc_muda", g_muda_ident);
  prefs.putFloat ("hx_fat",  g_hx_fator_cal);
  prefs.putLong  ("hx_zer",  g_hx_zero_offset);
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
  "<div class=\"logo\">V</div>"
  "<div><h1>VitroCeres</h1><p>Configuração da Prateleira</p></div>"
  "</div><div class=\"card\">";

static const char PORTAL_FOOT[] PROGMEM =
  "</div><div class=\"footer\">ESP32 • VitroCeres OS</div></div>";


void abrirPortalWifi(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  wm.setClass("invert");
  wm.setTitle("VitroCeres — Prateleira");
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

  // v2.6.9 — token do CO2 é fixo no firmware; só balança/muda seguem opcionais.
  WiFiManagerParameter param_sc_tok(
    "sc_tok",  "Token balança (opcional)",     g_token_scale.c_str(), 64);
  WiFiManagerParameter param_muda(
    "muda",    "Identificador da muda ativa (opcional)", g_muda_ident.c_str(), 64);
  wm.addParameter(&param_sc_tok);
  wm.addParameter(&param_muda);

  // AP name único por dispositivo: "VitroCeres-XXXXXX" (últimos 3 bytes do MAC)
  uint64_t mac = ESP.getEfuseMac();
  char apName[24];
  snprintf(apName, sizeof(apName), "VitroCeres-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 16), (uint8_t)(mac >> 8));
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
    // v2.6.9 — grava periféricos opcionais informados no portal (CO2 é fixo)
    String v;
    v = String(param_sc_tok .getValue()); v.trim(); if (v.length() > 0) g_token_scale = v;
    v = String(param_muda   .getValue()); v.trim(); g_muda_ident = v;   // pode limpar
    salvarPerifericos();
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
  doc["_rtc_bateria_fraca"]      = g_rtc_bat_fraca;
  doc["_rtc_hora_perdida"]       = g_rtc_hora_perdida;
  doc["_rtc_desvio_segundos"]    = g_rtc_desvio_medido ? g_rtc_desvio_seg : 0;
  doc["_ip_local"]               = WiFi.localIP().toString();
  doc["_luz_ligada"]             = g_luz_ligada;
  doc["_sensor_travado"]         = g_sensor_travado;
  doc["_sensor_reinicios"]       = g_temp_reinicios;

  // v2.6.0 — diagnóstico de queda: motivo do último boot, tempo ligado, menor
  // heap livre já visto, quedas de Wi-Fi e força do sinal.
  {
    uint32_t heap_agora = ESP.getFreeHeap();
    if (heap_agora < g_heap_min) g_heap_min = heap_agora;
  }
  doc["_reset_reason"]           = g_reset_reason;
  doc["_uptime_s"]               = (uint32_t)(millis() / 1000UL);
  doc["_heap_min"]               = (uint32_t)(g_heap_min == 0xFFFFFFFF ? 0 : g_heap_min);
  doc["_wifi_reconexoes"]        = g_wifi_reconexoes;
  doc["_rssi"]                   = (int)WiFi.RSSI();

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

// v2.4.3 — Reporta evento do aprendizado IR pro painel (RPC bench_ir_debug),
// pra UI mostrar em tempo real o que o receptor captou (ou não captou).
void reportarIrDebug(const char* evento, uint16_t pulsos) {
  if (ir_learn_ar_id.length() == 0) return;
  JsonDocument body;
  body["_ar_id"]        = ir_learn_ar_id;
  body["_bancada_id"]   = creds.bancada_id;
  body["_device_token"] = creds.device_token;
  body["_evento"]       = evento;
  body["_pulsos"]       = pulsos;
  JsonObject extra = body["_extra"].to<JsonObject>();
  extra["modo"] = ir_learn_modo;
  String bodyStr; serializeJson(body, bodyStr);
  String resp;
  supabaseRpc("bench_ir_debug", bodyStr, resp); // best-effort
}

// v2.2.0 — Captura IR e envia array raw pro backend via RPC bench_ir_save_raw.
void tickIrLearn() {
  if (!ir_learn_ativo) return;

  // Timeout — desiste da captura e libera receptor.
  if ((long)(millis() - ir_learn_deadline_ms) >= 0) {
    Serial.println("[IR_LEARN] timeout — nenhum código recebido");
    reportarIrDebug("timeout", 0);
    irrecv.disableIRIn();
    ir_learn_ativo = false;
    ir_learn_ar_id = "";
    ir_learn_modo  = "cool";
    return;
  }

  decode_results results;
  if (!irrecv.decode(&results)) return;

  // rawlen inclui o primeiro "gap" (índice 0) que descartamos.
  uint16_t n = results.rawlen > 1 ? results.rawlen - 1 : 0;
  Serial.printf("[IR_LEARN] recebido: %u pulsos, protocolo=%d\n",
                (unsigned)n, (int)results.decode_type);

  if (n < IR_MIN_UNKNOWN_SIZE) {
    Serial.println("[IR_LEARN] frame muito curto — descartado, aguardando outro");
    reportarIrDebug("curto", n);
    irrecv.resume();
    return;
  }

  // Serializa como array de microsegundos (rawbuf está em ticks de 50us).
  String rawJson = "[";
  for (uint16_t i = 1; i <= n; i++) {
    if (i > 1) rawJson += ",";
    rawJson += String((uint32_t)results.rawbuf[i] * kRawTick);
  }
  rawJson += "]";

  JsonDocument body;
  body["_ar_id"] = ir_learn_ar_id;
  body["_bancada_id"] = creds.bancada_id;
  body["_device_token"] = creds.device_token;
  JsonDocument rawDoc;
  deserializeJson(rawDoc, rawJson);
  body["_raw"] = rawDoc.as<JsonArray>();
  String bodyStr; serializeJson(body, bodyStr);

  String resp;
  // v2.5.1 — cada estado tem seu proprio codigo aprendido: cool / heat / off.
  const char* rpc = (ir_learn_modo == "heat") ? "bench_ir_save_raw_heat"
                  : (ir_learn_modo == "off")  ? "bench_ir_save_raw_off"
                                              : "bench_ir_save_raw";
  bool ok = supabaseRpc(rpc, bodyStr, resp);
  if (ok) {
    Serial.printf("[IR_LEARN] gravado com sucesso (%u pulsos, modo=%s)\n",
                  (unsigned)n, ir_learn_modo.c_str());
    reportarIrDebug("gravado", n);
  } else {
    Serial.println("[IR_LEARN] falha ao gravar no backend — tentará no próximo boot");
    reportarIrDebug("falha_gravar", n);
  }

  irrecv.disableIRIn();
  ir_learn_ativo = false;
  ir_learn_ar_id = "";
  ir_learn_modo  = "cool";
}



// v2.1.6 — Proteção contra comando antigo após reconexão.
// Se a prateleira ficou sem internet, ela pode ter iniciado/retomado o ciclo
// localmente pelo RTC. Quando a internet volta, um FORCE_CYCLE antigo que ficou
// pendente no backend não pode reiniciar a fase do zero.
bool cicloEmAndamento() {
  return fase == INJETANDO || fase == PAUSADO || fase == RETORNANDO;
}

// -------- Comandos --------
void tratarComando(JsonObject cmd) {
  const char* tipo = cmd["tipo"] | "";
  Serial.printf("[CMD] %s\n", tipo);
  if (strcmp(tipo, "FORCE_CYCLE") == 0) {
    if (cicloEmAndamento()) {
      Serial.printf("[CMD] FORCE_CYCLE ignorado: ciclo já em andamento (%s)\n", faseNome(fase));
      lastTelem = 0;
      return;
    }
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
    // Payload: { acao: "on"|"off", modo: "cool", setpoint: 22, protocolo: "LG"|"SAMSUNG"|"FUJITSU"|"MIDEA"|"ELECTRA"|"CONSUL" }
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

    // v2.2.0 — se o payload trouxer "raw":[...] (código IR aprendido do controle
    // real via IR_LEARN), dispara direto por sendRaw() e ignora a lib de protocolo.
    bool enviadoRaw = false;
    JsonArrayConst rawArr = p["raw"].as<JsonArrayConst>();
    if (!rawArr.isNull() && rawArr.size() >= IR_MIN_UNKNOWN_SIZE) {
      size_t n = rawArr.size();
      uint16_t* buf = (uint16_t*)malloc(sizeof(uint16_t) * n);
      if (buf) {
        size_t i = 0;
        for (JsonVariantConst v : rawArr) buf[i++] = (uint16_t)(v.as<uint32_t>());
        if (ir_learn_ativo) irrecv.disableIRIn();
        irsend.sendRaw(buf, n, 38);  // 38 kHz portadora padrão AC
        if (ir_learn_ativo) irrecv.enableIRIn();
        free(buf);
        Serial.printf("[AC] IR RAW enviado (%u pulsos)\n", (unsigned)n);
        ac_ligado_local = ligar;
        ac_setpoint_local = setpoint;
        ac_protocolo_local = "RAW";
        lastTelem = 0;
        enviadoRaw = true;
      }
    }

    if (!enviadoRaw) {
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
      // v2.5.1 — "liga mas nao desliga": o frame de OFF do Fujitsu e um frame
      // curto (5 bytes) e depende do modelo do controle. ARRAH2E cobre a maioria
      // dos splits BR; se nao responder, tentamos tambem ARDB1 (frame antigo).
      // Enviamos o OFF duas vezes com pequeno intervalo, pois o frame curto e
      // facilmente perdido se o receptor do split estiver em borda de alcance.
      if (ligar) {
        IRFujitsuAC ac(PIN_IR_LED);
        ac.begin();
        ac.setModel(ARRAH2E);
        ac.setMode(kFujitsuAcModeCool);
        ac.setTemp((uint8_t)roundf(setpoint));
        ac.setFanSpeed(kFujitsuAcFanAuto);
        ac.setCmd(kFujitsuAcCmdTurnOn);
        ac.send();
      } else {
        const fujitsu_ac_remote_model_t modelos[] = { ARRAH2E, ARDB1 };
        for (uint8_t m = 0; m < 2; m++) {
          IRFujitsuAC ac(PIN_IR_LED);
          ac.begin();
          ac.setModel(modelos[m]);
          ac.off();               // monta o frame curto de desligar
          ac.send();
          delay(120);
          ac.send();              // repete — frame curto se perde facil
          delay(200);
        }
        Serial.println("[AC] Fujitsu: OFF enviado (ARRAH2E + ARDB1, 2x cada)");
      }
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
    } else if (strcasecmp(protocolo, "CONSUL") == 0 ||
               strcasecmp(protocolo, "WHIRLPOOL") == 0) {
      // Consul é do grupo Whirlpool (DG11J1-3A). O bit de power é TOGGLE:
      // cada frame com PowerToggle=true inverte o estado do ar. Portanto só
      // enviamos o comando quando o estado desejado difere do estado atual
      // local; caso contrário mandaríamos um "desliga" quando na verdade
      // queríamos ligar (ou vice-versa). v2.2.1 — corrige "liga mas não desliga".
      IRWhirlpoolAc ac(PIN_IR_LED);
      ac.begin();
      ac.setModel(DG11J13A);
      bool precisaToggle = (ligar != ac_ligado_local);
      ac.setMode(kWhirlpoolAcCool);
      ac.setTemp((uint8_t)roundf(ligar ? setpoint : 24));
      ac.setFan(kWhirlpoolAcFanAuto);
      ac.setPowerToggle(precisaToggle);
      if (precisaToggle) {
        ac.send();
        Serial.printf("[AC] Consul/Whirlpool: toggle enviado (novo estado=%s)\n",
                      ligar ? "ON" : "OFF");
      } else {
        Serial.printf("[AC] Consul/Whirlpool: estado ja é %s — nenhum frame enviado\n",
                      ligar ? "ON" : "OFF");
      }
    } else {
      Serial.printf("[AC] protocolo desconhecido: %s\n", protocolo);
    }

    ac_ligado_local = ligar;
    ac_setpoint_local = setpoint;
    ac_protocolo_local = String(protocolo);
    lastTelem = 0; // reporta estado na próxima telemetria
    } // fecha if (!enviadoRaw)
  } else if (strcmp(tipo, "IR_LEARN") == 0) {
    // v2.2.0 — Modo aprender IR: escuta o receptor VS1838B por até timeout_s
    // segundos. Ao capturar um frame válido, POSTa o array raw pra RPC
    // bench_ir_save_raw(ar_id, raw[]) e o dashboard associa ao ar_condicionado.
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
    const char* ar_id = p["ar_id"] | "";
    uint32_t timeout_s = p["timeout_s"] | 30;
    const char* modo = p["modo"] | "cool";
    if (!*ar_id) {
      Serial.println("[IR_LEARN] ar_id ausente — ignorado");
    } else {
      ir_learn_ar_id = String(ar_id);
      ir_learn_modo  = String(modo);
      ir_learn_deadline_ms = millis() + timeout_s * 1000UL;
      irrecv.enableIRIn();
      ir_learn_ativo = true;
      Serial.printf("[IR_LEARN] aguardando código do controle por %us (ar=%s, modo=%s)\n",
                    (unsigned)timeout_s, ar_id, modo);
      reportarIrDebug("iniciado", 0); // v2.4.3 — avisa UI que receptor está escutando
    }
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
    luzWrite(false);
    // Publica um último ping de telemetria antes de reiniciar.
    enviarTelemetria();
    // v2.5.9 — carimbo de hora atualizado antes do reinício controlado.
    salvarCarimboHoraRtc(true);

    // v2.5.9 — Libera RAM antes do OTA.
    // A telemetria mantém um cliente TLS global (httpsClient) com keep-alive.
    // Criar o cliente do OTA sem fechá-lo deixa DOIS contextos TLS vivos
    // (~30–40 KB cada) e, com heap fragmentado após dias no ar, isso derruba
    // o download (out of memory / panic reset).
    Serial.printf("[OTA] heap antes da limpeza: %u bytes\n",
                  (unsigned)ESP.getFreeHeap());
    http.end();
    httpsClient.stop();
    delay(200);
    uint32_t heapLivre = ESP.getFreeHeap();
    Serial.printf("[OTA] heap após limpeza: %u bytes\n", (unsigned)heapLivre);

    // Abaixo desse piso o handshake TLS + buffers do update não caberiam;
    // melhor abortar com log claro e reenviar o comando depois.
    static const uint32_t OTA_HEAP_MINIMO = 45000UL;
    if (heapLivre < OTA_HEAP_MINIMO) {
      Serial.printf("[OTA] ABORTADO: heap insuficiente (%u < %u). Reenvie o comando.\n",
                    (unsigned)heapLivre, (unsigned)OTA_HEAP_MINIMO);
      pausado_manual = false;
      return;
    }

    WiFiClientSecure otaClient;
    otaClient.setInsecure();
    // v2.5.9 — Timeout de rede: se o Wi-Fi do local remoto oscilar no meio da
    // transferência, o socket não fica pendurado esperando pacotes.
    otaClient.setTimeout(10000);
    httpUpdate.rebootOnUpdate(true);
    httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

    // v2.5.9 — Watchdog armado só durante o OTA. Se o processo travar em um
    // ponto que o timeout de socket não cobre, o ESP32 reinicia sozinho e volta
    // rodando o firmware antigo (o OTA é atômico: a nova imagem só é ativada
    // depois de validada), evitando deslocamento até o local.
    bool wdtArmado = (esp_task_wdt_init(180, true) == ESP_OK);
    if (wdtArmado) esp_task_wdt_add(NULL);

    // Piscar LED durante download
    httpUpdate.onProgress([](int cur, int total) {
      static uint32_t lastLog = 0;
      digitalWrite(PIN_LED, (cur / 8192) & 1 ? HIGH : LOW);
      esp_task_wdt_reset();
      if (millis() - lastLog > 1000) {
        lastLog = millis();
        Serial.printf("[OTA] %d / %d bytes (%d%%) heap=%u\n",
                      cur, total, total > 0 ? (cur * 100 / total) : 0,
                      (unsigned)ESP.getFreeHeap());
      }
    });
    t_httpUpdate_return ret = httpUpdate.update(otaClient, String(url));
    if (wdtArmado) esp_task_wdt_delete(NULL);
    armarWatchdogPadrao();   // v2.6.0 — volta ao watchdog global de 30 s
    switch (ret) {
      case HTTP_UPDATE_FAILED:
        Serial.printf("[OTA] FALHOU: (%d) %s (heap=%u)\n",
                      httpUpdate.getLastError(),
                      httpUpdate.getLastErrorString().c_str(),
                      (unsigned)ESP.getFreeHeap());
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
  } else if (strcmp(tipo, "OTA_CANCEL") == 0) {
    Serial.println("[OTA] Cancelamento recebido.");
  } else if (strcmp(tipo, "LUZ_TESTE") == 0) {
    // v2.5.8 — Liga a luz por 7 segundos para teste de fiação/relé
    Serial.println("[CMD] LUZ_TESTE — ligando por 7s");
    g_luz_teste_ate = millis() + 7000UL;
    lastTelem = 0; // reporta luz_ligada:true imediatamente
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

  // v2.6.0 — TETO DE SEGURANÇA por fase: se por qualquer motivo (relógio,
  // config corrompida, travamento recuperado) uma fase passar do DOBRO do
  // tempo configurado, fecha tudo e volta ao Repouso. Nunca mais válvula
  // aberta por horas.
  if (fase == INJETANDO || fase == PAUSADO || fase == RETORNANDO) {
    uint32_t limite = 60;
    if (fase == INJETANDO)  limite = cfg.tempo_injecao_segundos;
    if (fase == PAUSADO)    limite = cfg.tempo_pausa_segundos;
    if (fase == RETORNANDO) limite = cfg.tempo_retorno_segundos;
    if (limite < 10) limite = 10;
    if (decorrido > (uint32_t)(limite * 2 + 60)) {
      Serial.printf("[SEGURANCA] fase %s durou %us (limite %us) -> Repouso\n",
                    faseNome(fase), (unsigned)decorrido, (unsigned)limite);
      aplicarFase(REPOUSO);
      return;
    }
  }
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

// =====================================================================
// v2.4.0 — SCD41 (CO2) e HX711 (balança)
// =====================================================================

// POST simples em endpoint público com header X-Device-Token.
bool postPublic(const char* path, const String& body, const String& token,
                String& respOut) {
  if (WiFi.status() != WL_CONNECTED || token.length() < 8) return false;
  HTTPClient h;
  WiFiClientSecure c;
  c.setInsecure();
  String url = String(API_HOST) + path;
  if (!h.begin(c, url)) return false;
  h.setTimeout(8000);
  h.addHeader("Content-Type", "application/json");
  h.addHeader("X-Device-Token", token);
  int code = h.POST(body);
  respOut = h.getString();
  h.end();
  if (code < 200 || code >= 300) {
    Serial.printf("[HTTP] %s => %d: %s\n", path, code, respOut.c_str());
    return false;
  }
  return true;
}

bool getPublic(const char* path, const String& token, String& respOut) {
  if (WiFi.status() != WL_CONNECTED || token.length() < 8) return false;
  HTTPClient h;
  WiFiClientSecure c;
  c.setInsecure();
  String url = String(API_HOST) + path;
  if (!h.begin(c, url)) return false;
  h.setTimeout(8000);
  h.addHeader("X-Device-Token", token);
  int code = h.GET();
  respOut = h.getString();
  h.end();
  if (code < 200 || code >= 300) return false;
  return true;
}

// -------- CO2 (SCD41) --------
// v2.6.10 — init mais tolerante: acorda o sensor, reinicia o periférico e
// retenta a cada 60 s se ele não responder no boot (o SCD41 pode levar alguns
// segundos após energizar). Sem gate por número de série, que falhava (err=268).
// Esta versão usa SensirionI2cScd4x: nesta API begin recebe endereço e o método
// de prontidão chama-se getDataReadyStatus().
unsigned long g_ts_retry_scd41 = 0;

void iniciarScd41() {
  // Wire.begin() já foi chamado pelo bloco do DS3231; reaproveitamos o bus.
  g_scd4x.begin(Wire, SCD41_I2C_ADDR_62);
  g_scd4x.wakeUp();
  delay(30);
  g_scd4x.stopPeriodicMeasurement();
  delay(500);
  g_scd4x.reinit();
  delay(30);
  uint16_t err = g_scd4x.startPeriodicMeasurement();
  if (err) {
    Serial.printf("[SCD41] nao iniciou (err=%u) — retentando em 60 s\n", err);
    g_tem_scd41 = false;
  } else {
    Serial.println("[SCD41] modo periodico OK (1 amostra a cada 5 s)");
    g_tem_scd41 = true;
  }
}

void tickCo2(unsigned long now) {
  if (!g_tem_scd41) {
    if (now - g_ts_retry_scd41 >= 60000UL) {
      g_ts_retry_scd41 = now;
      esp_task_wdt_reset();
      Serial.println("[SCD41] tentando reinicializar...");
      iniciarScd41();
    }
    return;
  }
  // O SCD41 converte em aproximadamente 5 s, mas a prontidão é consultada a
  // cada 1 s. Assim não perdemos a amostra quando ela fica pronta alguns
  // milissegundos depois da marca exata de 5 s.
  static unsigned long last_check = 0;
  if (now - last_check >= 1000UL) {
    last_check = now;
    esp_task_wdt_reset();
    bool pronto = false;
    if (g_scd4x.getDataReadyStatus(pronto) == 0 && pronto) {
      uint16_t ppm; float t, rh;
      if (g_scd4x.readMeasurement(ppm, t, rh) == 0 && ppm > 0) {
        // Só confirma o cronômetro depois de recuperar uma leitura válida.
        g_ts_ultima_co2_leitura = now;
        g_co2_ppm      = ppm;
        g_scd41_temp_c = t;
        g_scd41_umid   = rh;
        g_co2_soma    += ppm;
        g_co2_amostras++;
        Serial.printf("[CO2] %u ppm | %.1f C | %.0f %%\n", (unsigned)ppm, t, rh);
      }
    }
  }
  // envia média a cada 60 s
  if (now - g_ts_ultimo_co2_envio >= 60000UL && g_co2_amostras > 0 &&
      g_token_co2.length() >= 8) {
    g_ts_ultimo_co2_envio = now;
    uint16_t media = (uint16_t)(g_co2_soma / g_co2_amostras);
    g_co2_soma = 0; g_co2_amostras = 0;
    String body = String("{\"ppm\":") + media;
    if (!isnan(g_scd41_temp_c)) body += String(",\"temperatura_c\":") + String(g_scd41_temp_c, 1);
    if (!isnan(g_scd41_umid))   body += String(",\"umidade_pct\":")   + String(g_scd41_umid, 0);
    body += String(",\"firmware_version\":\"") + FIRMWARE_VERSION + "\"}";
    String resp;
    if (postPublic("/api/public/co2/reading", body, g_token_co2, resp)) {
      Serial.printf("[CO2] enviado %u ppm\n", (unsigned)media);
    } else {
      Serial.println("[CO2] falha ao enviar (token/rede)");
    }
  } else if (now - g_ts_ultimo_co2_envio >= 60000UL && g_token_co2.length() < 8) {
    g_ts_ultimo_co2_envio = now;
    Serial.println("[CO2] token do sensor nao configurado (portal Wi-Fi)");
  }
}

// -------- Balança HX711 --------
void iniciarHx711() {
  g_balanca.begin(PIN_HX_DOUT, PIN_HX_SCK);
  g_balanca.set_scale(1.0f);
  g_balanca.set_offset(0);
  // Aguarda até 2 s pelo primeiro dado — se não responder, marca ausente.
  uint32_t t0 = millis();
  while (!g_balanca.is_ready() && millis() - t0 < 2000) delay(50);
  g_tem_hx711 = g_balanca.is_ready();
  Serial.printf("[HX711] %s (fator=%.4f zero=%ld)\n",
                g_tem_hx711 ? "detectado" : "NAO detectado",
                g_hx_fator_cal, g_hx_zero_offset);
}

float hxLerPesoG() {
  if (!g_tem_hx711 || !g_balanca.is_ready()) return g_hx_peso_g;
  long raw = g_balanca.read_average(10);
  return (raw - g_hx_zero_offset) / g_hx_fator_cal;
}

void hxConsultarStatus() {
  String resp;
  if (!getPublic("/api/public/scale/status", g_token_scale, resp)) return;
  JsonDocument d;
  if (deserializeJson(d, resp)) return;
  g_hx_pode_amostrar   = d["amostrar"] | false;
  const char* m        = d["motivo"] | "ok";
  g_hx_motivo_bloqueio = String(m);
}

void hxEnviarLeitura(float g) {
  if (g_muda_ident.length() == 0) return;
  String body = String("{\"valor_g\":") + String(g, 2) +
                ",\"muda_identificador\":\"" + g_muda_ident + "\"}";
  String resp;
  if (postPublic("/api/public/scale/reading", body, g_token_scale, resp)) {
    Serial.printf("[HX711] enviado %.2f g (muda=%s)\n", g, g_muda_ident.c_str());
  }
}

void tickBalanca(unsigned long now) {
  if (!g_tem_hx711 || g_token_scale.length() < 8) return;
  if (now - g_ts_ultima_hx_leitura >= 2000UL) {
    g_ts_ultima_hx_leitura = now;
    g_hx_peso_g = hxLerPesoG();
  }
  if (now - g_ts_ultimo_hx_status >= 60000UL || g_ts_ultimo_hx_status == 0) {
    g_ts_ultimo_hx_status = now;
    hxConsultarStatus();
  }
  if (g_hx_pode_amostrar && now - g_ts_ultimo_hx_envio >= 300000UL) {
    g_ts_ultimo_hx_envio = now;
    hxEnviarLeitura(g_hx_peso_g);
  }
}

// -------- Setup / Loop --------
void setup() {
  // BOOT-SAFE: em placas Low Level Trigger, o GPIO fica em HIGH-Z durante o
  // reset — o SSR interpreta como "quase LOW" e pode chavear brevemente.
  // Colocamos os pinos em OUTPUT + nível de "desligado" (HIGH em LLT) como
  // ABSOLUTA PRIMEIRA COISA, antes de Serial/sensores/rede.
  for (int p : {PIN_V1_V4, PIN_V2_V3}) {
    pinMode(p, OUTPUT);
    relayWrite(p, false);
  }
  pinMode(PIN_LUZ, OUTPUT);
  luzWrite(false);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  // v2.5.4 — LED de status do ciclo (inicia apagado antes de qualquer coisa)
  pinMode(PIN_LED_CICLO, OUTPUT);
  // v2.5.7: Sinalização visual de reset (3 piscadas rápidas no LED de ciclo)
  for (int i = 0; i < 3; i++) {
    ledCicloWrite(true);
    delay(100);
    ledCicloWrite(false);
    delay(100);
  }
  ledCicloWrite(false);
  g_luz_ligada = false;

  // IR: inicializa LED em nível baixo (transistor bloqueado).
  irsend.begin();
  pinMode(PIN_IR_LED, OUTPUT);
  digitalWrite(PIN_IR_LED, LOW);

  // IR RX (v2.2.0): receptor VS1838B/TL1838 no GPIO 33.
  // enableIRIn é chamado sob demanda em IR_LEARN — mantém CPU livre pro resto.
  pinMode(PIN_IR_RX, INPUT);

  Serial.begin(115200);
  delay(200);
  Serial.printf("\n== VitroCeres Prateleira ESP32 v%s (direct-Supabase) ==\n", FIRMWARE_VERSION);
  // v2.6.0 — motivo do último boot (brownout = queda de tensão na comutação da
  // válvula; task_wdt/panic = travamento de software).
  g_reset_reason = nomeResetReason();
  Serial.printf("[BOOT] motivo do reset: %s | heap=%u\n",
                g_reset_reason, (unsigned)ESP.getFreeHeap());
  // (o watchdog global é armado no FIM do setup, depois do portal Wi-Fi)
  Serial.printf("[RELAY] valvulas: ACTIVE_%s | luz: ACTIVE_%s\n",
                RELAY_ACTIVE_LOW ? "LOW" : "HIGH",
                LUZ_ACTIVE_LOW ? "LOW" : "HIGH");

  pinMode(PIN_RESET_BTN, INPUT_PULLUP);
  // v2.5.3 — botão físico de ciclo manual (para GND)
  pinMode(PIN_BOTAO_CICLO, INPUT_PULLUP);

  // v2.4.8: marca o instante do boot — o fallback de agenda por intervalo
  // fica em carência e não dispara ciclo ao religar a energia.
  g_boot_ms = millis();
  g_ultimo_disparo_ms = g_boot_ms;

  dsSensor.begin();
  dsSensor.setResolution(12);
  dsSensor.setWaitForConversion(true);  // v1.9.6: leitura bloqueante evita valor cacheado/antigo
  g_tem_ds18b20 = dsSensor.getAddress(g_ds18b20_addr, 0);
  Serial.printf("[TEMP] DS18B20 %s — sensores encontrados: %u\n",
                g_tem_ds18b20 ? "detectado" : "NAO detectado",
                (unsigned)dsSensor.getDeviceCount());
  if (!g_tem_ds18b20) Serial.println("[TEMP] sem DS18B20 no boot — ok, prateleira pode operar sem temperatura");

  // DS3231 opcional (I²C em SDA=21 / SCL=22). Se não responder, seguimos sem ele.
  Wire.begin();
  g_tem_rtc = g_rtc.begin();
  if (g_tem_rtc) {
    Serial.println("[RTC] DS3231 detectado no barramento I2C");
    if (g_rtc.lostPower()) {
      Serial.println("[RTC] perdeu energia — aguardando NTP p/ ajustar");
    }
    avaliarBateriaRtcNoBoot();   // v2.4.7: avaliação persistente da bateria (OSF + carimbo)
  } else {
    Serial.println("[RTC] DS3231 não encontrado — usando NTP + millis()");
  }

  carregarPrefs();

  // v2.4.0 — periféricos opcionais compartilhando o mesmo binário
  iniciarScd41();     // SCD41 no I2C 21/22 (endereço diferente do DS3231)
  iniciarHx711();     // HX711 nas GPIOs 16/17


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

  restaurarCiclo();

  // v2.6.0 — watchdog global só aqui: o portal Wi-Fi e o pareamento podem
  // bloquear por minutos e não devem provocar reinício.
  armarWatchdogPadrao();
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
  // v2.4.3: instalação tem SEMPRE apenas UM sensor de temperatura por prateleira —
  // ou o DS18B20 (na maioria das prateleiras) OU o SCD41 (quando a sala tem o
  // sensor de CO2 acoplado à muda). Se o DS18B20 não foi detectado no boot mas o
  // SCD41 está ativo, usamos a temperatura reportada pelo SCD41 no lugar. Assim
  // o backend continua recebendo `_temperatura_planta` normalmente e todos os
  // alertas / controle de ar-condicionado seguem funcionando sem alteração.
  float t = DEVICE_DISCONNECTED_C;

  // v2.4.5 — se o DS18B20 não foi visto no boot (fio solto, energia instável,
  // sensor plugado depois), tenta redetectar periodicamente em vez de ficar
  // preso em "sem sensor" até o próximo reboot.
  // v2.5.0 — prateleiras SEM sensor de temperatura são suportadas oficialmente.
  // Depois de várias tentativas frustradas de re-scan, espaçamos a busca para
  // 5 min e paramos de tratar a ausência de sensor como falha (sem log a cada
  // leitura, sem "sensor travado", sem telemetria forçada).
  static uint32_t ultimoRescan = 0;
  const uint32_t intervaloRescan = g_sem_sensor_temp ? 300000UL : 30000UL;
  if (!g_tem_ds18b20 && millis() - ultimoRescan > intervaloRescan) {
    ultimoRescan = millis();
    dsSensor.begin();
    dsSensor.setResolution(12);
    dsSensor.setWaitForConversion(true);
    g_tem_ds18b20 = dsSensor.getAddress(g_ds18b20_addr, 0);
    if (g_tem_ds18b20) {
      Serial.println("[TEMP] DS18B20 redetectado no barramento");
      g_sem_sensor_temp = false;
      g_temp_sem_leitura_seguidas = 0;
    }
  }

  if (g_tem_ds18b20) {
    // Leitura padrão do DS18B20 (igual ao teste simples da IDE Arduino).
    // Até 2 tentativas: uma leitura isolada com CRC ruim não vira falha.
    for (int tent = 0; tent < 2; tent++) {
      dsSensor.requestTemperatures();
      t = dsSensor.getTempCByIndex(0);
      if (t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 125.0 && t != 85.0) break;
      delay(60);
    }
  }

  bool valida = t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 125.0;

  // v2.4.5 — fallback para o SCD41 sempre que o DS18B20 não entregar leitura
  // válida (antes só valia quando o DS18B20 nunca havia sido detectado).
  if (!valida && g_tem_scd41 && !isnan(g_scd41_temp_c)) {
    t = g_scd41_temp_c;
    valida = t > -50.0 && t < 125.0;
  }

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
    bool estavaValida = g_temperatura_valida;
    g_temp_falhas_seguidas++;
    if (g_temp_invalidas_consecutivas < 255) g_temp_invalidas_consecutivas++;
    if (g_temp_sem_leitura_seguidas < 65535) g_temp_sem_leitura_seguidas++;

    // v2.5.0 — se nunca houve DS18B20 nem SCD41 e já falhamos muitas vezes,
    // esta prateleira simplesmente não tem sensor: modo silencioso.
    if (!g_tem_ds18b20 && !g_tem_scd41 && g_temp_sem_leitura_seguidas >= 5 &&
        !g_sem_sensor_temp) {
      g_sem_sensor_temp = true;
      Serial.println("[TEMP] nenhum sensor presente — prateleira operando sem temperatura");
    }

    if (!g_sem_sensor_temp) {
      Serial.printf("[TEMP] leitura invalida (t=%.4f, falhas=%u, ultima=%.4f)\n",
                    t, (unsigned)g_temp_falhas_seguidas,
                    g_ultima_temperatura_valida);
    }
    g_temperatura_planta = NAN;
    g_temperatura_valida = false;
    // v2.5.0 — só força telemetria na TRANSIÇÃO válida→inválida. Antes isso
    // acontecia a cada leitura, o que em prateleiras sem sensor gerava push a
    // cada 3 s e estourava o rate limit do backend.
    if (estavaValida) lastTelem = 0;
    if (g_temp_falhas_seguidas >= 3 && g_tem_ds18b20 && !g_sem_sensor_temp) {
      // Só reinicia 1-Wire se realmente havia DS18B20 detectado no boot.
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

// v2.1.2 — Watchdog Wi-Fi: quando o roteador volta depois de uma queda de
// energia/link, `WiFi.setAutoReconnect(true)` pode demorar vários minutos
// pra reengatar (o rádio fica preso em estado "sem AP"). Forçamos um ciclo
// disconnect()/begin() a cada 20 s enquanto estiver caído e, se passar de
// 5 min offline, reiniciamos o subsistema Wi-Fi.
void tickWifiWatchdog(unsigned long now) {
  static unsigned long lastTry = 0;
  static unsigned long downSince = 0;
  static uint8_t tentativas = 0;

  if (WiFi.status() == WL_CONNECTED) {
    if (downSince != 0) g_wifi_reconexoes++;   // v2.6.0 — conta quedas de link
    downSince = 0;
    tentativas = 0;
    return;
  }
  if (downSince == 0) {
    downSince = now;
    Serial.println("[WIFI] link caiu — watchdog ativo");
  }

  if (now - lastTry < 20000UL) return;
  lastTry = now;
  tentativas++;

  Serial.printf("[WIFI] tentativa %u de reconexão (%.1fs offline)\n",
                tentativas, (now - downSince) / 1000.0);

  // A cada ~5 min offline reinicia o rádio inteiro (mode OFF/STA + begin).
  if (now - downSince > 300000UL) {
    Serial.println("[WIFI] 5 min sem link — reiniciando rádio Wi-Fi");
    WiFi.disconnect(true, false); // limpa estado, mantém credenciais
    delay(200);
    WiFi.mode(WIFI_OFF);
    delay(300);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin();
    downSince = now; // reinicia janela de 5 min
    return;
  }

  // Reconexão rápida: força um novo ciclo do stack
  WiFi.disconnect(false, false);
  delay(100);
  WiFi.reconnect();
}

// -------- v2.5.3 — Botão físico: curto inicia, longo cancela --------
// Debounce por tempo + medição da duração do aperto. Não depende de internet:
// age direto na máquina de estados local e persiste a fase na NVS.
//   - Aperto CURTO (60 ms .. 2 s) e em REPOUSO  -> inicia ciclo (Injetando)
//   - Aperto LONGO (>= 2 s)                     -> cancela e volta ao Repouso
void tickBotaoCiclo(unsigned long now) {
  static int  nivelEstavel = HIGH;
  static int  nivelBruto   = HIGH;
  static unsigned long ultimaMudanca = 0;
  static unsigned long inicioAperto  = 0;
  static bool longoDisparado = false;

  int nivel = digitalRead(PIN_BOTAO_CICLO);
  if (nivel != nivelBruto) {
    nivelBruto = nivel;
    ultimaMudanca = now;
  }
  if (now - ultimaMudanca >= 60 && nivel != nivelEstavel) {   // debounce 60 ms
    nivelEstavel = nivel;
    if (nivel == LOW) {
      inicioAperto = now;
      longoDisparado = false;
    } else {
      // Soltou: se não virou aperto longo, trata como curto
      if (!longoDisparado) {
        if (cicloEmAndamento() || fase == MANUAL) {
          Serial.println("[BOTAO] curto ignorado (ciclo em andamento) — segure 2 s p/ cancelar");
        } else {
          Serial.println("[BOTAO] curto -> iniciando ciclo manual (Injetando)");
          pausado_manual = false;
          ciclo_manual_ativo = true;   // v2.5.4 — LED fica aceso fixo no ciclo manual
          aplicarFase(INJETANDO);
          lastTelem = 0;
        }
      }
    }
  }

  // Enquanto segurado: dispara o cancelamento ao cruzar o limiar
  if (nivelEstavel == LOW && !longoDisparado &&
      (now - inicioAperto) >= BOTAO_LONGO_MS) {
    longoDisparado = true;
    if (cicloEmAndamento() || fase == MANUAL) {
      Serial.printf("[BOTAO] longo -> cancelando ciclo (%s) -> Repouso\n", faseNome(fase));
      pausado_manual = false;               // não trava o agendamento futuro
      aplicarFase(REPOUSO);
      lastTelem = 0;                        // publica novo estado assim que houver rede
    } else {
      Serial.println("[BOTAO] longo sem ciclo ativo — nada a cancelar");
    }
  }
}


// -------- v2.5.4 — LED de status do ciclo --------
// Traduz a fase atual (e a origem manual) em um padrão de pisca no PIN_LED_CICLO.
// Não bloqueia: usa só comparação de millis().
void tickLedStatus(unsigned long now) {
  bool on = false;

  if (ciclo_manual_ativo && fase != REPOUSO) {
    on = true;                                  // ciclo manual -> aceso fixo
  } else if (pausado_manual && fase == REPOUSO) {
    // v2.5.5 — "Sair" do modo manual no app envia PAUSE: a prateleira volta a
    // REPOUSO e o LED NAO deve ficar piscando intermitente. Usa o mesmo pulso
    // curtissimo de "vivo" do repouso.
    on = ((now % 3000UL) < 40UL);
  } else {
    switch (fase) {
      case INJETANDO:  on = ((now % 1000UL) < 500UL); break;          // lento
      case RETORNANDO: on = ((now % 300UL)  < 150UL); break;          // rápido
      case PAUSADO:    on = ((now % 2000UL) < 150UL); break;          // curto
      case MANUAL:     on = true;                     break;          // válvula manual
      case REPOUSO:
      default:         on = ((now % 3000UL) < 40UL);  break;          // "vivo"
    }
  }

  static bool ultimo = false;
  if (on != ultimo) {
    ultimo = on;
    ledCicloWrite(on);
  }
}


void loop() {
  unsigned long now = millis();

  // v2.6.0 — realimenta o watchdog global e acompanha o piso de memória.
  if (g_wdt_armado) esp_task_wdt_reset();
  {
    uint32_t heap_agora = ESP.getFreeHeap();
    if (heap_agora < g_heap_min) g_heap_min = heap_agora;
  }

  // v1.9.0 — intervalos adaptativos p/ suportar 100+ bancadas na mesma
  // instância Supabase. Em REPOUSO (>99% do tempo) reduz drasticamente
  // requisições; durante ciclo ativo / manual mantém responsividade.
  // v1.9.3 — leitura de temperatura sobe pra 3s e há push imediato por delta.
  // v2.4.4 — o backend limita 60 req/min por prateleira (telemetria + comandos
  // somados). Com 2s/1.5s dava ~70 req/min e gerava "rate_limit_exceeded".
  // Agora: ativo = 3s + 3s (~40 req/min), repouso = 15s + 5s (~16 req/min).
  bool ativo = (fase != REPOUSO) || pausado_manual;
  unsigned long intervaloTelem = ativo ? 3000UL  : 15000UL;  // 3s ativo / 15s parado (delta força push)
  unsigned long intervaloCmd   = ativo ? 3000UL  : 5000UL;   // 3s ativo / 5s parado


  tickLedStatus(now);     // v2.5.4 — LED de status do ciclo / ciclo manual
  tickBotaoCiclo(now);    // v2.5.3 — botão: curto inicia, longo (2 s) cancela
  tickWifiWatchdog(now); // v2.1.2 — reengata rápido quando o Wi-Fi/roteador volta
  tickIrLearn();          // v2.2.0 — captura IR do controle quando ativo
  tickCo2(now);           // v2.4.0 — amostra e envia CO2 se SCD41 presente
  tickBalanca(now);       // v2.4.0 — amostra e envia peso se HX711 presente
  tickBateriaRtc();       // v2.4.7 — OSF do DS3231 a cada 10 min
  tickDesvioRtc();        // v2.5.6 — desvio do RTC contra o NTP (bateria ruim)
  tickCarimboHoraRtc();   // v2.4.7 — carimbo de hora na NVS (detecta perda de hora no boot)

  if (now - lastTick > 1000)          { lastTick  = now; tickCiclo(); tickLuz(); tickAgendaCiclo(); sincronizarNtpParaRtc(); }
  if (now - lastTemp > 3000)          { lastTemp  = now; lerTemperatura(); }  // 3s p/ detectar variação rápido
  if (now - lastCmd  > intervaloCmd && WiFi.status() == WL_CONNECTED) { lastCmd = now; puxarComandos(); }
  if (now - lastTelem > intervaloTelem && WiFi.status() == WL_CONNECTED) {
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
