# P8S12: alerta "RTC · sem hora" que não some depois de trocar a bateria

## O que os dados mostram (verificado agora)

Na prateleira **P8S12** (firmware **2.5.8**, online, telemetria a cada 3 s):

- `rtc_hora_perdida = true`
- `rtc_bateria_fraca = true`
- `rtc_desvio_segundos = 0`
- último boot registrado: hoje 10:52 (UTC)

O desvio zerado é a pista decisiva: quando o firmware conclui "hora perdida" no boot, ele **não mede mais** o desvio contra o NTP (a referência de boot fica em zero e a comparação é abandonada). Ou seja, no boot de 10:52 o DS3231 respondeu com hora inválida (ou anterior ao carimbo salvo na memória), e a partir daí:

1. O alerta é gravado na memória interna do ESP32 e **fica ligado por toda a vida do boot**.
2. Alguns segundos depois o NTP corrige a hora e regrava o DS3231 — mas nada reavalia o alerta.
3. Em reinícios que não sejam por corte de energia (OTA, watchdog, reset por software), o firmware **repete o valor antigo** gravado na memória, então o aviso reaparece mesmo com a CR2032 nova.

Conclusão: o aviso que você está vendo é um **estado travado**, não uma leitura atual da bateria. Não é possível afirmar pelos dados que a bateria nova está ruim — o único evento suspeito foi aquele boot.

## O que será feito

### 1. Auto-recuperação do alerta (firmware v2.6.0)

- Depois que o NTP sincroniza e o firmware regrava a hora no DS3231, iniciar uma **janela de confirmação (~15 min)**: se o relógio se mantiver coerente com a hora real nesse período, o alerta é **apagado** (na memória interna também) e a telemetria volta a reportar RTC íntegro.
- Se o relógio divergir de novo dentro da janela, o alerta permanece — aí sim é evidência real.
- Deixar de propagar o valor antigo em reinícios por software quando o relógio está comprovadamente correto.

### 2. Leitura do RTC no boot mais tolerante

- Reler o DS3231 algumas vezes (com pequeno intervalo) antes de declarar "hora inválida", para que uma leitura I²C perdida no boot não condene o relógio.
- Só marcar "hora perdida" após leituras repetidas confirmarem o problema.

### 3. Reset manual do alerta pelo app

- Novo botão **"Zerar diagnóstico do RTC"** na configuração da prateleira (admin/operador), útil justamente depois de trocar a bateria.
- Ele limpa os campos de alerta no banco e envia um comando para o ESP32 apagar o registro na memória interna e reavaliar do zero — sem precisar reiniciar o equipamento na mão.

### 4. Texto do selo no card

- Enquanto a janela de confirmação estiver em curso, o selo mostra **"RTC · verificando"** (neutro) em vez de vermelho, com explicação no tooltip.

## Detalhes técnicos

- Novo `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (`FIRMWARE_VERSION = "2.6.0"`), sem mudança de pinagem.
- Alterações em `avaliarBateriaRtcNoBoot()` (releitura tolerante), `sincronizarNtpParaRtc()` / `tickDesvioRtc()` (janela de confirmação e limpeza do flag `rtc_bat` na NVS) e novo tratamento do comando `RTC_RESET_DIAG`.
- Backend: novo comando em `src/lib/bancadas.functions.ts` (grava em `comandos`) + limpeza de `rtc_bateria_fraca` / `rtc_hora_perdida` / `rtc_desvio_segundos` em `bancadas`; entrega já coberta por `bench_pull_commands`.
- UI: botão em `src/components/bancada-config-dialog.tsx` e estados do selo em `src/components/bancada-card.tsx`.
- Documentação: entrada no `CHANGELOG.md` e atualização da §6 de `docs/FIRMWARE.md`.

## Ação necessária do seu lado

- Depois do deploy, usar o botão **Zerar diagnóstico do RTC** na P8S12 — se o alerta não voltar em ~15 min, a bateria nova está boa.
- Atualizar as prateleiras para a **v2.6.0** via OTA para que a auto-recuperação funcione em todas.
