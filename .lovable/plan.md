## Fase 4 — Alertas e notificações via Telegram

### O que vai monitorar
- **Bancada offline**: `ultima_sync` há mais de N minutos (default 5)
- **Temperatura fora da faixa**: `temperatura_planta` fora do intervalo configurado por bancada
- **Falha no ciclo**: comando `FORCE_CYCLE` sem `entregue_em` após 2 minutos

### Banco de dados (1 migration)
- Tabela `alertas`: `id`, `bancada_id`, `tipo` (offline | temperatura | ciclo), `severidade` (warning | critical), `mensagem`, `valor` (jsonb), `resolvido_em`, `notificado_em`, `created_at`
- Tabela `alerta_destinos`: `id`, `chat_id` (Telegram), `nome`, `ativo` — admin gerencia
- Adicionar em `bancadas`: colunas `temp_min numeric`, `temp_max numeric`, `offline_threshold_segundos int default 300`
- RLS: leitura autenticada, escrita só admin. GRANTs completos.
- Função `detectar_alertas()` que insere linhas em `alertas` sem duplicar alertas ativos abertos por (bancada, tipo)

### Backend
- Server route pública `/api/public/hooks/check-alerts`: chama `detectar_alertas()`, lê alertas com `notificado_em IS NULL`, envia mensagem no Telegram para cada `chat_id` ativo, marca `notificado_em = now()`
- pg_cron rodando a cada 1 minuto chamando essa rota
- Conector Telegram do Lovable (usa `LOVABLE_API_KEY` + `TELEGRAM_API_KEY`, sem token exposto)

### UI
- Ícone de sino no header com badge de alertas abertos, dropdown com os últimos 5 e link "ver todos"
- Página `/alertas`: lista com filtros (tipo, status), botão "resolver"
- Página `/alertas/destinos` (admin): CRUD de chat_ids do Telegram + instruções de como obter o chat_id (falar com @userinfobot)
- Em cada card de bancada: campos de config de temp_min/temp_max/offline_threshold

### Pré-requisito do usuário
Conectar o Telegram na próxima etapa (link do conector). Depois o admin adiciona os chat_ids que devem receber os alertas.
