CREATE TABLE public.medicoes_balanca (
  id bigserial PRIMARY KEY,
  balanca_id uuid NOT NULL REFERENCES public.balancas(id) ON DELETE CASCADE,
  valor_g numeric NOT NULL,
  amostras integer NOT NULL DEFAULT 1,
  minuto timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (balanca_id, minuto)
);

CREATE INDEX idx_medicoes_balanca_balanca_minuto
  ON public.medicoes_balanca (balanca_id, minuto DESC);

GRANT SELECT ON public.medicoes_balanca TO authenticated;
GRANT ALL ON public.medicoes_balanca TO service_role;

ALTER TABLE public.medicoes_balanca ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem ler medicoes_balanca"
  ON public.medicoes_balanca FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.scale_push_reading(_device_token text, _muda_identificador text, _valor_g numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Histórico agregado por minuto (média incremental), sempre gravado.
  INSERT INTO public.medicoes_balanca (balanca_id, valor_g, amostras, minuto)
  VALUES (b.id, _valor_g, 1, date_trunc('minute', now()))
  ON CONFLICT (balanca_id, minuto) DO UPDATE
    SET valor_g = (public.medicoes_balanca.valor_g * public.medicoes_balanca.amostras + EXCLUDED.valor_g)
                  / (public.medicoes_balanca.amostras + 1),
        amostras = public.medicoes_balanca.amostras + 1;

  IF random() < 0.01 THEN
    DELETE FROM public.medicoes_balanca WHERE minuto < now() - interval '90 days';
  END IF;

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
$function$;