# Documentação Técnica do Firmware — VitroCeres Prateleira ESP32

> Versão atual: **v2.5.8**  
> Arquivo: `firmware/bancada_esp32_v2_5_8/bancada_esp32_v2_5_8.ino`

Este documento explica como o firmware funciona, pinagem, lógica de ciclos, luzes, ar-condicionado, sensores e atualização OTA. Use-o para entender o comportamento esperado, diagnosticar problemas e saber quando é necessário atualizar os equipamentos.

---

## 1. Visão geral

O mesmo binário roda em qualquer prateleira, com ou sem sensores opcionais. No boot, cada periférico é auto-detectado; se não estiver presente, os ticks correspondentes ficam inertes.

A prateleira é **autônoma**: ciclos e luzes funcionam sem internet desde que o horário e os agendamentos estejam configurados. A internet é usada apenas para:

- Receber comandos do app (forçar ciclo, pausar, configurar horários, OTA).
- Enviar telemetria (temperatura, estado, CO2, peso, alertas).
- Sincronizar horário via NTP (fallback para RTC DS3231 ou millis).

---

## 2. Pinagem consolidada (v2.5.8)

| Função | GPIO | Observação |
| :--- | :--- | :--- |
| **Injeção (V1 + V4)** | 25 | Par de válvulas que abrem juntas. |
| **Retorno (V2 + V3)** | 26 | Par de válvulas que abrem juntas. |
| **Luzes** | 27 | Relé das luzes (timer HH:MM). |
| **Botão de ciclo manual** | 4 | Um lado no GPIO, outro no GND (pull-up interno). |
| **LED de status do ciclo** | 19 | Resistor 330 Ω → anodo; catodo no GND. |
| **DS18B20 (temperatura)** | 14 | Data do sensor 1-Wire. |
| **IR TX (ar-condicionado)** | 32 | LED IR transmissor. |
| **IR RX (aprendizado)** | 33 | Receptor VS1838B/TL1838. |
| **HX711 (balança)** | 16 (DOUT) / 17 (SCK) | Opcional. |
| **DS3231 (RTC)** | 21 (SDA) / 22 (SCL) | I²C, opcional. |
| **LED onboard** | 2 | Indica Wi-Fi conectado. |
| **Botão de reset/portal** | 0 | Segurar 5 s apaga credenciais e abre portal. |

### GPIO 33 (histórico)

Nas versões antigas o GPIO 33 controlava a válvula V5 (alívio). A partir da v1.9.2 a V5 foi removida e o GPIO 33 ficou livre, hoje usado como receptor IR RX.

---

## 3. Lógica dos relés

O firmware usa duas constantes independentes para a polaridade dos relés:

```cpp
static const bool RELAY_ACTIVE_LOW = true;  // válvulas: LOW liga, HIGH desliga
static const bool LUZ_ACTIVE_LOW   = false; // luz: HIGH liga, LOW desliga
```

- `RELAY_ACTIVE_LOW = true`: módulos "Low Level Trigger" (jumper LOW). O ESP32 inicia os GPIOs em HIGH, evitando ligamento acidental no boot.
- `LUZ_ACTIVE_LOW`: altere aqui se o relé da luz usar lógica invertida.

No `setup()` os pinos são configurados como saída e colocados em nível de "desligado" **antes** de qualquer outra inicialização, para evitar glitches de boot.

---

## 4. Máquina de estados do ciclo

O ciclo é **Repouso → Injeção → Pausa → Retorno → Repouso**.

```text
REPOUSO
   |
   v (disparo programado, manual ou app)
INJETANDO  -- tempo_injecao_segundos -->
PAUSADO    -- tempo_pausa_segundos -->
RETORNANDO -- tempo_retorno_segundos -->
REPOUSO
```

A fase `ALIVIO` ainda existe no enum por compatibilidade, mas **nunca é ativada** (a válvula V5 foi removida).

### Ciclos podem ser iniciados por:

1. **Agendamento local** (`tickAgendaCiclo`): horários programados, persistidos na NVS.
2. **Botão físico** (GPIO 4): aperto curto inicia ciclo manual.
3. **Comando do app**: `FORCE_CYCLE` ou acionamento manual das válvulas (`MANUAL`).

### Cancelamento:

- Botão físico pressionado por **≥ 2 s**.
- Comando `PAUSE` do app.
- Ciclo manual desativado quando a fase volta para `REPOUSO`.

### Persistência de ciclo

A fase atual e o epoch de início são salvos na NVS (`Preferences`, namespace `"ciclo"`). Se a energia cair durante um ciclo, o firmware retoma de onde parou no boot, desde que o RTC/NTP forneça hora confiável.

---

## 5. Timer de luzes

Configuração: lista de janelas `luz_janelas: [{ ligar: "HH:MM", desligar: "HH:MM" }]`.

