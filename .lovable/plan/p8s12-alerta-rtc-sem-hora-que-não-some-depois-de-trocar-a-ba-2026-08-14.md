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

## O que será feito — sem intervenção humana

### 1. Auto-recuperação do alerta (firmware v2.6.0)

- Depois que o NTP sincroniza e o firmware regrava a hora no DS3231, começa uma **janela de confirmação (~15 min)**: se o relógio se mantiver coerente com a hora real nesse período, o alerta é **apagado sozinho** (inclusive na memória interna) e a telemetria volta a reportar RTC íntegro.
- Se o relógio divergir de novo dentro da janela, o alerta permanece — aí sim é evidência real de bateria ruim.
- O firmware deixa de propagar o valor antigo em reinícios por software quando o relógio está comprovadamente correto.
- A verificação se repete continuamente enquanto o equipamento está ligado: qualquer alerta antigo é reavaliado a cada sincronização com o NTP, então trocar a bateria basta para o aviso desaparecer por conta própria.

### 2. Leitura do RTC no boot mais tolerante

- Reler o DS3231 algumas vezes (com pequeno intervalo) antes de declarar "hora inválida", para que uma leitura I²C perdida no boot não condene o relógio.
- Só marcar "hora perdida" após leituras repetidas confirmarem o problema.

### 3. Limpeza automática no banco

- Quando o firmware reporta RTC íntegro, os campos `rtc_bateria_fraca`, `rtc_hora_perdida` e `rtc_desvio_segundos` da prateleira são zerados pela própria telemetria — nenhum botão ou ação manual envolvida.

### 4. Texto do selo no card

- Enquanto a janela de confirmação estiver em curso, o selo mostra **"RTC · verificando"** (neutro) em vez de vermelho, com explicação no tooltip; ao final ele desaparece ou vira alerta vermelho, conforme o resultado.

## Detalhes técnicos

- Novo `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (`FIRMWARE_VERSION = "2.6.0"`), sem mudança de pinagem.
- Alterações em `avaliarBateriaRtcNoBoot()` (releitura tolerante) e em `sincronizarNtpParaRtc()` / `tickDesvioRtc()` (janela de confirmação, limpeza do flag `rtc_bat` na NVS e reavaliação periódica).
- Telemetria continua enviando `rtc_bat` / `rtc_hora_perdida` / `rtc_desvio`, agora podendo voltar a `false`/`0`; a função de telemetria grava esses valores sempre (sem "travar" o alerta).
- UI: estados do selo em `src/components/bancada-card.tsx` (verificando / alerta / oculto).
- Documentação: entrada no `CHANGELOG.md` e atualização da §6 de `docs/FIRMWARE.md`.

## Ação necessária do seu lado

- Só atualizar as prateleiras para a **v2.6.0** via OTA. Depois disso, o alerta se resolve sozinho quando o problema é resolvido (bateria trocada) — sem botão nem reset manual.
