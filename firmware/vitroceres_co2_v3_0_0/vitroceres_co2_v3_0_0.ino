// =====================================================================
//  VitroCeres OS — Módulo de CO2 (firmware DEDICADO)
//  Versão: 3.0.0-co2
//
//  Este firmware é EXCLUSIVO do sensor de CO2 (SCD41). Ele NÃO controla
//  válvulas, luz, ar-condicionado, balança nem DS18B20/DS3231, e não envia
//  telemetria de prateleira. Só faz três coisas:
//
//    1) Lê ppm + temperatura + umidade do SCD41 (I2C SDA 21 / SCL 22)
//    2) Envia a média a cada 60 s para POST /api/public/co2/reading
//    3) Consulta GET /api/public/co2/commands para receber OTA
//
//  Configuração: portal Wi-Fi "VitroCeres-XXXXXX" (senha 1234567890) com
//  apenas dois campos — Token do sensor de CO2 e fuso horário (POSIX TZ).
//
//  Pinagem:
//    SDA .............. GPIO 21
//    SCL .............. GPIO 22
//    LED de status .... GPIO 19 (opcional)
//    LED da placa ..... GPIO 2
//    Botão reset cfg .. GPIO 0 (segurar 3 s no boot abre o portal)
//
//  Bibliotecas: WiFiManager, ArduinoJson, SensirionI2cScd4x, HTTPClient,
//               HTTPUpdate, Preferences (todas do core ESP32).
// =====================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Wire.h>
#include <SensirionI2cScd4x.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <time.h>

static const char* FIRMWARE_VERSION = "3.0.0-co2";

// Host da aplicação (endpoints públicos autenticados por X-Device-Token)
static const char* API_HOST = "https://explantelab.lovable.app";

// -------- Pinagem --------
static const int PIN_LED_STATUS = 19;  // LED externo opcional
static const int PIN_LED        = 2;   // LED da placa
static const int PIN_RESET_BTN  = 0;   // BOOT: segurar 3 s abre o portal

// -------- Intervalos --------
static const uint32_t INTERVALO_ENVIO_MS    = 60000UL;  // média de ppm
static const uint32_t INTERVALO_COMANDOS_MS = 60000UL;  // consulta OTA
static const uint32_t INTERVALO_RETRY_MS    = 60000UL;  // retenta init SCD41
static const uint32_t WDT_TIMEOUT_S         = 30;

// -------- Estado persistido --------
Preferences prefs;
String g_token_co2 = "";
String g_tz        = "<-03>3";  // America/Sao_Paulo (sem horário de verão)

// -------- SCD41 --------
SensirionI2cScd4x g_scd4x;
bool     g_tem_scd41   = false;
uint16_t g_ppm         = 0;
float    g_temp_c      = NAN;
float    g_umid        = NAN;
uint32_t g_soma_ppm    = 0;
uint32_t g_amostras    = 0;
double   g_soma_temp   = 0;
double   g_soma_umid   = 0;
uint32_t g_ts_amostra  = 0;
uint32_t g_ts_envio    = 0;
uint32_t g_ts_comandos = 0;
uint32_t g_ts_retry    = 0;
bool     g_wdt_armado  = false;
char     g_reset_reason[24] = "desconhecido";

// ===================== Persistência =====================
void carregarConfig() {
  prefs.begin("vc-co2", true);
  g_token_co2 = prefs.getString("tok", "");
  g_tz        = prefs.getString("tz", "<-03>3");
  prefs.end();
}

void salvarConfig() {
  prefs.begin("vc-co2", false);
  prefs.putString("tok", g_token_co2);
  prefs.putString("tz", g_tz);
  prefs.end();
}

