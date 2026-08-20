# Changelog — VitroCeres / Explante Lab

> Histórico técnico de alterações do projeto. Cada entrada explica **o que mudou**, **como funciona** e **se exige ação** (ex: atualizar firmware dos ESP32, reconfigurar no app, etc.).

## 2026-08-20 — Firmware v2.6.17: calibração de 2 pontos (célula 5 kg)

- **Problema**: com um único ponto de calibração, a célula de 5 kg acertava 1 kg mas mostrava ~18–31 g para 218–258 g. A reta ficava com deslocamento de ~200 g (zona morta/pré-carga da célula), o que nenhum ajuste de fator sozinho corrige.
- **Correção**: o comando `BALANCA_CALIBRAR` aceita `ponto: 1 | 2`. O ESP32 grava as contagens brutas de dois pesos conhecidos em NVS e resolve a reta completa: `fator = (raw2 - raw1) / (peso2 - peso1)` e `zero = raw1 - peso1 × fator`. Assim ganho **e** deslocamento são corrigidos.
- **Tara**: continua funcionando e agora invalida pontos antigos, evitando misturar calibrações.
- **Painel**: em Balanças → Ajustes há o bloco "Calibração de 2 pontos": informar o peso menor → **Ponto 1**, trocar pelo peso maior → **Ponto 2 e calcular**.
- **Ação**: gravar `firmware/bancada_esp32_v2_6_17/bancada_esp32_v2_6_17.ino`, fazer Tara vazia e usar os dois pontos (ex.: 218 g e 1000 g).

---

## 2026-08-20 — Firmware v2.6.16: calibração direta no HX711

- **Causa da escala incorreta**: a calibração automática era calculada no navegador com a última leitura enviada ao banco. Essa leitura podia pertencer a outro instante e produzir um fator incorreto; por isso uma massa de calibração parecia correta, mas outros pesos ficavam multiplicados.
- **Correção**: o comando envia somente a massa conhecida. O ESP32 lê as contagens brutas naquele momento e calcula localmente `fator = (raw - tara) / massa`.
- **Estabilidade**: leitura, tara e calibração agora usam média aparada, descartando os 20% menores e maiores valores para reduzir picos elétricos do HX711. O Serial mostra raw, zero, delta, fator e peso em cada amostra.
- **Sincronização**: cada leitura também informa o fator ativo no ESP32, mantendo o painel alinhado com o valor persistido no dispositivo.
- **Ação**: gravar `firmware/bancada_esp32_v2_6_16/bancada_esp32_v2_6_16.ino`; com a plataforma vazia fazer Tara, aguardar estabilizar, colocar o peso conhecido e usar Calibrar uma única vez.

---

## 2026-08-20 — Gráfico de peso por balança

- **Histórico de peso**: nova tabela `medicoes_balanca` guarda um ponto por minuto por balança (média das leituras do minuto, com contagem de amostras). Retenção de 90 dias, igual à temperatura.
- **Gravação**: `scale_push_reading` passa a registrar sempre esse ponto, mesmo sem muda ativa e mesmo durante o ciclo hidráulico. As regras de `medicoes_peso` (muda, outlier, estabilização) continuam iguais.
- **Nova tela**: `/balancas/{id}/grafico` mostra a curva de peso com seletor de período (6 h / 24 h / 7 d / 30 d), temperatura da prateleira associada em eixo secundário (ligável) e faixas sombreadas das fases do ciclo (injeção, pausa, retorno), além de cartões de peso atual, mínimo, máximo e variação.
- **Acesso**: botão **Gráfico** no card de cada balança na tela Balanças.
- **Ação**: nenhuma no firmware. O histórico começa a partir das próximas leituras enviadas.

---

## 2026-08-20 — Firmware v2.6.15: tara e calibração da balança

- **Causa do valor bruto persistente**: a v2.6.14 recebia os comandos do painel, porém `tratarComando()` não implementava `BALANCA_TARA` nem `BALANCA_CALIBRAR`; portanto o offset permanecia em zero e o fator permanecia em 1.
- **Correção**: Tara agora grava na NVS a média bruta atual do HX711 como zero; Calibração aplica e persiste o fator recebido e força um novo envio do peso.
- **Fator com sinal**: fatores negativos são aceitos quando a orientação/fiação da célula produz contagens decrescentes ao adicionar peso. Fator zero continua bloqueado.
- **Ação**: gravar `firmware/bancada_esp32_v2_6_15/bancada_esp32_v2_6_15.ino`. Depois, com a plataforma vazia, clicar em **Tara (Zerar)**; colocar um peso conhecido, calcular o fator e salvar.

---

## 2026-08-20 — Firmware v2.6.14: diagnóstico e envio rápido da balança

