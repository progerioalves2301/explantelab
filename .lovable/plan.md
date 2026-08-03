# Diagrama de fiação e endereçamento das válvulas

Objetivo: documentar, de forma clara e imprimível, como ligar as 4 válvulas de uma prateleira (ESP32) — fonte, relés SSR, solenoides — e qual GPIO comanda cada par.

## O que será entregue

1. **Documento novo** `firmware/FIACAO_VALVULAS.md` contendo:
   - Tabela de endereçamento (GPIO → par de válvulas → função no ciclo).
   - Diagrama ASCII do circuito completo: fonte 12/24 V, ESP32, canais SSR, solenoides.
   - Diagrama Mermaid do mesmo circuito (renderiza no GitHub/preview).
   - Notas de instalação: polaridade, snubber/diodo de retorno, aterramento comum, seção de cabo, fusível.
   - Aviso sobre `RELAY_ACTIVE_LOW` (hoje `true` no firmware v2.5.3 — GPIO em LOW liga a carga).
   - Seção de expansão futura (8 válvulas) usando GPIOs livres.

2. **Arquivo de diagrama** `/mnt/documents/Fiacao_Valvulas_Prateleira.mmd`, entregue como artefato baixável/visualizável no chat.

## Endereçamento (conforme firmware v2.5.3)

| GPIO | Canal SSR | Válvulas | Papel no ciclo |
|------|-----------|----------|----------------|
| 25   | CH1       | V1 + V4  | Injeção — Meio → Planta |
| 26   | CH2       | V2 + V3  | Retorno — Planta → Meio |
| 27   | CH3       | Luzes    | Timer HH:MM (janelas de luz) |
| 4    | —         | Botão físico | Curto: inicia ciclo / Longo (2 s): cancela |

GPIOs já ocupados por outras funções e que não devem ser reutilizados: 2 (LED), 0 (BOOT/reset), 14 (DS18B20), 16/17 (balança HX711), 21/22 (I²C DS3231), 32 (IR TX), 33 (IR RX).

## Componentes listados no documento

- ESP32 DevKit (alimentação 5 V regulada, GND comum com o módulo SSR).
- Módulo relé de estado sólido 4 canais (Fotek SSR-xxDA ou módulo 4ch), entrada 3–32 VDC.
- Fonte dedicada para as solenoides (12 V ou 24 V DC conforme a válvula).
- Diodo de retorno (1N4007) ou snubber RC em cada solenoide DC.
- Fusível / disjuntor na entrada da fonte e borneira de distribuição.

## Detalhes técnicos

- O diagrama mostra que V1 e V4 compartilham fisicamente o mesmo canal de relé (paralelo elétrico), assim como V2 e V3 — refletindo a consolidação de GPIOs já feita no firmware.
- Nada no app ou no banco muda; é documentação. O firmware não é alterado.
- O `.mmd` usa apenas nós/labels neutros para permanecer legível em tema claro e escuro.