// ===================== LED de status =====================
// Sem Wi-Fi: pisca rápido | SCD41 mudo: aceso fixo | normal: pulso curto/3 s
void tickLed() {
  static uint32_t t0 = 0;
  uint32_t now = millis();
  bool on;
  if (!g_tem_scd41) {
    on = true;
  } else if (WiFi.status() != WL_CONNECTED) {
    on = ((now / 150) % 2) == 0;
  } else {
    on = (now - t0 > 3000UL) ? ((now - t0) < 3080UL) : false;
    if (now - t0 > 3080UL) t0 = now;
  }
  digitalWrite(PIN_LED_STATUS, on ? HIGH : LOW);
  digitalWrite(PIN_LED, on ? HIGH : LOW);
}

// ===================== Watchdog =====================
void armarWatchdog() {
  if (esp_task_wdt_init(WDT_TIMEOUT_S, true) == ESP_OK) {
    esp_task_wdt_add(NULL);
    g_wdt_armado = true;
    Serial.printf("[WDT] watchdog global armado (%us)\n", (unsigned)WDT_TIMEOUT_S);
  }
}
inline void alimentarWatchdog() {
  if (g_wdt_armado) esp_task_wdt_reset();
}

void lerMotivoReset() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  strcpy(g_reset_reason, "poweron");   break;
    case ESP_RST_SW:       strcpy(g_reset_reason, "software");  break;
    case ESP_RST_PANIC:    strcpy(g_reset_reason, "panic");     break;
    case ESP_RST_INT_WDT:  strcpy(g_reset_reason, "int_wdt");   break;
    case ESP_RST_TASK_WDT: strcpy(g_reset_reason, "task_wdt");  break;
    case ESP_RST_WDT:      strcpy(g_reset_reason, "wdt");       break;
    case ESP_RST_BROWNOUT: strcpy(g_reset_reason, "brownout");  break;
    case ESP_RST_DEEPSLEEP:strcpy(g_reset_reason, "deepsleep"); break;
    default:               strcpy(g_reset_reason, "outro");     break;
  }
}

// ===================== HTTP =====================
bool postPublic(const char* path, const String& body, String& respOut) {
  if (WiFi.status() != WL_CONNECTED || g_token_co2.length() < 8) return false;
  HTTPClient h;
  WiFiClientSecure c;
  c.setInsecure();
  if (!h.begin(c, String(API_HOST) + path)) return false;
  h.setTimeout(8000);
  h.addHeader("Content-Type", "application/json");
  h.addHeader("X-Device-Token", g_token_co2);
  int code = h.POST(body);
  respOut = h.getString();
  h.end();
  if (code < 200 || code >= 300) {
    Serial.printf("[HTTP] %s => %d: %s\n", path, code, respOut.c_str());
    return false;
  }
  return true;
}

bool getPublic(const char* path, String& respOut) {
  if (WiFi.status() != WL_CONNECTED || g_token_co2.length() < 8) return false;
  HTTPClient h;
  WiFiClientSecure c;
  c.setInsecure();
  if (!h.begin(c, String(API_HOST) + path)) return false;
  h.setTimeout(8000);
  h.addHeader("X-Device-Token", g_token_co2);
  h.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  int code = h.GET();
  respOut = h.getString();
  h.end();
  return code >= 200 && code < 300;
}

// ===================== Portal Wi-Fi =====================
static const char PORTAL_HEAD[] PROGMEM =
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
  "<style>"
  "html,body{margin:0;background:#0b1220;color:#e6edf7;"
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;}"
  ".wrap{max-width:440px;margin:0 auto;padding:24px 18px;}"
  "input,select{width:100%;background:#0a1224;color:#e6edf7;border:1px solid #1f2b45;"
  "border-radius:12px;padding:12px 14px;font-size:15px;}"
  "button,input[type=submit],.btn{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;"
  "background:linear-gradient(135deg,#22c55e,#16a34a);color:#04140a;font-weight:700;font-size:15px;}"
  "label,.wm-label{color:#8ea0be;font-size:12px;text-transform:uppercase;letter-spacing:.08em;"
  "display:block;margin:14px 0 6px;}"
  "</style>"
  "<div class=\"wrap\"><h2>VitroCeres — Sensor de CO2</h2>";

