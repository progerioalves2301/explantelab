# Ar da sala 11: por que os comandos parecem errados

## O que os dados mostram (verificado agora)

- Os limites que a automação realmente usa **não são os do cadastro do ar** (22–26 °C gravados em `ar_condicionados`), e sim os **limites de alerta da prateleira controladora P8S11: 16,5 – 21 °C**. Ou seja, existem duas configurações de faixa e só uma vale — a tela mostra 16,5–21, mas o cadastro guarda 22–26. Isso é a maior fonte de confusão.
- Com 21 °C de teto e histerese 1,0: o ar **liga acima de 22 °C** e só **desliga abaixo de 20 °C**.
- A P8S11 está em 24,4 °C e o histórico da última hora nunca ficou abaixo de 23,6 °C. Logo, pela regra, o ar deveria estar **ligado sem interrupção**.
- Mas o histórico de comandos mostra alternância: ON 16:52, OFF 16:58, ON 17:09, OFF 17:19, ON 17:32, OFF 17:48, ON 17:57, OFF 18:13, ON 18:21 — todos entregues à prateleira em segundos. Os setpoints enviados variam (22 / 21,5 / 21), o que indica que os limites foram sendo editados nesse período; ainda assim, um OFF com 24 °C não é explicável pela temperatura.
- Desde o último ON (18:21) a temperatura **subiu** (23,6 → 24,5 °C), o que sugere que o aparelho não está de fato resfriando: ou o código IR de LIGAR está funcionando como alternância (liga/desliga o mesmo botão) e a sequência ON/OFF deixou o aparelho invertido, ou o comando chega mas o ar está com setpoint próprio alto.

Diagnóstico da causa do OFF ainda **não está confirmado** — falta registro de decisão. Primeiro passo do plano é justamente tornar isso visível.

## O que fazer

1. **Registrar cada decisão da automação** (nova tabela de log): temperatura de referência, origem, limites usados, histerese, decisão tomada e motivo ("acima do teto", "abaixo do piso", "sem leitura recente", "aguardando intervalo mínimo"). Sem isso, qualquer explicação é chute.
2. **Faixa única = limites de alerta da prateleira controladora**: continua sendo o único lugar de cadastro (Temperatura mínima/máxima da prateleira). Os campos `setpoint_min`/`setpoint_max` do cadastro do ar (22–26) saem da tela e deixam de ser gravados — eram só ruído, a automação nunca os usou. A tela de Ar-condicionado passa a exibir a faixa de alerta em destaque, com atalho para editar os limites da prateleira controladora.
3. **Nunca desligar por falta de leitura**: hoje, se a leitura da prateleira ficar mais de 3 minutos sem atualizar, a lógica manda OFF. Passa a **manter o estado atual** e apenas registrar "sem leitura recente" — isso elimina o ping-pong ON/OFF.
4. **Exigir confirmação antes de comutar**: só liga/desliga depois de 3 leituras consecutivas do mesmo lado do limite, respeitando o intervalo mínimo entre comandos.
5. **Não gerar comando ao editar limites**: mudança de faixa não dispara comutação imediata; entra na mesma regra de confirmação.
6. **Painel de verificação na tela do ar**: último comando (ação, hora, entregue sim/não), temperatura no momento do comando e agora, e a variação desde então — para ver na hora se o aparelho respondeu.
7. **Teste dos códigos IR**: botões separados de "testar LIGAR" e "testar DESLIGAR" com aviso de que, se o aparelho alternar em vez de ligar/desligar, é preciso reaprender o código de desligar do controle original.

## Detalhes técnicos

- Migração: nova tabela `ar_decisoes_log` (com GRANTs e RLS de leitura para autenticados) e reescrita de `public.decidir_ar_condicionado()`:
  - fonte única de limites (`bancadas.temp_min/temp_max` da controladora);
  - caso `v_qtd = 0 / v_temp IS NULL` → não altera estado, apenas loga;
  - contador de confirmações consecutivas (coluna nova em `ar_condicionados`, ex.: `pendente_estado` + `pendente_contagem`);
  - insert em `ar_decisoes_log` em toda execução, com motivo.
- `src/lib/ar-condicionado.functions.ts`: remover `setpoint_min/max` do schema de gravação (ou marcá-los como legado não usados), nova server fn `listarDecisoesAr(ar_id)`.
- `src/routes/_shell.ar-condicionado.tsx`: bloco "Verificação" (último comando/entrega/temperatura antes e depois), lista das últimas decisões com motivo, botões de teste IR separados, edição de faixa apontando para os limites da prateleira.
- Sem alteração de firmware.
- Documentar em `CHANGELOG.md`.
