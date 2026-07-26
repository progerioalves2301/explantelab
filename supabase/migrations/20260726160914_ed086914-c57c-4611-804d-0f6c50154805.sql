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
  v_sp_min NUMERIC;
  v_sp_max NUMERIC;
  v_deseja_ligado BOOLEAN;
  v_deseja_modo TEXT;
  v_deseja_setpoint NUMERIC;
  v_deve_enviar BOOLEAN;
  v_raw jsonb;
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
    IF r.ctrl_travado IS TRUE THEN CONTINUE; END IF;

    -- Faixa unificada: vem da prateleira controladora (mesma dos alertas).
    v_sp_min := r.ctrl_temp_min;
    v_sp_max := r.ctrl_temp_max;
    IF v_sp_min IS NULL OR v_sp_max IS NULL THEN
      CONTINUE; -- prateleira sem faixa configurada, não decide
    END IF;

    IF r.agregacao = 'media' THEN
      SELECT AVG(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSE
      SELECT MAX(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND temperatura_planta IS NOT NULL AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    END IF;

    IF v_qtd = 0 OR v_temp IS NULL THEN
      v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
    ELSE
      IF v_temp > v_sp_max THEN
        v_deseja_ligado := true; v_deseja_modo := 'cool';
        v_deseja_setpoint := v_sp_max;
      ELSIF v_temp < v_sp_min AND r.suporta_aquecimento THEN
        v_deseja_ligado := true; v_deseja_modo := 'heat';
        v_deseja_setpoint := v_sp_min;
      ELSIF v_temp < v_sp_min AND NOT r.suporta_aquecimento THEN
        v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
      ELSE
        v_deseja_ligado := r.ligado; v_deseja_modo := r.modo_atual; v_deseja_setpoint := r.setpoint_atual;
      END IF;

      IF r.ligado AND r.modo_atual = 'heat' AND v_temp >= v_sp_min + r.histerese THEN
        v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
      END IF;
      IF r.ligado AND r.modo_atual = 'cool' AND v_temp <= v_sp_max - r.histerese THEN
        v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
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

    UPDATE public.ar_condicionados SET ultimo_temp_lida = v_temp WHERE id = r.id;

    IF v_deve_enviar THEN
      v_raw := CASE WHEN v_deseja_modo = 'heat' THEN r.codigo_ir_raw_heat ELSE r.codigo_ir_raw END;
      INSERT INTO public.comandos (bancada_id, tipo, payload)
      VALUES (
        r.bancada_controladora_id, 'AC_CONTROL',
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
         SET ligado = v_deseja_ligado, modo_atual = COALESCE(v_deseja_modo, 'off'),
             setpoint_atual = v_deseja_setpoint, ultimo_comando_em = now()
       WHERE id = r.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;