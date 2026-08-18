# Changelog — VitroCeres / Explante Lab

> Histórico técnico de alterações do projeto. Cada entrada explica **o que mudou**, **como funciona** e **se exige ação** (ex: atualizar firmware dos ESP32, reconfigurar no app, etc.).

## 2026-08-18 — CO₂ v3.0.1-co2: pareamento por senha de 6 dígitos

- **O que mudou**: o módulo de CO₂ não pede mais token nem URL de API. A URL já é fixa no firmware (`https://explantelab.lovable.app`) e o portal Wi-Fi agora tem só **Senha de pareamento (6 dígitos)** + fuso.
- **Como funciona**: na aba **CO₂**, o botão **Gerar senha** no card do sensor cria um código de 6 dígitos válido por 24 h. O ESP32 envia esse código em `POST /api/public/co2/pair` e recebe o token definitivo, que fica salvo em Preferences. Se a senha estiver expirada/errada, ele avisa no serial e retenta a cada 30 s até haver senha válida.
- **Ação**: gravar `firmware/vitroceres_co2_v3_0_1/vitroceres_co2_v3_0_1.ino`, gerar a senha no app e digitá-la no portal.

---

## 2026-08-18 — Firmware dedicado do CO₂: VitroCeres CO2 OS v3.0.0-co2

- **O que mudou**: módulos de CO₂ passam a ter sketch próprio em `firmware/vitroceres_co2_v3_0_1/vitroceres_co2_v3_0_1.ino` — só Wi-Fi (portal `VitroCeres-XXXXXX`), SCD41 (I²C 21/22), LED de status (GPIO 19), watchdog e OTA. Sem válvulas, ciclos, luz, IR/ar-condicionado ou HX711.
- **Backend**:
  - `POST /api/public/co2/reading` aceita agora `temperatura_c`, `umidade_pct`, `firmware_version` e `ip_local` (todos opcionais — firmwares antigos continuam funcionando).
  - Novo `GET /api/public/co2/commands` (header `X-Device-Token`) devolve o OTA pendente do sensor.
  - `sensores_co2` guarda última temperatura/umidade, versão de firmware, IP e o OTA agendado; `medicoes_co2` guarda temperatura e umidade por leitura.
- **App**: a aba **Atualização** ganhou a seção “Sensores de CO₂ (firmware dedicado)”, com status online/offline, versão instalada e botões Atualizar/Parar por sensor.
- **Ação**: gravar a v3.0.0-co2 por USB no módulo de CO₂ (a partir daí o OTA funciona pelo app) e informar o token do sensor no portal Wi-Fi.

---

## 2026-08-18 — Firmware v2.6.8: temperatura vem do SCD41 quando não há DS18B20

- **Problema**: em módulos só com SCD41 (CO₂), o loop imprimia `[TEMP] leitura invalida (t=-127...)` indefinidamente e o 1-Wire era varrido a cada 30 s.
- **Correção**: o SCD41 passa a ser a fonte **primária** de temperatura quando o DS18B20 não está instalado. Enquanto a 1ª amostra não chega, o log é um aviso único a cada 30 s (`aguardando temperatura do SCD41`), sem marcar "sensor travado" nem forçar reinícios do 1-Wire. Re-scan do DS18B20 cai para 5 min quando há SCD41. O log de leitura boa agora indica a origem: `[TEMP] 24.3 C (SCD41)`.
- **Ação**: compilar `firmware/bancada_esp32_v2_6_8/bancada_esp32_v2_6_8.ino` e atualizar via OTA.

---

## 2026-08-18 — Correção crítica: prateleiras ficando offline ao entrar em Repouso

- **Causa**: o gatilho `tg_bancada_fim_ciclo_balanca` (criado na integração da balança) consultava `balancas.laboratorio_id`, coluna que não existe. Toda telemetria com status `Repouso` era abortada com erro `42703`, então cada prateleira parava de atualizar exatamente no fim da fase de Retorno e aparecia como Offline (os ESP32 seguiam funcionando normalmente).
- **Correção**: o gatilho agora localiza a balança por `bancada_associada_id` e qualquer falha nessa etapa é ignorada, nunca derrubando a telemetria.
- **Ação**: nenhuma — não exige atualização de firmware.

---


## 2026-08-18 — Firmware v2.6.6 + Resiliência de Sensores

**Firmware (v2.6.6)**
- **Watchdog Global**: Adicionada alimentação do watchdog (`esp_task_wdt_reset`) nos loops de leitura do sensor de CO2 (SCD41) e da balança (HX711). Isso evita reinícios inesperados em equipamentos onde esses sensores demoram a responder ou travam o barramento I2C/Serial.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_6/bancada_esp32_v2_6_6.ino` e atualizar via OTA.

## 2026-08-18 — Firmware v2.6.5 + Correções de Conectividade

**Firmware (v2.6.5)**
- **Melhoria na Reconexão Wi-Fi**: Ajustada a lógica de watchdog e persistência para mitigar quedas de conexão em massa durante a noite.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_5/bancada_esp32_v2_6_5.ino` e atualizar via OTA.

