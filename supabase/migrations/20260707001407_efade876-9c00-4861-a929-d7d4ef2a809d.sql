
-- 1) Coluna que reflete o estado atual das luzes (reportada pelo firmware)
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS luz_ligada boolean NOT NULL DEFAULT false;

-- 2) Novo default do ciclo com luz_janelas (lista de janelas HH:MM)
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"], "luz_janelas": [{"ligar":"06:00","desligar":"18:00"}]}'::jsonb;

-- 3) Backfill: converte luz_ligar/luz_desligar em luz_janelas quando ausente
UPDATE public.bancadas
   SET config = (config - 'luz_ligar' - 'luz_desligar')
                || jsonb_build_object(
                     'luz_janelas',
                     COALESCE(
                       config->'luz_janelas',
                       jsonb_build_array(
                         jsonb_build_object(
                           'ligar',    COALESCE(config->>'luz_ligar',   '06:00'),
                           'desligar', COALESCE(config->>'luz_desligar','18:00')
                         )
                       )
                     )
                   );

UPDATE public.app_settings
   SET value = (value - 'luz_ligar' - 'luz_desligar')
               || jsonb_build_object(
                    'luz_janelas',
                    COALESCE(
                      value->'luz_janelas',
                      jsonb_build_array(
                        jsonb_build_object(
                          'ligar',    COALESCE(value->>'luz_ligar',   '06:00'),
                          'desligar', COALESCE(value->>'luz_desligar','18:00')
                        )
                      )
                    )
                  )
 WHERE key = 'default_ciclo';

-- 4) Consolidar bench_push_telemetry num único overload com _luz_ligada opcional
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text);
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text,numeric);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL,
  _luz_ligada boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_ok boolean;
  v_config jsonb;
  v_version integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;
