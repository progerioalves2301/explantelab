# Plano de comunicação e documentação das implementações

## Contexto

O usuário acompanha um projeto complexo: aplicação web + firmware ESP32 + hardware físico (prateleiras, válvulas, sensores, IR, etc.). Sem explicação clara do que mudou e como funciona, fica difícil validar se o comportamento está correto ou se um equipamento precisa ser atualizado. Será criado um padrão de documentação **dentro do repositório** para que o usuário possa consultar sempre que quiser.

## Objetivos

1. Registrar toda alteração relevante em um arquivo técnico no projeto (não no chat).
2. Para firmware, documentar: pinos GPIO, lógica de funcionamento e necessidade de atualização/OTA nos equipamentos existentes.
3. Criar uma estrutura previsível para que o usuário saiba onde procurar o que foi modificado.
4. Manter memória do projeto atualizada para regras que se repetem.

## O que será entregue

### 1. `CHANGELOG.md` na raiz do projeto
- Arquivo central com histórico de alterações.
- Entrada por versão/data, dividida em: Web, Firmware, Hardware/Configuração.
- Cada item deve responder:
  - O que mudou
  - Por quê (quando relevante)
  - Como validar/testar
  - Se exige ação do usuário (ex: atualizar ESP32, religar, reconfigurar)

### 2. `docs/FIRMWARE.md`
- Documentação técnica do firmware:
  - Tabela de pinos GPIO consolidada (versão atual e histórico)
  - Lógica dos ciclos, luz, IR, AC, botão físico, LED, RTC, etc.
  - Instruções de OTA e quando é obrigatório aplicar
  - Requisitos de hardware por versão

### 3. Atualização da memória do projeto
- Sincronizar `mem://index.md` com as regras atuais de firmware (pinagem, lógica de luz/relés, etc.).
- Garantir que a memória reflita a versão mais recente do firmware.

### 4. Padrão para futuras implementações
- Sempre que uma mudança envolver:
  - **Firmware**: criar/renomear versão, atualizar `CHANGELOG.md`, `docs/FIRMWARE.md`, detalhar pinos, lógica e OTA.
  - **Web**: registrar no `CHANGELOG.md` com o que mudou na UI/regras e como validar.
  - **Banco/RLS**: documentar no `CHANGELOG.md` e, se necessário, em `docs/INFRA.md`.

## Exemplo de formato de entrada no `CHANGELOG.md`

```text
## 2026-08-09 - Firmware v2.5.5
- LED de status (GPIO 19) não pisca intermitente ao sair do ciclo manual; passa para pulso de "vivo" do repouso.
- Pinos: GPIO 19 (LED status), GPIO 4 (botão físico).
- Lógica: ao comando PAUSE vindo do app durante ciclo manual, estado vai para repouso e LED apaga.
- Ação necessária: atualizar ESP32 via OTA se estiver na v2.5.4 ou anterior.
- Validar: pressionar ciclo manual, depois clicar "Sair" no app; LED deve apagar com pulso a cada 3s.
```

## Próximos passos

1. Criar/validar `CHANGELOG.md` e `docs/FIRMWARE.md` com base no histórico da conversa.
2. Atualizar `mem://index.md` com as regras consolidadas.
3. Aplicar esse padrão a partir da próxima implementação.

## Não incluso neste plano

- Refatoração de código funcional não solicitada.
- Mudanças no firmware em si; apenas a estrutura de documentação.
- Resumos extensos no chat (conforme preferência do usuário: somente arquivo no projeto).