- **Causa do 0,00 g**: o ESP32 estava conectado e consultando o servidor, mas a balança sem tara/calibração produzia um valor bruto fora do intervalo aceito; a leitura era rejeitada antes de chegar ao painel.
- **Correção**: o endpoint aceita temporariamente a faixa bruta do HX711, inclusive valores negativos, permitindo visualizar, tarar e calibrar o sensor.
- **Atualização**: o peso ao vivo passa a ser enviado a cada 10 segundos, inclusive durante o ciclo hidráulico; o histórico estável continua protegido.
- **Ação**: publicar o app e gravar `firmware/bancada_esp32_v2_6_14/bancada_esp32_v2_6_14.ino` para obter atualização a cada 10 segundos. Depois, executar Tara e Calibração em Balanças → Ajustes.

---

## 2026-08-20 — Firmware v2.6.13: balança sem código próprio

- **Um único pareamento**: existe apenas o código de 6 dígitos da prateleira. O campo "Código da balança" foi removido do portal Wi-Fi.
- **Como funciona**: após parear a prateleira, o ESP32 chama `GET /api/public/scale/claim` com o token da prateleira e recebe automaticamente a credencial da balança ativa associada. Se a balança for cadastrada depois, a tentativa é repetida a cada 5 minutos.
- **Correção do envio de peso**: as rotinas de status e leitura agora localizam a sala pela prateleira associada. Antes, o erro nessa consulta mantinha a amostragem bloqueada e nenhum peso era enviado.
- **Painel**: a tela Balanças não gera mais códigos; basta cadastrar a balança e associá-la a uma prateleira.
- **Ação**: gravar `firmware/bancada_esp32_v2_6_13/bancada_esp32_v2_6_13.ino` e garantir que a balança esteja associada à prateleira correta.

---

## 2026-08-20 — Firmware v2.6.12: balança por código de pareamento

- **Sem token manual**: o cadastro da balança gera um código de 6 dígitos válido por 24 horas. O ESP32 troca esse código por uma credencial interna e a salva automaticamente.
- **Leitura ao vivo**: o peso passa a atualizar no card mesmo sem uma muda identificada; a associação da muda continua opcional para registrar o histórico.
- **Ação**: gravar `firmware/bancada_esp32_v2_6_12/bancada_esp32_v2_6_12.ino`, cadastrar/abrir a balança no painel, gerar o código e digitá-lo no portal VitroCeres.

---

## 2026-08-18 — Firmware v2.6.10: polling confiável do SCD41

- **Problema**: consultar o SCD41 exatamente a cada 5 s podia ocorrer instantes antes do fim da conversão; o cronômetro era reiniciado mesmo sem dado pronto e a leitura era perdida.
- **Correção**: a prontidão agora é consultada a cada 1 s e `g_ts_ultima_co2_leitura` só é atualizado após `readMeasurement()` retornar uma amostra válida. A média e o envio a cada 60 s foram preservados.
- **Compatibilidade da biblioteca**: o sketch usa `SensirionI2cScd4x.h`; nessa API oficial, as assinaturas corretas são `begin(Wire, SCD41_I2C_ADDR_62)` e `getDataReadyStatus(pronto)`. Não foram aplicados os nomes de outra variante da biblioteca, pois isso impediria a compilação deste firmware.
- **Ação**: compilar e gravar `firmware/bancada_esp32_v2_6_10/bancada_esp32_v2_6_10.ino`.

---

## 2026-08-18 — Volta ao firmware unificado: v2.6.9 (CO₂ funcionando)

- **O que mudou**: o firmware dedicado v3.0.x-co2 foi descartado (o SCD41 falhava no boot com `err=268` por causa do gate por número de série). Agora o módulo de CO₂ usa `firmware/bancada_esp32_v2_6_9/bancada_esp32_v2_6_9.ino`, que é o v2.6.0 comprovado + correções no SCD41.
- **Como funciona**: init do SCD41 com `wakeUp` + `reinit` antes do `startPeriodicMeasurement`, retentativa automática a cada 60 s se não responder, log por amostra (`[CO2] 812 ppm | 24.3 C | 55 %`), watchdog alimentado nos loops de I²C e envio de temperatura/umidade/versão junto do ppm.
- **Ação**: gravar a v2.6.9 e informar o **Token sensor CO2** no portal Wi-Fi (como antes).

---

## 2026-08-18 — CO₂ v3.0.1-co2: pareamento por senha de 6 dígitos (revertido)

- **O que mudou**: o módulo de CO₂ não pede mais token nem URL de API. A URL já é fixa no firmware (`https://explantelab.lovable.app`) e o portal Wi-Fi agora tem só **Senha de pareamento (6 dígitos)** + fuso.
- **Como funciona**: na aba **CO₂**, o botão **Gerar senha** no card do sensor cria um código de 6 dígitos válido por 24 h. O ESP32 envia esse código em `POST /api/public/co2/pair` e recebe o token definitivo, que fica salvo em Preferences. Se a senha estiver expirada/errada, ele avisa no serial e retenta a cada 30 s até haver senha válida.
- **Ação**: gravar `firmware/vitroceres_co2_v3_0_1/vitroceres_co2_v3_0_1.ino`, gerar a senha no app e digitá-la no portal.

