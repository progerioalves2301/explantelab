
-- Colunas novas
ALTER TABLE public.ar_condicionados
  ADD COLUMN IF NOT EXISTS suporta_aquecimento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codigo_ir_raw_heat jsonb,
  ADD COLUMN IF NOT EXISTS modo_atual text NOT NULL DEFAULT 'off'
    CHECK (modo_atual IN ('off','cool','heat'));

-- RPC para gravar código IR de aquecimento
CREATE OR REPLACE FUNCTION public.bench_ir_save_raw_heat(_ar_id uuid, _bancada_id uuid, _device_token text, _raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
     SET codigo_ir_raw_heat = _raw,
         updated_at         = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true, 'pulsos', jsonb_array_length(_raw));
END;
$$;

-- Lógica de decisão dual-mode (frio + quente)
CREATE OR REPLACE FUNCTION public.decidir_ar_condicionado()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INT := 0;
  r RECORD;
  v_temp NUMERIC;
  v_qtd INT;
  v_deseja_ligado BOOLEAN;
  v_deseja_modo TEXT;
  v_deseja_setpoint NUMERIC;
  v_deve_enviar BOOLEAN;
  v_raw jsonb;
BEGIN
  FOR r IN
    SELECT a.*, b.sensor_travado AS ctrl_travado
      FROM public.ar_condicionados a
      LEFT JOIN public.bancadas b ON b.id = a.bancada_controladora_id
     WHERE a.ativo = true
       AND a.bancada_controladora_id IS NOT NULL
  LOOP
    IF r.ctrl_travado IS TRUE THEN
      CONTINUE;
    END IF;

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

    IF v_qtd = 0 OR v_temp IS NULL THEN
      v_deseja_ligado := false;
      v_deseja_modo := 'off';
      v_deseja_setpoint := NULL;
    ELSE
      -- Quente/Frio com histerese
      IF v_temp > r.setpoint_max THEN
        v_deseja_ligado := true;
        v_deseja_modo := 'cool';
        v_deseja_setpoint := GREATEST(16, LEAST(30, r.setpoint_min + 1));
      ELSIF v_temp < r.setpoint_min AND r.suporta_aquecimento THEN
        v_deseja_ligado := true;
        v_deseja_modo := 'heat';
        v_deseja_setpoint := GREATEST(16, LEAST(30, r.setpoint_max - 1));
      ELSIF v_temp < r.setpoint_min AND NOT r.suporta_aquecimento THEN
        -- Só-frio: desliga se está frio demais
        v_deseja_ligado := false;
        v_deseja_modo := 'off';
        v_deseja_setpoint := NULL;
      ELSE
        -- Zona morta: mantém estado atual
        v_deseja_ligado := r.ligado;
        v_deseja_modo := r.modo_atual;
        v_deseja_setpoint := r.setpoint_atual;
      END IF;

      -- Saída da zona quente com histerese: só desliga heat quando subir bem
      IF r.ligado AND r.modo_atual = 'heat' AND v_temp >= r.setpoint_min + r.histerese THEN
        v_deseja_ligado := false;
        v_deseja_modo := 'off';
        v_deseja_setpoint := NULL;
      END IF;
      IF r.ligado AND r.modo_atual = 'cool' AND v_temp <= r.setpoint_max - r.histerese THEN
        v_deseja_ligado := false;
        v_deseja_modo := 'off';
        v_deseja_setpoint := NULL;
      END IF;
    END IF;

    v_deve_enviar := (
      v_deseja_ligado IS DISTINCT FROM r.ligado
      OR v_deseja_modo IS DISTINCT FROM r.modo_atual
      OR (v_deseja_ligado AND v_deseja_setpoint IS DISTINCT FROM r.setpoint_atual)
    ) AND (
      r.ultimo_comando_em IS NULL
      OR r.ultimo_comando_em < now() - make_interval(secs => r.intervalo_min_comando_s)
    );

    UPDATE public.ar_condicionados
       SET ultimo_temp_lida = v_temp
     WHERE id = r.id;

    IF v_deve_enviar THEN
      v_raw := CASE WHEN v_deseja_modo = 'heat' THEN r.codigo_ir_raw_heat ELSE r.codigo_ir_raw END;

      INSERT INTO public.comandos (bancada_id, tipo, payload)
      VALUES (
        r.bancada_controladora_id,
        'AC_CONTROL',
        jsonb_build_object(
          'acao', CASE WHEN v_deseja_ligado THEN 'on' ELSE 'off' END,
          'modo', COALESCE(v_deseja_modo, 'cool'),
          'setpoint', v_deseja_setpoint,
          'protocolo', r.ir_protocol,
          'ar_id', r.id,
          'raw', v_raw
        )
      );

      UPDATE public.ar_condicionados
         SET ligado = v_deseja_ligado,
             modo_atual = COALESCE(v_deseja_modo, 'off'),
             setpoint_atual = v_deseja_setpoint,
             ultimo_comando_em = now()
       WHERE id = r.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
