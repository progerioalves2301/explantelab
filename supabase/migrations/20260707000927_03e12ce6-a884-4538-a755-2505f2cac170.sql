
-- Adiciona luz_ligar / luz_desligar ao ciclo padrão e às bancadas existentes.
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"], "luz_ligar": "06:00", "luz_desligar": "18:00"}'::jsonb;

-- Backfill: injeta defaults nas bancadas que ainda não têm as chaves de luz.
UPDATE public.bancadas
   SET config = config
                || jsonb_build_object('luz_ligar',   COALESCE(config->>'luz_ligar',   '06:00'))
                || jsonb_build_object('luz_desligar', COALESCE(config->>'luz_desligar', '18:00'));

-- Backfill no default salvo em app_settings (se existir).
UPDATE public.app_settings
   SET value = value
               || jsonb_build_object('luz_ligar',   COALESCE(value->>'luz_ligar',   '06:00'))
               || jsonb_build_object('luz_desligar', COALESCE(value->>'luz_desligar', '18:00'))
 WHERE key = 'default_ciclo';
