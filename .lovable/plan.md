# Plan: Diagnóstico de Dispositivos Offline

O usuário relatou que todos os dispositivos ficaram offline durante a noite. Como os dispositivos são ESP32 e operam de forma autônoma (ciclos e luzes rodam sem internet se configurados), a perda de conexão com o painel web sugere problemas de rede (Wi-Fi/Internet) ou oscilações de energia.

## Diagnóstico técnico realizado

1.  **Estado Atual**: No momento (11:55 UTC), a maioria das prateleiras (P1 a P6) está online e reportando dados (última sync há poucos minutos).
2.  **Dispositivos Pendentes**:
    *   **P8S12**: Última sync às 08:18 UTC. Motivo do boot: `poweron` (queda de energia ou ligamento manual).
    *   **P7S12**: Última sync às 08:07 UTC.
    *   **Balança**: Última sync às 01:13 UTC. Motivo do boot: `poweron`.
3.  **Causas Prováveis**:
    *   **Queda de Energia Local**: O fato de P8S12 e Balança reportarem `poweron` no último reinício confirma que houve um corte físico de energia no local.
    *   **Instabilidade de Wi-Fi/Internet**: Como as prateleiras pararam de reportar dados em horários próximos durante a madrugada, é provável que o roteador Wi-Fi ou a conexão de internet do laboratório tenha caído ou ficado instável após o retorno da energia.
    *   **Hardware antigo**: As prateleiras que ainda estão em versões v2.5.0/v2.5.1 não possuem o Watchdog de 30s e a comutação escalonada da v2.6.0+, o que as torna mais sensíveis a travamentos por transientes elétricos.

## Ações recomendadas

### 1. Atualização para Firmware v2.6.4 (Crítico)
Atualizar todos os dispositivos para a versão **v2.6.4**. Esta versão inclui:
*   **Watchdog Global (30s)**: Reinicia o ESP32 automaticamente se ele travar por qualquer motivo (inclusive instabilidade de Wi-Fi).
*   **Comutação Escalonada**: Evita quedas por `brownout` ao não acionar todos os relés ao mesmo tempo.
*   **Diagnóstico Avançado**: Mostra no card se o reinício foi por energia ou travamento.

### 2. Verificação de Infraestrutura
*   **Roteador**: Verificar se o roteador Wi-Fi está em um local com sinal estável para todas as prateleiras (verificar o selo **RSSI** nos cards).
*   **Energia**: Considerar o uso de filtros de linha ou estabilizadores nos ESP32 para mitigar ruídos da rede elétrica.

### 3. Melhoria na Interface (Filtro Offline)
Adicionar um filtro rápido no Dashboard para visualizar apenas dispositivos que estão "Offline" ou que reiniciaram recentemente por motivos anormais, facilitando a identificação de problemas em massa.

## Detalhes técnicos
*   **Firmware**: v2.6.4 disponível em `firmware/bancada_esp32_v2_6_4/`.
*   **Logs**: O sistema agora reporta `reset_reason` (motivo do reset), o que ajuda a distinguir se o dispositivo desligou por falta de luz ou se o programa travou.
