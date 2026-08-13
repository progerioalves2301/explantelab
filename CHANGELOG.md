# Changelog — VitroCeres / Explante Lab

> Histórico técnico de alterações do projeto. Cada entrada explica **o que mudou**, **como funciona** e **se exige ação** (ex: atualizar firmware dos ESP32, reconfigurar no app, etc.).

---

## 2026-08-12 — Firmware v2.5.9

**Firmware — confiabilidade do OTA e vida útil da memória**
- **Liberação de RAM antes do OTA**: a telemetria mantém um cliente TLS global com keep-alive. Antes, o cliente do OTA era criado sem fechar esse cliente, deixando dois contextos TLS vivos (~30–40 KB cada) — causa comum de falha/reset no download em equipamentos com dias de uptime. Agora o firmware encerra a conexão global (`http.end()` + `httpsClient.stop()`), aguarda 200 ms e registra o heap livre antes e depois.
- **Piso de memória**: se o heap livre ficar abaixo de 45 KB, o OTA é abortado com log claro (em vez de travar) e o comando pode ser reenviado.
- **Timeout de rede no OTA**: `otaClient.setTimeout(10000)` evita que a transferência fique pendurada quando o Wi-Fi do local remoto oscila.
- **Watchdog durante o OTA**: watchdog de 180 s armado só no download e realimentado no progresso. Se travar fora do alcance do timeout, o ESP32 reinicia sozinho e volta no firmware antigo — sem viagem até o local. O OTA é atômico, então nunca fica firmware corrompido.
- **Log de progresso** agora inclui o heap livre, para diagnosticar tentativas futuras.
- **Menos desgaste na NVS**: o carimbo de hora do RTC (`rtc_ts`) passa de 5 minutos para **1 hora**. Como o valor é o epoch atual, cada tick era uma gravação física no flash (~105 mil/ano); o desgaste cai ~12x. A detecção de bateria fraca da CR2032 continua funcionando (janela de incerteza vira 1 h). Gravações com valor igual são ignoradas e o carimbo é salvo antes de um reinício por OTA.
- **Correção de interferência**: identificada causa de quedas esporádicas na prateleira P8S12 devido a ruído eletromagnético das válvulas AC. Recomendado uso de filtros ou separação física de cabos.
- **Ação**: compilar `firmware/bancada_esp32_v2_5_9/bancada_esp32_v2_5_9.ino` e atualizar via OTA a partir da v2.5.8.

---


## 2026-08-11 — Firmware v2.5.8

**Firmware**
- Implementado o comando **LUZ_TESTE**: permite testar o funcionamento da fiação e do relé da luz diretamente pela interface web.
- **Funcionamento**: Ao acionar o botão "Teste 7s" na interface, a luz liga por exatos 7 segundos e desliga automaticamente, sem interferir na agenda programada.
- **Ação**: Atualizar via OTA para a v2.5.8 para habilitar o botão de teste.

---

## 2026-08-11 — Firmware v2.5.7

---

## 2026-08-10 — Interface e Explicações (Atualização Web)

**Web**
- **Explicações de Funções**: Adicionadas descrições detalhadas na tela de **Ar-condicionado** explicando o que é Histerese, Intervalo entre comandos e Agregação de temperatura (ajuda o usuário a entender as lógicas automáticas). Removida mensagem redundante sobre múltiplos ares na sala.
- **Apoio à Configuração**: Adicionado um tooltip (ícone "?") na configuração de ciclos da prateleira explicando como funciona o preenchimento automático de horários.
- **Ciclos Diários**: Os horários calculados automaticamente agora são **editáveis**.

---

## 2026-08-09 — Firmware v2.5.6 (Atualização Web)

---

## 2026-08-09 — Firmware v2.5.6

**Firmware**
- Detecção de **bateria fraca do RTC (DS3231)** muito mais confiável:
  - Nova evidência: **desvio contra o NTP**. No boot o firmware guarda a hora que o DS3231 estava marcando; quando o NTP sincroniza, compara. Desvio maior que **120 s** acende o alerta de bateria.
  - O **carimbo de hora** (`rtc_ts` na NVS) não é mais apagado quando a bateria é julgada OK — só atualizado. Antes, apagá-lo deixava o boot seguinte sem referência para detectar que o relógio retrocedeu.
  - Telemetria passa a reportar `_rtc_hora_perdida` e `_rtc_desvio_segundos`.
