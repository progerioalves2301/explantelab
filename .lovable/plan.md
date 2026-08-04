# Migrar o backend para a sua conta Supabase

## Situação atual

Este projeto usa o backend gerenciado do Lovable Cloud. Ele **não pode ser desconectado** para colocar a sua conta no lugar — essa troca não é reversível nem suportada no projeto atual. O que dá para fazer é **reproduzir o backend inteiro na sua conta**, com schema e dados, e você passa a ter acesso total (dashboard, psql, backups).

Como você deixou a escolha comigo, vou pelo caminho mais seguro e sem quebrar nada que está rodando: **gerar um pacote de migração completo**. O app atual continua funcionando no Cloud enquanto você valida a sua cópia.

## O que será entregue

Uma pasta `migracao-supabase/` no projeto com:

1. `01_schema.sql` — recriação completa e na ordem correta:
   - tipo `app_role`
   - 22 tabelas (`bancadas`, `laboratorios`, `mudas`, `ar_condicionados`, `balancas`, `sensores_co2`, `medicoes_*`, `alertas`, `comandos`, `auditoria`, `user_roles`, `bancada_*`, `termos_aceites`, `solicitacoes_lgpd`, `app_settings`, `alerta_destinos`, `bench_rate_state`)
   - chaves estrangeiras, índices e defaults
   - GRANTs por tabela, RLS habilitado e todas as políticas atuais
2. `02_funcoes_triggers.sql` — as 24 funções do banco (telemetria das prateleiras, pareamento, aprendizado IR, `decidir_ar_condicionado`, `detectar_alertas`, balança, CO2, auditoria, `has_role`) e os triggers correspondentes.
3. `03_cron.sql` — os dois agendamentos de minuto: disparo de ciclos programados e verificação de alertas (o segundo aponta para uma URL do app, que você troca pela sua).
4. `04_storage.sql` — criação dos buckets privados `firmware` e `lgpd-exports` com as políticas de acesso.
5. `dados/*.csv` — export dos dados atuais de cada tabela, prontos para importar, com a ordem de carga documentada para não violar chaves estrangeiras.
6. `README.md` — passo a passo: aplicar os SQLs na ordem, importar os CSVs, recriar os usuários de autenticação, refazer os `device_token` das prateleiras/balanças/sensores e apontar o firmware ESP32 para a nova URL.

## Pontos que exigem atenção (estarão no README)

- **Usuários e senhas** de autenticação não são exportáveis; os usuários serão recriados na sua conta e os papéis (admin/operador/visualizador) reaplicados via `user_roles`.
- **Firmware ESP32**: cada dispositivo aponta para a URL e a chave pública do backend atual. Depois de migrar, é preciso atualizar essas duas constantes e reflashar/OTA. O pareamento por código de 6 dígitos continua funcionando.
- **Segredos** (Telegram, chave de IA) precisam ser cadastrados de novo no seu projeto.
- Enquanto os dois backends existirem, mantenha apenas um recebendo telemetria para não duplicar medições.

## Detalhes técnicos

O schema será extraído do catálogo atual (`pg_dump` lógico reconstruído por consulta), preservando `security definer` e `set search_path` nas funções, que são o que permite o ESP32 gravar telemetria sem login. Os CSVs saem via consultas de leitura, com corte opcional por período nas tabelas de medição (que são as maiores) para o arquivo não ficar gigante.
