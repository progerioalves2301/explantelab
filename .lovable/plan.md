# Por que a leitura de temperatura fica falhando (P7S11)

## O que os dados mostram

Consultei o banco agora:

- Só três prateleiras acumulam reinícios do sensor: **P7S11 (14)**, **P5S11 (8)**, **P4S11 (3)**. Todas as outras estão com 0.
- A P7S11 está com `sensor_travado = true`, mas ainda com o último valor (22,75 °C) — é isso que o card mostra como "Última leitura; sensor sem leitura nova".
- No histórico das últimas 6 h da P7S11 há buracos reais de leitura: **75 min** (19:43), **21 min** (20:45) e vários de 5–6 min, enquanto a telemetria continuou chegando a cada poucos segundos.

Ou seja: o ESP32 está online e falando com o servidor normalmente; **o que falha é o barramento 1-Wire do DS18B20 daquela prateleira**. O firmware já trata isso: 2 tentativas por leitura, e após 3 leituras inválidas seguidas ele marca `sensor_travado` e reinicia o 1-Wire (contador de reinícios). O valor antigo é preservado na tela para não piscar.

Como o problema é concentrado em 2–3 prateleiras e não em todas (mesmo firmware em todas), a causa provável é **elétrica/mecânica no sensor**: resistor de pull-up de 4,7 kΩ ausente/fraco ou longe do ESP32, cabo longo/emenda ruim no GPIO 14, ou ruído dos relés/solenoides acoplando no fio de dados. Isso não pode ser afirmado com certeza pelo banco — precisa do teste físico abaixo.

## Plano

### 1. Verificação física (você faz, é o passo decisivo)

Na P7S11 (e depois P5S11):

1. Conferir o pull-up **4,7 kΩ entre DATA (GPIO 14) e 3,3 V**, instalado o mais perto possível do ESP32.
2. Refazer as emendas do cabo do sensor; usar par trançado/cabo blindado com a malha no GND, afastado dos fios de 127/220 V e dos relés.
3. Alimentar o DS18B20 em **3,3 V com fio dedicado** (não pela saída do módulo de relés).
4. Teste cruzado: trocar o sensor da P7S11 por um de prateleira estável. Se a falha migrar com o sensor, é o sensor; se ficar na prateleira, é fiação/ruído.

### 2. Firmware v2.6.21 — endurecer a leitura

- Subir de 2 para **4 tentativas** por ciclo de leitura, com pequeno intervalo entre elas.
- Tratar **85,00 °C e -127 °C** explicitamente como inválidos (hoje 85 só é evitado no laço de tentativa).
- Após reiniciar o 1-Wire, esperar o tempo de conversão antes da primeira leitura nova, evitando falha imediata que conta como novo reinício.
- **Não ler temperatura durante a comutação dos relés** (curta janela de bloqueio em torno do acionamento), para não capturar leituras corrompidas por ruído.
- Contar e reportar, além de `sensor_reinicios`, **quantos segundos está sem leitura válida**, para o painel mostrar a idade real da leitura.
- Registrar no Serial o endereço 1-Wire encontrado a cada re-scan, ajudando a distinguir "sensor sumiu" de "sensor responde com CRC ruim".

### 3. Painel — deixar o diagnóstico óbvio

- No card da prateleira, quando `sensor_travado` estiver ativo, mostrar **há quanto tempo é a última leitura válida** (ex.: "última leitura há 21 min") em vez de só "sensor sem leitura nova".
- Manter a contagem de reinícios visível e destacar em amarelo/vermelho conforme o volume.

## Detalhes técnicos

- Arquivo novo `firmware/bancada_esp32_v2_6_21/bancada_esp32_v2_6_21.ino` (cópia da v2.6.20 com as mudanças), `FIRMWARE_VERSION = "2.6.21"`.
- Campo opcional novo na telemetria (`temp_sem_leitura_s`), aceito em `src/routes/api/public/bench.telemetry.ts` e gravado em coluna nova em `bancadas` via migração.
- Ajuste de exibição em `src/components/bancada-card.tsx`.
- `CHANGELOG.md` e `docs/FIRMWARE.md` atualizados; a lista de versões em `src/routes/_shell.atualizacao.tsx` passa a apontar para a v2.6.21 (requer OTA nas prateleiras afetadas).

O firmware reduz falsos negativos e melhora o diagnóstico, mas se a causa for fiação/pull-up, só o passo 1 resolve de fato.