## 2026-08-18 — Firmware v2.6.4 + Debug Serial Aprimorado

**Firmware (v2.6.4)**
- **Serial Debug**: Aumentado delay no boot e adicionado banner visual para garantir que a IDE capture o início dos logs.
- **Debug Balança**: Lógica de leitura do HX711 alterada para forçar retorno de dados mesmo que o chip demore a responder, com log detalhado (`ready=0/1`).
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_4/bancada_esp32_v2_6_4.ino` e atualizar via OTA. Verifique o Monitor Serial a 115200 bps.

## 2026-08-18 — Firmware v2.6.3 + Log de Debug da Balança

**Firmware (v2.6.3)**
- **Debug Balança**: Adicionado log de leitura raw no Serial (`[DEBUG BALANCA]`) para facilitar o diagnóstico de hardware e calibração via IDE do Arduino.

## 2026-08-18 — Firmware v2.6.2 + Ajustes de Balança (Tara e Calibração)

**App / Backend**
- **Ajustes de Balança**: Implementada interface para realizar **Tara** (zerar) e **Calibração** de balanças HX711 diretamente pelo painel de gerenciamento.
- **Teste em Tempo Real**: Novo dialog de ajustes permite forçar a leitura do peso atual para validar a estabilidade e o fator de calibração.
- **Integração no Dashboard**: Adicionado atalho rápido para ajustes de balança nos cards das prateleiras que possuem o sensor vinculado.

**Firmware (v2.6.2)**
- **BALANCA_TARA**: Novo comando para zerar o offset do HX711 e salvar na NVS.
- **BALANCA_CALIBRAR**: Novo comando para atualizar o `fator_calibracao` no dispositivo e persistir localmente.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_2/bancada_esp32_v2_6_2.ino` e atualizar via OTA.

## 2026-08-16 — Firmware v2.6.1 + Cancelamento de OTA

**App / Backend**
- **Parada de Emergência OTA**: Implementado botão "Parar" (individual) e "Parar todas" (massa) na aba de Atualização.
- **Funcionamento**: O sistema agora permite cancelar uma atualização que já foi disparada, desde que o ESP32 ainda não tenha concluído o download. O comando `OTA_CANCEL` limpa a fila de comandos pendentes no banco e notifica o dispositivo para ignorar o agendamento de flash.

**Firmware (v2.6.1)**
- **OTA_CANCEL**: Adicionado tratamento para o comando de cancelamento explícito no loop de processamento de comandos.

## 2026-08-15 — Firmware v2.6.0 + diagnóstico de queda

**Contexto**: a prateleira P8S12 saía do ar todos os dias no mesmo minuto (17:13), exatamente no instante em que a injeção termina e o par de válvulas V1/V4 desliga. Ela ficava travada em "Injetando" por horas — com as válvulas possivelmente energizadas.

**Firmware (v2.6.0 — sem mudança de pinagem)**
- **Motivo do último reinício na telemetria** (`esp_reset_reason`): `poweron`, `brownout`, `task_wdt`, `panic`, `botao_reset`, etc. É isso que separa "queda de tensão na comutação da válvula" de "travamento de software".
- **Diagnóstico de rede/memória**: tempo ligado (`uptime_s`), menor heap livre já visto (`heap_min`), número de quedas de Wi-Fi (`wifi_reconexoes`) e intensidade do sinal (`rssi`).
- **Watchdog global de 30 s** (antes existia só durante o OTA): se o loop travar, o ESP32 reinicia sozinho e retoma o ciclo pelo estado salvo na NVS. Armado no fim do `setup()` para não interferir no portal Wi-Fi.
- **Teto de segurança por fase**: se Injeção/Pausa/Retorno passar do dobro do tempo configurado (+60 s), o firmware fecha todas as válvulas e volta ao Repouso — mesmo sem internet.
- **Comutação escalonada das válvulas**: o par que desliga vai primeiro, espera ~150 ms e só então o outro par energiza. Antes os dois transientes de 220 Vac aconteciam no mesmo instante.

**Backend**
- `bancadas` ganhou `reset_reason`, `uptime_s`, `heap_min`, `wifi_reconexoes`, `rssi`; `bench_push_telemetry` e `POST /api/public/bench/telemetry` aceitam os novos campos (a versão antiga da função foi removida para não criar sobrecarga ambígua).
- **Ar-condicionado sem ping-pong**: `decidir_ar_condicionado()` agora exige a histerese **também para ligar** (liga em `> max + histerese`, desliga em `<= max - histerese`), respeita um intervalo mínimo de 300 s entre comandos e descarta comandos `AC_CONTROL` pendentes antigos em vez de acumular fila de códigos IR.

**App**
- Selo no card: **"Reset · energia"** (vermelho) quando o último boot foi por brownout e **"Reset · travou"** (âmbar) quando foi pelo watchdog/pânico, com explicação no tooltip.

**Ação**: compilar `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` e atualizar por OTA. Depois do primeiro reinício, o selo do card diz se a causa é elétrica (hardware: snubber RC 100 Ω/100 nF 275 Vac na bobina + desacoplamento nas fontes de 12 V e 5 V) com base na causa do reset.