static const char PORTAL_FOOT[] PROGMEM =
  "</div><div style=\"text-align:center;color:#8ea0be;font-size:11px;margin-top:18px\">"
  "ESP32 • VitroCeres OS • Módulo CO2</div>";

void abrirPortalWifi(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  wm.setClass("invert");
  wm.setTitle("VitroCeres — Sensor de CO2");
  wm.setCustomHeadElement(PORTAL_HEAD);
  wm.setCustomMenuHTML(PORTAL_FOOT);
  wm.setShowInfoUpdate(false);
  wm.setShowInfoErase(false);
  std::vector<const char*> menu = {"wifi", "info", "exit"};
  wm.setMenu(menu);

  WiFiManagerParameter p_tok("co2_tok", "Token do sensor de CO2",
                             g_token_co2.c_str(), 64);
  WiFiManagerParameter p_tz("tz", "Fuso horario (POSIX TZ)", g_tz.c_str(), 40);
  wm.addParameter(&p_tok);
  wm.addParameter(&p_tz);

  uint64_t mac = ESP.getEfuseMac();
  char apName[24];
  snprintf(apName, sizeof(apName), "VitroCeres-%02X%02X%02X",
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 16), (uint8_t)(mac >> 8));
  const char* apPass = "1234567890";

  if (forcar) {
    wm.resetSettings();
    if (!wm.startConfigPortal(apName, apPass)) {
      Serial.println("[WM] falha no portal; reiniciando...");
      delay(3000);
      ESP.restart();
    }
    String v = String(p_tok.getValue()); v.trim();
    if (v.length() > 0) g_token_co2 = v;
    v = String(p_tz.getValue()); v.trim();
    if (v.length() > 0) g_tz = v;
    salvarConfig();
    Serial.println("[WM] Wi-Fi conectado");
    return;
  }

  // Já configurado — nunca bloqueia o boot: se a rede estiver fora, o sensor
  // segue medindo e reconecta sozinho (autoReconnect).
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  Serial.print("[WM] tentando Wi-Fi salvo");
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000UL) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  Serial.println(WiFi.status() == WL_CONNECTED
                     ? "[WM] Wi-Fi conectado"
                     : "[WM] SEM Wi-Fi — segue medindo e reconecta sozinho");
}

// ===================== SCD41 =====================
void scanI2c() {
  Serial.println("[I2C] varrendo barramento (SDA=21 / SCL=22)...");
  uint8_t achados = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      achados++;
      Serial.printf("[I2C] dispositivo em 0x%02X%s\n", addr,
                    addr == 0x62 ? "  <- SCD41 (CO2)" : "");
    }
  }
  if (achados == 0) {
    Serial.println("[I2C] NENHUM dispositivo — confira VCC 3V3, GND, SDA=21, SCL=22");
  }
}

void iniciarScd41() {
  g_scd4x.begin(Wire, SCD41_I2C_ADDR_62);
  g_scd4x.wakeUp();
  delay(30);
  g_scd4x.stopPeriodicMeasurement();
  delay(500);
  g_scd4x.reinit();
  delay(30);

  uint64_t serial_num = 0;
  uint16_t errSn = g_scd4x.getSerialNumber(serial_num);
  if (errSn != 0) {
    g_tem_scd41 = false;
    Serial.printf("[SCD41] nao respondeu (err=%u) — retentando em 60 s\n", errSn);
    return;
  }
  Serial.printf("[SCD41] serial=%llu\n", (unsigned long long)serial_num);

  uint16_t err = g_scd4x.startPeriodicMeasurement();
  if (err != 0) {
    g_tem_scd41 = false;
    Serial.printf("[SCD41] startPeriodicMeasurement err=%u\n", err);
    return;
  }
  g_tem_scd41 = true;
  Serial.println("[SCD41] modo periodico OK (1 amostra a cada 5 s)");
}

