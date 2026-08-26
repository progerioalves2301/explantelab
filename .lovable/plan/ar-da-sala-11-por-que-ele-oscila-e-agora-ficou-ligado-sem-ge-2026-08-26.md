# Ar da sala 11: por que ele oscila e agora ficou "ligado" sem gelar

## O que os dados mostram (verificado agora)

A faixa usada é a **faixa de alerta da prateleira controladora P8S11** (16,5 – 21 °C, histerese 1,0). Não existe outro cadastro: liga em frio acima de 22 °C, desliga abaixo de 20 °C.

Histórico real da P8S11 hoje:

```text
16:52 ON  → 16:58 sensor 20,8 °C → OFF
17:09 ON  → 17:19 sensor 20,8 °C → OFF
17:32 ON  → 17:48 sensor 20,8 °C → OFF
17:57 ON  → 18:13 sensor 20,5 °C → OFF
18:21 ON  → temperatura SUBIU 23,6 → 24,5 °C (não gelou)
```

Duas coisas ficam claras:

1. **A lógica está correta, mas o sensor da P8S11 está no jato do ar.** Assim que o ar liga, o sensor cai para ~20,8 °C em poucos minutos (a sala inteira continua em 23–24 °C), o sistema entende "atingiu o alvo" e desliga. Depois o sensor volta a subir e ele liga de novo — ciclo de ~10 minutos, ligando e desligando o aparelho o dia todo. Na sala 12 isso não acontece porque a referência é o **máximo da sala** (agregação "máxima"), que não reage ao jato de um único sensor.
2. **O último comando ON (18:21) não teve efeito físico.** Foi entregue à prateleira, mas a temperatura subiu em vez de cair — ao contrário de todos os ONs anteriores. Ou o aparelho perdeu o frame IR, ou o código aprendido funciona como alternância (o mesmo botão liga e desliga), e a sequência ON/OFF repetida deixou o estado invertido em relação ao que o banco acredita.

## O que fazer

1. **Tirar a referência do jato de ar**: voltar a sala 11 para agregação **"máxima da sala"** (como a sala 12, que funciona) ou, se a P8S11 tiver de continuar sendo a referência, reposicionar/blindar o sensor fora do fluxo do ar. A troca de agregação é imediata e resolve a oscilação sem mexer no hardware.
2. **Faixa única = limites de alerta da prateleira controladora.** Continua sendo o único lugar de cadastro. Os campos `setpoint_min`/`setpoint_max` do cadastro do ar (hoje 22–26, nunca usados pela automação) saem da tela e deixam de ser gravados, para não parecer que existem dois cadastros. A tela de Ar-condicionado exibe a faixa de alerta em destaque com atalho para editar a prateleira controladora.
3. **Antioscilação**: exigir 3 leituras consecutivas do mesmo lado do limite antes de comutar, e respeitar um tempo mínimo de permanência ligado/desligado (ex.: 10 min) além do intervalo mínimo entre comandos.
4. **Nunca desligar por falta de leitura**: se a prateleira ficar sem telemetria recente, manter o estado atual e registrar o motivo, em vez de mandar OFF.
5. **Não comutar por edição de limites**: mudança de faixa entra na regra de confirmação, sem disparar comando na hora.
6. **Registrar cada decisão** (nova tabela de log): temperatura de referência, origem, limites, histerese, decisão e motivo. É o que faltou hoje para explicar cada ON/OFF sem investigação manual.
7. **Verificação de efeito na tela do ar**: último comando (ação, hora, entregue sim/não), temperatura no momento do comando e agora, variação desde então, e alerta "comando enviado mas a temperatura não reagiu" — que é exatamente o caso do ON das 18:21.
8. **Teste IR separado**: botões "testar LIGAR" e "testar DESLIGAR" com aviso de que, se o aparelho alternar em vez de obedecer, o código de desligar precisa ser reaprendido do controle original.

## Detalhes técnicos

- Migração: nova tabela `ar_decisoes_log` (com GRANTs e RLS de leitura para autenticados); colunas novas em `ar_condicionados` para o contador de confirmação (`pendente_estado`, `pendente_contagem`) e tempo mínimo de permanência (`permanencia_min_s`); reescrita de `public.decidir_ar_condicionado()` para: manter estado quando `v_temp IS NULL`, aplicar confirmação/permanência antes de comutar e logar sempre o motivo.
- `src/lib/ar-condicionado.functions.ts`: remover `setpoint_min/max` do schema de gravação, nova server fn `listarDecisoesAr(ar_id)`.
- `src/routes/_shell.ar-condicionado.tsx`: faixa de alerta em destaque com atalho de edição, bloco "Verificação" (último comando, entrega, temperatura antes/depois, aviso de não reação), lista das últimas decisões, botões de teste IR separados.
- Ajuste de dados: sala 11 volta para `agregacao = 'maxima'` (ou mantém `controladora` se o sensor for reposicionado).
- Sem alteração de firmware. Documentar em `CHANGELOG.md`.
