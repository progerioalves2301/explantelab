# Quedas do ESP32 quando as válvulas acionam

## O que provavelmente está acontecendo

Válvulas solenoide não "sujam" o Wi-Fi por rádio. O 2,4 GHz do ESP32 é digital e o ruído das solenoides é de baixa frequência. O que realmente derruba a placa nesse cenário, em ordem de probabilidade:

1. **Queda de tensão (brownout)** — no instante em que a bobina energiza, a corrente de partida puxa a fonte 5 V. Se o ESP32 divide a mesma fonte, o 3,3 V afunda, o brownout detector dispara e a placa reinicia. Reiniciar leva ~10–20 s até reconectar: no app aparece como "offline" momentâneo.
2. **Coice indutivo / EMI conduzida** — ao desligar a bobina, o pico de tensão volta pelo GND comum e trava ou reseta o rádio. Sem diodo de proteção (solenoide DC) ou snubber (AC), isso é frequente.
3. **Arco no contato do relé mecânico** — o faiscamento acopla ruído na fiação de sinal se os cabos de força correm junto com os cabos dos GPIOs.

Nada disso é problema de código: é alimentação e supressão. Mas o firmware pode **provar qual é a causa** e reduzir o impacto.

## Como confirmar antes de mexer em hardware

O ESP32 sabe por que reiniciou. O firmware passa a registrar isso e enviar na telemetria:

- Motivo do último reset (`esp_reset_reason`) — se vier `BROWNOUT`, o diagnóstico está fechado: é a fonte.
- Contador de boots e uptime no momento do último acionamento de válvula.
- Carimbo do último acionamento antes do reset, para correlacionar "reiniciou logo depois de abrir a injeção".

No app, o card da prateleira ganha um aviso discreto quando o último reset foi por brownout, com o contador de ocorrências.

## Mitigações no firmware (v2.6.0)

- **Acionamento escalonado**: quando um par de válvulas e a luz precisarem ligar quase juntos, inserir ~150 ms entre eles, para não somar duas correntes de partida.
- **Silenciar HTTP durante a comutação**: não iniciar uma requisição TLS na janela de ~300 ms em torno de ligar/desligar relé (o TLS é o momento de maior consumo do rádio, é justo aí que o brownout mata).
- **Reconexão mais rápida após reset**: hoje a primeira tentativa de reconexão espera até 20 s. Reduzir a primeira janela para ~3 s encurta o tempo aparente de "offline".
- **Retomada de ciclo já existe** (NVS), então um reset não perde a fase — apenas some do painel por alguns segundos.

## Recomendações de hardware (documentadas em `firmware/FIACAO_VALVULAS.md`)

- Fonte **separada** para as válvulas; ESP32 em fonte própria, GND unidos em um único ponto (estrela).
- Capacitor eletrolítico **1000 µF** no 5 V do ESP32 + **100 nF** cerâmico junto ao pino.
- **Diodo 1N4007** em paralelo com cada bobina DC (catodo no positivo); para bobina AC, **snubber RC** 100 Ω / 100 nF nos contatos do relé.
- Manter os cabos de força a pelo menos alguns centímetros dos cabos de sinal; nunca no mesmo feixe.

## Detalhes técnicos

- Novo firmware `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (cópia da v2.5.9 + mudanças acima), versão `2.6.0`.
- Telemetria: novos campos `_reset_reason`, `_boot_count`, `_reset_pos_valvula` (bool), persistidos em `Preferences`.
- Backend: aceitar os campos novos no schema Zod de `src/routes/api/public/bench.telemetry.ts` e na RPC de telemetria; colunas novas em `bancadas` (nullable, sem quebrar deploys antigos).
- UI: badge/aviso no `src/components/bancada-card.tsx` quando `reset_reason = brownout`.
- Docs: `docs/FIRMWARE.md` (nova seção de diagnóstico de reset), `firmware/FIACAO_VALVULAS.md` (supressão e alimentação), `CHANGELOG.md`.
- Requer atualização OTA das prateleiras para o diagnóstico começar a reportar.
