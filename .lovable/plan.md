# Firmware exclusivo para o módulo de CO2 (v3.0.0-co2)

Faz muito sentido. Hoje o módulo de CO2 roda o mesmo `.ino` das prateleiras (2.582 linhas): ciclos de válvulas, agenda de luz, IR de ar-condicionado, HX711, DS18B20, botão/LED de ciclo — tudo carregado e executado à toa. Isso custa RAM/flash (importante para OTA), gera logs confusos como a varredura eterna do DS18B20 e cria caminhos de código que podem travar um sensor que só precisa medir e enviar.

## O que o firmware do CO2 faz

- Wi-Fi via portal "VitroCeres-XXXXXX" com apenas 3 campos: URL da API, **Token do sensor de CO2** e fuso.
- SCD41 no I²C (SDA 21 / SCL 22): varredura do barramento no boot, `wakeUp` + `reinit`, medição periódica, retentativa a cada 60 s se não responder.
- Envio da média de ppm a cada 60 s para `POST /api/public/co2/reading` com header `X-Device-Token`.
- Temperatura e umidade do SCD41 lidas e logadas; enviadas junto no mesmo POST (ver seção técnica).
- Watchdog de 30 s alimentado nos loops de leitura e de rede; reconexão Wi-Fi automática e operação normal offline (só acumula/descarta leituras, sem travar).
- LED de status opcional no GPIO 19: pisca a cada leitura boa, pisca rápido sem Wi-Fi, aceso fixo se o SCD41 não responde.
- OTA pelo mesmo comando/bucket já usado hoje, para poder atualizar sem USB.

## O que sai fora

Válvulas, fases de ciclo, agenda de horários, luz, DS3231, IR/ar-condicionado, HX711, botão de ciclo, telemetria de prateleira. Nada de `bench/telemetry` nem `bench/commands` — o módulo é só um sensor.

## Efeito no app

- O card do CO2 no dashboard e a aba de sensores continuam iguais: já leem de `sensores_co2` / `medicoes_co2`.
- Como esse módulo deixa de enviar telemetria de prateleira, a "prateleira CO2" cadastrada hoje não vai mais aparecer online. Duas opções, escolha na hora de aplicar: manter a prateleira só como rótulo (marcada como não-operacional) ou remover e ficar apenas com o sensor na aba de CO2.
- Temperatura da sala: com o campo novo no banco, a aba de CO2 passa a mostrar temperatura e umidade da sala junto do ppm.

## Detalhes técnicos

- Novo sketch `firmware/vitroceres_co2_v3_0_0/vitroceres_co2_v3_0_0.ino`, independente (não é fork mantido em paralelo do de prateleira). Libs: WiFiManager, HTTPClient, Preferences, SensirionI2cScd4x, esp_task_wdt, HTTPUpdate (OTA).
- `sensores_co2` ganha `ultima_temperatura_c` e `ultima_umidade_pct` (nullable); `medicoes_co2` ganha `temperatura_c` e `umidade_pct` (nullable). Migração com os GRANTs correspondentes.
- `src/routes/api/public/co2.reading.ts`: schema passa a aceitar `temperatura_c` e `umidade_pct` opcionais; `co2_push_reading` atualizado para gravar os dois quando presentes (compatível com firmwares antigos que só mandam `ppm`).
- OTA: o comando OTA hoje chega por `bench/commands`, que é atrelado a prateleira. Para o módulo de CO2 o firmware fará um GET leve em um endpoint novo `GET /api/public/co2/commands` (autenticado pelo token do sensor) a cada 60 s, devolvendo `{ ota: { url, filename } }` quando houver atualização pendente; a tela `/atualizacao` lista os sensores de CO2 junto das prateleiras.
- `docs/FIRMWARE.md` ganha uma seção separada para o módulo CO2 (pinagem: I²C 21/22, LED 19) e o `CHANGELOG.md` registra a criação da linha de firmware dedicada.