void tickCo2() {
  uint32_t now = millis();

  // Sensor mudo: retenta a inicialização periodicamente (pode ter sido plugado
  // depois, ou o barramento travou por transiente).
  if (!g_tem_scd41) {
    if (now - g_ts_retry >= INTERVALO_RETRY_MS) {
      g_ts_retry = now;
      Serial.println("[SCD41] tentando reinicializar...");
      alimentarWatchdog();
      iniciarScd41();
    }
    return;
  }

  // Amostra a cada 5 s
  if (now - g_ts_amostra >= 5000UL) {
    g_ts_amostra = now;
    alimentarWatchdog();

    bool pronto = false;
    uint16_t errRdy = g_scd4x.getDataReadyStatus(pronto);
    if (errRdy != 0) {
      static uint8_t falhas = 0;
      falhas++;
      Serial.printf("[SCD41] getDataReadyStatus err=%u (falha %u)\n", errRdy, falhas);
      if (falhas >= 5) { falhas = 0; g_tem_scd41 = false; }
      return;
    }
    if (!pronto) {
      Serial.println("[SCD41] aguardando amostra...");
      return;
    }

    uint16_t ppm = 0;
    float t = NAN, rh = NAN;
    uint16_t errRd = g_scd4x.readMeasurement(ppm, t, rh);
    if (errRd != 0 || ppm == 0) {
      Serial.printf("[SCD41] readMeasurement err=%u ppm=%u\n", errRd, ppm);
      return;
    }

    g_ppm    = ppm;
    g_temp_c = t;
    g_umid   = rh;
    g_soma_ppm  += ppm;
    g_soma_temp += t;
    g_soma_umid += rh;
    g_amostras++;
    Serial.printf("[CO2] %u ppm | %.1f C | %.0f%% (amostras=%u)\n",
                  (unsigned)ppm, t, rh, (unsigned)g_amostras);
  }

  // Envia a média a cada 60 s
  if (now - g_ts_envio >= INTERVALO_ENVIO_MS && g_amostras > 0) {
    g_ts_envio = now;
    uint16_t media = (uint16_t)(g_soma_ppm / g_amostras);
    float mediaT = (float)(g_soma_temp / g_amostras);
    float mediaH = (float)(g_soma_umid / g_amostras);
    g_soma_ppm = 0; g_soma_temp = 0; g_soma_umid = 0; g_amostras = 0;

    if (g_token_co2.length() < 8) {
      Serial.printf("[CO2] media %u ppm NAO enviada — token vazio "
                    "(preencha no portal Wi-Fi)\n", (unsigned)media);
      return;
    }

    JsonDocument doc;
    doc["ppm"] = media;
    doc["temperatura_c"] = serialized(String(mediaT, 2));
    doc["umidade_pct"]   = serialized(String(mediaH, 1));
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["ip_local"] = WiFi.localIP().toString();
    String body;
    serializeJson(doc, body);

    String resp;
    if (postPublic("/api/public/co2/reading", body, resp)) {
      Serial.printf("[CO2] enviado %u ppm | %.1f C | %.0f%%\n",
                    (unsigned)media, mediaT, mediaH);
    } else {
      Serial.printf("[CO2] falha ao enviar %u ppm (resp: %s)\n",
                    (unsigned)media, resp.c_str());
    }
  }
}

