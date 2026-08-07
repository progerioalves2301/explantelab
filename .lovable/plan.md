# Autonomia sem migrar nada

Premissa firme: **nenhum ESP32 é tocado**. Sem OTA, sem recompilar, sem janela de manutenção. Eles continuam gravando exatamente onde gravam hoje, 24h por dia.

O que muda é só o app: ele passa a rodar no seu Vercel, no seu domínio, com credenciais que estão na sua mão.

## Credenciais — o que existe e o que não existe

Você já pode ter, agora, as duas credenciais que o app precisa: a **URL do backend** e a **chave publicável (anon)**. Elas estão no arquivo de ambiente do projeto e servem para o app inteiro funcionar no Vercel.

A chave de serviço (`service_role`) e a senha do banco **não são acessíveis neste ambiente** — nem para mim. Então, em vez de o app depender delas, o plano é **remover essa dependência**.

## Passo 1 — Tirar a chave secreta do caminho

Hoje três abas dependem dela. Cada uma passa a funcionar só com a chave publicável:

- **Usuários**
  - *Redefinir senha*: passa a enviar o e-mail de redefinição pelo próprio serviço de autenticação.
  - *Criar usuário*: convite por e-mail — o admin informa e-mail e papel, o usuário define a senha ao aceitar, e o papel já vem pré-atribuído.
  - *Remover usuário*: função no banco, com privilégio próprio, liberada só para administradores, que apaga o usuário e seus papéis.
- **Dados e exportação**: gera os arquivos direto do banco com a sessão do próprio administrador.
- **Atualização (OTA)**: o link do firmware passa a ser assinado por função do banco.

Resultado: o app roda no Vercel sem uma única variável secreta.

## Passo 2 — Publicar no seu domínio

Configurar no Vercel apenas a URL e a chave publicável, mais o seu domínio. A partir daí você publica e opera o app por conta própria.

## Passo 3 — Seus dados sempre na sua mão

Uma rotina de exportação (leituras de temperatura, pesos, CO2, histórico de status, auditoria) em CSV, disponível na aba de exportação e executável quando você quiser. Assim o histórico nunca fica preso em um só lugar, mesmo sem migrar.

## O que fica para depois, sem prazo

A estrutura do seu Supabase já está criada (o `schema_completo.sql` rodou). Quando um dia houver manutenção física ou prateleira nova, aí sim se prepara o firmware com backend configurável. Não faz parte deste plano.

## Detalhes técnicos

- `src/routes/_shell.usuarios.tsx`: remover os contornos client-side atuais; `supabase.auth.resetPasswordForEmail` para senha, fluxo de convite por e-mail para criação, RPC `admin_remover_usuario` para exclusão.
- Migração nova: `admin_remover_usuario(uuid)` como `SECURITY DEFINER`, guardada por `has_role(auth.uid(),'admin')`, apagando de `auth.users` e `public.user_roles`; `GRANT EXECUTE` para `authenticated`.
- Nova rota pública `/reset-password` para concluir a redefinição de senha.
- `src/routes/_shell.atualizacao.tsx` e `_shell.dados.tsx`: substituir chamadas que exigem cliente admin por RPC/consulta com a sessão do usuário.
- Vercel: somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Firmware: nenhuma alteração.
