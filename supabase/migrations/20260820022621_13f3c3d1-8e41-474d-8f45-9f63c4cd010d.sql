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
  v_amostrar boolean;
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
    v_amostrar := false;
    v_motivo := 'ciclo_hidraulico_ativo';
  ELSIF b.ultimo_ciclo_fim IS NOT NULL AND now() < v_espera_ate THEN
    v_amostrar := false;
    v_motivo := 'aguardando_estabilizacao';
  ELSE
    v_amostrar := true;
    v_motivo := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'amostrar', v_amostrar,
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

CREATE OR REPLACE FUNCTION public.scale_push_reading(
  _device_token text,
  _muda_identificador text,
  _valor_g numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_muda RECORD;
  v_laboratorio_id uuid;
  v_qtd_ativas int;
  v_fase text;
  v_ultima numeric;
  v_delta numeric;
  v_media_residuo numeric;
BEGIN
  SELECT * INTO b FROM public.balancas
   WHERE device_token = _device_token AND ativa = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;

  SELECT laboratorio_id INTO v_laboratorio_id
    FROM public.bancadas
   WHERE id = b.bancada_associada_id;

  UPDATE public.balancas
     SET ultima_leitura_g = _valor_g, ultima_sync = now()
   WHERE id = b.id;

  SELECT COUNT(*) INTO v_qtd_ativas
    FROM public.bancadas
   WHERE laboratorio_id = v_laboratorio_id
     AND status IN ('Injetando','Retornando','Pausado','Alivio');
  IF v_qtd_ativas > 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ciclo_hidraulico_ativo');
  END IF;

  IF b.ultimo_ciclo_fim IS NOT NULL
     AND now() < b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'aguardando_estabilizacao');
  END IF;

  IF _muda_identificador IS NULL OR length(trim(_muda_identificador)) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'sem_muda_ativa');
  END IF;

  SELECT * INTO v_muda FROM public.mudas
   WHERE identificador = _muda_identificador
     AND laboratorio_id = v_laboratorio_id
     AND ativa = true
   ORDER BY data_inicio DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'muda_nao_encontrada');
  END IF;

  v_fase := 'Repouso';

  SELECT valor_g INTO v_ultima FROM public.medicoes_peso
   WHERE muda_id = v_muda.id
     AND medido_em > now() - interval '30 minutes'
   ORDER BY medido_em DESC LIMIT 1;
  IF v_ultima IS NOT NULL THEN
    v_delta := abs(_valor_g - v_ultima);
    IF v_delta > b.outlier_delta_g THEN
      RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'outlier', 'delta', v_delta);
    END IF;
  END IF;

  INSERT INTO public.medicoes_peso
    (muda_id, laboratorio_id, balanca_id, valor_g, origem, fase_bancada, residuo_estimado_g)
  VALUES
    (v_muda.id, v_laboratorio_id, b.id, _valor_g, 'hx711', v_fase, b.residuo_ultimo_ciclo_g);

  IF b.ultimo_ciclo_fim IS NOT NULL
     AND now() < b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao + 5) THEN
    SELECT AVG(valor_g) INTO v_media_residuo
      FROM public.medicoes_peso
     WHERE balanca_id = b.id
       AND medido_em >= b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao);
    UPDATE public.balancas
       SET residuo_ultimo_ciclo_g = COALESCE(v_media_residuo, _valor_g)
     WHERE id = b.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'gravado', true);
END;
$$;

REVOKE ALL ON FUNCTION public.scale_can_sample(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scale_can_sample(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.scale_push_reading(text, text, numeric) TO service_role;