
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS temperatura_planta numeric;

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;
