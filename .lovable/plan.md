# P8S12 cai ao acionar o Teste de Luz

## O que os dados mostram

Consultei o banco para essa prateleira:

- O comando `LUZ_TESTE` foi entregue às **02:22:31**.
- A última telemetria chegou às **02:22:32** — um segundo depois. Antes disso, telemetria chegava normalmente a cada 15 s, sem falhas.
- O comando `LUZ_TESTE` seguinte (02:27) **nunca foi entregue**: o ESP32 não voltou a se conectar.
- Firmware reportado: **2.5.8** (o `.bin` 2.5.9 enviado por OTA às 02:14 não passou a reportar 2.5.9 — a versão instalada continua 2.5.8).

Conclusão: o dispositivo parou de responder no instante exato em que o relé da luz foi energizado. O caminho de software do teste é simples (liga o pino da luz e agenda o desligamento em 7 s, sem bloqueio), então o comportamento aponta para causa **elétrica**: queda de tensão / reset por brownout ou ruído do relé da luz derrubando o ESP32, e não uma falha na lógica do teste.

Isso não é confirmado ainda — a primeira etapa do plano é confirmar a causa.

## Etapa 1 — Confirmar a causa (sem mudar código)

1. Religar a alimentação da P8S12 e verificar se ela volta online. Se voltar só após power-cycle, é reset/travamento por alimentação.
2. Acionar a luz **pela programação de horário** (não pelo botão de teste). Se cair igual, o problema é o acionamento da luz em si — o teste apenas o expõe.
3. Observar o LED de status (GPIO 19): 3 piscadas rápidas no boot indicam que o ESP32 reiniciou.

## Etapa 2 — Instrumentar o firmware para diagnóstico

Nova versão de firmware (v2.5.9, pasta e `FIRMWARE_VERSION` renomeados conforme o padrão do projeto):

- Registrar o **motivo do último reset** do ESP32 (`esp_reset_reason()`), incluindo brownout, e enviá-lo na telemetria.
- Contador de reboots persistido em NVS, também enviado na telemetria.
- Habilitar/registrar explicitamente o detector de brownout e logar no Serial.
- Desligar a luz no boot antes de qualquer outra coisa (já é feito para os pinos; confirmar que o estado de teste não persiste após reset).

## Etapa 3 — Mostrar o diagnóstico na interface

- Guardar `motivo_reset` e `reboots` na prateleira e exibir um badge/tooltip no card quando o último reset for por brownout ("queda de tensão").
- No botão "Teste 7s", exibir aviso curto de que uma queda ao acionar indica fonte insuficiente para o relé da luz.

## Etapa 4 — Recomendação de hardware (documentação)

Adicionar a `firmware/FIACAO_VALVULAS.md` uma seção sobre o relé da luz:

- Fonte separada (ou com folga) para os relés; não alimentar bobina de relé pelo 5V do regulador do ESP32.
- Capacitor eletrolítico (470–1000 µF) + 100 nF no trilho 5V e no 3V3 próximo ao ESP32.
- Diodo de roda-livre no relé mecânico; snubber RC (100 Ω + 100 nF) no contato quando a carga da luz for reator/LED com driver.
- Manter fiação de rede longe das linhas de sinal; ferrite no cabo da luz se necessário.

## Detalhes técnicos

Arquivos envolvidos: `firmware/bancada_esp32_v2_5_9/` (novo, a partir do v2_5_8), `bench_push_telemetry` (novas colunas opcionais `motivo_reset`, `reboots` em `bancadas`, com migração incluindo GRANTs), `src/components/bancada-card.tsx` (badge), `src/components/bancada-config-dialog.tsx` (aviso), `CHANGELOG.md` e `docs/FIRMWARE.md`.

A Etapa 2 exige atualização de firmware por OTA. Vale checar antes por que a OTA de 2.5.9 não mudou a versão reportada (o binário enviado pode não corresponder ao fonte).
