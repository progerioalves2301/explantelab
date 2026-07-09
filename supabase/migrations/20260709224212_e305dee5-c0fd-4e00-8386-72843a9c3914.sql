CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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
         temperatura_planta = CASE
           WHEN _temperatura_valida IS FALSE THEN NULL
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           ELSE COALESCE(_sensor_travado, sensor_travado)
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;