- Até 8 janelas por prateleira.
- Fuso horário configurável (`cfg.tz`, formato POSIX).
- O firmware lê a hora local (`getLocalTime`) e decide se deve ligar ou desligar.
- O estado `_luz_ligada` é reportado na telemetria e exibido no app.

### Padrão de fábrica

Sem configuração, a luz permanece desligada até que o usuário cadastre janelas.

---

## 6. Autonomia offline

O firmware não depende de internet para operar.

### Horário

1. Tenta usar o **DS3231** (RTC com bateria CR2032).
2. Se não houver RTC, usa **NTP** quando a internet estiver disponível.
3. Se não houver nem RTC nem NTP, usa `millis()` como fallback.

### Agendamento local

- Horários de ciclo (`horarios_disparo`) são persistidos na NVS.
- `tickAgendaCiclo()` dispara o ciclo no minuto exato programado.
- Se o minuto já foi executado no mesmo dia, não dispara novamente.

### Fallback por intervalo

Se o horário nunca foi sincronizado, a prateleira pode usar `intervalo_ciclo_horas` (padrão 4 h) como fallback. Existe uma **carência de 10 min após o boot** para evitar disparo imediato ao religar.

### Catch-up de ciclos perdidos

Se a energia cair em cima de um horário programado, o firmware pode recuperar o ciclo dentro de `AGENDA_CATCHUP_S` (15 min) após o retorno da energia, desde que o RTC mantenha a hora correta.

### Bateria do RTC

A tensão da bateria **não é medida** (o DS3231 não expõe o Vbat e não há divisor resistivo na fiação atual). O firmware usa três evidências indiretas:

- **OSF** (Oscillator Stop Flag): o oscilador parou — faltou VCC e a bateria não segurou o relógio.
- **Carimbo de hora**: a cada 5 min o firmware salva o epoch atual na NVS. Se no boot o RTC voltar com hora anterior ao carimbo, ele perdeu a hora. A partir da **v2.5.6** o carimbo não é mais apagado quando a bateria é julgada OK — apenas atualizado —, para que o boot seguinte sempre tenha referência.
- **Desvio contra o NTP (v2.5.6+)**: no boot o firmware guarda a hora que o DS3231 marcava; quando o NTP confirma a sincronização (`sntp_get_sync_status`), compara as duas. Desvio acima de **120 s** acende o alerta.

Quando a bateria é detectada como fraca, o firmware envia alerta na telemetria (`_rtc_bateria_fraca`, `_rtc_hora_perdida`, `_rtc_desvio_segundos`) e o app exibe **RTC · bateria** ou **RTC · sem hora** no card.

> **Limitação importante**: com o ESP32 energizado, o DS3231 conta a hora pelo VCC. Uma CR2032 fraca ou ausente **não produz nenhum sinal** nesse estado. A avaliação só é conclusiva depois de uma queda de energia. Para detecção em tempo real seria necessário medir o positivo da bateria por ADC (divisor resistivo em uma GPIO analógica) — não implementado.

---

## 7. Botão físico e LED de status

### Botão (GPIO 4)

- **Curto (60 ms a 2 s)**: inicia ciclo manual se estiver em repouso.
- **Longo (≥ 2 s)**: cancela ciclo em andamento e volta ao repouso.

O botão usa pull-up interno e debounce de 60 ms.

### LED (GPIO 19)

| Estado | Padrão do LED |
| :--- | :--- |
| Repouso | Apagado; pulso curtíssimo a cada 3 s ("vivo"). |
| Ciclo manual | Aceso fixo. |
| Injetando (automático) | Pisca lento (0,5 s ligado / 0,5 s apagado). |
| Pausa | Pisca curto (150 ms a cada 2 s). |
| Retornando (automático) | Pisca rápido (150 ms / 150 ms). |
| Pausado (STOP pelo app) | 2 piscas curtas a cada 2 s. |
| Reset / Boot | 3 piscas rápidas (100ms on/off) no início. |


> Se o LED for de driver que liga em nível baixo, altere `LED_CICLO_ACTIVE_LOW = true` no firmware.

---

## 8. Ar-condicionado por IR

O firmware controla o ar-condicionado de uma sala a partir da temperatura da prateleira controladora.

- **TX IR**: GPIO 32.
- **RX IR**: GPIO 33 (aprendizado de códigos RAW).
- Protocolos suportados: Samsung, LG, Midea, Electrolux, Electra, Fujitsu, Consul/Whirlpool.
- Para aparelhos **Consul/Whirlpool**, o bit de power é **toggle**: o firmware mantém o estado local (`ac_ligado_local`) para enviar o frame apenas quando necessário.

### Lógica de controle

A decisão de ligar/desligar é tomada no backend (função `detectar_alertas` no banco). O firmware recebe um comando `AC_CONTROL` com:

```json
{ "ligar": true, "setpoint": 23, "protocolo": "MIDEA" }
```

