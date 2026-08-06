ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS tem_sensor_temp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tem_luz boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tem_balanca boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_co2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS controla_ar boolean NOT NULL DEFAULT false;

UPDATE public.bancadas
   SET tem_sensor_temp = false
 WHERE temperatura_planta IS NULL
   AND COALESCE(sensor_reinicios, 0) = 0;

UPDATE public.bancadas b
   SET controla_ar = true
 WHERE EXISTS (
   SELECT 1 FROM public.ar_condicionados a
    WHERE a.bancada_controladora_id = b.id
 );

UPDATE public.bancadas b
   SET tem_balanca = true
 WHERE EXISTS (
   SELECT 1 FROM public.balancas x
    WHERE x.bancada_associada_id = b.id
 );

CREATE OR REPLACE FUNCTION public.detectar_alertas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT b.id, b.nome, b.ultima_sync, b.offline_threshold_segundos
      FROM public.bancadas b
     WHERE b.ultima_sync IS NOT NULL
       AND b.ultima_sync < now() - make_interval(secs => b.offline_threshold_segundos)
       AND NOT EXISTS (
         SELECT 1 FROM public.alertas a
          WHERE a.bancada_id = b.id AND a.tipo = 'offline' AND a.resolvido_em IS NULL
       )
  LOOP
    INSERT INTO public.alertas(bancada_id, tipo, severidade, mensagem, valor)
    VALUES (r.id, 'offline', 'critical',
      format('Bancada "%s" está offline desde %s', r.nome,
        to_char(timezone('America/Sao_Paulo', r.ultima_sync),'DD/MM HH24:MI')),
      jsonb_build_object('ultima_sync', r.ultima_sync));
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.alertas a
     SET resolvido_em = now()
    FROM public.bancadas b
   WHERE a.bancada_id = b.id
     AND a.tipo = 'offline' AND a.resolvido_em IS NULL
     AND b.ultima_sync >= now() - make_interval(secs => b.offline_threshold_segundos);

  FOR r IN
    SELECT b.id, b.nome, b.temperatura_planta, b.temp_min, b.temp_max
      FROM public.bancadas b
     WHERE b.tem_sensor_temp IS TRUE
       AND b.temperatura_planta IS NOT NULL
       AND (
         (b.temp_min IS NOT NULL AND b.temperatura_planta < b.temp_min) OR
         (b.temp_max IS NOT NULL AND b.temperatura_planta > b.temp_max)
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.alertas a
          WHERE a.bancada_id = b.id AND a.tipo = 'temperatura' AND a.resolvido_em IS NULL
       )
  LOOP
    INSERT INTO public.alertas(bancada_id, tipo, severidade, mensagem, valor)
    VALUES (r.id, 'temperatura', 'warning',
      format('Bancada "%s": temperatura %s°C fora da faixa (%s–%s)', r.nome, r.temperatura_planta, COALESCE(r.temp_min::text,'-'), COALESCE(r.temp_max::text,'-')),
      jsonb_build_object('temperatura', r.temperatura_planta, 'min', r.temp_min, 'max', r.temp_max));
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.alertas a
     SET resolvido_em = now()
    FROM public.bancadas b
   WHERE a.bancada_id = b.id
     AND a.tipo = 'temperatura' AND a.resolvido_em IS NULL
     AND (
       b.tem_sensor_temp IS NOT TRUE
       OR (
         b.temperatura_planta IS NOT NULL
         AND (b.temp_min IS NULL OR b.temperatura_planta >= b.temp_min)
         AND (b.temp_max IS NULL OR b.temperatura_planta <= b.temp_max)
       )
     );

  FOR r IN
    SELECT DISTINCT b.id, b.nome, c.created_at
      FROM public.comandos c
      JOIN public.bancadas b ON b.id = c.bancada_id
     WHERE c.tipo = 'FORCE_CYCLE'
       AND c.entregue_em IS NULL
       AND c.created_at < now() - interval '2 minutes'
       AND c.created_at > now() - interval '1 hour'
       AND NOT EXISTS (
         SELECT 1 FROM public.alertas a
          WHERE a.bancada_id = b.id AND a.tipo = 'ciclo' AND a.resolvido_em IS NULL
       )
  LOOP
    INSERT INTO public.alertas(bancada_id, tipo, severidade, mensagem, valor)
    VALUES (r.id, 'ciclo', 'critical',
      format('Bancada "%s": comando de ciclo não confirmado (criado %s)', r.nome,
        to_char(timezone('America/Sao_Paulo', r.created_at),'DD/MM HH24:MI')),
      jsonb_build_object('comando_criado_em', r.created_at));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

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

    v_sp_min := r.ctrl_temp_min;
    v_sp_max := r.ctrl_temp_max;
    IF v_sp_min IS NULL OR v_sp_max IS NULL THEN
      CONTINUE;
    END IF;

    IF r.agregacao = 'media' THEN
      SELECT AVG(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND tem_sensor_temp IS TRUE
         AND temperatura_planta IS NOT NULL AND sensor_travado IS NOT TRUE
         AND ultima_sync > now() - interval '3 minutes';
    ELSE
      SELECT MAX(temperatura_planta), COUNT(*) INTO v_temp, v_qtd
        FROM public.bancadas
       WHERE laboratorio_id = r.laboratorio_id
         AND tem_sensor_temp IS TRUE
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
      v_raw := CASE
                 WHEN NOT v_deseja_ligado THEN COALESCE(r.codigo_ir_raw_off, NULL)
                 WHEN v_deseja_modo = 'heat' THEN r.codigo_ir_raw_heat
                 ELSE r.codigo_ir_raw
               END;
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