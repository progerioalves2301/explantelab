# Independência total: sair do backend gerenciado

Objetivo: o VitroCeres passa a rodar 100% no **seu** Supabase e no **seu** Vercel, com credenciais que são suas, sem depender deste editor para funcionar.

## Ponto importante, com honestidade

A chave `service_role` e a senha do banco do backend gerenciado **não podem ser exibidas** — não é escolha minha, o ambiente não expõe esses valores para ninguém, nem para mim. Por isso a saída não é "te entregar aquela chave": é **você passar a usar o seu próprio projeto Supabase**, onde você é o dono e tem todas as chaves (URL, anon, service_role, senha do banco, backups).

Metade disso já está feito: o `supabase/schema_completo.sql` já rodou com sucesso no seu Supabase, então a estrutura já é sua.

## O que falta para a independência

1. **Ativar extensões e agendamentos no seu Supabase**
   - Ativar `pg_cron` e `pg_net`.
   - Criar os cron jobs (ciclos agendados, detecção de alertas, decisão do ar-condicionado) apontando para o seu domínio.

2. **Apontar o app do Vercel para o seu Supabase**
   - Definir as variáveis de ambiente do seu projeto (URL, chave publicável e chave de serviço) no Vercel.
   - Com a chave de serviço no seu Vercel, as abas **Usuários** (criar/remover usuário, redefinir senha), **Dados e exportação** e **Atualização** passam a funcionar de verdade, sem os contornos atuais.

3. **Firmware v2.5.4 — backend configurável**
   - Hoje a URL e a chave do backend estão fixas no código, é isso que prende as prateleiras ao backend antigo.
   - Na v2.5.4 essas duas informações passam a ser gravadas na memória do ESP32 e configuráveis pela tela de Wi-Fi (portal VitroCeres) — assim, trocar de backend no futuro nunca mais exige recompilar.
   - Enviar a v2.5.4 por OTA para as prateleiras já instaladas e, no primeiro boot, elas passam a gravar no seu banco.

4. **Migração dos dados históricos (opcional)**
   - Exportar as leituras de temperatura, pesos, CO2 e histórico de status do banco atual e importar no seu, para os relatórios não começarem vazios.

5. **Documentação de operação própria**
   - Atualizar o `MIGRACAO_SUPABASE.md` com: onde ficam suas chaves, como rodar o projeto localmente, como publicar no Vercel, como fazer backup do banco e como gerar novo firmware. Objetivo: você conseguir operar tudo sem depender deste editor.

## Ordem sugerida

Passos 1 e 2 podem ser feitos agora sem afetar nada em produção (as prateleiras continuam transmitindo no backend antigo). O passo 3 é o corte real e deve ser combinado com o cliente, porque durante a troca há uma janela curta em que os dados novos vão para o banco novo e os antigos ficam no antigo.

## Detalhes técnicos

- `src/integrations/supabase/client.ts` já lê `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, então no Vercel basta trocar os valores.
- As rotas administrativas passam a usar a chave de serviço vinda do ambiente do Vercel, removendo os contornos client-side criados para contornar sua ausência.
- Firmware: `SUPABASE_URL` e `SUPABASE_ANON_KEY` saem de `#define` e vão para `Preferences` (NVS), com campos extras no portal do WiFiManager e fallback para os valores atuais quando a NVS estiver vazia.
- Cron jobs: mesmos blocos já comentados no fim do `schema_completo.sql`, com domínio e chave do seu projeto.
