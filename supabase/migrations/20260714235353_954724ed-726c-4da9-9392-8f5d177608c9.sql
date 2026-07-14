
ALTER TABLE public.ar_condicionados
  ADD COLUMN IF NOT EXISTS codigo_ir_raw jsonb;

-- RPC chamada pelo ESP32 (autenticado via anon key + device_token da bancada).
-- Grava o array de microsegundos capturado do controle no ar correspondente,
-- desde que a bancada que está enviando seja a bancada_controladora daquele AC.
CREATE OR REPLACE FUNCTION public.bench_ir_save_raw(
  _ar_id uuid,
  _bancada_id uuid,
  _device_token text,
  _raw jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_ok boolean;
  v_owner    uuid;
BEGIN
  IF _raw IS NULL OR jsonb_typeof(_raw) <> 'array' OR jsonb_array_length(_raw) < 12 THEN
    RAISE EXCEPTION 'raw invalido';
  END IF;

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
     SET codigo_ir_raw = _raw,
         updated_at    = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true, 'pulsos', jsonb_array_length(_raw));
END;
$$;

GRANT EXECUTE ON FUNCTION public.bench_ir_save_raw(uuid, uuid, text, jsonb) TO anon, authenticated, service_role;
