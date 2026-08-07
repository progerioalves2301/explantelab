# Migração do banco para a sua conta Supabase

Objetivo: rodar o app no Vercel com **criar usuário, remover usuário e redefinir senha** funcionando. Isso exige a chave privilegiada (*service role*), que só existe em um projeto Supabase da sua própria conta.

---

## 1. Criar o projeto

1. Acesse o painel do Supabase e crie um projeto **novo e vazio** (região mais próxima do laboratório).
2. Anote a senha do banco (é pedida na criação).

## 2. Criar toda a estrutura

1. No projeto novo: **SQL Editor → New query**.
2. Cole o conteúdo **inteiro** de `supabase/schema_completo.sql` e clique **Run**.
   - Cria tabelas, GRANTs, RLS e todas as políticas
   - Cria o tipo `app_role` e as funções/triggers (telemetria do ESP32, pareamento, rate-limit, alertas, ar-condicionado, `has_role`, auditoria, primeiro admin)
   - Cria os buckets privados `firmware` e `lgpd-exports` e suas políticas
3. Se algum comando falhar, rode em partes: o arquivo está dividido por blocos comentados na ordem correta.

## 3. Habilitar os agendamentos (cron)

1. **Database → Extensions**: habilite `pg_cron` e `pg_net`.
2. Volte ao SQL Editor, copie o **bloco final** de `schema_completo.sql` (está comentado com `--`), remova os `--` e substitua:
   - `SEU_DOMINIO` → domínio do app publicado (ex.: `meuapp.vercel.app`)
   - `SUA_ANON_KEY` → chave *anon/publishable* do seu projeto
3. Rode. Isso liga: disparo dos ciclos programados, detecção de alertas (Telegram) e controle do ar-condicionado.

## 4. Pegar as chaves

No painel do seu projeto: **Settings → API**.

| Onde aparece | Usar como |
|---|---|
| Project URL | `VITE_SUPABASE_URL` e `SUPABASE_URL` |
| `anon` / publishable key | `VITE_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_PUBLISHABLE_KEY` |
| Reference ID (Settings → General) | `VITE_SUPABASE_PROJECT_ID` |
| `service_role` (secret) | `SUPABASE_SERVICE_ROLE_KEY` |

> A `service_role` é uma chave de administrador total. Coloque **somente** nas variáveis de servidor do Vercel. Nunca em variável com prefixo `VITE_`, nunca no firmware, nunca no código.

## 5. Configurar o Vercel

**Project → Settings → Environment Variables** (ambiente Production e Preview):

```text
VITE_SUPABASE_URL             = https://SEU-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = <anon/publishable>
VITE_SUPABASE_PROJECT_ID      = SEU-REF
SUPABASE_URL                  = https://SEU-REF.supabase.co
SUPABASE_PUBLISHABLE_KEY      = <anon/publishable>
SUPABASE_SERVICE_ROLE_KEY     = <service_role>
```

Depois faça **Redeploy** (variáveis novas só valem em build novo).

## 6. Autenticação

1. **Authentication → Providers → Email**: mantenha habilitado.
2. **Authentication → URL Configuration**: em *Site URL* coloque o domínio do Vercel; em *Redirect URLs* adicione `https://SEU-DOMINIO/*`.
3. Recuperação de senha por e-mail usa o remetente do seu projeto. Para uso real, configure SMTP próprio em **Authentication → Emails → SMTP** (o remetente padrão do Supabase tem limite baixo).

## 7. Criar o primeiro admin

O gatilho `assign_first_admin` promove **o primeiro usuário cadastrado** a administrador automaticamente.

1. Abra o app no Vercel e faça o cadastro com o seu e-mail.
2. Confirme o e-mail (ou, para agilizar, **Authentication → Users → Add user** com *Auto Confirm* marcado).
3. Entre: as abas de administração aparecem e a tela **Usuários** já cria/remove usuários e redefine senhas.

## 8. Copiar os dados atuais (opcional)

Exporte de cá e importe lá **nesta ordem** (respeita as dependências):

1. `laboratorios`
2. `bancadas` (prateleiras)
3. `bancada_secrets` (tokens dos ESP32)
4. `ar_condicionados`, `balancas`, `sensores_co2`
5. `mudas`
6. `medicoes_temperatura`, `medicoes_peso`, `medicoes_co2`
7. `alerta_destinos`, `app_settings`

No projeto novo: **Table Editor → tabela → Insert → Import data from CSV**.

Não migre: `auditoria`, `alertas`, `comandos`, `bancada_status_log`, `bancada_telemetry_debug`, `bench_rate_state` (histórico/efêmero) e nem os usuários — senhas não são exportáveis; recrie-os pela tela de Usuários.

## 9. Reapontar os ESP32

Em `firmware/bancada_esp32_v2_5_3/bancada_esp32_v2_5_3.ino`:

- **linha 64** — `SUPABASE_URL`: troque para `https://SEU-REF.supabase.co`
- **linha 65** — `SUPABASE_ANON_KEY`: troque para a chave *anon/publishable* do seu projeto

Recompile e grave (ou publique como atualização OTA na aba Atualização). Se você **não** copiou a tabela `bancada_secrets`, cada prateleira precisa ser pareada de novo com o código de 6 dígitos.

O certificado usado no *pinning* (ISRG Root X1) continua válido — o novo projeto também é Supabase.

## 10. Conferência final

- [ ] Login funciona no domínio do Vercel
- [ ] Abas de administração aparecem (papel admin)
- [ ] Tela **Usuários**: criar, remover e redefinir senha funcionam
- [ ] Telemetria do ESP32 chegando (prateleira sai de "offline")
- [ ] Ciclo manual e ciclo programado disparam
- [ ] Alerta de teste chega no Telegram
- [ ] Upload de firmware na aba Atualização

---

## Observações

- O ambiente de pré-visualização aqui no Lovable continua ligado ao banco atual; o banco da sua conta vale para o Vercel. Os dois **não** se sincronizam.
- O segredo `TELEGRAM_API_KEY` precisa ser configurado como variável de ambiente no Vercel também, com o mesmo valor do bot.
- Se as três ações de usuários mostrarem a mensagem "Esta ação exige a chave privilegiada do banco", é sinal de que `SUPABASE_SERVICE_ROLE_KEY` não chegou ao servidor — revise a variável e refaça o deploy.
