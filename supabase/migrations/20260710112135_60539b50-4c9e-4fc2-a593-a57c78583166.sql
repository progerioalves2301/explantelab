
-- 1) Tabela ar_condicionados (1 por sala bioreator)
CREATE TABLE public.ar_condicionados (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  laboratorio_id UUID NOT NULL UNIQUE REFERENCES public.laboratorios(id) ON DELETE CASCADE,
  bancada_controladora_id UUID REFERENCES public.bancadas(id) ON DELETE SET NULL,
  marca TEXT NOT NULL DEFAULT 'LG',
  modelo TEXT,
  ir_protocol TEXT NOT NULL DEFAULT 'LG',
  ativo BOOLEAN NOT NULL DEFAULT true,
  setpoint_min NUMERIC(4,1) NOT NULL DEFAULT 22.0,
  setpoint_max NUMERIC(4,1) NOT NULL DEFAULT 26.0,
  histerese NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  intervalo_min_comando_s INT NOT NULL DEFAULT 180,
  agregacao TEXT NOT NULL DEFAULT 'maxima' CHECK (agregacao IN ('media','maxima')),
  ligado BOOLEAN NOT NULL DEFAULT false,
  setpoint_atual NUMERIC(4,1),
  ultimo_comando_em TIMESTAMPTZ,
  ultimo_temp_lida NUMERIC(4,1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ar_condicionados TO authenticated;
GRANT ALL ON public.ar_condicionados TO service_role;

ALTER TABLE public.ar_condicionados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth pode ler ar" ON public.ar_condicionados
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin pode gerenciar ar" ON public.ar_condicionados
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_ar_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_ar_updated_at BEFORE UPDATE ON public.ar_condicionados
  FOR EACH ROW EXECUTE FUNCTION public.tg_ar_updated_at();

-- 2) Função de decisão do ar-condicionado (chamada pelo cron)
CREATE OR REPLACE FUNCTION public.decidir_ar_condicionado()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
  v_temp NUMERIC;
  v_qtd INT;
  v_deseja_ligado BOOLEAN;
  v_deseja_setpoint NUMERIC;
  v_deve_enviar BOOLEAN;
BEGIN
  FOR r IN
    SELECT a.*, b.sensor_travado AS ctrl_travado
      FROM public.ar_condicionados a
      LEFT JOIN public.bancadas b ON b.id = a.bancada_controladora_id
     WHERE a.ativo = true
       AND a.bancada_controladora_id IS NOT NULL
  LOOP
    -- Falha para seguro: se controladora offline / sensor travado, pula
    IF r.ctrl_travado IS TRUE THEN
      CONTINUE;
    END IF;

    -- Agrega temperatura das bancadas da sala com telemetria recente e válida
    IF r.agregacao = 'media' THEN
      SELECT AVG(temperatura_planta), COUNT(*)
        INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL
         AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSE
      SELECT MAX(temperatura_planta), COUNT(*)
        INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL
         AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    END IF;

    -- Sala sem telemetria válida: força desligar (seguro)
    IF v_qtd = 0 OR v_temp IS NULL THEN
      v_deseja_ligado := false;
      v_deseja_setpoint := NULL;
    ELSE
      -- Lógica com histerese
      IF v_temp > r.setpoint_max THEN
        v_deseja_ligado := true;
        v_deseja_setpoint := GREATEST(16, LEAST(30, r.setpoint_min + 1));
      ELSIF v_temp < r.setpoint_min THEN
        v_deseja_ligado := false;
        v_deseja_setpoint := NULL;
      ELSE
        -- zona morta: mantém estado atual
        v_deseja_ligado := r.ligado;
        v_deseja_setpoint := r.setpoint_atual;
      END IF;
    END IF;

    -- Só envia se mudou E respeitou intervalo mínimo
    v_deve_enviar := (
      v_deseja_ligado IS DISTINCT FROM r.ligado
      OR (v_deseja_ligado AND v_deseja_setpoint IS DISTINCT FROM r.setpoint_atual)
    ) AND (
      r.ultimo_comando_em IS NULL
      OR r.ultimo_comando_em < now() - make_interval(secs => r.intervalo_min_comando_s)
    );

    -- Atualiza sempre o snapshot da temperatura lida
    UPDATE public.ar_condicionados
       SET ultimo_temp_lida = v_temp
     WHERE id = r.id;

    IF v_deve_enviar THEN
      INSERT INTO public.comandos (bancada_id, tipo, payload)
      VALUES (
        r.bancada_controladora_id,
        'AC_CONTROL',
        jsonb_build_object(
          'acao', CASE WHEN v_deseja_ligado THEN 'on' ELSE 'off' END,
          'modo', 'cool',
          'setpoint', v_deseja_setpoint,
          'protocolo', r.ir_protocol,
          'ar_id', r.id
        )
      );

      UPDATE public.ar_condicionados
         SET ligado = v_deseja_ligado,
             setpoint_atual = v_deseja_setpoint,
             ultimo_comando_em = now()
       WHERE id = r.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
