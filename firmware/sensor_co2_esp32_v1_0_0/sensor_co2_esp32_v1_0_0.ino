/**
 * VitroCeres — Sensor de CO₂ (SCD41)
 * Firmware v1.0.0
 *
 * Cenário: 1 ESP32 + 1 SCD41 por sala do laboratório. O sensor mora dentro
 * (ou na tampa) do garrafão da muda e reporta CO₂ ambiente em ppm.
 *
 * Endpoint:
 *   POST /api/public/co2/reading
 *   Header: X-Device-Token: <device_token>
 *   Body:   { "ppm": <number> }
 *
 * Hardware (I²C):
 *   SCD41 SDA → GPIO 21
 *   SCD41 SCL → GPIO 22
 *   SCD41 VCC → 3V3   (NÃO usar 5V)
 *   SCD41 GND → GND
 *   LED status → GPIO 2 (onboard)
 *
 * Notas de montagem na tampa do garrafão:
 *   - Fixe o sensor voltado para o interior, com o difusor livre.
 *   - Passe os 4 fios por prensa-cabo M8 e vede com SILICONE NEUTRO
 *     (o silicone acético libera ácido acético e envenena o NDIR).
 *   - Rode o SCD41 em modo periódico (1 leitura / 5 s) — leituras
 *     tornam-se válidas ~30 s após energizar.
 *
 * Provisionamento:
 *   1) Primeiro boot → cria AP "VitroCeres-CO2-XXXXXX" (WiFiManager).
 *   2) Configure Wi-Fi e o campo "Device Token" (gerado na tela Sensores
 *      CO₂ do painel, botão Copy).
 *   3) O token fica salvo em NVS. Para reprovisionar, mantenha o botão
 *      BOOT (GPIO 0) pressionado por 5 s ao ligar.
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Preferences.h>
#include <SensirionI2CScd4x.h>

#define FW_VERSION            "1.0.0"
#define PIN_SDA               21
#define PIN_SCL               22
#define PIN_LED               2
#define PIN_BTN_RESET         0     // BOOT

#define INTERVALO_LEITURA_MS  5000   // SCD41 modo periódico: 1 amostra / 5 s
#define INTERVALO_ENVIO_MS    60000  // envia 1x por minuto (média das últimas amostras)
#define TAMANHO_MEDIA         12     // ~1 min de amostras

const char* API_HOST = "https://explantelab.lovable.app";

SensirionI2CScd4x scd4x;
Preferences prefs;

String deviceToken = "";
uint16_t bufferPpm[TAMANHO_MEDIA];
uint8_t bufferIdx = 0;
uint8_t bufferCount = 0;

uint16_t ultimoPpm = 0;
float ultimaTempC = 0;
float ultimaUmid = 0;

unsigned long tsUltimaLeitura = 0;
unsigned long tsUltimoEnvio   = 0;

// ============ Utilidades ============

void piscarLed(int vezes, int msOn = 80) {
  for (int i = 0; i < vezes; i++) {
    digitalWrite(PIN_LED, HIGH); delay(msOn);
    digitalWrite(PIN_LED, LOW);  delay(msOn);
  }
}

void salvarToken(const String& t) {
  prefs.begin("vc-co2", false);
  prefs.putString("token", t);
  prefs.end();
}

String carregarToken() {
  prefs.begin("vc-co2", true);
  String t = prefs.getString("token", "");
  prefs.end();
  return t;
}

void limparNVS() {
  prefs.begin("vc-co2", false);
  prefs.clear();
  prefs.end();
}

// ============ Wi-Fi ============

void configurarWifi() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);

  char mac[7];
  uint64_t chipid = ESP.getEfuseMac();
  snprintf(mac, sizeof(mac), "%06X", (uint32_t)(chipid >> 24));
  String apName = String("VitroCeres-CO2-") + mac;

  WiFiManagerParameter tokenParam("token", "Device Token (painel VitroCeres)",
                                   deviceToken.c_str(), 64);
  wm.addParameter(&tokenParam);

  Serial.printf("[WIFI] AP: %s\n", apName.c_str());
  bool ok = wm.autoConnect(apName.c_str());
  if (!ok) {
    Serial.println("[WIFI] falha no portal, reiniciando");
    delay(2000);
    ESP.restart();
  }

  String novoToken = String(tokenParam.getValue());
  novoToken.trim();
  if (novoToken.length() >= 16 && novoToken != deviceToken) {
    deviceToken = novoToken;
    salvarToken(deviceToken);
    Serial.println("[NVS] token salvo");
  }
  Serial.printf("[WIFI] conectado, IP=%s\n", WiFi.localIP().toString().c_str());
}

// ============ SCD41 ============

void iniciarSensor() {
  Wire.begin(PIN_SDA, PIN_SCL);
  scd4x.begin(Wire);

  // Para caso o sensor esteja em medição contínua de um boot anterior:
  scd4x.stopPeriodicMeasurement();
  delay(500);

  uint16_t err = scd4x.startPeriodicMeasurement();
  if (err) {
    Serial.printf("[SCD41] erro startPeriodicMeasurement: %u\n", err);
    piscarLed(6);
  } else {
    Serial.println("[SCD41] modo periódico OK (1 amostra a cada 5 s)");
  }
}

bool lerSensor() {
  bool pronto = false;
  if (scd4x.getDataReadyFlag(pronto) != 0 || !pronto) return false;

  uint16_t co2 = 0;
  float t = 0, rh = 0;
  uint16_t err = scd4x.readMeasurement(co2, t, rh);
  if (err || co2 == 0) return false;

  ultimoPpm = co2;
  ultimaTempC = t;
  ultimaUmid = rh;

  bufferPpm[bufferIdx] = co2;
  bufferIdx = (bufferIdx + 1) % TAMANHO_MEDIA;
  if (bufferCount < TAMANHO_MEDIA) bufferCount++;

  Serial.printf("[SCD41] %u ppm | %.1f°C | %.0f%%RH\n", co2, t, rh);
  return true;
}

uint16_t mediaPpm() {
  if (bufferCount == 0) return 0;
  uint32_t soma = 0;
  for (uint8_t i = 0; i < bufferCount; i++) soma += bufferPpm[i];
  return (uint16_t)(soma / bufferCount);
}

// ============ Envio ============

bool enviarLeitura(uint16_t ppm) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (deviceToken.length() < 16) {
    Serial.println("[HTTP] sem token, pulando envio");
    return false;
  }

  HTTPClient http;
  String url = String(API_HOST) + "/api/public/co2/reading";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", deviceToken);
  http.setTimeout(8000);

  String body = String("{\"ppm\":") + ppm + "}";
  int code = http.POST(body);
  bool ok = (code >= 200 && code < 300);
  Serial.printf("[HTTP] POST %d ppm=%u %s\n", code, ppm, ok ? "OK" : "FAIL");
  if (!ok) {
    String resp = http.getString();
    Serial.printf("[HTTP] resp: %s\n", resp.c_str());
  }
  http.end();
  return ok;
}

// ============ Setup / loop ============

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[VitroCeres CO2] fw %s\n", FW_VERSION);

  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BTN_RESET, INPUT_PULLUP);

  // Reset de fábrica: segura BOOT por 5 s ao ligar.
  if (digitalRead(PIN_BTN_RESET) == LOW) {
    unsigned long t0 = millis();
    while (digitalRead(PIN_BTN_RESET) == LOW && millis() - t0 < 5000) delay(50);
    if (millis() - t0 >= 5000) {
      Serial.println("[NVS] limpando credenciais");
      limparNVS();
      WiFi.disconnect(true, true);
      piscarLed(10, 60);
      ESP.restart();
    }
  }

  deviceToken = carregarToken();
  configurarWifi();
  iniciarSensor();

  Serial.println("[BOOT] aguardando estabilizar (~30 s)...");
  piscarLed(3);
}

void loop() {
  unsigned long agora = millis();

  if (agora - tsUltimaLeitura >= INTERVALO_LEITURA_MS) {
    tsUltimaLeitura = agora;
    lerSensor();
  }

  if (agora - tsUltimoEnvio >= INTERVALO_ENVIO_MS && bufferCount > 0) {
    tsUltimoEnvio = agora;
    uint16_t p = mediaPpm();
    if (enviarLeitura(p)) piscarLed(1);
    else piscarLed(3, 40);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] desconectado, reconectando...");
    WiFi.reconnect();
    delay(3000);
  }
}
