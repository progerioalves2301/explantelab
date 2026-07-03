# Firmware da Bancada — ESP32

Sketch Arduino para o nó físico da bancada. Fala com o dashboard GeneLab IoT
via HTTPS.

## Hardware

| Sinal            | GPIO |
|------------------|------|
| V1 (injeção A)   | 25   |
| V2 (retorno A)   | 26   |
| V3 (retorno B)   | 27   |
| V4 (injeção B)   | 32   |
| V5 (alívio)      | 33   |
| LED status       | 2    |
| Botão RESET      | 0 (BOOT) |

Use um módulo relé/MOSFET de 5 canais entre o GPIO e a solenóide. Se as
válvulas forem 24 V, isole com opto-driver.

## Instalação

1. Arduino IDE ≥ 2.x com o board **esp32 by Espressif** (≥ 3.0).
2. Library Manager → instalar:
   - **WiFiManager** (tzapu) ≥ 2.0.17
   - **ArduinoJson** (Benoit Blanchon) ≥ 7.0
3. Selecionar **ESP32 Dev Module**, Flash 4 MB, Partition Scheme *Default 4MB with spiffs*.
4. Abrir `bancada_esp32/bancada_esp32.ino`, compilar e gravar.

## Primeiro boot (provisionamento)

1. O ESP32 sobe uma rede AP chamada `BancadaSetup-XXXX` (senha `genelab123`).
2. Conecte-se pelo celular — o portal captivo abre automaticamente
   (ou acesse `http://192.168.4.1`).
3. Escolha o Wi-Fi do laboratório e preencha os campos extras com o que
   aparece na tela **Nova bancada** do dashboard:
   - **Bancada ID** — UUID da bancada
   - **Device Token** — segredo (só aparece uma vez!)
   - **Server URL** — `https://project--<project-id>.lovable.app`
4. Salve. O ESP32 conecta, começa a mandar telemetria e aparece no dashboard.

## Resetar credenciais

Segurar o botão **BOOT** (GPIO 0) por 5 segundos em qualquer momento apaga as
credenciais salvas e reabre o portal AP no próximo boot.

## Segurança

O sketch usa `WiFiClientSecure::setInsecure()` — aceita qualquer certificado.
Para produção, substitua por `setCACert(root_ca_pem)` com a CA raiz do host.

O `Device Token` é o único segredo: quem tiver o token pode enviar telemetria
como essa bancada. Trate como senha.

## Protocolo

- `POST /api/public/bench/telemetry` a cada 5 s
  ```json
  {
    "status": "Injetando",
    "valvulas": { "v1": true, "v2": false, "v3": false, "v4": true, "v5": false },
    "proximo_ciclo_segundos": 14213,
    "firmware_version": "1.0.0",
    "ip_local": "192.168.0.42"
  }
  ```
  Resposta traz `config` e `config_version` — se maior que a local, aplica.

- `GET /api/public/bench/commands` a cada 2 s → lista de comandos pendentes:
  `FORCE_CYCLE`, `PAUSE`, `RESUME`, `UPDATE_CONFIG`.

Header obrigatório em ambos: `X-Device-Token: <token>`.
