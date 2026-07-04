-- Alertas
CREATE TABLE public.alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('offline','temperatura','ciclo')),
  severidade text NOT NULL DEFAULT 'warning' CHECK (severidade IN ('warning','critical')),
  mensagem text NOT NULL,
  valor jsonb NOT NULL DEFAULT '{}'::jsonb,
  notificado_em timestamptz,
  resolvido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_abertos ON public.alertas(bancada_id, tipo) WHERE resolvido_em IS NULL;
CREATE INDEX idx_alertas_created ON public.alertas(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alertas TO authenticated;
GRANT ALL ON public.alertas TO service_role;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read alertas" ON public.alertas FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage alertas" ON public.alertas FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Destinos Telegram
CREATE TABLE public.alerta_destinos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL UNIQUE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerta_destinos TO authenticated;
GRANT ALL ON public.alerta_destinos TO service_role;
ALTER TABLE public.alerta_destinos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read destinos" ON public.alerta_destinos FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage destinos" ON public.alerta_destinos FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Config de alerta por bancada
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS temp_min numeric,
  ADD COLUMN IF NOT EXISTS temp_max numeric,
  ADD COLUMN IF NOT EXISTS offline_threshold_segundos integer NOT NULL DEFAULT 300;

-- Detecção
CREATE OR REPLACE FUNCTION public.detectar_alertas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  -- Offline
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
      format('Bancada "%s" está offline desde %s', r.nome, to_char(r.ultima_sync,'DD/MM HH24:MI')),
      jsonb_build_object('ultima_sync', r.ultima_sync));
    v_count := v_count + 1;
  END LOOP;

  -- Auto-resolver offline se voltou
  UPDATE public.alertas a
     SET resolvido_em = now()
    FROM public.bancadas b
   WHERE a.bancada_id = b.id
     AND a.tipo = 'offline' AND a.resolvido_em IS NULL
     AND b.ultima_sync >= now() - make_interval(secs => b.offline_threshold_segundos);

  -- Temperatura fora da faixa
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

  -- Auto-resolver temperatura
  UPDATE public.alertas a
     SET resolvido_em = now()
    FROM public.bancadas b
   WHERE a.bancada_id = b.id
     AND a.tipo = 'temperatura' AND a.resolvido_em IS NULL
     AND b.temperatura_planta IS NOT NULL
     AND (b.temp_min IS NULL OR b.temperatura_planta >= b.temp_min)
     AND (b.temp_max IS NULL OR b.temperatura_planta <= b.temp_max);

  -- Falha no ciclo: FORCE_CYCLE não entregue em 2 min
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
      format('Bancada "%s": comando de ciclo não confirmado', r.nome),
      jsonb_build_object('comando_criado_em', r.created_at));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detectar_alertas() TO service_role, authenticated;