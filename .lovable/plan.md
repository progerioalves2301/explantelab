# Plano: Gráfico de Temperatura vs. Tempo de Luz Acesa

O objetivo é implementar uma visualização que relacione a curva de temperatura com os períodos em que a iluminação da prateleira esteve ligada. Isso permite identificar se o calor das lâmpadas está afetando a temperatura da planta.

## Alterações

### Backend (Banco de Dados e Funções)
- Criar a tabela `luz_status_log` (se não existir) para persistir as mudanças de estado da iluminação (`true`/`false`) enviadas pela telemetria.
- Atualizar a RPC de telemetria para registrar mudanças no campo `luz_ligada`.
- Criar a função `listar_historico_luz` para retornar os intervalos (ligado/desligado) em um período determinado.

### Frontend (Aplicação)
- **Funções de Servidor**: Criar `listarHistoricoLuz` em `src/lib/luz.functions.ts` para buscar os dados de log da iluminação.
- **Gráfico de Prateleira**: Atualizar `src/routes/_shell.bancadas.$id.grafico.tsx`:
    - Buscar simultaneamente o histórico de temperatura e o histórico de luz.
    - Utilizar o componente `ReferenceArea` do Recharts para sombrear o fundo do gráfico nos períodos em que a luz esteve acesa.
    - Adicionar uma legenda indicando que as áreas sombreadas representam "Luz Acesa".

## Detalhes Técnicos
- A iluminação será representada como áreas retangulares no eixo X (tempo) do gráfico de linhas de temperatura.
- Caso não existam logs históricos (funcionalidade nova), o gráfico continuará exibindo apenas a temperatura normalmente.
- O fuso horário será tratado consistentemente com o restante da aplicação (`America/Sao_Paulo`).

