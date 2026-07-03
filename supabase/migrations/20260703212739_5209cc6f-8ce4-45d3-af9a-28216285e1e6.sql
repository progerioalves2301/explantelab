
-- bench_pair: troca pairing_code por credenciais reais
CREATE OR REPLACE FUNCTION public.bench_pair(_pairing_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret record;
BEGIN
  IF _pairing_code IS NULL OR length(_pairing_code) <> 6 THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT bancada_id, device_token, pairing_expires_at
    INTO v_secret
    FROM public.bancada_secrets
   WHERE pairing_code = _pairing_code
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF v_secret.pairing_expires_at IS NOT NULL AND v_secret.pairing_expires_at < now() THEN
    RAISE EXCEPTION 'expired_code';
  END IF;

  UPDATE public.bancada_secrets
     SET paired_at = COALESCE(paired_at, now()),
         pairing_code = NULL,
         pairing_expires_at = NULL
   WHERE bancada_id = v_secret.bancada_id;

  RETURN json_build_object(
    'bancada_id', v_secret.bancada_id,
    'device_token', v_secret.device_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bench_pair(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_pair(text) TO anon, authenticated;

-- bench_push_telemetry: recebe telemetria e devolve configuração
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text) TO anon, authenticated;

-- bench_pull_commands: retorna pendentes e marca entregues
CREATE OR REPLACE FUNCTION public.bench_pull_commands(
  _bancada_id uuid,
  _device_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  WITH pend AS (
    SELECT id, tipo, payload, created_at
      FROM public.comandos
     WHERE bancada_id = _bancada_id AND entregue_em IS NULL
     ORDER BY created_at ASC
     LIMIT 10
  ),
  upd AS (
    UPDATE public.comandos c
       SET entregue_em = now()
      FROM pend
     WHERE c.id = pend.id
    RETURNING c.id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(pend)::jsonb), '[]'::jsonb) INTO v_result FROM pend;

  RETURN jsonb_build_object('comandos', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.bench_pull_commands(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_pull_commands(uuid, text) TO anon, authenticated;
