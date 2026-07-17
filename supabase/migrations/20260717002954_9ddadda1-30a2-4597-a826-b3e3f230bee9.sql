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
  v_qtd INT;
  v_modo_desejado TEXT;
  v_setpoint_desejado NUMERIC;
  v_ligado_desejado BOOLEAN;
  v_deve_enviar BOOLEAN;
  v_raw JSONB;
BEGIN
  FOR r IN
    SELECT a.*, b.sensor_travado AS ctrl_travado
      FROM public.ar_condicionados a
      LEFT JOIN public.bancadas b ON b.id = a.bancada_controladora_id
     WHERE a.ativo = true
       AND a.bancada_controladora_id IS NOT NULL
  LOOP
    IF r.ctrl_travado IS TRUE THEN CONTINUE; END IF;

    IF r.agregacao = 'media' THEN
      SELECT AVG(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL
         AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSE
      SELECT MAX(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL
         AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    END IF;

    IF v_qtd = 0 OR v_temp IS NULL THEN
      v_modo_desejado := 'off'; v_setpoint_desejado := NULL;
    ELSIF v_temp > r.setpoint_max THEN
      v_modo_desejado := 'cool';
      v_setpoint_desejado := GREATEST(16, LEAST(30, r.setpoint_min + 1));
    ELSIF v_temp < r.setpoint_min THEN
      IF r.suporta_aquecimento THEN
        v_modo_desejado := 'heat';
        v_setpoint_desejado := GREATEST(16, LEAST(30, r.setpoint_max - 1));
      ELSE
        v_modo_desejado := 'off'; v_setpoint_desejado := NULL;
      END IF;
    ELSE
      IF r.modo_atual = 'cool' AND v_temp < (r.setpoint_max - r.histerese) THEN
        v_modo_desejado := 'off'; v_setpoint_desejado := NULL;
      ELSIF r.modo_atual = 'heat' AND v_temp > (r.setpoint_min + r.histerese) THEN
        v_modo_desejado := 'off'; v_setpoint_desejado := NULL;
      ELSE
        v_modo_desejado := r.modo_atual; v_setpoint_desejado := r.setpoint_atual;
      END IF;
    END IF;

    v_ligado_desejado := (v_modo_desejado <> 'off');

    v_deve_enviar := (
      v_modo_desejado IS DISTINCT FROM r.modo_atual
      OR (v_ligado_desejado AND v_setpoint_desejado IS DISTINCT FROM r.setpoint_atual)
    ) AND (
      r.ultimo_comando_em IS NULL
      OR r.ultimo_comando_em < now() - make_interval(secs => r.intervalo_min_comando_s)
    );

    UPDATE public.ar_condicionados SET ultimo_temp_lida = v_temp WHERE id = r.id;

    IF v_deve_enviar THEN
      -- Escolhe o RAW conforme o modo alvo. Se está desligando, manda o RAW
      -- do modo que estava ativo (o pulso costuma ser toggle igual pros dois).
      v_raw := CASE
        WHEN v_modo_desejado = 'heat' THEN r.codigo_ir_raw_heat
        WHEN v_modo_desejado = 'cool' THEN r.codigo_ir_raw
        WHEN r.modo_atual = 'heat' THEN r.codigo_ir_raw_heat
        ELSE r.codigo_ir_raw
      END;

      INSERT INTO public.comandos (bancada_id, tipo, payload)
      VALUES (
        r.bancada_controladora_id,
        'AC_CONTROL',
        jsonb_build_object(
          'acao', CASE WHEN v_ligado_desejado THEN 'on' ELSE 'off' END,
          'modo', v_modo_desejado,
          'setpoint', v_setpoint_desejado,
          'protocolo', r.ir_protocol,
          'ar_id', r.id,
          'raw', v_raw
        )
      );

      UPDATE public.ar_condicionados
         SET ligado = v_ligado_desejado,
             modo_atual = v_modo_desejado,
             setpoint_atual = v_setpoint_desejado,
             ultimo_comando_em = now()
       WHERE id = r.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;