// ===================== OTA =====================
void executarOta(const String& url) {
  Serial.printf("[OTA] iniciando download: %s\n", url.c_str());
  Serial.printf("[OTA] heap livre: %u bytes\n", (unsigned)ESP.getFreeHeap());

  WiFiClientSecure otaClient;
  otaClient.setInsecure();
  otaClient.setTimeout(10000);
  httpUpdate.rebootOnUpdate(true);
  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  // Watchdog longo só durante o flash (o OTA é atômico: se travar, o ESP
  // reinicia com o firmware antigo).
  if (g_wdt_armado) esp_task_wdt_delete(NULL);
  bool wdtOta = (esp_task_wdt_init(180, true) == ESP_OK);
  if (wdtOta) esp_task_wdt_add(NULL);

  httpUpdate.onProgress([](int cur, int total) {
    static uint32_t lastLog = 0;
    digitalWrite(PIN_LED_STATUS, (cur / 8192) & 1 ? HIGH : LOW);
    esp_task_wdt_reset();
    if (millis() - lastLog > 1000) {
      lastLog = millis();
      Serial.printf("[OTA] %d / %d bytes (%d%%)\n", cur, total,
                    total > 0 ? (cur * 100 / total) : 0);
    }
  });

  t_httpUpdate_return ret = httpUpdate.update(otaClient, url);
  if (wdtOta) esp_task_wdt_delete(NULL);
  armarWatchdog();

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] FALHOU: (%d) %s\n", httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] Sem atualizacao disponivel");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] OK — reiniciando...");
      break;
  }
}

void tickComandos() {
  uint32_t now = millis();
  if (now - g_ts_comandos < INTERVALO_COMANDOS_MS) return;
  g_ts_comandos = now;
  if (WiFi.status() != WL_CONNECTED || g_token_co2.length() < 8) return;

  String resp;
  if (!getPublic("/api/public/co2/commands", resp)) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  const char* url = doc["ota"]["url"] | "";
  if (*url) executarOta(String(url));
}

// ===================== Wi-Fi / hora =====================
void tickWifi() {
  static uint32_t ultimaTentativa = 0;
  static bool avisou = false;
  if (WiFi.status() == WL_CONNECTED) {
    avisou = false;
    return;
  }
  if (!avisou) {
    avisou = true;
    Serial.println("[WIFI] link caiu — reconectando em background");
  }
  if (millis() - ultimaTentativa > 30000UL) {
    ultimaTentativa = millis();
    WiFi.reconnect();
  }
}

void sincronizarHora() {
  configTzTime(g_tz.c_str(), "pool.ntp.org", "time.google.com");
}

// ===================== setup / loop =====================
void setup() {
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);
  digitalWrite(PIN_LED, LOW);
  pinMode(PIN_RESET_BTN, INPUT_PULLUP);

  Serial.begin(115200);
  delay(1500);  // dá tempo do monitor serial conectar antes dos primeiros logs
  Serial.printf("\n\n== VitroCeres Sensor CO2 ESP32 v%s ==\n", FIRMWARE_VERSION);
  Serial.println("=======================================================");

  lerMotivoReset();
  Serial.printf("[BOOT] motivo do reset: %s | heap=%u\n", g_reset_reason,
                (unsigned)ESP.getFreeHeap());

  carregarConfig();
  Serial.printf("[CFG] token do sensor: %s | tz=%s\n",
                g_token_co2.length() >= 8 ? "configurado" : "VAZIO (portal Wi-Fi)",
                g_tz.c_str());

  Wire.begin(21, 22);
  scanI2c();
  iniciarScd41();

  // Segurar o botão BOOT por 3 s abre o portal de configuração.
  bool forcarPortal = g_token_co2.length() < 8;
  if (!forcarPortal && digitalRead(PIN_RESET_BTN) == LOW) {
    uint32_t t0 = millis();
    while (digitalRead(PIN_RESET_BTN) == LOW && millis() - t0 < 3200UL) delay(50);
    if (millis() - t0 >= 3000UL) {
      Serial.println("[CFG] botao BOOT — abrindo portal de configuracao");
      forcarPortal = true;
    }
  }
  abrirPortalWifi(forcarPortal);
  sincronizarHora();

  armarWatchdog();

  // Pisca 3 vezes indicando boot concluído.
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_STATUS, HIGH); digitalWrite(PIN_LED, HIGH); delay(120);
    digitalWrite(PIN_LED_STATUS, LOW);  digitalWrite(PIN_LED, LOW);  delay(120);
  }
}

void loop() {
  alimentarWatchdog();
  tickWifi();
  tickCo2();
  tickComandos();
  tickLed();
  delay(20);
}
