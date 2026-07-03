
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Novo default sem intervalo_ciclo_horas, com horarios_disparo
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"]}'::jsonb;

-- Backfill: adiciona horarios_disparo padrão se ausente, remove intervalo_ciclo_horas
UPDATE public.bancadas
   SET config = (config - 'intervalo_ciclo_horas')
                || jsonb_build_object(
                     'horarios_disparo',
                     COALESCE(config->'horarios_disparo',
                              '["06:00","12:00","18:00","00:00"]'::jsonb)
                   );

-- Função executada pelo cron a cada minuto
CREATE OR REPLACE FUNCTION public.trigger_scheduled_cycles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now text := to_char(timezone('America/Sao_Paulo', now()), 'HH24:MI');
BEGIN
  INSERT INTO public.comandos (bancada_id, tipo, payload)
  SELECT b.id, 'FORCE_CYCLE', '{"source":"scheduler"}'::jsonb
    FROM public.bancadas b
   WHERE (b.config->'horarios_disparo') ? v_now
     AND NOT EXISTS (
       SELECT 1 FROM public.comandos c
        WHERE c.bancada_id = b.id
          AND c.tipo = 'FORCE_CYCLE'
          AND c.created_at > now() - interval '90 seconds'
     );
END;
$$;
