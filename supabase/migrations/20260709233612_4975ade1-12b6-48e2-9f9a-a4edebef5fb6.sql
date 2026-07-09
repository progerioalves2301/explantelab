CREATE TABLE public.bancada_telemetry_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text,
  firmware_version text,
  ip_local text,
  temperatura_planta numeric,
  temperatura_valida boolean,
  sensor_travado boolean,
  sensor_reinicios integer,
  valvulas jsonb,
  proximo_ciclo_segundos integer
);

GRANT ALL ON public.bancada_telemetry_debug TO service_role;

ALTER TABLE public.bancada_telemetry_debug ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages telemetry debug"
ON public.bancada_telemetry_debug
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX bancada_telemetry_debug_bancada_received_idx
ON public.bancada_telemetry_debug (bancada_id, received_at DESC);

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
    SELECT 1
      FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id
       AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  INSERT INTO public.bancada_telemetry_debug (
    bancada_id,
    status,
    firmware_version,
    ip_local,
    temperatura_planta,
    temperatura_valida,
    sensor_travado,
    sensor_reinicios,
    valvulas,
    proximo_ciclo_segundos
  ) VALUES (
    _bancada_id,
    _status,
    _firmware_version,
    _ip_local,
    _temperatura_planta,
    _temperatura_valida,
    _sensor_travado,
    _sensor_reinicios,
    _valvulas,
    _proximo_ciclo_segundos
  );

  DELETE FROM public.bancada_telemetry_debug d
   WHERE d.bancada_id = _bancada_id
     AND d.id NOT IN (
       SELECT x.id
         FROM public.bancada_telemetry_debug x
        WHERE x.bancada_id = _bancada_id
        ORDER BY x.received_at DESC
        LIMIT 50
     );

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN _temperatura_valida IS FALSE THEN true
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado
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

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;