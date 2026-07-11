
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
     WHERE b.temperatura_planta IS NOT NULL
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
     AND b.temperatura_planta IS NOT NULL
     AND (b.temp_min IS NULL OR b.temperatura_planta >= b.temp_min)
     AND (b.temp_max IS NULL OR b.temperatura_planta <= b.temp_max);

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
