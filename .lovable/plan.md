# Plano de Implementação: Ajustes de Balança (Tara, Calibração e Teste)

O objetivo é permitir que o administrador realize a manutenção das balanças HX711 diretamente pela interface, enviando comandos de tara, ajustando o fator de calibração e visualizando leituras de teste.

## Ações

### 1. Backend: Funções de Comando
- Atualizar `src/lib/balancas.functions.ts` para incluir a função `enviarComandoBalanca`.
- Esta função registrará comandos (`BALANCA_TARA`, `BALANCA_CALIBRAR`) na tabela `comandos` usando o `device_token` da balança para identificação (ou `bancada_id` se associada).

### 2. UI: Gerenciamento de Balanças
- Modificar `src/routes/_shell.balancas.tsx`:
    - Adicionar o botão **Ajustes** no card de cada balança.
    - Implementar o dialog `AjustesBalancaDialog` com:
        - Leitura de peso em tempo real.
        - Botão **Tara** (Zerar).
        - Campo para **Fator de Calibração**.
        - Botão **Salvar Calibração**.

### 3. Melhoria na Experiência (UX)
- Adicionar atalho de ajustes de balança no dashboard principal para prateleiras que possuem balança vinculada.

## Detalhes Técnicos
- O firmware v2.6.2 (próxima versão) processará os comandos `BALANCA_TARA` e `BALANCA_CALIBRAR`.
- A leitura de peso no dialog usará polling ou refresh manual para não sobrecarregar o banco.
- Calibração exige nível de acesso Técnico.
