# Separar visualização de CO2 nos gráficos

O objetivo é restringir a exibição dos dados de CO2 apenas à página de gráfico da prateleira que atua como o sensor de CO2. Gráficos de outras prateleiras exibirão apenas a temperatura.

## Alterações

### Frontend

1.  **src/routes/_shell.bancadas.$id.grafico.tsx**
    - Modificar a função `carregar` para buscar dados de CO2 apenas se `bancada.tem_co2` for verdadeiro.
    - Ajustar a lógica de renderização (títulos, legendas, eixos e linhas) para que o CO2 seja omitido quando a prateleira não for o módulo de CO2.
    - Manter a visualização cruzada (Temperatura + CO2) apenas na prateleira onde `tem_co2` está ativo.

## Detalhes técnicos

- Identificação da prateleira de CO2 via propriedade `tem_co2` do objeto `Bancada`.
- Omissão completa da série de dados e dos elementos de UI (botão de toggle, eixo Y secundário) em prateleiras comuns.