Para aparelhos não suportados nativamente, o backend pode enviar códigos **RAW** (`codigo_ir_raw_on` / `codigo_ir_raw_off`).

---

## 9. Sensores opcionais

### CO2 — SCD41

- Barramento I²C (SDA=21, SCL=22).
- Endereço diferente do DS3231, podem coexistir no mesmo barramento.
- Amostra a cada 5 s; envia para `/api/public/co2/reading` com `X-Device-Token`.

### Balança — HX711

- GPIO 16 (DOUT) / GPIO 17 (SCK).
- Calibração (`fator_cal`, `zero_offset`) persistida na NVS.
- Envia para `/api/public/scale/reading` com `X-Device-Token`.

### Temperatura — DS18B20

- GPIO 14 (data, com pull-up de 4,7 kΩ).
- Resolução de 12 bits.
- Push imediato se a temperatura variar ≥ 0,2 °C em relação à última publicação.
- Se o sensor falhar repetidamente, o firmware tenta re-detectar o barramento 1-Wire.
- Se não houver sensor, a prateleira opera em modo "sem temperatura".

---

## 10. Comunicação com o backend

A prateleira se comunica com o Supabase via RPC:

- `bench_push_telemetry`: envia estado, temperatura, luz, bateria RTC, etc.
- `_pull_commands`: recebe comandos pendentes (ciclo, AC, OTA, configuração).

### Limites de taxa

- Ativo (ciclo/manual): telemetria a cada 3 s, comandos a cada 3 s.
- Repouso: telemetria a cada 15 s, comandos a cada 5 s.

Isso mantém a taxa abaixo do limite de 60 requisições/minuto por prateleira.

---

## 11. Atualização OTA

A atualização é disparada pelo app na aba **Atualização** (admin-only). O backend gera uma URL assinada de 1 h válida no bucket privado `firmware` e envia para a prateleira via comando `OTA_UPDATE`.

### Comportamento durante OTA

1. A prateleira recebe `{ "url": "...", "filename": "..." }`.
2. Desliga válvulas e luzes por segurança.
3. Envia um último ping de telemetria.
4. Faz download do binário via HTTPS.
5. Se o download for bem-sucedido, reinicia automaticamente.
6. Se falhar, volta ao estado anterior (`pausado_manual = false`).

### Quando atualizar

- Sempre que o `FIRMWARE_VERSION` mudar e a nova versão afetar o hardware/fiação da prateleira.
- Correções de bugs que afetam autonomia offline, segurança ou estabilidade do ciclo.
- Melhorias no controle de IR ou novos sensores.

---

## 12. Provisionamento Wi-Fi

No primeiro boot (ou após reset de fábrica), o ESP32 abre um portal com:

- SSID: `VitroCeres-XXXXXX` (onde XXXXXX são os últimos dígitos do MAC).
- Senha: não definida (rede aberta).
- O usuário conecta e informa:
  - Código de pareamento de 6 dígitos (cadastrado no app).
  - Wi-Fi da rede local.
  - Tokens opcionais de CO2 e balança.
  - Identificador da muda (opcional).

Após o pareamento, as credenciais são salvas na NVS e o portal não abre mais, a menos que o botão de reset seja pressionado por 5 s.

---

## 13. Checklist de diagnóstico rápido

| Sintoma | Possível causa | Verificar |
| :--- | :--- | :--- |
| Não inicia ciclo offline | Sem hora válida (RTC sem bateria ou NTP não sincronizado) | LED onboard, app, logs seriais. |
| Religou e injetou sozinho | Boot sem carência / hora errada | Versão ≥ v2.4.8, bateria RTC. |
| LED de ciclo pisca estranho | Estado manual ou fase inconsistente | Botão pressionado, app em pausa. |
| Temperatura travada | DS18B20 falhando ou sem pull-up | Cabo, resistor, versão ≥ v2.4.5. |
| Ar não desliga | Protocolo toggle sem estado local | Versão ≥ v2.2.1, protocolo correto. |
| Rate limit no serial | Intervalos muito curtos | Versão ≥ v2.4.4. |
| Bateria RTC alerta | OSF ligado, hora perdida ou desvio > 120 s vs NTP | Trocar CR2032; ver §6. |
| RTC sem bateria e nada é acusado | ESP energizado mantém o relógio pelo VCC | Cortar energia por 1 min e religar; versão ≥ v2.5.6. |

---

## 14. Arquivos relacionados

- `firmware/bancada_esp32_v2_5_7/bancada_esp32_v2_5_7.ino` — código fonte.
- `firmware/FIACAO_VALVULAS.md` — diagrama de fiação e endereçamento.
- `CHANGELOG.md` — histórico de alterações.
- `mem://index.md` — memória consolidada do projeto.
- `MIGRACAO_SUPABASE.md` — guia de migração do banco.
