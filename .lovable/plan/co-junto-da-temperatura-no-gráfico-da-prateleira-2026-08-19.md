# CO₂ junto da temperatura no gráfico da prateleira

Boa ideia: correlacionar CO₂ com temperatura na mesma tela ajuda a ver o efeito do ar-condicionado e da respiração da planta no mesmo eixo de tempo. A forma mais legível é **um gráfico com dois eixos Y**: temperatura (°C) à esquerda, CO₂ (ppm) à direita, compartilhando o eixo de tempo e o sombreado de luz acesa já existente.

## O que muda na tela

- Segunda linha no gráfico, em cor distinta, com o CO₂ da sala da prateleira.
- Eixo direito em ppm; tooltip mostra os dois valores no mesmo instante.
- Cartões de resumo ganham mín./média/máx. de CO₂ quando houver dados.
- Botão para ligar/desligar a linha de CO₂ (o gráfico continua útil em prateleiras sem sensor).
- Se a sala não tiver sensor de CO₂ ativo, nada aparece e a tela fica como está hoje.
- Título/descrição passam a indicar "Temperatura e CO₂".

## Observação sobre os dados

O CO₂ é medido **por sala** (sensor independente), não por prateleira: a linha representa a sala à qual a prateleira pertence. O histórico de CO₂ começou a ser gravado agora, então nas janelas longas (7/30 dias) a linha só aparece a partir do início do registro.

## Detalhes técnicos

- Reaproveitar `listarHistoricoCo2` (`src/lib/co2.functions.ts`), que já lê `medicoes_co2` por `laboratorio_id` e período (6h/24h/7d/30d). Para os períodos 60d/120d da tela de temperatura, ampliar o mapa `PERIODOS` dessa função.
- Em `src/routes/_shell.bancadas.$id.grafico.tsx`: buscar o histórico de CO₂ em paralelo quando `bancada.laboratorio_id` existir; unir as séries por timestamp (merge ordenado, sem inventar pontos — cada série usa `connectNulls`).
- Recharts: adicionar `<YAxis yAxisId="co2" orientation="right" />`, manter o eixo atual como `yAxisId="temp"`, e uma `<Line dataKey="ppm" yAxisId="co2" />`. `ReferenceArea` da luz e `ReferenceLine` de temp mín/máx seguem no eixo de temperatura.
- Cores via tokens do design system existente, sem classes de cor fixas.
