# Controle de ar-condicionado (IR, por sala bioreator)

## Arquitetura

Como 1 ar atende várias bancadas da mesma sala, uma bancada por sala é eleita **"controladora IR"** — ela recebe o LED IR no GPIO 32 e é quem dispara os comandos para o ar. O backend agrega a temperatura de todas as bancadas da sala e decide o comando; o firmware apenas recebe e emite o IR.

```text
Bancadas da sala → telemetria (temp) → Backend agrega (média/máx)
                                              ↓
                                     Decide: LIGAR/DESLIGAR/AJUSTAR
                                              ↓
                                     Comando AC_CONTROL → bancada controladora
                                              ↓
                                     ESP32 emite IR → Ar-condicionado
```

## Hardware por sala

- 1× LED IR de alta potência (940nm) + resistor 100Ω
- 1× transistor 2N2222 ou BC337 (chaveia o LED com corrente > GPIO)
- Fio até "enxergar" o receptor IR do split (≤ 5m em linha reta)
- GPIO 32 da bancada controladora

## Banco de dados

Nova tabela `ar_condicionados` (1 por sala):
- `laboratorio_id` (unique — 1 ar por sala)
- `bancada_controladora_id` — quem tem o LED IR
- `marca`, `modelo` — para escolher protocolo IR (LG, Samsung, Fujitsu, Midea, Electrolux…)
- `ir_protocol` — enum do IRremoteESP8266
- `modo` — auto/cool/off/manual
- `setpoint_min`, `setpoint_max` (default puxado dos limites da bancada)
- `histerese` — zona morta em °C (default 1.0)
- `intervalo_min_comando_s` — default 180 (proteção compressor)
- `agregacao` — "media" | "maxima" (default: máxima — mais conservador para plantas)
- Estado atual reportado: `ligado`, `setpoint_atual`, `ultimo_comando_em`

Novo tipo de comando: `AC_CONTROL` com payload `{ acao: "on"|"off", modo: "cool", setpoint: 22, protocolo: "LG" }`.

## Lógica de controle (server-side)

Função `decidir_ar_condicionado()` roda no cron a cada 1 min (junto com `detectar_alertas`):

1. Para cada sala com ar cadastrado:
   - Pega temperaturas válidas das bancadas ativas (últimos 3 min)
   - Aplica agregação (máx ou média)
2. Aplica histerese:
   - `temp > setpoint_max` → liga em COOL, setpoint = `setpoint_min + 1`
   - `temp < setpoint_min` → desliga
   - Zona intermediária → mantém estado atual
3. Só enfileira comando se:
   - Estado desejado ≠ estado atual
   - `now() - ultimo_comando_em > intervalo_min_comando_s`

## Firmware v2.1.0

- Adiciona `IRremoteESP8266` (~200 marcas suportadas)
- `PIN_IR_LED = 32`
- Handler para `AC_CONTROL`: seleciona protocolo do payload e emite comando
- Reporta estado do ar nos campos de telemetria (`_ac_ligado`, `_ac_setpoint`)
- Roda apenas se a bancada estiver marcada como controladora (backend só envia para ela)

## UI

- Nova página admin `/_shell/ar-condicionado`:
  - Lista salas com/sem ar
  - Formulário: escolher bancada controladora, marca/protocolo, setpoints, agregação
  - Botão "testar IR" (envia comando manual on/off)
- No card da bancada controladora: badge "Controla AC"
- No dashboard: status do ar por sala (ligado/desligado + setpoint atual)

## Segurança de comando

- Comando IR não tem feedback — mantemos `intervalo_min_comando_s` para evitar rajadas
- Se `sensor_travado` da controladora → não envia comando (falha para seguro: mantém estado)
- Se sala sem telemetria válida > 5 min → desliga o ar (evita compressor rodando sem controle)

## Detalhes técnicos

**Migração**:
- `CREATE TABLE public.ar_condicionados` + GRANTs + RLS (leitura auth, escrita admin)
- Nova função `decidir_ar_condicionado()` SECURITY DEFINER
- Atualizar cron da rota `/api/public/hooks/check-alerts` para chamar também `decidir_ar_condicionado()`

**Servidor**:
- `src/lib/ar-condicionado.functions.ts` — CRUD + `testarIR`
- Nova coluna em telemetria: `_ac_ligado`, `_ac_setpoint` (opcional; só a controladora reporta)

**Firmware**:
- `firmware/bancada_esp32_v2_1_0/bancada_esp32_v2_1_0.ino`
- Flag `EH_CONTROLADORA_IR` vinda da config
- Suporte inicial: LG, Samsung, Fujitsu, Midea, Electrolux (cobre >90% do mercado BR)

**Memória do projeto**: atualizar core com pinagem GPIO 32 = IR e nova regra de ar por sala.

## Fora do escopo desta fase

- Feedback real do ar (não temos sensor no ar) — assumimos que o comando foi aceito
- Multi-zona (só 1 ar por sala)
- Modo HEAT / DRY / FAN — só COOL e OFF inicialmente
- Aprendizado de controle remoto customizado (usaremos protocolos pré-definidos)
