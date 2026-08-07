# Migrar o banco para a sua conta Supabase (e liberar criar/remover usuário e redefinir senha no Vercel)

Com o banco na sua conta você passa a ter a chave privilegiada (service role). É ela que falta hoje no Vercel para as três ações de administração de usuários.

## O que será entregue

1. **Script único de criação do banco** (`supabase/schema_completo.sql`) — gerado a partir das 54 migrações já existentes, contendo em ordem:
   - tabelas do schema `public` (prateleiras/bancadas, laboratórios, alertas, comandos, medições, mudas, balanças, sensores CO2, ar-condicionados, papéis de usuário, auditoria, LGPD, etc.)
   - os GRANTs, o RLS e todas as políticas de acesso
   - o tipo `app_role` e as 24 funções/triggers (telemetria do ESP32, pareamento, rate-limit, alertas, decisão do ar-condicionado, `has_role`, auditoria, primeiro admin)
   - criação dos buckets privados `firmware` e `lgpd-exports` com suas políticas
   - agendamentos (cron) de ciclos, alertas e ar-condicionado, com nota de como ativar as extensões

2. **Guia passo a passo** (`MIGRACAO_SUPABASE.md`) com:
   - criar o projeto na sua conta e rodar o script no editor SQL
   - onde pegar cada chave (URL, publishable/anon, service role) e onde colar no Vercel
   - como criar o primeiro usuário admin (o gatilho já promove o primeiro cadastro a admin)
   - como copiar os dados atuais (laboratórios, prateleiras, tokens dos ESP32, medições) — exportação CSV por tabela, na ordem correta de dependências
   - reapontar os ESP32: os dispositivos usam a URL do backend, então o firmware precisa da nova URL/chave pública (indico exatamente as linhas do `.ino` a alterar)
   - conferência final: login, papéis, telemetria chegando, alertas no Telegram

3. **Nenhuma mudança de código de aplicação necessária** — o app já lê tudo de variáveis de ambiente. As três ações de usuários voltam a funcionar assim que `SUPABASE_SERVICE_ROLE_KEY` existir no Vercel; opcionalmente eu reativo o caminho privilegiado nelas com uma mensagem de erro clara caso a chave esteja ausente.

## Variáveis no Vercel depois da migração

```text
VITE_SUPABASE_URL            = https://SEU-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY= (anon/publishable da sua conta)
VITE_SUPABASE_PROJECT_ID     = SEU-REF
SUPABASE_URL                 = https://SEU-REF.supabase.co
SUPABASE_PUBLISHABLE_KEY     = (a mesma anon/publishable)
SUPABASE_SERVICE_ROLE_KEY    = (service role da sua conta — só no servidor)
```

## Pontos de atenção

- O ambiente de pré-visualização aqui no Lovable continua ligado ao banco atual; o banco da sua conta valerá para o Vercel. Os dois ficam separados (bom para testes, mas os dados não se sincronizam).
- Os tokens dos dispositivos (`bancada_secrets`) precisam ser copiados ou regerados; se regerados, cada ESP32 precisa ser pareado de novo com o código de 6 dígitos.
- E-mails de autenticação (recuperação de senha) passam a sair pelo provedor de e-mail configurado na sua conta.
- Senhas dos usuários não são migráveis via CSV; o mais simples é recriar os poucos usuários e definir novas senhas pela tela de Usuários (que voltará a funcionar plenamente).

## Detalhes técnicos

- O script é derivado dos arquivos em `supabase/migrations/` mais o estado atual de funções/triggers, consolidado e idempotente (`create ... if not exists`, `create or replace function`).
- Storage: buckets criados via `storage.buckets` + políticas em `storage.objects` equivalentes às atuais (upload/leitura de firmware apenas para admin; exportações LGPD apenas para o próprio usuário).
- Cron: `pg_cron` + `pg_net` precisam ser habilitados na sua conta antes dos `cron.schedule`; o script deixa esses comandos em um bloco separado e comentado com instrução.