- **Motivo**: com o ESP32 energizado, o DS3231 conta a hora pelo VCC. Uma CR2032 fraca/ausente não gerava nenhum sinal (OSF em 0, hora certa), então o app nunca acusava falha. Só um relógio que voltou errado após queda de energia revela o problema — e esse caso passava batido quando a hora voltava "válida" mas errada.
- **Pinos**: nenhuma alteração (DS3231 em SDA=21 / SCL=22).
- **Ação**: atualizar os ESP32 para a **v2.5.6** via OTA. Sem mudança de fiação.
- **Validar**:
  1. Com o ESP32 ligado, retirar a CR2032 → nada muda (esperado; sem medir a tensão da bateria não há sinal).
  2. Cortar a energia por ~1 min e religar → o card deve mostrar **RTC · sem hora** ou **RTC · bateria** em poucos minutos.
  3. Com CR2032 boa, desligar/religar → o alerta desaparece no próximo boot.
  4. No serial: `[RTC] desvio contra NTP: X s` e `[RTC] bateria ...`.

**Web / Backend**
- Colunas novas em `bancadas`: `rtc_hora_perdida`, `rtc_desvio_segundos`; `bench_push_telemetry` aceita os dois parâmetros novos (opcionais — firmwares antigos seguem funcionando).
- Selo "RTC" no card agora tem três estados: **RTC** (íntegro), **RTC · bateria**, **RTC · sem hora**, com o motivo detalhado no tooltip.
- Configuração da prateleira informa a limitação: a bateria do RTC só é avaliada de forma conclusiva após uma queda de energia.

---

## 2026-08-09 — Firmware v2.5.5

**Firmware**
- LED de status do ciclo (GPIO 19) não fica mais piscando intermitente ao clicar em **Sair** no app durante ciclo manual. Agora ele volta ao padrão de repouso (apagado, pulso curto de "vivo" a cada 3 s).
- **Motivo**: o comando `PAUSE` enviado pelo app para encerrar o ciclo manual colocava a prateleira em repouso, mas o LED mantinha um estado intermitente de pausa.
- **Pinos**: GPIO 19 (LED), GPIO 4 (botão).
- **Ação**: atualizar via OTA os ESP32 que estão na v2.5.4 ou anterior.
- **Validar**: iniciar ciclo manual pelo botão (GPIO 4), clicar "Sair" no app; o LED deve apagar com um breve piscar a cada 3 s.

---

## 2026-08-09 — Firmware v2.5.4

**Firmware**
- Adicionado LED de status do ciclo no **GPIO 19**.
- Padrões de pisca (não bloqueantes, funcionam offline):
  - **Repouso**: apagado (pulso curto a cada 3 s).
  - **Ciclo manual** (botão GPIO 4): aceso fixo.
  - **Injetando**: pisca lento (500 ms ligado / 500 ms apagado).
  - **Pausa**: pisca curto (150 ms a cada 2 s).
  - **Retornando**: pisca rápido (150 ms / 150 ms).
  - **Pausado (STOP pelo app)**: 2 piscas curtas a cada 2 s.
- **Pinos**: GPIO 19 → resistor 330 Ω → anodo do LED; catodo no GND.
- **Ação**: fiação física do LED + OTA para v2.5.4+.
- **Validar**: observar os padrões acima durante cada fase do ciclo.

---

## 2026-08-09 — Firmware v2.5.3

**Firmware**
- Botão físico de ciclo manual no **GPIO 4**.
- Aperto **curto** (60 ms a 2 s): inicia ciclo manual se estiver em repouso.
- Aperto **longo** (≥ 2 s): cancela qualquer ciclo em andamento e volta ao repouso com válvulas fechadas.
- Funciona **100% offline** (sem internet).
- **Ação**: instalar botão físico + OTA.

---

## 2026-08-09 — Firmware v2.5.2

