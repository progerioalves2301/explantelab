# Conectar o app a uma conta Supabase própria (migração manual)

Como o projeto já está no Lovable Cloud, não é possível "conectar" um Supabase externo pelo editor — a integração nativa não aparece nesse caso. O caminho para ter a chave `service_role` e liberar a gestão completa de usuários no Vercel é migrar o banco para um projeto Supabase da sua própria conta. Eu não posso acessar a sua conta (nem devo pedir senhas), mas posso deixar todos os arquivos e o guia prontos para você executar.

## O que será entregue

1. **Revisão e consolidação do `supabase/schema_completo.sql`**
   - Atualmente o script reflete as 54+ migrações na ordem, mas algumas tabelas principais são criadas sem colunas que só aparecem depois via `ALTER TABLE` (ex.: os campos de hardware profile da tabela `bancadas` e os campos de IR off/heat da tabela `ar_condicionados`).
   - O plano é reescrever as definições iniciais de `bancadas`, `ar_condicionados`, `mudas`, `balancas`, `sensores_co2` e outras tabelas afetadas para já incluírem todas as colunas finais, removendo os `ALTER TABLE` de adição de coluna que hoje estão no final do arquivo.
   - Manter a ordem de criação (tabelas referenciadas antes das que as referenciam), todos os GRANTs, RLS, funções, triggers, buckets e cron jobs.

2. **Atualização do `MIGRACAO_SUPABASE.md`**
   - Confirmar que o firmware de referência é o `v2.5.3` e os números de linha de `SUPABASE_URL`/`SUPABASE_ANON_KEY` estão corretos.
   - Adicionar a lista exata das abas que dependem de papel de admin (Usuários, Dados e exportação, Atualização) e como elas aparecem no Vercel.
   - Incluir instrução sobre como ativar `pg_cron` e `pg_net` no projeto Supabase antes de ligar os cron jobs.
   - Deixar explícito que o banco de preview do Lovable continua separado; o novo banco passa a valer só para o Vercel.

3. **Validação das políticas de acesso para o novo banco**
   - Garantir que `user_roles` tenha as políticas corretas para o usuário ler seus próprios papéis (a sidebar já caiu nesse caminho no Vercel).
   - Confirmar que as tabelas de hardware profile continuam acessíveis por admin/operador conforme as regras de RBAC.

4. **Nenhuma mudança no código de aplicação**
   - O app já lê tudo de variáveis de ambiente. A única diferença no Vercel serão as novas chaves apontando para o seu projeto Supabase.

## Como você usará depois

1. Cria um projeto novo e vazio no painel do Supabase.
2. Roda o `schema_completo.sql` inteiro no SQL Editor.
3. Ativa as extensões `pg_cron` e `pg_net` e roda o bloco de cron jobs no final do SQL (com seu domínio e anon key).
4. Copia URL, anon key e service role key para as variáveis de ambiente do Vercel (Production e Preview).
5. Redeploya no Vercel.
6. Cria o primeiro usuário no app — ele vira admin automaticamente pelo gatilho `assign_first_admin`.

## Pontos de atenção

- `SUPABASE_SERVICE_ROLE_KEY` é necessária apenas para criar/remover usuário e redefinir senha; ela só existe no seu próprio projeto Supabase.
- Os tokens dos ESP32 (`bancada_secrets`) precisam ser copiados ou cada prateleira precisa ser pareada de novo.
- O firmware ESP32 precisa ser atualizado com a nova URL e anon key (ou enviado via OTA).
- `TELEGRAM_API_KEY` continua sendo uma variável de ambiente no Vercel; não muda com a migração.
