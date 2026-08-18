# Plano de Diagnóstico e Estabilidade: Prateleiras Offline e Novas Implementações

O objetivo deste plano é investigar e corrigir a instabilidade relatada (equipamentos entrando e saindo da rede), analisando a relação com as atualizações de ontem (Área de Testes e Implementação da Balança) e preparando o **Firmware v2.6.6**.

## Análise Técnica
As mudanças de ontem envolveram:
1. **RLS (Row Level Security)**: Adição da coluna `is_teste` e novas políticas de segurança no banco de dados.
2. **Balança**: Comandos de calibração (`BALANCA_TARA`, `BALANCA_CALIBRAR`) e logs de debug no firmware.
3. **Firmware v2.6.5**: Melhorias de estabilidade de rede.

Possíveis causas para o "entra e sai" da rede:
- **Watchdog Trigger**: O watchdog global (30s) pode estar reiniciando o ESP32 devido a algum loop longo durante a leitura da balança ou CO2.
- **Transientes Elétricos**: Se a balança ou novos sensores causarem queda de tensão no barramento 3.3V/5V no momento da comutação.
- **RLS/Permissões**: Erros 401/403 no Supabase se as novas políticas estiverem bloqueando a telemetria de algum dispositivo (especialmente se o pareamento estiver instável).

## Ações Propostas

### 1. Investigação do Backend
- Verificar os logs de erro do Supabase para identificar falhas de permissão (403 Forbidden) causadas pelas novas políticas de `is_teste`.
- Monitorar a tabela `bancadas` para ver se os equipamentos marcados como `is_teste` estão conseguindo publicar telemetria.

### 2. Implementação do Firmware v2.6.6
Criar a nova versão focada em resiliência:
- **Watchdog Feed**: Garantir que o `esp_task_wdt_reset()` seja chamado dentro dos loops de leitura de sensores lentos (como HX711 e SCD41).
- **Retry Exponencial**: Melhorar a lógica de reconexão Wi-Fi para evitar "flood" no roteador.
- **Debug de Reinício**: Incluir no log serial o contador de *uptime* e a causa do reinício logo no banner inicial.

### 3. Melhoria na Interface (UI)
- Adicionar no Dashboard um indicador visual de "RSSI" (intensidade do sinal Wi-Fi) para ajudar a descartar problemas físicos de rede.
- Mostrar o motivo do reset (Brownout/Watchdog) de forma mais clara no card da prateleira.

## Detalhes Técnicos
- **Ficheiro**: `firmware/bancada_esp32_v2_6_6/bancada_esp32_v2_6_6.ino`
- **Watchdog**: Aumentar o timeout se necessário ou alimentar o cão de guarda em pontos críticos.
- **RLS Check**: Validar se a função `public.has_role` não está causando gargalo nas queries de telemetria.