**Firmware**
- Introdução do botão físico de ciclo manual (GPIO 4).

---

## 2026-08-09 — Firmware v2.5.1

**Firmware**
- Confiabilidade do IR para ar-condicionado **Fujitsu**: envio duplo de frames e modelos alternativos.

---

## 2026-08-09 — Firmware v2.5.0

**Firmware**
- Modo **"Sem sensor de temperatura"**: prateleiras sem DS18B20 operam normalmente, sem alertas de temperatura.
- A telemetria indica explicitamente quando não há sensor (`g_sem_sensor_temp`).
- **UI**: badge cinza "Sem sensor instalado" quando aplicável.

---

## 2026-08-09 — Firmware v2.4.9

**Firmware**
- Lógica de bateria do DS3231 refinada: o **OSF** sozinho não condena mais a bateria no boot. A prova real é o relógio ter perdido a hora (inválida ou anterior ao carimbo da NVS).
- O OSF é zerado no boot para que uma nova parada de oscilador seja detectada em runtime.

---

## 2026-08-09 — Firmware v2.4.8

**Firmware**
- Adicionado **BOOT_CARENCIA_MS = 10 min**: evita que a prateleira injete imediatamente ao religar sem energia/internet.
- **Catch-up de ciclos perdidos**: se um horário programado foi perdido por queda de energia e ainda está dentro de `AGENDA_CATCHUP_S` (15 min), o ciclo é recuperado.

---

## 2026-08-09 — Firmware v2.4.7

**Firmware**
- Monitoramento da bateria do DS3231 via **OSF** (Oscillator Stop Flag) e carimbo de hora salvo na NVS a cada 5 min.
- Aviso de bateria fraca/ausente na telemetria e no app.

---

## 2026-08-09 — Firmware v2.4.6 a v2.4.8

**Firmware**
- Implementação de detecção de bateria fraca do DS3231 e limpeza do flag OSF (`limparOsfDs3231`).
- Ícone de alerta no app quando bateria do RTC precisa ser trocada.

---

## 2026-08-09 — Firmware v2.4.5

**Firmware**
- Pino do DS18B20 movido do GPIO 4 para o **GPIO 14** (o GPIO 4 passou a ser usado pelo botão físico).
- Re-detecção do sensor e fallback para SCD41 em caso de falha.

---

## 2026-08-09 — Firmware v2.4.4

**Firmware**
- Intervalos de telemetria/comandos ajustados para respeitar o limite de 60 req/min por prateleira:
  - Ativo: 3 s + 3 s
  - Repouso: 15 s + 5 s

---

## 2026-08-09 — Firmware v2.4.3

**Firmware**
- Adicionado controle de polaridade independente dos relés:
  - `RELAY_ACTIVE_LOW` (válvulas).
  - `LUZ_ACTIVE_LOW` (luzes).

---

## 2026-08-09 — Firmware v2.4.0

**Firmware**
- Suporte a **SCD41** (CO2) e **HX711** (balança) como periféricos opcionais.
- Endpoints públicos para CO2 e balança: `/api/public/co2/reading` e `/api/public/scale/reading`.
- Leitura de temperatura com **Delta Push** e detecção de sensor travado.

---

## 2026-08-09 — Firmware v2.3.3

**Firmware**
- CA Pinning com certificado ISRG Root X1 para comunicação HTTPS.

---

## 2026-08-09 — Firmware v2.3.2

**Firmware**
- Nome do AP de provisionamento Wi-Fi alterado para **"VitroCeres-XXXXXX"**.

---

## 2026-08-09 — Firmware v2.3.0

**Firmware / Web**
- Controle de ar-condicionado com modos **COOL/HEAT**, histerese e setpoint vinculado à faixa de temperatura da prateleira (`temp_min`/`temp_max`).
- Códigos IR RAW separados para ligar e desligar (`codigo_ir_raw_on` / `codigo_ir_raw_off`).

**Web**
- Nova aba `/ar-condicionado` com gerenciamento de múltiplos ares por laboratório.

---

## 2026-08-09 — Firmware v2.2.0

