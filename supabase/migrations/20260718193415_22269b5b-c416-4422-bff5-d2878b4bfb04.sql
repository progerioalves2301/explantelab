CREATE TABLE public.sensores_co2 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  laboratorio_id UUID NOT NULL REFERENCES public.laboratorios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  device_token TEXT NOT NULL UNIQUE,
  ultima_leitura_ppm NUMERIC,
  ultima_medicao_em TIMESTAMPTZ,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sensores_co2 TO authenticated;
GRANT ALL ON public.sensores_co2 TO service_role;

ALTER TABLE public.sensores_co2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem sensores co2"
  ON public.sensores_co2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin e operador gerenciam sensores co2"
  ON public.sensores_co2 FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE OR REPLACE FUNCTION public.set_updated_at_sensores_co2()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_sensores_co2_updated
  BEFORE UPDATE ON public.sensores_co2
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_sensores_co2();

CREATE TABLE public.medicoes_co2 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sensor_id UUID NOT NULL REFERENCES public.sensores_co2(id) ON DELETE CASCADE,
  laboratorio_id UUID NOT NULL REFERENCES public.laboratorios(id) ON DELETE CASCADE,
  ppm NUMERIC NOT NULL,
  medido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_medicoes_co2_lab_tempo ON public.medicoes_co2 (laboratorio_id, medido_em DESC);
CREATE INDEX idx_medicoes_co2_sensor_tempo ON public.medicoes_co2 (sensor_id, medido_em DESC);

GRANT SELECT, INSERT ON public.medicoes_co2 TO authenticated;
GRANT ALL ON public.medicoes_co2 TO service_role;

ALTER TABLE public.medicoes_co2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem medicoes co2"
  ON public.medicoes_co2 FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.co2_push_reading(
  _device_token TEXT,
  _ppm NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.medicoes_co2 (sensor_id, laboratorio_id, ppm)
    VALUES (v_sensor.id, v_sensor.laboratorio_id, _ppm);

  UPDATE public.sensores_co2
     SET ultima_leitura_ppm = _ppm,
         ultima_medicao_em = now()
   WHERE id = v_sensor.id;

  RETURN jsonb_build_object('ok', true, 'sensor_id', v_sensor.id);
END;
$$;

REVOKE ALL ON FUNCTION public.co2_push_reading(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.co2_push_reading(TEXT, NUMERIC) TO service_role;
