# Quedas do ESP32 quando as válvulas acionam

## O que provavelmente está acontecendo

Válvulas solenoide não "sujam" o Wi-Fi por rádio. O 2,4 GHz do ESP32 é digital e o ruído das solenoides é de baixa frequência. Como as válvulas são **220 Vac ligadas direto na rede**, o mecanismo mais provável muda de ordem:

1. **EMI conduzida pela rede / arco no contato do relé** — ao abrir e fechar 220 Vac numa carga indutiva o contato faisca e gera um transiente rápido de centenas de volts. Esse pulso entra pela rede e volta pela **fonte chaveada do ESP32** (que está na mesma rede), resetando ou travando a placa. Esta é a causa nº 1 em instalação AC.
2. **Queda/pico na fonte do ESP32 (brownout)** — o transiente na rede se propaga pela fonte chaveada 12 V → regulador 5 V, afunda o 3,3 V por instantes e o brownout detector reinicia. Reiniciar leva ~10–20 s até reconectar: no app aparece como "offline" momentâneo.
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

A topologia de alimentação atual é `220 Vac → fonte chaveada 12 Vdc → fonte 5 Vdc → ESP32`. O ESP32 já tem fonte dedicada, então a causa provável **não** é a corrente da bobina afundando a fonte — é o **transiente de 220 Vac que entra pela primeira fonte e se propaga pelo trilho de 12 V** até o regulador de 5 V, derrubando o 3,3 V. Por isso a supressão tem que atacar a fonte do transiente:

- **Snubber RC** (100 Ω / 100 nF, capacitor classe X2, 275 Vac) **em paralelo com a bobina de cada válvula 220 Vac** — absorve o pico ao cortar a corrente da carga indutiva, antes que ele vire arco no relé e EMI na rede. É a medida de maior impacto. Complementar: **varistor MOV 275 V** nos contatos do relé. Diodo 1N4007 **não serve** em AC.
- **Capacitor de desacoplamento no trilho de 12 V**: 470–1000 µF eletrolítico + 100 nF cerâmico na entrada da fonte 12→5 V, para amortecer o transiente que escapar do snubber. E **100 µF + 100 nF** na saída de 5 V, junto ao pino do ESP32.
- **Filtro de linha EMI / N-F** na entrada de 220 V do quadro (especialmente na ramificação que alimenta as fontes), para barrar o ruído conduzido pela rede.
- **Separação física**: cabos de 220 V em canaleta/lado oposto do quadro, cruzando os cabos de sinal em 90° quando inevitável; nunca no mesmo feixe. GND de sinal ligado em um único ponto (estrela).
- Preferir relé/contator com contato dimensionado para carga indutiva AC (categoria AC-1/AC-3), ou trocar por **SSR com zero-crossing**, que praticamente elimina o arco — eliminando a fonte do transiente pela raiz.



## Detalhes técnicos

- Novo firmware `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` (cópia da v2.5.9 + mudanças acima), versão `2.6.0`.
- Telemetria: novos campos `_reset_reason`, `_boot_count`, `_reset_pos_valvula` (bool), persistidos em `Preferences`.
- Backend: aceitar os campos novos no schema Zod de `src/routes/api/public/bench.telemetry.ts` e na RPC de telemetria; colunas novas em `bancadas` (nullable, sem quebrar deploys antigos).
- UI: badge/aviso no `src/components/bancada-card.tsx` quando `reset_reason = brownout`.
- Docs: `docs/FIRMWARE.md` (nova seção de diagnóstico de reset), `firmware/FIACAO_VALVULAS.md` (supressão e alimentação), `CHANGELOG.md`.
- Requer atualização OTA das prateleiras para o diagnóstico começar a reportar.