**Firmware**
- Modo de aprendizado IR no **GPIO 33** (receptor VS1838B/TL1838).
- Comando `IR_LEARN` captura códigos do controle remoto e envia para o backend.

---

## 2026-08-09 — Firmware v2.1.0

**Firmware**
- Controle de ar-condicionado via IR no **GPIO 32**.
- Suporte a protocolos: Samsung, LG, Midea, Electrolux, Electra, Fujitsu, Consul/Whirlpool.

---

## 2026-08-09 — Firmware v1.9.2

**Firmware**
- Válvula V5 (alívio) **removida**. Ciclo passa a ser: Repouso → Injeção → Pausa → Retorno → Repouso.
- GPIO 33 liberado (hoje usado como IR RX).

---

## 2026-08-09 — Firmware v1.9.0 / v1.8.0

**Firmware**
- DS3231 opcional no I²C (SDA=GPIO 21, SCL=GPIO 22) para autonomia offline.
- Autonomia completa: ciclos e luzes rodam sem internet, usando horários persistidos na NVS.

---

## 2026-08-09 — Firmware v1.6.0

**Firmware**
- Suporte a atualização **OTA** via comando `OTA_UPDATE` com URL assinada do bucket privado `firmware`.

**Web**
- Nova aba admin-only `/_shell/atualizacao` para disparar OTA nos ESP32.

---

## 2026-08-09 — Firmware v1.5.0 / v1.4.0

**Firmware**
- Timer de luzes com múltiplas janelas (`luz_janelas: [{ligar, desligar}]`), NTP e fuso configurável.
- **GPIO 27** dedicado ao relé das luzes.

---

## 2026-08-09 — Firmware v1.3.0

**Firmware**
- Consolidação dos GPIOs das válvulas:
  - V1/V4 (par de injeção) → **GPIO 25**
  - V2/V3 (par de retorno) → **GPIO 26**

---

## 2026-08-09 — Firmware v1.2.0

**Firmware**
- Primeira versão com nomeação padronizada (`bancada_esp32_vX_Y_Z/`).

---

## 2026-08-09 — Web / App

**Web**
- Renomeação de "Bancada" para "Prateleira" em todos os textos visíveis.
- Implementação de controle de usuários com papéis: **Administrador**, **Técnico/Operador** e **Visualizador**.
- Aba de **Usuários** visível apenas para Administradores.
- Aba de **Atualização** (OTA) visível apenas para Administradores.
- Aba de **Dados e exportação** (LGPD) visível apenas para Administradores.
- Relatório de ciclos em PDF (`/_shell/relatorios`).
- Relatório de temperatura em PDF (`/_shell/relatorios-temperatura`).
- Gráfico de temperatura por sala (`/_shell.bancadas.$id.grafico`).
- Ajuste de padrões de ciclo: Injeção 180 s, Pausa 60 s, Retorno 240 s.
- Limite offline padrão alterado para **420 s** (7 min).
- Configuração de horários de disparo por dia com recálculo automático (quantidade + horário inicial + espaçamento igual).

**Backend / Segurança**
- RLS revisado em várias tabelas para acesso por papel.
- Auditoria de alterações (trigger `tg_auditoria`).
- Tabela de perfis de hardware das prateleiras (`bancadas` com colunas de sensores/AC/luz/balança/CO2).
- Tabela `ar_condicionados` com suporte a múltiplos ares por laboratório e vinculação à prateleira controladora.
- Tabelas de medições de temperatura (`medicoes_temperatura`) e logs de auditoria.

---

## Formato de entradas futuras

```text
## YYYY-MM-DD — [Web | Firmware | Backend | Infra] vX.Y.Z
- O que mudou
- Por que mudou (quando relevante)
- Pinos/dependências (para firmware)
- Ação necessária do usuário (ex: OTA, reconfiguração, novo hardware)
- Como validar/testar
```

---

## Onde encontrar mais detalhes

- Documentação técnica do firmware: `docs/FIRMWARE.md`
- Fiação e endereçamento: `firmware/FIACAO_VALVULAS.md`
- Memória do projeto: `mem://index.md`
- Guia de migração do banco: `MIGRACAO_SUPABASE.md`
