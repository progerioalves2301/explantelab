ALTER TABLE public.sensores_co2
  ADD COLUMN IF NOT EXISTS ultima_temperatura_c numeric,
  ADD COLUMN IF NOT EXISTS ultima_umidade_pct numeric,
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS ip_local text,
  ADD COLUMN IF NOT EXISTS ota_url text,
  ADD COLUMN IF NOT EXISTS ota_filename text,
  ADD COLUMN IF NOT EXISTS ota_solicitado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ota_entregue_em timestamptz;

ALTER TABLE public.medicoes_co2
  ADD COLUMN IF NOT EXISTS temperatura_c numeric,
  ADD COLUMN IF NOT EXISTS umidade_pct numeric;

CREATE OR REPLACE FUNCTION public.co2_push_reading(
  _device_token text,
  _ppm numeric,
  _temperatura_c numeric DEFAULT NULL,
  _umidade_pct numeric DEFAULT NULL,
  _firmware_version text DEFAULT NULL,
  _ip_local text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sensor public.sensores_co2%ROWTYPE;
BEGIN
  SELECT * INTO v_sensor FROM public.sensores_co2
   WHERE device_token = _device_token AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF _ppm IS NULL OR _ppm < 0 OR _ppm > 50000 THEN
    RAISE EXCEPTION 'invalid_ppm';
  END IF;

  IF _temperatura_c IS NOT NULL AND (_temperatura_c < -50 OR _temperatura_c > 125) THEN
    _temperatura_c := NULL;
  END IF;
  IF _umidade_pct IS NOT NULL AND (_umidade_pct < 0 OR _umidade_pct > 100) THEN
    _umidade_pct := NULL;
  END IF;

  INSERT INTO public.medicoes_co2 (sensor_id, laboratorio_id, ppm, temperatura_c, umidade_pct)
    VALUES (v_sensor.id, v_sensor.laboratorio_id, _ppm, _temperatura_c, _umidade_pct);

  UPDATE public.sensores_co2
     SET ultima_leitura_ppm = _ppm,
         ultima_medicao_em = now(),
         ultima_temperatura_c = COALESCE(_temperatura_c, ultima_temperatura_c),
         ultima_umidade_pct = COALESCE(_umidade_pct, ultima_umidade_pct),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local)
   WHERE id = v_sensor.id;

  RETURN jsonb_build_object('ok', true, 'sensor_id', v_sensor.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.co2_pull_commands(
  _device_token text,
  _firmware_version text DEFAULT NULL,
  _ip_local text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sensor public.sensores_co2%ROWTYPE;
BEGIN
  SELECT * INTO v_sensor FROM public.sensores_co2
   WHERE device_token = _device_token AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.sensores_co2
     SET firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local)
   WHERE id = v_sensor.id;

  IF v_sensor.ota_url IS NULL OR v_sensor.ota_solicitado_em IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- URL assinada vale 1 h; depois disso o comando é descartado.
  IF v_sensor.ota_solicitado_em < now() - interval '55 minutes' THEN
    UPDATE public.sensores_co2
       SET ota_url = NULL, ota_filename = NULL, ota_solicitado_em = NULL
     WHERE id = v_sensor.id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  UPDATE public.sensores_co2
     SET ota_entregue_em = now()
   WHERE id = v_sensor.id;

  RETURN jsonb_build_object(
    'ok', true,
    'ota', jsonb_build_object('url', v_sensor.ota_url, 'filename', v_sensor.ota_filename)
  );
END;
$function$;