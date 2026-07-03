/*
 * GeneLab IoT — Bancada ESP32
 * =============================================================
 * Firmware Arduino para as bancadas físicas do laboratório.
 * - Portal AP (WiFiManager) para configurar Wi-Fi + credenciais no 1o boot.
 * - Ciclo pneumático de 5 válvulas (V1..V5).
 * - Envia telemetria HTTPS a cada 5 s e faz polling de comandos a cada 2 s.
 *
 * Bibliotecas necessárias (Library Manager):
 *   - WiFiManager        (tzapu)          >= 2.0.17
 *   - ArduinoJson        (Benoit Blanchon) >= 7.0
 *   - Preferences        (nativo ESP32)
 *
 * Board: ESP32 Dev Module (esp32 by Espressif >= 3.0)
 *
 * Pinagem (ajuste conforme sua PCB):
 *   V1  → GPIO 25   (injeção lado A)
 *   V2  → GPIO 26   (retorno lado A)
 *   V3  → GPIO 27   (retorno lado B)
 *   V4  → GPIO 32   (injeção lado B)
 *   V5  → GPIO 33   (alívio de pressão)
 *   LED status → GPIO 2 (built-in)
 *   Botão RESET → GPIO 0 (BOOT). Segurar 5 s no boot apaga credenciais.
 *
 * Ciclo:
 *   Repouso  → Injetando (V1+V4)  → Pausa  → Retornando (V2+V3)
 *            → Alivio (V5)        → Repouso …
 *   Intervalo entre ciclos = config.intervalo_ciclo_horas
 * =============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// -------- Credenciais fixas da bancada --------
// Estes valores vêm da tela "Nova bancada" do dashboard.
// Cada ESP32 deve ser flasheado com os valores da SUA bancada.
static const char* BANCADA_ID   = "e7a0b3e7-f36b-440a-9437-dc05268bf359";
static const char* DEVICE_TOKEN = "S6a0B41jgZ9x7Q2eqEQ0sHwSsrnCPHQC8oYatgJdGJA";
static const char* SERVER_URL   = "https://project--90989b19-e7c7-43b6-a4a1-5affc6bb05c8.lovable.app";

// -------- Pinagem --------
static const int PIN_V1 = 25;
static const int PIN_V2 = 26;
static const int PIN_V3 = 27;
static const int PIN_V4 = 32;
static const int PIN_V5 = 33;
static const int PIN_LED = 2;
static const int PIN_RESET_BTN = 0;

// -------- Estado --------
enum FaseCiclo { REPOUSO, INJETANDO, PAUSADO, RETORNANDO, ALIVIO, OFFLINE };

struct Config {
  uint32_t tempo_injecao_segundos   = 150;
  uint32_t tempo_pausa_segundos     = 60;
  uint32_t tempo_retorno_segundos   = 150;
  uint32_t tempo_alivio_segundos    = 10;
  uint32_t intervalo_ciclo_horas    = 4;
  uint32_t versao                   = 0;
};

struct Creds {
  String bancada_id;
  String device_token;
  String server_url;   // ex.: https://project--...lovable.app
};

Config      cfg;
Creds       creds;
Preferences prefs;

FaseCiclo    fase = REPOUSO;
uint32_t     fase_inicio_ms = 0;
uint32_t     proximo_ciclo_epoch = 0; // millis() alvo p/ próximo INJETANDO
bool         pausado_manual = false;

// -------- Utilidades --------
static const char* faseNome(FaseCiclo f) {
  switch (f) {
    case REPOUSO:    return "Repouso";
    case INJETANDO:  return "Injetando";
    case PAUSADO:    return "Pausado";
    case RETORNANDO: return "Retornando";
    case ALIVIO:     return "Alivio";
    case OFFLINE:    return "Offline";
  }
  return "Offline";
}

void escreverValvulas(bool v1, bool v2, bool v3, bool v4, bool v5) {
  digitalWrite(PIN_V1, v1 ? HIGH : LOW);
  digitalWrite(PIN_V2, v2 ? HIGH : LOW);
  digitalWrite(PIN_V3, v3 ? HIGH : LOW);
  digitalWrite(PIN_V4, v4 ? HIGH : LOW);
  digitalWrite(PIN_V5, v5 ? HIGH : LOW);
}

void aplicarFase(FaseCiclo f) {
  fase = f;
  fase_inicio_ms = millis();
  switch (f) {
    case INJETANDO:  escreverValvulas(true,  false, false, true,  false); break;
    case RETORNANDO: escreverValvulas(false, true,  true,  false, false); break;
    case ALIVIO:     escreverValvulas(false, false, false, false, true);  break;
    default:         escreverValvulas(false, false, false, false, false); break;
  }
  Serial.printf("[FASE] %s\n", faseNome(f));
}

// -------- Persistência --------
void carregarCreds() {
  // Credenciais são fixas no firmware (BANCADA_ID / DEVICE_TOKEN / SERVER_URL).
  creds.bancada_id   = BANCADA_ID;
  creds.device_token = DEVICE_TOKEN;
  creds.server_url   = SERVER_URL;

  prefs.begin("genelab", true);
  cfg.tempo_injecao_segundos = prefs.getUInt("t_inj",  150);
  cfg.tempo_pausa_segundos   = prefs.getUInt("t_pau",  60);
  cfg.tempo_retorno_segundos = prefs.getUInt("t_ret",  150);
  cfg.tempo_alivio_segundos  = prefs.getUInt("t_ali",  10);
  cfg.intervalo_ciclo_horas  = prefs.getUInt("t_int",  4);
  cfg.versao                 = prefs.getUInt("cfgv",   0);
  prefs.end();
}


void salvarConfig() {
  prefs.begin("genelab", false);
  prefs.putUInt("t_inj", cfg.tempo_injecao_segundos);
  prefs.putUInt("t_pau", cfg.tempo_pausa_segundos);
  prefs.putUInt("t_ret", cfg.tempo_retorno_segundos);
  prefs.putUInt("t_ali", cfg.tempo_alivio_segundos);
  prefs.putUInt("t_int", cfg.intervalo_ciclo_horas);
  prefs.putUInt("cfgv",  cfg.versao);
  prefs.end();
}

void apagarTudo() {
  prefs.begin("genelab", false);
  prefs.clear();
  prefs.end();
}

// -------- Portal AP (apenas Wi-Fi) --------
void abrirPortalWifi(bool forcar) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(300); // 5 min

  const char* apName = "BancadaSetup";
  const char* apPass = "1234567890";

  bool ok;
  if (forcar) {
    wm.resetSettings();
    ok = wm.startConfigPortal(apName, apPass);
  } else {
    ok = wm.autoConnect(apName, apPass);
  }

  if (!ok) {
    Serial.println("[WM] falha no portal; reiniciando…");
    delay(3000);
    ESP.restart();
  }
  Serial.println("[WM] Wi-Fi conectado");
}

// -------- HTTPS --------
bool httpJson(const String& method, const String& path,
              const String& body, String& outBody) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure(); // dev: aceita qualquer cert. Em produção use setCACert().
  HTTPClient http;
  String url = creds.server_url + path;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", creds.device_token);
  int code = (method == "POST") ? http.POST(body) : http.GET();
  outBody = http.getString();
  http.end();
  if (code < 200 || code >= 300) {
    Serial.printf("[HTTP] %s %s => %d: %s\n", method.c_str(), path.c_str(), code, outBody.c_str());
    return false;
  }
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

void enviarTelemetria() {
  JsonDocument doc;
  doc["status"] = faseNome(fase);
  JsonObject v = doc["valvulas"].to<JsonObject>();
  v["v1"] = digitalRead(PIN_V1);
  v["v2"] = digitalRead(PIN_V2);
  v["v3"] = digitalRead(PIN_V3);
  v["v4"] = digitalRead(PIN_V4);
  v["v5"] = digitalRead(PIN_V5);
  doc["proximo_ciclo_segundos"] = proxCicloSegRest();
  doc["firmware_version"] = "1.0.0";
  doc["ip_local"] = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);
  String resp;
  if (!httpJson("POST", "/api/public/bench/telemetry", body, resp)) return;

  JsonDocument r;
  if (deserializeJson(r, resp) != DeserializationError::Ok) return;
  uint32_t nova_ver = r["config_version"] | 0;
  if (nova_ver > cfg.versao) {
    JsonObject c = r["config"].as<JsonObject>();
    cfg.tempo_injecao_segundos = c["tempo_injecao_segundos"] | cfg.tempo_injecao_segundos;
    cfg.tempo_pausa_segundos   = c["tempo_pausa_segundos"]   | cfg.tempo_pausa_segundos;
    cfg.tempo_retorno_segundos = c["tempo_retorno_segundos"] | cfg.tempo_retorno_segundos;
    cfg.tempo_alivio_segundos  = c["tempo_alivio_segundos"]  | cfg.tempo_alivio_segundos;
    cfg.intervalo_ciclo_horas  = c["intervalo_ciclo_horas"]  | cfg.intervalo_ciclo_horas;
    cfg.versao = nova_ver;
    salvarConfig();
    Serial.printf("[CFG] atualizado p/ versão %u\n", (unsigned)nova_ver);
  }
}

// -------- Comandos --------
void tratarComando(JsonObject cmd) {
  const char* tipo = cmd["tipo"] | "";
  Serial.printf("[CMD] %s\n", tipo);
  if (strcmp(tipo, "FORCE_CYCLE") == 0) {
    pausado_manual = false;
    aplicarFase(INJETANDO);
  } else if (strcmp(tipo, "PAUSE") == 0) {
    pausado_manual = true;
    aplicarFase(REPOUSO);
  } else if (strcmp(tipo, "RESUME") == 0) {
    pausado_manual = false;
  } else if (strcmp(tipo, "UPDATE_CONFIG") == 0) {
    JsonObject p = cmd["payload"].as<JsonObject>();
    cfg.tempo_injecao_segundos = p["tempo_injecao_segundos"] | cfg.tempo_injecao_segundos;
    cfg.tempo_pausa_segundos   = p["tempo_pausa_segundos"]   | cfg.tempo_pausa_segundos;
    cfg.tempo_retorno_segundos = p["tempo_retorno_segundos"] | cfg.tempo_retorno_segundos;
    cfg.tempo_alivio_segundos  = p["tempo_alivio_segundos"]  | cfg.tempo_alivio_segundos;
    cfg.intervalo_ciclo_horas  = p["intervalo_ciclo_horas"]  | cfg.intervalo_ciclo_horas;
    cfg.versao++;
    salvarConfig();
  }
}

void puxarComandos() {
  String resp;
  if (!httpJson("GET", "/api/public/bench/commands", "", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
  JsonArray arr = doc["comandos"].as<JsonArray>();
  for (JsonObject c : arr) tratarComando(c);
}

// -------- Máquina de estados --------
void tickCiclo() {
  if (pausado_manual) { aplicarFase(REPOUSO); return; }
  uint32_t decorrido = (millis() - fase_inicio_ms) / 1000;
  switch (fase) {
    case REPOUSO:
      if (decorrido >= cfg.intervalo_ciclo_horas * 3600UL) aplicarFase(INJETANDO);
      break;
    case INJETANDO:
      if (decorrido >= cfg.tempo_injecao_segundos) aplicarFase(PAUSADO);
      break;
    case PAUSADO:
      if (decorrido >= cfg.tempo_pausa_segundos) aplicarFase(RETORNANDO);
      break;
    case RETORNANDO:
      if (decorrido >= cfg.tempo_retorno_segundos) aplicarFase(ALIVIO);
      break;
    case ALIVIO:
      if (decorrido >= cfg.tempo_alivio_segundos) aplicarFase(REPOUSO);
      break;
    case OFFLINE: break;
  }
}

// -------- Setup / Loop --------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n== GeneLab Bancada ESP32 ==");

  for (int p : {PIN_V1, PIN_V2, PIN_V3, PIN_V4, PIN_V5, PIN_LED}) {
    pinMode(p, OUTPUT); digitalWrite(p, LOW);
  }
  pinMode(PIN_RESET_BTN, INPUT_PULLUP);

  carregarCreds();

  // Botão RESET segurado no boot → limpar tudo
  if (digitalRead(PIN_RESET_BTN) == LOW) {
    Serial.println("Botão RESET pressionado — apagando credenciais em 5s…");
    delay(5000);
    if (digitalRead(PIN_RESET_BTN) == LOW) {
      apagarTudo();
      creds = {};
      Serial.println("Preferences apagadas.");
    }
  }

  bool precisaPortal = creds.bancada_id.isEmpty() ||
                       creds.device_token.isEmpty() ||
                       creds.server_url.isEmpty();
  abrirPortalConfig(precisaPortal);

  Serial.printf("Wi-Fi OK: %s\n", WiFi.localIP().toString().c_str());
  digitalWrite(PIN_LED, HIGH);
  aplicarFase(REPOUSO);
}

unsigned long lastTelem = 0, lastCmd = 0, lastTick = 0;

void loop() {
  unsigned long now = millis();

  if (now - lastTick > 1000)  { lastTick  = now; tickCiclo(); }
  if (now - lastCmd  > 2000)  { lastCmd   = now; puxarComandos(); }
  if (now - lastTelem > 5000) { lastTelem = now; enviarTelemetria(); }

  // Reset em runtime: botão segurado por 5 s
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
