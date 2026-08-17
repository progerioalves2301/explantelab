# Plano: Gerenciamento e Integração de Balanças HX711

Este plano detalha a implementação de uma interface administrativa para gerenciar balanças HX711 e a integração direta no fluxo de pesagem das mudas, permitindo capturar o peso em tempo real via software.

## Alterações Propostas

### Backend & Segurança
- **Migração SQL**:
  - Garantir que a tabela `balancas` possua RLS (Row Level Security) e `GRANT`s adequados para o `authenticated` e `service_role`.
  - Criar/verificar as funções RPC `scale_can_sample` e `scale_push_reading` para suportar a telemetria autônoma do ESP32.

### Server Functions (TanStack Start)
- **`src/lib/balancas.functions.ts`**:
  - Implementar CRUD completo para a tabela `balancas` (listar, criar, editar, excluir).
  - Adicionar middleware de proteção para garantir que apenas administradores/técnicos possam gerenciar o hardware.

### Interface do Usuário (UI)
- **Página de Gerenciamento (`/balancas`)**:
  - Nova rota administrativa para cadastrar dispositivos HX711.
  - Campos: Nome, Sala (Laboratório), Token do Dispositivo, Tempo de Estabilização e Filtro de Outliers.
  - Visualização de status: Último peso lido e data/hora da última sincronização.
- **Fluxo de Pesagem de Mudas (`/mudas`)**:
  - Botão "Pesar" destacado no card da muda.
  - Diálogo de pesagem aprimorado com botão "Ler Balança".
  - Captura automática: Ao clicar, o sistema busca a leitura mais recente (últimos 30s) da balança associada àquela sala.
- **Navegação**:
  - Adicionar "Balanças" à barra lateral (`AppSidebar`).

## Detalhes Técnicos
- **Integração Realtime**: A interface utilizará consultas diretas à telemetria enviada pelo Firmware v2.6.0.
- **Consistência de Dados**: O peso capturado da balança pode ser editado manualmente antes de salvar para permitir correções do operador.
- **Validação**: Bloqueio de leituras se o ciclo hidráulico (injeção/retorno) estiver ativo na sala, garantindo precisão (sem vibração).
