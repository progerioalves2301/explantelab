ALTER TABLE public.ar_condicionados
  ADD COLUMN IF NOT EXISTS pendente_estado text,
  ADD COLUMN IF NOT EXISTS pendente_contagem integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS permanencia_min_s integer NOT NULL DEFAULT 600;

CREATE TABLE IF NOT EXISTS public.ar_decisoes_log (
  id bigserial PRIMARY KEY,
  ar_id uuid NOT NULL REFERENCES public.ar_condicionados(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  temperatura_ref numeric,
  origem text,
  temp_min numeric,
  temp_max numeric,
  histerese numeric,
  estado_atual text,
  decisao text,
  motivo text NOT NULL,
  comando_enviado boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ar_decisoes_log_ar_criado
  ON public.ar_decisoes_log (ar_id, criado_em DESC);

GRANT SELECT ON public.ar_decisoes_log TO authenticated;
GRANT ALL ON public.ar_decisoes_log TO service_role;

ALTER TABLE public.ar_decisoes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leem decisoes do ar" ON public.ar_decisoes_log;
CREATE POLICY "Autenticados leem decisoes do ar"
  ON public.ar_decisoes_log FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.decidir_ar_condicionado()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT := 0;
  r RECORD;
  v_temp NUMERIC;
  v_origem TEXT;
  v_sp_min NUMERIC;
  v_sp_max NUMERIC;
  v_hist NUMERIC;
  v_estado_atual TEXT;
  v_deseja_modo TEXT;
  v_deseja_ligado BOOLEAN;
  v_deseja_setpoint NUMERIC;
  v_contagem INT;
  v_raw jsonb;
  v_espera_s INT;
BEGIN
  FOR r IN
    SELECT a.*,
           b.sensor_travado AS ctrl_travado,
           b.temp_min AS ctrl_temp_min,
           b.temp_max AS ctrl_temp_max
      FROM public.ar_condicionados a
      LEFT JOIN public.bancadas b ON b.id = a.bancada_controladora_id
     WHERE a.ativo = true
       AND a.bancada_controladora_id IS NOT NULL
  LOOP
    v_estado_atual := CASE WHEN r.ligado THEN COALESCE(r.modo_atual, 'cool') ELSE 'off' END;
    v_sp_min := r.ctrl_temp_min;
    v_sp_max := r.ctrl_temp_max;
    v_hist   := GREATEST(COALESCE(r.histerese, 1), 0.5);

    IF r.ctrl_travado IS TRUE THEN
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, NULL, 'controladora', v_sp_min, v_sp_max, v_hist, v_estado_atual, v_estado_atual, 'sensor_travado_mantem_estado');
      CONTINUE;
    END IF;

    IF v_sp_min IS NULL OR v_sp_max IS NULL THEN
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, NULL, NULL, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_estado_atual, 'faixa_de_alerta_nao_configurada');
      CONTINUE;
    END IF;

    IF r.agregacao = 'controladora' THEN
      v_origem := 'prateleira controladora';
      SELECT temperatura_planta INTO v_temp
        FROM public.bancadas
       WHERE id = r.bancada_controladora_id
         AND tem_sensor_temp IS TRUE
         AND temperatura_planta IS NOT NULL
         AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSIF r.agregacao = 'media' THEN
      v_origem := 'média da sala';
      SELECT AVG(temperatura_planta) INTO v_temp
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND tem_sensor_temp IS TRUE
         AND temperatura_planta IS NOT NULL AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSE
      v_origem := 'máxima da sala';
      SELECT MAX(temperatura_planta) INTO v_temp
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND tem_sensor_temp IS TRUE
         AND temperatura_planta IS NOT NULL AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    END IF;

    -- Sem leitura recente: mantém o estado atual (nunca desliga por falta de dado).
    IF v_temp IS NULL THEN
      UPDATE public.ar_condicionados
         SET pendente_estado = NULL, pendente_contagem = 0
       WHERE id = r.id;
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, NULL, v_origem, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_estado_atual, 'sem_leitura_recente_mantem_estado');
      CONTINUE;
    END IF;

    -- Estado desejado
    v_deseja_modo := v_estado_atual;
    IF v_estado_atual = 'cool' THEN
      IF v_temp <= v_sp_max - v_hist THEN v_deseja_modo := 'off'; END IF;
    ELSIF v_estado_atual = 'heat' THEN
      IF v_temp >= v_sp_min + v_hist THEN v_deseja_modo := 'off'; END IF;
    ELSE
      IF v_temp > v_sp_max + v_hist THEN
        v_deseja_modo := 'cool';
      ELSIF v_temp < v_sp_min - v_hist AND r.suporta_aquecimento THEN
        v_deseja_modo := 'heat';
      END IF;
    END IF;

    UPDATE public.ar_condicionados SET ultimo_temp_lida = v_temp WHERE id = r.id;

    IF v_deseja_modo = v_estado_atual THEN
      UPDATE public.ar_condicionados
         SET pendente_estado = NULL, pendente_contagem = 0
       WHERE id = r.id;
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, v_temp, v_origem, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_estado_atual, 'dentro_da_faixa_sem_mudanca');
      CONTINUE;
    END IF;

    -- Confirmação: 3 leituras consecutivas pedindo a mesma mudança
    IF r.pendente_estado = v_deseja_modo THEN
      v_contagem := COALESCE(r.pendente_contagem, 0) + 1;
    ELSE
      v_contagem := 1;
    END IF;
    UPDATE public.ar_condicionados
       SET pendente_estado = v_deseja_modo, pendente_contagem = v_contagem
     WHERE id = r.id;

    IF v_contagem < 3 THEN
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, v_temp, v_origem, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_deseja_modo,
              format('aguardando_confirmacao_%s_de_3', v_contagem));
      CONTINUE;
    END IF;

    -- Intervalo mínimo entre comandos e permanência mínima no estado atual
    v_espera_s := GREATEST(COALESCE(r.intervalo_min_comando_s, 60), 60, COALESCE(r.permanencia_min_s, 600));
    IF r.ultimo_comando_em IS NOT NULL
       AND r.ultimo_comando_em > now() - make_interval(secs => v_espera_s) THEN
      INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo)
      VALUES (r.id, v_temp, v_origem, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_deseja_modo,
              format('aguardando_permanencia_minima_%ss', v_espera_s));
      CONTINUE;
    END IF;

    v_deseja_ligado := v_deseja_modo <> 'off';
    v_deseja_setpoint := CASE WHEN v_deseja_modo = 'cool' THEN v_sp_max
                              WHEN v_deseja_modo = 'heat' THEN v_sp_min
                              ELSE NULL END;

    DELETE FROM public.comandos
     WHERE bancada_id = r.bancada_controladora_id
       AND tipo = 'AC_CONTROL'
       AND entregue_em IS NULL;

    v_raw := CASE
               WHEN NOT v_deseja_ligado THEN r.codigo_ir_raw_off
               WHEN v_deseja_modo = 'heat' THEN r.codigo_ir_raw_heat
               ELSE r.codigo_ir_raw
             END;

    INSERT INTO public.comandos (bancada_id, tipo, payload)
    VALUES (
      r.bancada_controladora_id, 'AC_CONTROL',
      jsonb_build_object(
        'acao', CASE WHEN v_deseja_ligado THEN 'on' ELSE 'off' END,
        'modo', CASE WHEN v_deseja_modo = 'off' THEN 'cool' ELSE v_deseja_modo END,
        'setpoint', v_deseja_setpoint,
        'protocolo', r.ir_protocol,
        'ar_id', r.id,
        'raw', v_raw
      )
    );

    UPDATE public.ar_condicionados
       SET ligado = v_deseja_ligado,
           modo_atual = v_deseja_modo,
           setpoint_atual = v_deseja_setpoint,
           ultimo_comando_em = now(),
           pendente_estado = NULL,
           pendente_contagem = 0
     WHERE id = r.id;

    INSERT INTO public.ar_decisoes_log (ar_id, temperatura_ref, origem, temp_min, temp_max, histerese, estado_atual, decisao, motivo, comando_enviado)
    VALUES (r.id, v_temp, v_origem, v_sp_min, v_sp_max, v_hist, v_estado_atual, v_deseja_modo, 'comando_enviado', true);

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;