---

## 2026-08-18 — Firmware dedicado do CO₂: VitroCeres CO2 OS v3.0.0-co2

- **O que mudou**: módulos de CO₂ passam a ter sketch próprio em `firmware/vitroceres_co2_v3_0_1/vitroceres_co2_v3_0_1.ino` — só Wi-Fi (portal `VitroCeres-XXXXXX`), SCD41 (I²C 21/22), LED de status (GPIO 19), watchdog e OTA. Sem válvulas, ciclos, luz, IR/ar-condicionado ou HX711.
- **Backend**:
  - `POST /api/public/co2/reading` aceita agora `temperatura_c`, `umidade_pct`, `firmware_version` e `ip_local` (todos opcionais — firmwares antigos continuam funcionando).
  - Novo `GET /api/public/co2/commands` (header `X-Device-Token`) devolve o OTA pendente do sensor.
  - `sensores_co2` guarda última temperatura/umidade, versão de firmware, IP e o OTA agendado; `medicoes_co2` guarda temperatura e umidade por leitura.
- **App**: a aba **Atualização** ganhou a seção “Sensores de CO₂ (firmware dedicado)”, com status online/offline, versão instalada e botões Atualizar/Parar por sensor.
- **Ação**: gravar a v3.0.0-co2 por USB no módulo de CO₂ (a partir daí o OTA funciona pelo app) e informar o token do sensor no portal Wi-Fi.

---

## 2026-08-18 — Firmware v2.6.8: temperatura vem do SCD41 quando não há DS18B20

- **Problema**: em módulos só com SCD41 (CO₂), o loop imprimia `[TEMP] leitura invalida (t=-127...)` indefinidamente e o 1-Wire era varrido a cada 30 s.
- **Correção**: o SCD41 passa a ser a fonte **primária** de temperatura quando o DS18B20 não está instalado. Enquanto a 1ª amostra não chega, o log é um aviso único a cada 30 s (`aguardando temperatura do SCD41`), sem marcar "sensor travado" nem forçar reinícios do 1-Wire. Re-scan do DS18B20 cai para 5 min quando há SCD41. O log de leitura boa agora indica a origem: `[TEMP] 24.3 C (SCD41)`.
- **Ação**: compilar `firmware/bancada_esp32_v2_6_8/bancada_esp32_v2_6_8.ino` e atualizar via OTA.

---

## 2026-08-18 — Correção crítica: prateleiras ficando offline ao entrar em Repouso

- **Causa**: o gatilho `tg_bancada_fim_ciclo_balanca` (criado na integração da balança) consultava `balancas.laboratorio_id`, coluna que não existe. Toda telemetria com status `Repouso` era abortada com erro `42703`, então cada prateleira parava de atualizar exatamente no fim da fase de Retorno e aparecia como Offline (os ESP32 seguiam funcionando normalmente).
- **Correção**: o gatilho agora localiza a balança por `bancada_associada_id` e qualquer falha nessa etapa é ignorada, nunca derrubando a telemetria.
- **Ação**: nenhuma — não exige atualização de firmware.

---


## 2026-08-18 — Firmware v2.6.6 + Resiliência de Sensores

**Firmware (v2.6.6)**
- **Watchdog Global**: Adicionada alimentação do watchdog (`esp_task_wdt_reset`) nos loops de leitura do sensor de CO2 (SCD41) e da balança (HX711). Isso evita reinícios inesperados em equipamentos onde esses sensores demoram a responder ou travam o barramento I2C/Serial.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_6/bancada_esp32_v2_6_6.ino` e atualizar via OTA.

## 2026-08-18 — Firmware v2.6.5 + Correções de Conectividade

**Firmware (v2.6.5)**
- **Melhoria na Reconexão Wi-Fi**: Ajustada a lógica de watchdog e persistência para mitigar quedas de conexão em massa durante a noite.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_5/bancada_esp32_v2_6_5.ino` e atualizar via OTA.

## 2026-08-18 — Firmware v2.6.4 + Debug Serial Aprimorado

