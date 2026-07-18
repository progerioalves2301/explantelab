
-- =========================================
-- MUDAS
-- =========================================
CREATE TABLE public.mudas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador text NOT NULL,
  especie text,
  laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
  bancada_id uuid REFERENCES public.bancadas(id) ON DELETE SET NULL,
  data_inicio timestamptz NOT NULL DEFAULT now(),
  data_fim timestamptz,
  ativa boolean NOT NULL DEFAULT true,
  observacoes text,
  peso_inicial_g numeric(10,2),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (laboratorio_id, identificador)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mudas TO authenticated;
GRANT ALL ON public.mudas TO service_role;

ALTER TABLE public.mudas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mudas_select_auth" ON public.mudas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "mudas_write_operador_admin" ON public.mudas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE TRIGGER tg_mudas_updated_at
  BEFORE UPDATE ON public.mudas
  FOR EACH ROW EXECUTE FUNCTION public.tg_ar_updated_at();

CREATE TRIGGER tg_mudas_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.mudas
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditoria();

CREATE INDEX idx_mudas_lab ON public.mudas(laboratorio_id) WHERE ativa;
CREATE INDEX idx_mudas_bancada ON public.mudas(bancada_id) WHERE ativa;

-- =========================================
-- BALANCAS (1 dispositivo físico compartilhado por lab)
-- =========================================
CREATE TABLE public.balancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laboratorio_id uuid NOT NULL REFERENCES public.laboratorios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  device_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  fator_calibracao numeric(12,4) NOT NULL DEFAULT 1,
  tara_g numeric(10,2) NOT NULL DEFAULT 0,
  ultima_leitura_g numeric(10,2),
  ultima_sync timestamptz,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_token)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.balancas TO authenticated;
GRANT ALL ON public.balancas TO service_role;

ALTER TABLE public.balancas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "balancas_select_auth" ON public.balancas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "balancas_write_admin" ON public.balancas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_balancas_updated_at
  BEFORE UPDATE ON public.balancas
  FOR EACH ROW EXECUTE FUNCTION public.tg_ar_updated_at();

-- =========================================
-- MEDICOES DE PESO
-- =========================================
CREATE TABLE public.medicoes_peso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  muda_id uuid NOT NULL REFERENCES public.mudas(id) ON DELETE CASCADE,
  laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
  balanca_id uuid REFERENCES public.balancas(id) ON DELETE SET NULL,
  valor_g numeric(10,2) NOT NULL,
  medido_em timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'manual', -- manual | hx711
  operador_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicoes_peso TO authenticated;
GRANT ALL ON public.medicoes_peso TO service_role;

ALTER TABLE public.medicoes_peso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medicoes_peso_select_auth" ON public.medicoes_peso
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "medicoes_peso_write_operador_admin" ON public.medicoes_peso
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE INDEX idx_medicoes_peso_muda ON public.medicoes_peso(muda_id, medido_em DESC);
CREATE INDEX idx_medicoes_peso_lab ON public.medicoes_peso(laboratorio_id, medido_em DESC);

-- =========================================
-- Balança HX711: RPC pra ESP32 dedicado enviar leituras
-- =========================================
CREATE OR REPLACE FUNCTION public.scale_push_reading(
  _device_token text,
  _muda_identificador text,
  _valor_g numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balanca record;
  v_muda    record;
BEGIN
  SELECT id, laboratorio_id INTO v_balanca
    FROM public.balancas
   WHERE device_token = _device_token AND ativa;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;

  UPDATE public.balancas
     SET ultima_leitura_g = _valor_g,
         ultima_sync = now()
   WHERE id = v_balanca.id;

  IF _muda_identificador IS NULL OR length(_muda_identificador) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'stored', false, 'reason', 'sem muda associada');
  END IF;

  SELECT id INTO v_muda
    FROM public.mudas
   WHERE laboratorio_id = v_balanca.laboratorio_id
     AND identificador = _muda_identificador
     AND ativa
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'stored', false, 'reason', 'muda nao encontrada');
  END IF;

  INSERT INTO public.medicoes_peso (muda_id, laboratorio_id, balanca_id, valor_g, origem)
  VALUES (v_muda.id, v_balanca.laboratorio_id, v_balanca.id, _valor_g, 'hx711');

  RETURN jsonb_build_object('ok', true, 'stored', true, 'muda_id', v_muda.id);
END;
$$;

REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scale_push_reading(text, text, numeric) TO anon, authenticated, service_role;
