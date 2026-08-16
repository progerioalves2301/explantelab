# Plano de Simplificação dos Cards de Dispositivos Independentes

O objetivo deste plano é simplificar os cards de visualização para prateleiras que possuem perfis específicos (Balança, CO2), removendo informações irrelevantes para esses dispositivos (como ciclos de injeção e horários) e focando apenas nos dados pertinentes ao sensor.

## Mudanças Técnicas

### 1. Refatoração do Componente `BancadaCard`
O componente `src/components/bancada-card.tsx` será atualizado para ocultar seções específicas dependendo do perfil da prateleira (`tem_balanca`, `tem_co2`).

- **Seção de Válvulas e Ciclo**: Ocultar os indicadores de válvulas, gráfico de ciclos e botões de comando hidráulico (Manual, STOP, Novo Ciclo) se `tem_balanca` ou `tem_co2` for verdadeiro e a prateleira não for um "controlador hidráulico" (definido pela ausência de sensores de luz/válvulas no perfil).
- **Seção de Status**: Manter as informações de rede, bateria RTC e diagnósticos de reinício.
- **Seção de Dados**: Priorizar a exibição do peso (para balança) ou PPM de CO2 (para sensores de ambiente) de forma proeminente.

### 2. Ajuste na Lógica de Exibição
- Adicionar verificações condicionais baseadas nas propriedades do objeto `Bancada`:
  - `tem_balanca`: Se true e não tiver válvulas, mostrar peso em destaque e remover abas de ciclo.
  - `tem_co2`: Se true e não tiver válvulas, mostrar CO2 em destaque.
  - `tem_luz`: Já controla a visibilidade do badge de luz.

### 3. Melhoria na UI do Dashboard
- Garantir que prateleiras com perfil de apenas sensor não ocupem espaço desnecessário com botões inativos.

## User Experience (UX)
O usuário verá cards mais limpos e focados na função real de cada dispositivo, evitando confusão com botões de "STOP" ou horários de injeção em dispositivos que não possuem válvulas instaladas.
