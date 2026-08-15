ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS reset_reason text,
  ADD COLUMN IF NOT EXISTS uptime_s integer,
  ADD COLUMN IF NOT EXISTS heap_min integer,
  ADD COLUMN IF NOT EXISTS wifi_reconexoes integer,
  ADD COLUMN IF NOT EXISTS rssi integer;

DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean, boolean, boolean, integer);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid, _device_token text, _status text, _valvulas jsonb,
  _proximo_ciclo_segundos integer, _firmware_version text, _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean,
  _rtc_bateria_fraca boolean DEFAULT NULL::boolean,
  _rtc_hora_perdida boolean DEFAULT NULL::boolean,
  _rtc_desvio_segundos integer DEFAULT NULL::integer,
  _reset_reason text DEFAULT NULL::text,
  _uptime_s integer DEFAULT NULL::integer,
  _heap_min integer DEFAULT NULL::integer,
  _wifi_reconexoes integer DEFAULT NULL::integer,
  _rssi integer DEFAULT NULL::integer
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean;
  v_config jsonb;
  v_version integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_token'; END IF;

  IF NOT public.check_rate_limit(_bancada_id, 60) THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF _temperatura_planta IS NOT NULL
     AND (_temperatura_planta >= 85 OR _temperatura_planta <= -10) THEN
    _temperatura_planta := NULL;
    _temperatura_valida := false;
  END IF;

  INSERT INTO public.bancada_telemetry_debug (
    bancada_id, status, firmware_version, ip_local,
    temperatura_planta, temperatura_valida, sensor_travado,
    sensor_reinicios, valvulas, proximo_ciclo_segundos
  ) VALUES (
    _bancada_id, _status, _firmware_version, _ip_local,
    _temperatura_planta, _temperatura_valida, _sensor_travado,
    _sensor_reinicios, _valvulas, _proximo_ciclo_segundos
  );

  DELETE FROM public.bancada_telemetry_debug d
   WHERE d.bancada_id = _bancada_id
     AND d.id NOT IN (
       SELECT x.id FROM public.bancada_telemetry_debug x
        WHERE x.bancada_id = _bancada_id
        ORDER BY x.received_at DESC LIMIT 50
     );

  IF _temperatura_planta IS NOT NULL
     AND (_temperatura_valida IS NULL OR _temperatura_valida IS TRUE) THEN
    INSERT INTO public.medicoes_temperatura (bancada_id, valor, minuto)
    VALUES (_bancada_id, _temperatura_planta, date_trunc('minute', now()))
    ON CONFLICT (bancada_id, minuto) DO NOTHING;
    IF random() < 0.01 THEN
      DELETE FROM public.medicoes_temperatura WHERE minuto < now() - interval '90 days';
    END IF;
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta ELSE temperatura_planta END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         rtc_bateria_fraca = COALESCE(_rtc_bateria_fraca, rtc_bateria_fraca),
         rtc_hora_perdida = COALESCE(_rtc_hora_perdida, rtc_hora_perdida),
         rtc_desvio_segundos = COALESCE(_rtc_desvio_segundos, rtc_desvio_segundos),
         reset_reason = COALESCE(_reset_reason, reset_reason),
         uptime_s = COALESCE(_uptime_s, uptime_s),
         heap_min = COALESCE(_heap_min, heap_min),
         wifi_reconexoes = COALESCE(_wifi_reconexoes, wifi_reconexoes),
         rssi = COALESCE(_rssi, rssi),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN _temperatura_valida IS FALSE THEN true
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object('config', v_config, 'config_version', v_version);
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
  v_hist NUMERIC;
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
    v_hist   := GREATEST(COALESCE(r.histerese, 1), 0.5);
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
      -- Estado atual como ponto de partida (mantém o que já está aplicado).
      v_deseja_ligado := r.ligado;
      v_deseja_modo := r.modo_atual;
      v_deseja_setpoint := r.setpoint_atual;

      IF r.ligado AND r.modo_atual = 'cool' THEN
        -- Desliga o resfriamento só quando esfriou o suficiente (histerese).
        IF v_temp <= v_sp_max - v_hist THEN
          v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
        END IF;
      ELSIF r.ligado AND r.modo_atual = 'heat' THEN
        IF v_temp >= v_sp_min + v_hist THEN
          v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
        END IF;
      ELSE
        -- Desligado: só liga quando passa da faixa COM margem, evitando o
        -- liga/desliga em ping-pong quando a temperatura fica na borda.
        IF v_temp > v_sp_max + v_hist THEN
          v_deseja_ligado := true; v_deseja_modo := 'cool'; v_deseja_setpoint := v_sp_max;
        ELSIF v_temp < v_sp_min - v_hist AND r.suporta_aquecimento THEN
          v_deseja_ligado := true; v_deseja_modo := 'heat'; v_deseja_setpoint := v_sp_min;
        END IF;
      END IF;
    END IF;

    v_deve_enviar := (
      v_deseja_ligado IS DISTINCT FROM r.ligado
      OR v_deseja_modo IS DISTINCT FROM r.modo_atual
      OR (v_deseja_ligado AND v_deseja_setpoint IS DISTINCT FROM r.setpoint_atual)
    ) AND (
      r.ultimo_comando_em IS NULL
      OR r.ultimo_comando_em < now() - make_interval(secs => GREATEST(r.intervalo_min_comando_s, 300))
    );

    UPDATE public.ar_condicionados SET ultimo_temp_lida = v_temp WHERE id = r.id;

    IF v_deve_enviar THEN
      -- Não acumula fila: comandos de AC antigos ainda não entregues são
      -- descartados, senão a prateleira recebe um lote inteiro ao voltar.
      DELETE FROM public.comandos
       WHERE bancada_id = r.bancada_controladora_id
         AND tipo = 'AC_CONTROL'
         AND entregue_em IS NULL;

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