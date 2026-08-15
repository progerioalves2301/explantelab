# P8S12 caindo todo dia às 17:13

## O que os dados mostram (verificado agora)

- Última telemetria da P8S12: **14/08 às 17:13:00** (local). A cada 3 s ela reportava normalmente até esse segundo exato, e simplesmente parou — sem degradação, sem sensor travado, temperatura estável em 19,5 °C.
- O ciclo dela começa às **17:10:00** e a injeção dura **180 s** → termina exatamente **17:13:00**. Ou seja, a morte acontece **no instante da troca de fase Injeção → Pausa**, quando o par de válvulas V1/V4 desliga.
- No dia anterior (13/08) o padrão é idêntico: último evento "Injetando" às 17:10 e nada mais até o religamento manual às 07:52 do dia seguinte.
- Em 12/08 o mesmo ciclo das 17:10 completou normalmente (Pausa 17:13, Retorno 17:14, Repouso 17:18). Os ciclos de 01:10, 05:10, 09:10, 13:10 e 21:10 continuam completando sem problema.
- Ela ficou registrada como **"Injetando"** por ~14 h. Se o ESP32 travou com o relé energizado, as válvulas ficaram abertas todo esse tempo — esse é o risco mais sério do quadro.
- As outras 6 prateleiras (firmware 2.5.0/2.5.1) estão online e completando ciclos. **Só a P8S12 roda 2.5.8** e só ela controla o ar-condicionado (Aufit, por código RAW).
- Achado colateral: o backend está mandando `AC_CONTROL` em **ping-pong ligar/desligar a cada ~3-4 minutos** (23:47 off, 23:53 off, 23:57 on, 00:01 off, 00:26 on, 00:30 off...). Hoje há **7 comandos pendentes** na fila dela, e cada um carrega ~1,2 KB de código IR RAW.

**Diagnóstico honesto:** o dado prova *quando* ela morre (transição de fase da injeção), mas **não prova a causa**. As duas hipóteses compatíveis com tudo acima são (a) transiente/brownout no desligamento da válvula 220 Vac, e (b) travamento de software no instante da troca de fase — provavelmente agravado por RAM/IR, já que ela é a única com a carga extra do ar-condicionado por RAW. Sem o motivo de reboot e o histórico de Wi-Fi na telemetria não é possível decidir entre as duas. Por isso o primeiro passo do plano é **instrumentar**, não "consertar às cegas".

## O que será feito

### 1. Instrumentação para identificar a causa (firmware v2.6.0)

- Reportar na telemetria o **motivo do último reboot** (`esp_reset_reason`): brownout, watchdog, pânico de software, botão, energia. Isso separa hipótese (a) de (b) num único ciclo de falha.
- Reportar **uptime**, **heap livre mínimo**, contagem de **reconexões de Wi-Fi** e **RSSI** do sinal.
- Guardar esses valores na memória interna antes de qualquer reinício, para que sobrevivam à queda.

### 2. Rede de segurança: nunca mais ficar 14 h com válvula aberta

- **Watchdog de hardware sempre armado** (não só durante OTA): se o loop principal travar, o ESP32 reinicia sozinho em segundos e retoma o ciclo pelo estado salvo.
- **Teto de segurança por fase**: se uma fase passar do dobro do tempo configurado, o firmware fecha todas as válvulas e volta para Repouso, mesmo sem internet.

### 3. Reduzir o estresse no instante da troca de fase

- Escalonar os acionamentos (~150 ms entre desligar um par e ligar o outro), em vez de comutar tudo no mesmo instante.
- Não executar requisição HTTP/TLS nem transmissão IR na mesma janela de 300 ms em que um relé comuta.

### 4. Corrigir o ping-pong do ar-condicionado

- A decisão no banco está reenviando ligar/desligar a cada poucos minutos, ignorando o intervalo mínimo entre comandos e a histerese. Vou corrigir a lógica para respeitar os dois e limpar a fila acumulada de comandos IR (que hoje enfileira ~1,2 KB cada e é entregue toda de uma vez quando ela volta).

### 5. Sinalização no app

- Selo no card quando o último reboot foi por **brownout/queda de energia** ou por **watchdog**, para você saber pela tela qual dos dois casos aconteceu.

## Detalhes técnicos

- Novo `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (`FIRMWARE_VERSION = "2.6.0"`), **sem mudança de pinagem**.
- Firmware: `esp_reset_reason()` lido no `setup()` e publicado na telemetria; `esp_task_wdt` global; escalonamento em `aplicarValvulas()`; limite de duração por fase na máquina de estados.
- Banco: novas colunas em `bancadas` (`reset_reason`, `uptime_s`, `heap_min`, `wifi_reconexoes`, `rssi`) e novos campos opcionais no schema de `src/routes/api/public/bench.telemetry.ts`.
- Ar-condicionado: revisão de `decidir_ar_condicionado()` (respeitar `intervalo_min_comando_s` e `histerese`) e limpeza dos comandos `AC_CONTROL` pendentes.
- UI: selo de motivo de reboot em `src/components/bancada-card.tsx`.
- Documentação: entrada no `CHANGELOG.md` e nova seção de diagnóstico em `docs/FIRMWARE.md`.

## Ação necessária do seu lado

1. Religar a P8S12 (tirar da tomada ~30 s) — ela está travada desde as 17:13 e as válvulas podem estar abertas.
2. Atualizar essa prateleira para a **v2.6.0** por OTA quando eu terminar.
3. Se o motivo de reboot vier como **brownout**, o próximo passo é hardware: snubber RC (100 Ω / 100 nF, 275 Vac) em paralelo com a bobina da válvula e capacitores de desacoplamento nas entradas de 12 V e 5 V. Se vier **watchdog/pânico**, é software e eu corrijo direto.
