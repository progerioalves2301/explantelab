/**
 * VitroCeres — Balança HX711
 * Firmware v1.0.0
 *
 * Uma balança HX711 + célula de carga por SALA. A muda fica sobre a balança
 * do primeiro dia ao fim do ciclo. Servidor decide QUANDO gravar amostra
 * (RPC scale_can_sample): não amostra durante ciclo hidráulico das prateleiras
 * daquela sala nem durante janela de estabilização pós-ciclo.
 *
 * Persistido em NVS (Preferences):
 *   - fator_cal        : constante da célula (calibração 1x na instalação)
 *   - zero_offset      : tare do vaso vazio (setado ao dar Start em uma muda)
 *   - muda_ident       : identificador da muda ativa (etiqueta legível)
 *   - device_token     : token da balança (pareamento)
 *
 * Endpoints usados:
 *   GET  /api/public/scale/status    — pode amostrar?
 *   POST /api/public/scale/reading   — envia leitura
 *
 * Hardware:
 *   HX711 DOUT → GPIO 16
 *   HX711 SCK  → GPIO 17
 *   Botão TARE (para GND) → GPIO 4
 *   Botão START/STOP     → GPIO 5
 *   LED status           → GPIO 2 (onboard)
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <HX711.h>

#define FW_VERSION           "1.0.0"
#define PIN_HX_DOUT          16
#define PIN_HX_SCK           17
#define PIN_BTN_TARE         4
#define PIN_BTN_START        5
#define PIN_LED              2

#define INTERVALO_LEITURA_MS       2000    // lê balança a cada 2s
#define INTERVALO_STATUS_MS        60000   // consulta status do servidor a cada 60s
#define INTERVALO_ENVIO_MS         300000  // envia amostra a cada 5 min (se pode)
#define AMOSTRAS_MEDIA             10      // média móvel para leitura estável

const char* API_HOST = "https://explantelab.lovable.app";  // ajuste se preciso

HX711 balanca;
Preferences prefs;

float fatorCal   = 1.0f;
long  zeroOffset = 0;
String mudaIdent = "";
String deviceToken = "";

float ultimaLeituraG = 0;
bool  podeAmostrar = false;
String motivoBloqueio = "iniciando";

unsigned long tsUltimaLeitura = 0;
unsigned long tsUltimoStatus  = 0;
unsigned long tsUltimoEnvio   = 0;

// ============ Utilidades ============

void piscarLed(int vezes, int msOn = 100) {
  for (int i = 0; i < vezes; i++) {
    digitalWrite(PIN_LED, HIGH); delay(msOn);
    digitalWrite(PIN_LED, LOW);  delay(msOn);
  }
}

void salvarNVS() {
  prefs.begin("vc-scale", false);
  prefs.putFloat("fator", fatorCal);
  prefs.putLong("zero", zeroOffset);
  prefs.putString("muda", mudaIdent);
  prefs.putString("token", deviceToken);
  prefs.end();
}

void carregarNVS() {
  prefs.begin("vc-scale", true);
  fatorCal    = prefs.getFloat("fator", 1.0f);
  zeroOffset  = prefs.getLong("zero", 0);
  mudaIdent   = prefs.getString("muda", "");
  deviceToken = prefs.getString("token", "");
  prefs.end();
  Serial.printf("[NVS] fator=%.4f zero=%ld muda=%s token=%s\n",
                fatorCal, zeroOffset, mudaIdent.c_str(),
                deviceToken.length() ? "***" : "(vazio)");
}

// ============ Balança ============

float lerPesoG() {
  if (!balanca.is_ready()) return ultimaLeituraG;
  long raw = balanca.read_average(AMOSTRAS_MEDIA);
  float g = (raw - zeroOffset) / fatorCal;
  return g;
}

void tarear() {
  Serial.println("[TARE] iniciando...");
  long raw = balanca.read_average(20);
  zeroOffset = raw;
  salvarNVS();
  Serial.printf("[TARE] zero=%ld\n", zeroOffset);
  piscarLed(3, 80);
}

// ============ Comunicação ============

bool consultarStatus() {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return false;
  HTTPClient http;
  http.begin(String(API_HOST) + "/api/public/scale/status");
  http.addHeader("X-Device-Token", deviceToken);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[STATUS] HTTP %d\n", code);
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, body)) return false;
  podeAmostrar   = doc["amostrar"] | false;
  motivoBloqueio = String((const char*)(doc["motivo"] | "ok"));
  Serial.printf("[STATUS] amostrar=%d motivo=%s\n", podeAmostrar, motivoBloqueio.c_str());
  return true;
}

bool enviarLeitura(float g) {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return false;
  if (mudaIdent.length() == 0) {
    Serial.println("[ENVIO] sem muda ativa — pulo");
    return false;
  }
  HTTPClient http;
  http.begin(String(API_HOST) + "/api/public/scale/reading");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", deviceToken);

  StaticJsonDocument<256> doc;
  doc["valor_g"] = g;
  doc["muda_identificador"] = mudaIdent;
  String out; serializeJson(doc, out);

  int code = http.POST(out);
  String resp = http.getString();
  http.end();
  Serial.printf("[ENVIO] %.2fg → HTTP %d %s\n", g, code, resp.c_str());
  return code == 200;
}

// ============ Botões ============

void checarBotoes() {
  static unsigned long lastTare = 0;
  static unsigned long lastStart = 0;
  if (digitalRead(PIN_BTN_TARE) == LOW && millis() - lastTare > 1000) {
    lastTare = millis();
    tarear();
  }
  if (digitalRead(PIN_BTN_START) == LOW && millis() - lastStart > 1000) {
    lastStart = millis();
    if (mudaIdent.length() == 0) {
      // Sem identificador: firmware entra em modo "aguardando muda pela UI web"
      // Fluxo típico: você cadastra a muda no app e digita o identificador na
      // página de configuração da balança (ou via portal cativo).
      Serial.println("[START] sem muda cadastrada — configure pelo app");
      piscarLed(5, 60);
    } else {
      Serial.printf("[STOP] encerrando muda %s\n", mudaIdent.c_str());
      mudaIdent = "";
      salvarNVS();
      piscarLed(2, 200);
    }
  }
}

// ============ Setup / Loop ============

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BTN_TARE, INPUT_PULLUP);
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  digitalWrite(PIN_LED, LOW);

  carregarNVS();

  balanca.begin(PIN_HX_DOUT, PIN_HX_SCK);
  balanca.set_scale(1.0f);
  balanca.set_offset(0);

  Serial.printf("[BOOT] VitroCeres Balança v%s\n", FW_VERSION);

  // WiFiManager — portal AP "VitroCeres-Balanca-XXXXXX"
  uint64_t mac = ESP.getEfuseMac();
  char apName[32];
  snprintf(apName, sizeof(apName), "VitroCeres-Balanca-%06X", (uint32_t)(mac & 0xFFFFFF));
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  if (!wm.autoConnect(apName)) {
    Serial.println("[WIFI] falha — seguindo offline");
  }
  Serial.printf("[WIFI] IP=%s\n", WiFi.localIP().toString().c_str());
  piscarLed(2, 150);
}

void loop() {
  checarBotoes();

  if (millis() - tsUltimaLeitura > INTERVALO_LEITURA_MS) {
    tsUltimaLeitura = millis();
    ultimaLeituraG = lerPesoG();
    Serial.printf("[PESO] %.2f g (muda=%s pode=%d)\n",
                  ultimaLeituraG, mudaIdent.c_str(), podeAmostrar);
  }

  if (millis() - tsUltimoStatus > INTERVALO_STATUS_MS || tsUltimoStatus == 0) {
    tsUltimoStatus = millis();
    consultarStatus();
  }

  if (podeAmostrar && millis() - tsUltimoEnvio > INTERVALO_ENVIO_MS) {
    tsUltimoEnvio = millis();
    enviarLeitura(ultimaLeituraG);
  }

  delay(50);
}
