# Guia de migração do banco para o seu Supabase próprio

Como você pediu para explicar o passo a passo, este plano detalha exatamente como migrar o banco do Lovable Cloud para um projeto Supabase na sua conta. Você fará a execução; eu não preciso acessar suas credenciais.

## Por que fazer isso

O app publicado no Vercel está usando variáveis de ambiente do Lovable Cloud. Isso funciona para login, dashboards e comandos dos ESP32, mas **não** permite ações de administração de usuários (criar, remover, redefinir senha). Essas três ações precisam da chave `service_role`, que só existe em um projeto Supabase de sua própria propriedade.

## O que você vai fazer (resumo)

1. Criar um projeto novo e vazio no Supabase.
2. Rodar o script `supabase/schema_completo.sql` no SQL Editor.
3. Ativar as extensões `pg_cron` e `pg_net` e rodar o bloco de cron jobs.
4. Copiar URL, anon key e service role key para o Vercel.
5. Redeployar no Vercel.
6. Criar o primeiro usuário no app (ele vira admin automaticamente).
7. Opcionalmente, copiar os dados atuais via CSV.
8. Reapontar os ESP32 com a nova URL e anon key.

## Passo a passo detalhado

### 1. Criar o projeto no Supabase

- Vá ao painel do Supabase (supabase.com) e clique em **New project**.
- Escolha uma organização, dê um nome (ex.: `vitroceres-producao`), e selecione a região mais próxima do laboratório (ex.: `South America (São Paulo)`).
- Anote a **Database password** que você criar na tela de configuração. Guarde no cofre de senhas.
- Aguarde a criação do projeto (costuma levar 1-2 minutos).

### 2. Rodar o script de estrutura

- No projeto novo, vá em **SQL Editor → New query**.
- Copie o conteúdo inteiro do arquivo `supabase/schema_completo.sql` do projeto Lovable e cole no editor.
- Clique em **Run**.
- O script faz tudo de uma vez: cria tabelas, tipo `app_role`, funções, triggers, GRANTs, RLS, buckets de storage e deixa os cron jobs comentados para o próximo passo.
- Se algum erro aparecer, a mensagem costuma ser clara (ex.: falta uma extensão). Ajuste e rode só o trecho que falhou.

### 3. Habilitar extensões e rodar os cron jobs

- Vá em **Database → Extensions**.
- Habilite `pg_cron` e `pg_net`.
- Volte ao SQL Editor, abra o `schema_completo.sql` novamente e vá até o **final do arquivo**.
- O último bloco está comentado com `--`. Copie esse bloco, remova os `--` e substitua:
  - `SEU_DOMINIO` → seu domínio no Vercel (ex.: `meuapp.vercel.app`)
  - `SUA_ANON_KEY` → a chave `anon` do seu novo projeto (veja no passo 4)
- Rode o bloco. Isso cria os agendamentos de ciclo, alertas e ar-condicionado.

### 4. Pegar as chaves no Supabase

- No painel do projeto, vá em **Settings → API**.
- Anote:
  - **Project URL** → usar como `VITE_SUPABASE_URL` e `SUPABASE_URL`
  - **anon public** → usar como `VITE_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_PUBLISHABLE_KEY`
  - **service role** (abaixo, marcada como secret) → usar como `SUPABASE_SERVICE_ROLE_KEY`
- Em **Settings → General**, anote o **Reference ID** → usar como `VITE_SUPABASE_PROJECT_ID`

### 5. Configurar as variáveis no Vercel

- No Vercel, vá em **Project → Settings → Environment Variables**.
- Adicione em **Production** e em **Preview**:

```text
VITE_SUPABASE_URL             = https://<seu-reference-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = <anon public do novo projeto>
VITE_SUPABASE_PROJECT_ID      = <seu-reference-id>
SUPABASE_URL                  = https://<seu-reference-id>.supabase.co
SUPABASE_PUBLISHABLE_KEY      = <anon public do novo projeto>
SUPABASE_SERVICE_ROLE_KEY     = <service role do novo projeto>
```

- A `service_role` deve ficar **apenas** nas variáveis sem `VITE_`. Nunca a exponha no frontend.
- Salve e faça **Redeploy** (variáveis só valem em build novo).

### 6. Criar o primeiro admin

- Abra o app no domínio do Vercel.
- Faça cadastro com seu e-mail. Se quiser pular a confirmação de e-mail, pode também adicionar o usuário no painel Supabase em **Authentication → Users → Add user** marcando **Auto Confirm**.
- O primeiro usuário que acessar o app vira admin automaticamente pelo gatilho `assign_first_admin`.
- As abas **Usuários**, **Dados e exportação** e **Atualização** aparecem para esse admin.

### 7. Copiar dados atuais (opcional)

- Se quiser manter os dados já cadastrados no Lovable Cloud, exporte as tabelas por CSV na ordem correta:

```text
1. laboratorios
2. bancadas
3. bancada_secrets
4. ar_condicionados, balancas, sensores_co2
5. mudas
6. medicoes_temperatura, medicoes_peso, medicoes_co2
7. alerta_destinos, app_settings
```

- No projeto novo, importe os CSVs em **Table Editor → tabela → Insert → Import data from CSV**.
- Não migre: `auditoria`, `alertas`, `comandos`, `bancada_status_log`, `bancada_telemetry_debug`, `bench_rate_state` (dados históricos/efêmeros) e nem os usuários (senhas não são exportáveis).

### 8. Reapontar os ESP32

- Abra o firmware `firmware/bancada_esp32_v2_5_3/bancada_esp32_v2_5_3.ino`.
- Altere:
  - `SUPABASE_URL` (linha 64) para `https://<seu-reference-id>.supabase.co`
  - `SUPABASE_ANON_KEY` (linha 65) para a anon public do novo projeto
- Recompile e grave em cada ESP32, ou use a tela **Atualização** para enviar via OTA.
- Se você **não** copiou a tabela `bancada_secrets`, cada prateleira precisa ser pareada de novo: gere o código de 6 dígitos no app e digite no painel de pareamento da prateleira.

## Conferência final

- [ ] Login funciona no domínio do Vercel
- [ ] Abas de administração aparecem (papel admin)
- [ ] Tela **Usuários**: criar, remover e redefinir senha funcionam
- [ ] Telemetria do ESP32 chegando (prateleira sai de "offline")
- [ ] Ciclo manual e ciclo programado disparam
- [ ] Alerta de teste chega no Telegram
- [ ] Upload de firmware na aba **Atualização** funciona

## Observações importantes

- O ambiente de preview no Lovable continua ligado ao banco atual. O banco da sua conta passa a valer só para o Vercel. Os dois **não** se sincronizam.
- A chave `TELEGRAM_API_KEY` do bot continua sendo uma variável de ambiente no Vercel; não é afetada pela migração.
- E-mails de autenticação (recuperação de senha) passam a sair pelo provedor do seu projeto Supabase. Para uso real, configure SMTP próprio em **Authentication → Emails → SMTP**.
- Se você tiver dúvida em algum passo, me mande a mensagem de erro exata que eu ajudo a interpretar.
