CREATE OR REPLACE FUNCTION public.scale_can_sample(_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_laboratorio_id uuid;
  v_qtd_ativas int;
  v_espera_ate timestamptz;
  v_motivo text;
BEGIN
  SELECT * INTO b
    FROM public.balancas
   WHERE device_token = _device_token AND ativa = true
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT laboratorio_id INTO v_laboratorio_id
    FROM public.bancadas
   WHERE id = b.bancada_associada_id;

  SELECT COUNT(*) INTO v_qtd_ativas
    FROM public.bancadas
   WHERE laboratorio_id = v_laboratorio_id
     AND status IN ('Injetando','Retornando','Pausado','Alivio');

  v_espera_ate := b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao);

  IF v_qtd_ativas > 0 THEN
    v_motivo := 'peso_ao_vivo_ciclo_ativo';
  ELSIF b.ultimo_ciclo_fim IS NOT NULL AND now() < v_espera_ate THEN
    v_motivo := 'peso_ao_vivo_estabilizando';
  ELSE
    v_motivo := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'amostrar', true,
    'motivo', v_motivo,
    'espera_ate', v_espera_ate,
    'minutos_estabilizacao', b.minutos_estabilizacao,
    'outlier_delta_g', b.outlier_delta_g,
    'residuo_ultimo_ciclo_g', b.residuo_ultimo_ciclo_g,
    'balanca_id', b.id,
    'laboratorio_id', v_laboratorio_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scale_can_sample(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scale_can_sample(text) TO service_role;