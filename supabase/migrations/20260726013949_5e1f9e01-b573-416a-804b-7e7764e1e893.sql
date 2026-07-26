ALTER TABLE public.ar_condicionados ADD COLUMN IF NOT EXISTS ir_learn_debug jsonb;

CREATE OR REPLACE FUNCTION public.bench_ir_debug(
  _ar_id uuid,
  _bancada_id uuid,
  _device_token text,
  _evento text,
  _pulsos int DEFAULT 0,
  _extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_ok boolean;
  v_owner    uuid;
BEGIN
  SELECT (device_token = _device_token) INTO v_token_ok
  FROM bancada_secrets WHERE bancada_id = _bancada_id;
  IF NOT COALESCE(v_token_ok, false) THEN
    RAISE EXCEPTION 'token invalido';
  END IF;

  SELECT bancada_controladora_id INTO v_owner
  FROM ar_condicionados WHERE id = _ar_id;
  IF v_owner IS NULL OR v_owner <> _bancada_id THEN
    RAISE EXCEPTION 'bancada nao controla este ar';
  END IF;

  UPDATE ar_condicionados
     SET ir_learn_debug = jsonb_build_object(
           'evento', _evento,
           'pulsos', COALESCE(_pulsos, 0),
           'extra',  COALESCE(_extra, '{}'::jsonb),
           'em',     now()
         ),
         updated_at = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bench_ir_debug(uuid, uuid, text, text, int, jsonb) TO anon, authenticated, service_role;