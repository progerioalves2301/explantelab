
-- Revogar EXECUTE de funções internas (chamadas apenas por triggers, pg_cron ou outras funções SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.trigger_scheduled_cycles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_first_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_bancada_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.detectar_alertas() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ar_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_auditoria() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decidir_ar_condicionado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, integer) FROM PUBLIC, anon, authenticated;

-- has_role: mantém EXECUTE para authenticated (usado em políticas RLS), revoga do resto
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- bench_* continuam com EXECUTE para anon (ESP32 usa chave anon)
-- Nada a alterar nelas.

-- Tabelas internas: remover exposição no Data API
REVOKE ALL ON public.bancada_secrets FROM anon, authenticated;
REVOKE ALL ON public.bench_rate_state FROM anon, authenticated;