**Firmware (v2.6.4)**
- **Serial Debug**: Aumentado delay no boot e adicionado banner visual para garantir que a IDE capture o início dos logs.
- **Debug Balança**: Lógica de leitura do HX711 alterada para forçar retorno de dados mesmo que o chip demore a responder, com log detalhado (`ready=0/1`).
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_4/bancada_esp32_v2_6_4.ino` e atualizar via OTA. Verifique o Monitor Serial a 115200 bps.

## 2026-08-18 — Firmware v2.6.3 + Log de Debug da Balança

**Firmware (v2.6.3)**
- **Debug Balança**: Adicionado log de leitura raw no Serial (`[DEBUG BALANCA]`) para facilitar o diagnóstico de hardware e calibração via IDE do Arduino.

## 2026-08-18 — Firmware v2.6.2 + Ajustes de Balança (Tara e Calibração)

**App / Backend**
- **Ajustes de Balança**: Implementada interface para realizar **Tara** (zerar) e **Calibração** de balanças HX711 diretamente pelo painel de gerenciamento.
- **Teste em Tempo Real**: Novo dialog de ajustes permite forçar a leitura do peso atual para validar a estabilidade e o fator de calibração.
- **Integração no Dashboard**: Adicionado atalho rápido para ajustes de balança nos cards das prateleiras que possuem o sensor vinculado.

**Firmware (v2.6.2)**
- **BALANCA_TARA**: Novo comando para zerar o offset do HX711 e salvar na NVS.
- **BALANCA_CALIBRAR**: Novo comando para atualizar o `fator_calibracao` no dispositivo e persistir localmente.
- **Ação**: Compilar `firmware/bancada_esp32_v2_6_2/bancada_esp32_v2_6_2.ino` e atualizar via OTA.

## 2026-08-16 — Firmware v2.6.1 + Cancelamento de OTA

**App / Backend**
- **Parada de Emergência OTA**: Implementado botão "Parar" (individual) e "Parar todas" (massa) na aba de Atualização.
- **Funcionamento**: O sistema agora permite cancelar uma atualização que já foi disparada, desde que o ESP32 ainda não tenha concluído o download. O comando `OTA_CANCEL` limpa a fila de comandos pendentes no banco e notifica o dispositivo para ignorar o agendamento de flash.

**Firmware (v2.6.1)**
- **OTA_CANCEL**: Adicionado tratamento para o comando de cancelamento explícito no loop de processamento de comandos.

## 2026-08-15 — Firmware v2.6.0 + diagnóstico de queda

**Contexto**: a prateleira P8S12 saía do ar todos os dias no mesmo minuto (17:13), exatamente no instante em que a injeção termina e o par de válvulas V1/V4 desliga. Ela ficava travada em "Injetando" por horas — com as válvulas possivelmente energizadas.

**Firmware (v2.6.0 — sem mudança de pinagem)**
- **Motivo do último reinício na telemetria** (`esp_reset_reason`): `poweron`, `brownout`, `task_wdt`, `panic`, `botao_reset`, etc. É isso que separa "queda de tensão na comutação da válvula" de "travamento de software".
- **Diagnóstico de rede/memória**: tempo ligado (`uptime_s`), menor heap livre já visto (`heap_min`), número de quedas de Wi-Fi (`wifi_reconexoes`) e intensidade do sinal (`rssi`).
- **Watchdog global de 30 s** (antes existia só durante o OTA): se o loop travar, o ESP32 reinicia sozinho e retoma o ciclo pelo estado salvo na NVS. Armado no fim do `setup()` para não interferir no portal Wi-Fi.
- **Teto de segurança por fase**: se Injeção/Pausa/Retorno passar do dobro do tempo configurado (+60 s), o firmware fecha todas as válvulas e volta ao Repouso — mesmo sem internet.
- **Comutação escalonada das válvulas**: o par que desliga vai primeiro, espera ~150 ms e só então o outro par energiza. Antes os dois transientes de 220 Vac aconteciam no mesmo instante.

**Backend**
- `bancadas` ganhou `reset_reason`, `uptime_s`, `heap_min`, `wifi_reconexoes`, `rssi`; `bench_push_telemetry` e `POST /api/public/bench/telemetry` aceitam os novos campos (a versão antiga da função foi removida para não criar sobrecarga ambígua).
- **Ar-condicionado sem ping-pong**: `decidir_ar_condicionado()` agora exige a histerese **também para ligar** (liga em `> max + histerese`, desliga em `<= max - histerese`), respeita um intervalo mínimo de 300 s entre comandos e descarta comandos `AC_CONTROL` pendentes antigos em vez de acumular fila de códigos IR.

**App**
- Selo no card: **"Reset · energia"** (vermelho) quando o último boot foi por brownout e **"Reset · travou"** (âmbar) quando foi pelo watchdog/pânico, com explicação no tooltip.

**Ação**: compilar `firmware/bancada_esp32_v2_6_0/bancada_esp32_v2_6_0.ino` e atualizar por OTA. Depois do primeiro reinício, o selo do card diz se a causa é elétrica (hardware: snubber RC 100 Ω/100 nF 275 Vac na bobina + desacoplamento nas fontes de 12 V e 5 V) com base na causa do reset.
