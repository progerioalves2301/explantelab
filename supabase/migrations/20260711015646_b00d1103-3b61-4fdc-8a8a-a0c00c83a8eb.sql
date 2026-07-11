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

  -- v2.1.6: se a internet ficou fora, o ESP32 já dispara/retoma o ciclo
  -- localmente pelo RTC. Não entregar FORCE_CYCLE automático antigo depois da
  -- reconexão, para não reiniciar o ciclo do zero.
  UPDATE public.comandos
     SET entregue_em = now()
   WHERE bancada_id = _bancada_id
     AND entregue_em IS NULL
     AND tipo = 'FORCE_CYCLE'
     AND payload->>'source' = 'scheduler'
     AND created_at < now() - interval '2 minutes';

  WITH pend AS (
    SELECT id, tipo, payload, created_at
      FROM public.comandos
     WHERE bancada_id = _bancada_id
       AND entregue_em IS NULL
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