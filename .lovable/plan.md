# Ponte para a tela de Usuários funcionar no seu domínio (Vercel)

## O que está acontecendo

A mensagem "Missing Supabase environment variable(s): SUPABASE_PUBLISHABLE_KEY" vem do **servidor** do Vercel: a tela de Usuários pede a lista de membros através de uma função de servidor, e essa função precisa das variáveis `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` configuradas no ambiente do Vercel. Sem elas, a função falha e o card fica vermelho.

Existem dois caminhos, e eles se somam:

## Caminho 1 — Configurar as variáveis (não precisa de código)

No Vercel, em Settings → Environment Variables (Production e Preview), adicionar:

```text
VITE_SUPABASE_URL             = https://ftfboqlapblxndizyaxy.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = <chave pública já enviada no chat>
VITE_SUPABASE_PROJECT_ID      = ftfboqlapblxndizyaxy
SUPABASE_URL                  = https://ftfboqlapblxndizyaxy.supabase.co
SUPABASE_PUBLISHABLE_KEY      = <a mesma chave pública>
```

Depois: **Redeploy**. Isso já resolve a mensagem de erro e a listagem/gestão de papéis.

## Caminho 2 — A "ponte" no código (o que eu implemento)

Para a tela não depender de variável de servidor nenhuma, faço a leitura e a gestão de papéis direto pelo navegador, usando a sessão do próprio admin (mesma proteção: as regras do banco continuam validando quem pode ver o quê).

Mudanças em `src/routes/_shell.usuarios.tsx`:

- Listar membros pelo navegador: chamada da função de banco `admin_listar_usuarios` + leitura de `user_roles` com o cliente público autenticado. A função já é `security definer` e só devolve dados se quem chama for admin.
- Usar a função de servidor apenas como plano B; se ela falhar por falta de variável, o resultado do navegador é usado e nenhuma mensagem de erro aparece.
- Conceder/remover papel também pelo navegador, com a mesma proteção de "nunca ficar sem admin".
- Mensagem clara e não alarmante nas três ações que **realmente** exigem a chave privilegiada: **criar usuário, remover usuário e redefinir senha**. Essas não têm ponte possível — a API de administração de contas do Auth só funciona com `SUPABASE_SERVICE_ROLE_KEY`, que não existe neste backend gerenciado (é o caminho do `MIGRACAO_SUPABASE.md`, migrando para um projeto Supabase da sua conta).

## Detalhes técnicos

- A ponte usa `supabase` de `@/integrations/supabase/client` (chave publicável + sessão persistida), portanto RLS se aplica como o usuário logado.
- Requer que a política de leitura de `user_roles` permita ao admin ler todos os papéis (via `has_role`). Verifico isso e, se faltar, proponho a migração correspondente antes de implementar.
- Nenhuma alteração no firmware, no dashboard ou nas outras abas.

## Resultado esperado

No seu domínio: aba Usuários carrega a equipe e permite trocar papéis, sem erro vermelho. Criar/remover usuário e redefinir senha seguem indisponíveis até a migração do banco para a sua conta Supabase.
