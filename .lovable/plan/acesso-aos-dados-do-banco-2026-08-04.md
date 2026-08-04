# Acesso aos dados do banco

O banco é Postgres gerenciado pelo Lovable Cloud. Não há senha de banco nem string de conexão externa disponível neste tipo de projeto, então o caminho prático é dar a você exportação de dados dentro do próprio painel.

## O que será feito

Nova página **Dados / Exportação** (visível apenas para Administrador), com:

- Lista das principais tabelas do sistema (prateleiras, laboratórios, mudas, medições de temperatura, medições de peso, medições de CO2, alertas, comandos, auditoria).
- Seletor de período (7 / 30 / 90 dias / tudo) para as tabelas com histórico.
- Botão **Baixar CSV** por tabela, gerando o arquivo direto no navegador.
- Aviso de LGPD: exportações de tabelas com dados pessoais (usuários, auditoria) ficam registradas na auditoria.

## Detalhes técnicos

- Novo `src/lib/exportacao.functions.ts` com um server function `exportarTabela` protegido por `requireAdmin`, que valida o nome da tabela contra uma lista fechada e retorna as linhas em JSON.
- Conversão para CSV no cliente (escape de vírgulas/quebras de linha) e download via Blob.
- Nova rota `src/routes/_shell.dados.tsx` + item no menu lateral, exibido só para admin.
- Limite de 50.000 linhas por exportação para não travar o navegador.

## Fora do escopo

- Conexão direta via psql/DBeaver/Power BI: exigiria mover o projeto para uma conta Supabase própria. Se você quiser esse caminho, é uma decisão separada e posso explicar as implicações antes.
