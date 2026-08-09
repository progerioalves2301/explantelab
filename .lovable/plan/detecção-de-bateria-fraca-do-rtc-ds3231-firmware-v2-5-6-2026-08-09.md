# Detecção de bateria fraca do RTC (DS3231) — firmware v2.5.6

## Por que hoje não acusa nada

A detecção atual usa apenas duas evidências:

1. **OSF** (bit que liga quando o oscilador do DS3231 **para**) — isso só acontece se o módulo ficar sem VCC **e** sem bateria.
2. **Perda de hora no boot** (hora inválida ou anterior ao último carimbo salvo).

Enquanto o ESP32 está energizado, o DS3231 conta a hora pelo VCC do próprio ESP. Então uma CR2032 fraca ou ausente **não produz nenhum sinal**: o relógio continua certo, o OSF fica em 0 e o alerta nunca acende. Ele só apareceria depois de um corte real de energia — e, dependendo da sequência, o firmware ainda pode concluir "OK" logo em seguida.

Há também um ponto que apaga a evidência: quando a bateria é julgada OK, o carimbo de hora salvo (`rtc_ts`) é removido, e o carimbo só volta a ser gravado alguns minutos depois. Se a queda de energia acontecer nessa janela, a comparação "relógio andou para trás" não tem referência.

Como você optou por não alterar a fiação, a detecção continuará dependendo de um evento de falta de energia — mas ela vai ficar muito mais confiável e, principalmente, **visível**.

## O que será feito

### 1. Nova evidência: desvio contra o NTP

Assim que o NTP sincronizar, o firmware compara a hora que o DS3231 estava marcando com a hora real:

- Desvio acima de ~2 minutos → bateria/relógio suspeito, alerta ligado.
- Desvio pequeno → relógio saudável.

Isso pega o caso mais comum: a prateleira religa, o RTC voltou com hora errada (mas "válida", ex. 2024), e hoje isso passa batido.

### 2. Carimbo de hora mais robusto

- O carimbo `rtc_ts` passa a ser gravado **sempre** que houver hora confiável (inclusive logo no primeiro minuto após o boot), e **não é mais apagado** quando a bateria é julgada OK — apenas atualizado.
- Assim a comparação "o relógio retrocedeu" sempre tem referência.

### 3. Estado do RTC visível no app (em vez de só um booleano)

O firmware passa a reportar, além do alerta:

- se o RTC perdeu a hora no último boot;
- o desvio medido em relação ao NTP;
- se o OSF ligou.

No card da prateleira o selo "RTC" passa a mostrar três estados:

- **RTC** (verde/neutro): relógio íntegro.
- **RTC · bateria** (alerta): evidência de bateria fraca/ausente.
- **RTC · sem hora** (alerta): o relógio voltou sem hora válida.

Ao passar o mouse, o detalhe do motivo (hora perdida, retrocedeu, desvio de X min, OSF).

### 4. Limitação declarada na tela

Na configuração da prateleira entra uma linha curta explicando que a verificação da bateria do RTC só é conclusiva após uma queda de energia — para você não interpretar "RTC OK" como "bateria nova".

## Como validar

1. Com o ESP32 ligado, **retirar a CR2032** → nada muda (esperado; sem hardware extra não há como medir).
2. Desligar a energia por ~1 minuto e religar → o card deve mostrar **RTC · sem hora** ou **RTC · bateria** em poucos minutos.
3. Colocar uma CR2032 boa, desligar/religar → o alerta deve desaparecer no próximo boot.
4. No monitor serial: linha `[RTC] bateria ... (OSF=.. hora_ruim=.. retrocedeu=.. desvio_s=..)`.

## Detalhes técnicos

- Novo firmware `firmware/bancada_esp32_v2_5_6/bancada_esp32_v2_5_6.ino` (`FIRMWARE_VERSION = "2.5.6"`), sem alteração de pinos.
- Ajustes em `avaliarBateriaRtcNoBoot()`, `tickCarimboHoraRtc()`, `tickBateriaRtc()` e nova checagem de desvio na sincronização NTP→RTC.
- Telemetria: campos adicionais `_rtc_hora_perdida` e `_rtc_desvio_segundos` (colunas novas em `bancadas`, com `DEFAULT`, sem quebrar firmwares antigos).
- Backend: migração adicionando as colunas e estendendo `bench_push_telemetry` com os parâmetros opcionais; rota `src/routes/api/public/bench.telemetry.ts` aceita os campos novos.
- UI: `src/components/bancada-card.tsx` (estados do selo RTC) e `src/components/bancada-config-dialog.tsx` (nota da limitação).
- Documentação: entrada no `CHANGELOG.md` e atualização da seção "Bateria do RTC" em `docs/FIRMWARE.md`.

## Ação necessária do seu lado

- Atualizar os ESP32 para a **v2.5.6** via OTA (sem mudança de fiação).
- Firmwares antigos continuam funcionando; só não reportarão os novos campos.
