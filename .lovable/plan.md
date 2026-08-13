# Quedas do ESP32 quando as válvulas acionam

## O que provavelmente está acontecendo

Válvulas solenoide não "sujam" o Wi-Fi por rádio. O 2,4 GHz do ESP32 é digital e o ruído das solenoides é de baixa frequência. Como as válvulas são **220 Vac ligadas direto na rede**, o mecanismo mais provável muda de ordem:

1. **EMI conduzida pela rede / arco no contato do relé** — ao abrir e fechar 220 Vac numa carga indutiva o contato faisca e gera um transiente rápido de centenas de volts. Esse pulso entra pela rede e volta pela **fonte chaveada do ESP32** (que está na mesma rede), resetando ou travando a placa. Esta é a causa nº 1 em instalação AC.
2. **Queda/pico na fonte do ESP32 (brownout)** — o transiente na rede afunda ou distorce a saída da fonte 5 V, o 3,3 V sai da faixa e o brownout detector reinicia. Reiniciar leva ~10–20 s até reconectar: no app aparece como "offline" momentâneo.
3. **Acoplamento capacitivo na fiação de sinal** — cabo de 220 V correndo no mesmo feixe dos cabos dos GPIOs injeta ruído nas entradas e no barramento I²C/1-Wire.

Nada disso é problema de código: é supressão de transiente e alimentação. Mas o firmware pode **provar qual é a causa** e reduzir o impacto.


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

## Recomendações de hardware para válvulas 220 Vac (documentadas em `firmware/FIACAO_VALVULAS.md`)

- **Snubber RC** (100 Ω / 100 nF, 275 Vac tipo X2) **em paralelo com a bobina de cada válvula** — é a medida mais eficaz para carga AC. Alternativa/complemento: **varistor MOV 275 V** nos contatos do relé. Diodo 1N4007 **não serve** em 220 Vac.
- **Filtro de linha EMI** na entrada de alimentação do quadro, ou no mínimo uma fonte 5 V de boa qualidade e exclusiva do ESP32 (não compartilhada com nada mais).
- Capacitor eletrolítico **1000 µF** no 5 V do ESP32 + **100 nF** cerâmico junto ao pino de alimentação.
- **Separação física**: cabos de 220 V em canaleta/lado oposto do quadro, cruzando os cabos de sinal em 90° quando inevitável; nunca no mesmo feixe. GND de sinal ligado em um único ponto (estrela).
- Preferir relé/contator com contato dimensionado para carga indutiva AC (AC-1/AC-3), ou trocar por **SSR com zero-crossing**, que praticamente elimina o arco.


## Detalhes técnicos

- Novo firmware `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (cópia da v2.5.9 + mudanças acima), versão `2.6.0`.
- Telemetria: novos campos `_reset_reason`, `_boot_count`, `_reset_pos_valvula` (bool), persistidos em `Preferences`.
- Backend: aceitar os campos novos no schema Zod de `src/routes/api/public/bench.telemetry.ts` e na RPC de telemetria; colunas novas em `bancadas` (nullable, sem quebrar deploys antigos).
- UI: badge/aviso no `src/components/bancada-card.tsx` quando `reset_reason = brownout`.
- Docs: `docs/FIRMWARE.md` (nova seção de diagnóstico de reset), `firmware/FIACAO_VALVULAS.md` (supressão e alimentação), `CHANGELOG.md`.
- Requer atualização OTA das prateleiras para o diagnóstico começar a reportar.
