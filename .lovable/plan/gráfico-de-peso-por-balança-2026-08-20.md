# Gráfico de peso por balança

Hoje o peso enviado pelo ESP32 só é gravado em histórico (`medicoes_peso`) quando existe uma muda ativa com o identificador correspondente; fora disso a função `scale_push_reading` apenas atualiza `ultima_leitura_g` na balança e descarta a leitura. Ou seja: não há série histórica para desenhar um gráfico. O plano cria esse histórico e uma página de gráfico por balança.

## O que será feito

### Banco de dados
- Nova tabela `medicoes_balanca` com um ponto por minuto por balança:
  `balanca_id`, `valor_g` (média do minuto), `amostras`, `minuto` (chave única com `balanca_id`).
- `scale_push_reading` passa a gravar sempre nessa tabela (mesmo sem muda ativa, mesmo durante ciclo hidráulico), fazendo média incremental dentro do minuto. O comportamento atual de `medicoes_peso` fica intacto.
- Limpeza automática de pontos com mais de 90 dias (mesmo padrão já usado em `medicoes_temperatura`).
- GRANT/RLS: leitura para usuários autenticados, escrita apenas via `service_role`.

### Frontend
- Nova função de servidor `listarHistoricoPeso` em `src/lib/balancas.functions.ts` (janela de tempo, paginação para não truncar em 1.000 linhas) retornando peso por minuto, mais busca de temperatura da prateleira associada e dos segmentos de ciclo.
- Nova rota `src/routes/_shell.balancas.$id.grafico.tsx`:
  - Seletor de período (6 h / 24 h / 7 d / 30 d).
  - Linha de peso (eixo Y esquerdo, gramas) sem pontos, no mesmo estilo do gráfico da prateleira.
  - Temperatura da prateleira associada sobreposta em eixo Y direito, com botão para ligar/desligar a série.
  - Faixas sombreadas (`ReferenceArea`) marcando as fases Injetando/Pausado/Retornando, a partir de `bancada_status_log` da prateleira associada.
  - Cartões de resumo: peso atual, mínimo, máximo e variação no período.
  - Estado vazio explicando que o histórico começa a partir de agora, para balanças sem dados.
- Botão "Gráfico" no card de cada balança em `src/routes/_shell.balancas.tsx`, levando para `/balancas/{id}/grafico`.

## Detalhes técnicos
- Fuso `America/Sao_Paulo` em todos os eixos e tooltips, como no restante do app.
- Nenhuma alteração de firmware: a v2.6.15 já envia leitura a cada 10 s; a agregação por minuto acontece no banco.
- Se a balança não tiver prateleira associada, a página mostra só a curva de peso (sem temperatura nem fases).
- `docs`/`CHANGELOG.md` atualizados com a nova tabela e a tela.
