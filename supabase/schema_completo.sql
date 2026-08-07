-- ============================================================
-- VitroCeres / Explante Lab - Script completo do banco de dados
-- Gerado a partir das migracoes do projeto (replay em ordem).
-- Rode este arquivo INTEIRO no SQL Editor de um projeto Supabase NOVO
-- (Database > SQL Editor > New query > cole > Run).
--
-- Requisitos antes de rodar:
--   1) Projeto Supabase novo e vazio
--   2) Nada mais: as extensoes usadas (pgcrypto/uuid) ja vem habilitadas
-- Depois de rodar, veja MIGRACAO_SUPABASE.md para chaves, cron e dados.
-- ============================================================

-- Buckets de Storage (privados)
INSERT INTO storage.buckets (id, name, public)
VALUES ('firmware', 'firmware', false), ('lgpd-exports', 'lgpd-exports', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Tabelas e funcoes criadas fora do fluxo de migrations
-- (rate-limit do ESP32, auditoria/LGPD)
-- ============================================================

-- Tabela de rate-limit das bancadas/prateleiras
CREATE TABLE IF NOT EXISTS public.bench_rate_state (
  bancada_id uuid NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  req_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS bench_rate_state_pkey ON public.bench_rate_state USING btree (bancada_id);
ALTER TABLE public.bench_rate_state ENABLE ROW LEVEL SECURITY;

-- Tabela de auditoria (LGPD)
CREATE TABLE IF NOT EXISTS public.auditoria (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid,
  usuario_email text,
  tabela text NOT NULL,
  operacao text NOT NULL,
  registro_id text,
  dados_anteriores jsonb,
  dados_novos jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS auditoria_pkey ON public.auditoria USING btree (id);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado_em ON public.auditoria USING btree (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_tabela ON public.auditoria USING btree (tabela);
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- Tabela de aceite dos termos (LGPD)
CREATE TABLE IF NOT EXISTS public.termos_aceites (
  user_id uuid NOT NULL,
  aceito_em timestamptz NOT NULL DEFAULT now(),
  versao text NOT NULL DEFAULT 'v1'
);
CREATE UNIQUE INDEX IF NOT EXISTS termos_aceites_pkey ON public.termos_aceites USING btree (user_id);
ALTER TABLE public.termos_aceites ENABLE ROW LEVEL SECURITY;

-- Funcao de rate-limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(_bancada_id uuid, _max integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE v_count int;
BEGIN
  INSERT INTO public.bench_rate_state (bancada_id, window_start, req_count)
  VALUES (_bancada_id, now(), 1)
  ON CONFLICT (bancada_id) DO UPDATE
    SET window_start = CASE WHEN bench_rate_state.window_start < now() - interval '1 minute'
                            THEN now() ELSE bench_rate_state.window_start END,
        req_count    = CASE WHEN bench_rate_state.window_start < now() - interval '1 minute'
                            THEN 1 ELSE bench_rate_state.req_count + 1 END
  RETURNING req_count INTO v_count;
  RETURN v_count <= _max;
END;
$function$;

-- Funcao de auditoria
CREATE OR REPLACE FUNCTION public.tg_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_reg_id text;
BEGIN
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  END IF;
  v_reg_id := COALESCE((to_jsonb(NEW)->>'id'), (to_jsonb(OLD)->>'id'));

  INSERT INTO public.auditoria(usuario_id, usuario_email, tabela, operacao, registro_id, dados_anteriores, dados_novos)
  VALUES (
    v_user_id, v_email, TG_TABLE_NAME, TG_OP, v_reg_id,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;



-- ============================================================
-- 20260703165327_b903ceaf-bf91-40e3-9bc8-22432f64837a.sql
-- ============================================================
CREATE TABLE public.bancadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'Offline',
  valvulas jsonb NOT NULL DEFAULT '{"v1":false,"v2":false,"v3":false,"v4":false,"v5":false}'::jsonb,
  ultima_sync timestamptz,
  proximo_ciclo_segundos integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{"tempo_injecao_segundos":150,"tempo_pausa_segundos":60,"tempo_retorno_segundos":150,"tempo_alivio_segundos":10,"intervalo_ciclo_horas":4}'::jsonb,
  config_version integer NOT NULL DEFAULT 1,
  firmware_version text,
  ip_local text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bancadas TO anon, authenticated;
GRANT ALL ON public.bancadas TO service_role;
ALTER TABLE public.bancadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read bancadas" ON public.bancadas FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.bancada_secrets (
  bancada_id uuid PRIMARY KEY REFERENCES public.bancadas(id) ON DELETE CASCADE,
  device_token text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bancada_secrets_token_idx ON public.bancada_secrets (device_token);
GRANT ALL ON public.bancada_secrets TO service_role;
ALTER TABLE public.bancada_secrets ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: só service_role acessa.

CREATE TABLE public.comandos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  entregue_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comandos_pendentes_idx ON public.comandos (bancada_id, entregue_em) WHERE entregue_em IS NULL;
GRANT SELECT ON public.comandos TO anon, authenticated;
GRANT ALL ON public.comandos TO service_role;
ALTER TABLE public.comandos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read comandos" ON public.comandos FOR SELECT TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.bancadas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comandos;


-- ============================================================
-- 20260703175743_fcc1b6d4-9d80-4660-8f65-123249d11fb2.sql
-- ============================================================
ALTER TABLE public.bancada_secrets
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS bancada_secrets_pairing_code_active_idx
  ON public.bancada_secrets (pairing_code)
  WHERE pairing_code IS NOT NULL;


-- ============================================================
-- 20260703212739_5209cc6f-8ce4-45d3-af9a-28216285e1e6.sql
-- ============================================================
-- bench_pair: troca pairing_code por credenciais reais
CREATE OR REPLACE FUNCTION public.bench_pair(_pairing_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret record;
BEGIN
  IF _pairing_code IS NULL OR length(_pairing_code) <> 6 THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT bancada_id, device_token, pairing_expires_at
    INTO v_secret
    FROM public.bancada_secrets
   WHERE pairing_code = _pairing_code
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  IF v_secret.pairing_expires_at IS NOT NULL AND v_secret.pairing_expires_at < now() THEN
    RAISE EXCEPTION 'expired_code';
  END IF;

  UPDATE public.bancada_secrets
     SET paired_at = COALESCE(paired_at, now()),
         pairing_code = NULL,
         pairing_expires_at = NULL
   WHERE bancada_id = v_secret.bancada_id;

  RETURN json_build_object(
    'bancada_id', v_secret.bancada_id,
    'device_token', v_secret.device_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bench_pair(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_pair(text) TO anon, authenticated;

-- bench_push_telemetry: recebe telemetria e devolve configuração
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_config jsonb;
  v_version integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text) TO anon, authenticated;

-- bench_pull_commands: retorna pendentes e marca entregues
CREATE OR REPLACE FUNCTION public.bench_pull_commands(
  _bancada_id uuid,
  _device_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  WITH pend AS (
    SELECT id, tipo, payload, created_at
      FROM public.comandos
     WHERE bancada_id = _bancada_id AND entregue_em IS NULL
     ORDER BY created_at ASC
     LIMIT 10
  ),
  upd AS (
    UPDATE public.comandos c
       SET entregue_em = now()
      FROM pend
     WHERE c.id = pend.id
    RETURNING c.id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(pend)::jsonb), '[]'::jsonb) INTO v_result FROM pend;

  RETURN jsonb_build_object('comandos', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.bench_pull_commands(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_pull_commands(uuid, text) TO anon, authenticated;


-- ============================================================
-- 20260703223026_39a52692-1481-47dc-a3fa-9acbfd0860bb.sql
-- ============================================================
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS temperatura_planta numeric;

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260703223946_d0d98bcb-f529-48e9-8285-620ebd4eb4c0.sql
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Novo default sem intervalo_ciclo_horas, com horarios_disparo
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"]}'::jsonb;

-- Backfill: adiciona horarios_disparo padrão se ausente, remove intervalo_ciclo_horas
UPDATE public.bancadas
   SET config = (config - 'intervalo_ciclo_horas')
                || jsonb_build_object(
                     'horarios_disparo',
                     COALESCE(config->'horarios_disparo',
                              '["06:00","12:00","18:00","00:00"]'::jsonb)
                   );

-- Função executada pelo cron a cada minuto
CREATE OR REPLACE FUNCTION public.trigger_scheduled_cycles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now text := to_char(timezone('America/Sao_Paulo', now()), 'HH24:MI');
BEGIN
  INSERT INTO public.comandos (bancada_id, tipo, payload)
  SELECT b.id, 'FORCE_CYCLE', '{"source":"scheduler"}'::jsonb
    FROM public.bancadas b
   WHERE (b.config->'horarios_disparo') ? v_now
     AND NOT EXISTS (
       SELECT 1 FROM public.comandos c
        WHERE c.bancada_id = b.id
          AND c.tipo = 'FORCE_CYCLE'
          AND c.created_at > now() - interval '90 seconds'
     );
END;
$$;


-- ============================================================
-- 20260703235919_2651760a-716d-41ad-a82c-1e07934c6992.sql
-- ============================================================
CREATE TABLE public.laboratorios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  cor text NOT NULL DEFAULT '#22c55e',
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.laboratorios TO anon, authenticated;
GRANT ALL ON public.laboratorios TO service_role;

ALTER TABLE public.laboratorios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read laboratorios"
  ON public.laboratorios FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.bancadas
  ADD COLUMN laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
  ADD COLUMN posicao integer;

CREATE INDEX bancadas_laboratorio_id_idx ON public.bancadas(laboratorio_id);


-- ============================================================
-- 20260704001415_602f152a-cdcb-4376-902e-3c902083b047.sql
-- ============================================================
-- 1. Enum de papéis
CREATE TYPE public.app_role AS ENUM ('admin', 'operador', 'visualizador');

-- 2. Tabela user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Função has_role (SECURITY DEFINER — evita recursão de RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. Policies user_roles
-- Cada usuário pode ver os próprios papéis
CREATE POLICY "usuário vê seus próprios papéis"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins veem todos os papéis
CREATE POLICY "admin vê todos os papéis"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Somente admins podem inserir/atualizar/deletar via Data API
CREATE POLICY "admin gerencia papéis"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Primeiro usuário cadastrado vira admin automaticamente
CREATE OR REPLACE FUNCTION public.assign_first_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    -- Novos usuários entram como visualizador por padrão
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'visualizador')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_assign_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.assign_first_admin();

-- 6. Restringir as tabelas de operação a papéis apropriados
-- laboratorios: admin gerencia
CREATE POLICY "admin gerencia laboratórios"
  ON public.laboratorios FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- bancadas: admin gerencia estrutura, operador pode atualizar comandos via server fn (service_role)
CREATE POLICY "admin gerencia bancadas"
  ON public.bancadas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- ============================================================
-- 20260704001432_c5fb300a-070e-42d6-9ff7-5d571a8289b8.sql
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.assign_first_admin() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 20260704004628_e40e4523-a135-4622-8e7d-0b43533c6c6b.sql
-- ============================================================
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


-- ============================================================
-- 20260704020851_f5b5e8c3-ca14-4c3a-977c-21164cc07fe4.sql
-- ============================================================
ALTER TABLE public.alertas ADD COLUMN IF NOT EXISTS notificado_resolucao_em timestamptz;


-- ============================================================
-- 20260704024459_c17cb9f5-97ba-42fd-b078-dc03f5d7f91c.sql
-- ============================================================
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS status_desde timestamptz DEFAULT now();

UPDATE public.bancadas
   SET status_desde = COALESCE(ultima_sync, created_at, now())
 WHERE status_desde IS NULL;

CREATE TABLE IF NOT EXISTS public.bancada_status_log (
  id bigserial PRIMARY KEY,
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bancada_status_log_bancada_time_idx
  ON public.bancada_status_log(bancada_id, changed_at DESC);

GRANT SELECT ON public.bancada_status_log TO authenticated;
GRANT ALL ON public.bancada_status_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bancada_status_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.bancada_status_log_id_seq TO service_role;

ALTER TABLE public.bancada_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read status log" ON public.bancada_status_log;
CREATE POLICY "auth read status log" ON public.bancada_status_log
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_bancada_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_desde := now();
    INSERT INTO public.bancada_status_log(bancada_id, status)
    VALUES (NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bancada_status_change ON public.bancadas;
CREATE TRIGGER trg_bancada_status_change
BEFORE UPDATE ON public.bancadas
FOR EACH ROW EXECUTE FUNCTION public.log_bancada_status_change();

INSERT INTO public.bancada_status_log(bancada_id, status, changed_at)
SELECT b.id, b.status, COALESCE(b.status_desde, b.ultima_sync, b.created_at, now())
  FROM public.bancadas b
 WHERE NOT EXISTS (
   SELECT 1 FROM public.bancada_status_log l WHERE l.bancada_id = b.id
 );


-- ============================================================
-- 20260705004204_bb27416a-d13d-42d7-868a-86f02241ee09.sql
-- ============================================================
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins write settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- ============================================================
-- 20260707000927_03e12ce6-a884-4538-a755-2505f2cac170.sql
-- ============================================================
-- Adiciona luz_ligar / luz_desligar ao ciclo padrão e às bancadas existentes.
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"], "luz_ligar": "06:00", "luz_desligar": "18:00"}'::jsonb;

-- Backfill: injeta defaults nas bancadas que ainda não têm as chaves de luz.
UPDATE public.bancadas
   SET config = config
                || jsonb_build_object('luz_ligar',   COALESCE(config->>'luz_ligar',   '06:00'))
                || jsonb_build_object('luz_desligar', COALESCE(config->>'luz_desligar', '18:00'));

-- Backfill no default salvo em app_settings (se existir).
UPDATE public.app_settings
   SET value = value
               || jsonb_build_object('luz_ligar',   COALESCE(value->>'luz_ligar',   '06:00'))
               || jsonb_build_object('luz_desligar', COALESCE(value->>'luz_desligar', '18:00'))
 WHERE key = 'default_ciclo';


-- ============================================================
-- 20260707001407_efade876-9c00-4861-a929-d7d4ef2a809d.sql
-- ============================================================
-- 1) Coluna que reflete o estado atual das luzes (reportada pelo firmware)
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS luz_ligada boolean NOT NULL DEFAULT false;

-- 2) Novo default do ciclo com luz_janelas (lista de janelas HH:MM)
ALTER TABLE public.bancadas
  ALTER COLUMN config SET DEFAULT
    '{"tempo_pausa_segundos": 60, "tempo_alivio_segundos": 10, "tempo_injecao_segundos": 150, "tempo_retorno_segundos": 150, "horarios_disparo": ["06:00","12:00","18:00","00:00"], "luz_janelas": [{"ligar":"06:00","desligar":"18:00"}]}'::jsonb;

-- 3) Backfill: converte luz_ligar/luz_desligar em luz_janelas quando ausente
UPDATE public.bancadas
   SET config = (config - 'luz_ligar' - 'luz_desligar')
                || jsonb_build_object(
                     'luz_janelas',
                     COALESCE(
                       config->'luz_janelas',
                       jsonb_build_array(
                         jsonb_build_object(
                           'ligar',    COALESCE(config->>'luz_ligar',   '06:00'),
                           'desligar', COALESCE(config->>'luz_desligar','18:00')
                         )
                       )
                     )
                   );

UPDATE public.app_settings
   SET value = (value - 'luz_ligar' - 'luz_desligar')
               || jsonb_build_object(
                    'luz_janelas',
                    COALESCE(
                      value->'luz_janelas',
                      jsonb_build_array(
                        jsonb_build_object(
                          'ligar',    COALESCE(value->>'luz_ligar',   '06:00'),
                          'desligar', COALESCE(value->>'luz_desligar','18:00')
                        )
                      )
                    )
                  )
 WHERE key = 'default_ciclo';

-- 4) Consolidar bench_push_telemetry num único overload com _luz_ligada opcional
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text);
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text,numeric);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL,
  _luz_ligada boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260707013127_abecd2c2-88ca-48b4-bba4-f47b777a6645.sql
-- ============================================================
-- Adiciona coluna tem_rtc (indica se a bancada possui módulo DS3231)
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS tem_rtc boolean;

-- Recria bench_push_telemetry aceitando o novo parâmetro opcional _tem_rtc
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260709214159_e41dbb11-7312-481a-a8cf-9ede5bf9fd3e.sql
-- ============================================================
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS sensor_travado boolean,
  ADD COLUMN IF NOT EXISTS sensor_reinicios integer;

-- Drop overload antiga (10 args) e recria com sensor_travado/sensor_reinicios
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL,
  _luz_ligada boolean DEFAULT NULL,
  _tem_rtc boolean DEFAULT NULL,
  _sensor_travado boolean DEFAULT NULL,
  _sensor_reinicios integer DEFAULT NULL
) RETURNS json
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = COALESCE(_sensor_travado, sensor_travado),
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260709220425_c9ac4387-2a5f-43dd-b42f-8e21d5f4a379.sql
-- ============================================================
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean);
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_valida IS FALSE THEN NULL
           WHEN _temperatura_valida IS TRUE THEN _temperatura_planta
           ELSE COALESCE(_temperatura_planta, temperatura_planta)
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = COALESCE(_sensor_travado, sensor_travado),
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;


-- ============================================================
-- 20260709220644_915b267a-81fc-48cb-a49d-6005200627ce.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_valida IS FALSE THEN NULL
           WHEN _temperatura_valida IS TRUE THEN _temperatura_planta
           WHEN _temperatura_planta IS NULL AND _sensor_reinicios IS NOT NULL THEN NULL
           WHEN _temperatura_planta IS NULL AND COALESCE(_sensor_travado, false) THEN NULL
           ELSE COALESCE(_temperatura_planta, temperatura_planta)
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = COALESCE(_sensor_travado, sensor_travado),
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;

UPDATE public.bancadas
   SET temperatura_planta = NULL,
       sensor_travado = true
 WHERE temperatura_planta IS NOT NULL
   AND COALESCE(sensor_reinicios, 0) > 0;


-- ============================================================
-- 20260709224212_e305dee5-c0fd-4e00-8386-72843a9c3914.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_valida IS FALSE THEN NULL
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           ELSE COALESCE(_sensor_travado, sensor_travado)
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260709224323_11dd27f5-46f5-4c86-abd0-ecbf9543afc4.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = COALESCE(_temperatura_planta, temperatura_planta),
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN temperatura_planta IS NOT NULL THEN false
           ELSE COALESCE(_sensor_travado, sensor_travado)
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260709225005_0d5480b3-8622-471a-a3f7-e77b42af94f6.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN temperatura_planta IS NOT NULL THEN false
           ELSE COALESCE(_sensor_travado, sensor_travado)
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;


-- ============================================================
-- 20260709225549_53cd35eb-7ce9-4b94-ab58-450bda55350c.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_valida IS TRUE AND _temperatura_planta IS NOT NULL THEN _temperatura_planta
           WHEN _temperatura_valida IS NULL AND _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_valida IS TRUE AND _temperatura_planta IS NOT NULL THEN false
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text,numeric,boolean,boolean,boolean,integer,boolean)
  TO anon, authenticated, service_role;


-- ============================================================
-- 20260709233414_0881dbfc-dcdb-4c86-beca-5347ee682a04.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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
    SELECT 1
      FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id
       AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN _temperatura_valida IS FALSE THEN true
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;


-- ============================================================
-- 20260709233612_4975ade1-12b6-48e2-9f9a-a4edebef5fb6.sql
-- ============================================================
CREATE TABLE public.bancada_telemetry_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text,
  firmware_version text,
  ip_local text,
  temperatura_planta numeric,
  temperatura_valida boolean,
  sensor_travado boolean,
  sensor_reinicios integer,
  valvulas jsonb,
  proximo_ciclo_segundos integer
);

GRANT ALL ON public.bancada_telemetry_debug TO service_role;

ALTER TABLE public.bancada_telemetry_debug ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages telemetry debug"
ON public.bancada_telemetry_debug
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX bancada_telemetry_debug_bancada_received_idx
ON public.bancada_telemetry_debug (bancada_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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
    SELECT 1
      FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id
       AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  INSERT INTO public.bancada_telemetry_debug (
    bancada_id,
    status,
    firmware_version,
    ip_local,
    temperatura_planta,
    temperatura_valida,
    sensor_travado,
    sensor_reinicios,
    valvulas,
    proximo_ciclo_segundos
  ) VALUES (
    _bancada_id,
    _status,
    _firmware_version,
    _ip_local,
    _temperatura_planta,
    _temperatura_valida,
    _sensor_travado,
    _sensor_reinicios,
    _valvulas,
    _proximo_ciclo_segundos
  );

  DELETE FROM public.bancada_telemetry_debug d
   WHERE d.bancada_id = _bancada_id
     AND d.id NOT IN (
       SELECT x.id
         FROM public.bancada_telemetry_debug x
        WHERE x.bancada_id = _bancada_id
        ORDER BY x.received_at DESC
        LIMIT 50
     );

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN _temperatura_valida IS FALSE THEN true
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bench_push_telemetry(uuid, text, text, jsonb, integer, text, text, numeric, boolean, boolean, boolean, integer, boolean) TO service_role;


-- ============================================================
-- 20260710112135_60539b50-4c9e-4fc2-a593-a57c78583166.sql
-- ============================================================
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


-- ============================================================
-- 20260711012624_6ec73393-d36e-439e-a3f5-b2d28e5b9e3f.sql
-- ============================================================
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


-- ============================================================
-- 20260711015646_b00d1103-3b61-4fdc-8a8a-a0c00c83a8eb.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_pull_commands(
  _bancada_id uuid,
  _device_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  -- v2.1.6: se a internet ficou fora, o ESP32 já dispara/retoma o ciclo
  -- localmente pelo RTC. Não entregar FORCE_CYCLE automático antigo depois da
  -- reconexão, para não reiniciar o ciclo do zero.
  UPDATE public.comandos
     SET entregue_em = now()
   WHERE bancada_id = _bancada_id
     AND entregue_em IS NULL
     AND tipo = 'FORCE_CYCLE'
     AND payload->>'source' = 'scheduler'
     AND created_at < now() - interval '2 minutes';

  WITH pend AS (
    SELECT id, tipo, payload, created_at
      FROM public.comandos
     WHERE bancada_id = _bancada_id
       AND entregue_em IS NULL
     ORDER BY created_at ASC
     LIMIT 10
  ),
  upd AS (
    UPDATE public.comandos c
       SET entregue_em = now()
      FROM pend
     WHERE c.id = pend.id
    RETURNING c.id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(pend)::jsonb), '[]'::jsonb) INTO v_result FROM pend;

  RETURN jsonb_build_object('comandos', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.bench_pull_commands(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bench_pull_commands(uuid, text) TO anon, authenticated;


-- ============================================================
-- 20260714235353_954724ed-726c-4da9-9392-8f5d177608c9.sql
-- ============================================================
ALTER TABLE public.ar_condicionados
  ADD COLUMN IF NOT EXISTS codigo_ir_raw jsonb;

-- RPC chamada pelo ESP32 (autenticado via anon key + device_token da bancada).
-- Grava o array de microsegundos capturado do controle no ar correspondente,
-- desde que a bancada que está enviando seja a bancada_controladora daquele AC.
CREATE OR REPLACE FUNCTION public.bench_ir_save_raw(
  _ar_id uuid,
  _bancada_id uuid,
  _device_token text,
  _raw jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
     SET codigo_ir_raw = _raw,
         updated_at    = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true, 'pulsos', jsonb_array_length(_raw));
END;
$$;

GRANT EXECUTE ON FUNCTION public.bench_ir_save_raw(uuid, uuid, text, jsonb) TO anon, authenticated, service_role;


-- ============================================================
-- 20260715004414_948e7bc8-d44e-46ef-b097-931878ecba52.sql
-- ============================================================
ALTER TABLE public.ar_condicionados DROP CONSTRAINT IF EXISTS ar_condicionados_laboratorio_id_key;


-- ============================================================
-- 20260717002859_09643e69-0533-4480-807d-c1e68df8b1e8.sql
-- ============================================================
-- Novas colunas
ALTER TABLE public.ar_condicionados
  ADD COLUMN IF NOT EXISTS suporta_aquecimento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codigo_ir_raw_heat jsonb,
  ADD COLUMN IF NOT EXISTS modo_atual text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ar_condicionados_modo_atual_check'
  ) THEN
    ALTER TABLE public.ar_condicionados
      ADD CONSTRAINT ar_condicionados_modo_atual_check
      CHECK (modo_atual IN ('off','cool','heat'));
  END IF;
END $$;

-- Substitui a função de decisão para suportar COOL + HEAT com histerese.
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
  v_modo_desejado TEXT;      -- 'off' | 'cool' | 'heat'
  v_setpoint_desejado NUMERIC;
  v_ligado_desejado BOOLEAN;
  v_deve_enviar BOOLEAN;
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
      v_modo_desejado := 'off';
      v_setpoint_desejado := NULL;
    ELSIF v_temp > r.setpoint_max THEN
      -- Quente demais → resfriar
      v_modo_desejado := 'cool';
      v_setpoint_desejado := GREATEST(16, LEAST(30, r.setpoint_min + 1));
    ELSIF v_temp < r.setpoint_min THEN
      -- Frio demais → aquecer (só se o ar suporta)
      IF r.suporta_aquecimento THEN
        v_modo_desejado := 'heat';
        v_setpoint_desejado := GREATEST(16, LEAST(30, r.setpoint_max - 1));
      ELSE
        v_modo_desejado := 'off';
        v_setpoint_desejado := NULL;
      END IF;
    ELSE
      -- Dentro da zona morta: se estava resfriando e caiu abaixo de (max - histerese) → desliga;
      -- se estava aquecendo e passou de (min + histerese) → desliga; senão mantém.
      IF r.modo_atual = 'cool' AND v_temp < (r.setpoint_max - r.histerese) THEN
        v_modo_desejado := 'off';
        v_setpoint_desejado := NULL;
      ELSIF r.modo_atual = 'heat' AND v_temp > (r.setpoint_min + r.histerese) THEN
        v_modo_desejado := 'off';
        v_setpoint_desejado := NULL;
      ELSE
        v_modo_desejado := r.modo_atual;
        v_setpoint_desejado := r.setpoint_atual;
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

    UPDATE public.ar_condicionados
       SET ultimo_temp_lida = v_temp
     WHERE id = r.id;

    IF v_deve_enviar THEN
      INSERT INTO public.comandos (bancada_id, tipo, payload)
      VALUES (
        r.bancada_controladora_id,
        'AC_CONTROL',
        jsonb_build_object(
          'acao', CASE WHEN v_ligado_desejado THEN 'on' ELSE 'off' END,
          'modo', v_modo_desejado,        -- 'off' | 'cool' | 'heat'
          'setpoint', v_setpoint_desejado,
          'protocolo', r.ir_protocol,
          'ar_id', r.id
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

-- Aprende IR para HEAT (separado do cool)
CREATE OR REPLACE FUNCTION public.bench_ir_save_raw_heat(_ar_id uuid, _bancada_id uuid, _device_token text, _raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         updated_at    = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true, 'pulsos', jsonb_array_length(_raw));
END;
$function$;


-- ============================================================
-- 20260717002954_9ddadda1-30a2-4597-a826-b3e3f230bee9.sql
-- ============================================================
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


-- ============================================================
-- 20260717003343_9add5a72-88de-458e-9e22-f1ba689692fa.sql
-- ============================================================
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


-- ============================================================
-- 20260717023050_91229910-92fb-42f0-9e83-7c033c26f682.sql
-- ============================================================
-- 1. bancadas: remover leitura pública
DROP POLICY IF EXISTS "public read bancadas" ON public.bancadas;
CREATE POLICY "auth read bancadas" ON public.bancadas
  FOR SELECT TO authenticated USING (true);

-- 2. laboratorios: remover leitura pública
DROP POLICY IF EXISTS "public read laboratorios" ON public.laboratorios;
CREATE POLICY "auth read laboratorios" ON public.laboratorios
  FOR SELECT TO authenticated USING (true);

-- 3. comandos: remover leitura pública, restringir a autenticados; permitir INSERT para operador/admin
DROP POLICY IF EXISTS "public read comandos" ON public.comandos;
CREATE POLICY "auth read comandos" ON public.comandos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "operador/admin insert comandos" ON public.comandos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
  );
CREATE POLICY "admin manage comandos" ON public.comandos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. alerta_destinos: apenas admin lê (contém chat_ids sensíveis)
DROP POLICY IF EXISTS "auth read destinos" ON public.alerta_destinos;
-- policy "admin manage destinos" (ALL) já cobre SELECT para admin

-- 5. app_settings: apenas admin lê
DROP POLICY IF EXISTS "authenticated read settings" ON public.app_settings;
-- policy "admins write settings" (ALL) já cobre SELECT para admin

-- 6. Storage: policies explícitas para bucket firmware
CREATE POLICY "admin read firmware" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin insert firmware" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin update firmware" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin delete firmware" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));


-- ============================================================
-- 20260717221258_91bd24ed-3158-4ceb-8585-9f5a89cec6c6.sql
-- ============================================================
-- 1) Tabela de séries temporais
CREATE TABLE public.medicoes_temperatura (
  id BIGSERIAL PRIMARY KEY,
  bancada_id UUID NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  valor NUMERIC(5,2) NOT NULL,
  minuto TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bancada_id, minuto)
);

GRANT SELECT ON public.medicoes_temperatura TO authenticated;
GRANT ALL ON public.medicoes_temperatura TO service_role;

ALTER TABLE public.medicoes_temperatura ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated leem histórico de temperatura"
  ON public.medicoes_temperatura
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_medicoes_temp_bancada_minuto
  ON public.medicoes_temperatura (bancada_id, minuto DESC);

CREATE INDEX idx_medicoes_temp_minuto
  ON public.medicoes_temperatura (minuto DESC);

-- 2) Atualiza bench_push_telemetry para gravar histórico (1 ponto/min) + purga 90d
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(
  _bancada_id uuid,
  _device_token text,
  _status text,
  _valvulas jsonb,
  _proximo_ciclo_segundos integer,
  _firmware_version text,
  _ip_local text,
  _temperatura_planta numeric DEFAULT NULL::numeric,
  _luz_ligada boolean DEFAULT NULL::boolean,
  _tem_rtc boolean DEFAULT NULL::boolean,
  _sensor_travado boolean DEFAULT NULL::boolean,
  _sensor_reinicios integer DEFAULT NULL::integer,
  _temperatura_valida boolean DEFAULT NULL::boolean
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
    SELECT 1
      FROM public.bancada_secrets
     WHERE bancada_id = _bancada_id
       AND device_token = _device_token
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_token';
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

  -- Grava ponto histórico de temperatura (1 por minuto)
  IF _temperatura_planta IS NOT NULL
     AND (_temperatura_valida IS NULL OR _temperatura_valida IS TRUE) THEN
    INSERT INTO public.medicoes_temperatura (bancada_id, valor, minuto)
    VALUES (_bancada_id, _temperatura_planta, date_trunc('minute', now()))
    ON CONFLICT (bancada_id, minuto) DO NOTHING;

    -- Purga oportunista: ~1% das inserções apaga pontos > 90 dias
    IF random() < 0.01 THEN
      DELETE FROM public.medicoes_temperatura
       WHERE minuto < now() - interval '90 days';
    END IF;
  END IF;

  UPDATE public.bancadas
     SET status = COALESCE(_status, status),
         valvulas = COALESCE(_valvulas, valvulas),
         proximo_ciclo_segundos = COALESCE(_proximo_ciclo_segundos, proximo_ciclo_segundos),
         firmware_version = COALESCE(_firmware_version, firmware_version),
         ip_local = COALESCE(_ip_local, ip_local),
         temperatura_planta = CASE
           WHEN _temperatura_planta IS NOT NULL THEN _temperatura_planta
           ELSE temperatura_planta
         END,
         luz_ligada = COALESCE(_luz_ligada, luz_ligada),
         tem_rtc = COALESCE(_tem_rtc, tem_rtc),
         sensor_travado = CASE
           WHEN _temperatura_planta IS NOT NULL THEN false
           WHEN _temperatura_valida IS FALSE THEN true
           WHEN _sensor_travado IS NOT NULL THEN _sensor_travado
           ELSE sensor_travado
         END,
         sensor_reinicios = COALESCE(_sensor_reinicios, sensor_reinicios),
         ultima_sync = now()
   WHERE id = _bancada_id
   RETURNING config, config_version INTO v_config, v_version;

  RETURN json_build_object(
    'config', v_config,
    'config_version', v_version
  );
END;
$function$;


-- ============================================================
-- 20260718142715_e698e991-3e60-45c4-b19b-44eaaaf5000c.sql
-- ============================================================
-- Revogar EXECUTE de funções internas (chamadas apenas por triggers, pg_cron ou outras funções SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.trigger_scheduled_cycles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_first_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_bancada_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.detectar_alertas() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ar_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_auditoria() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decidir_ar_condicionado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, integer) FROM PUBLIC, anon, authenticated;

-- has_role: mantém EXECUTE para authenticated (usado em políticas RLS), revoga do resto
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- bench_* continuam com EXECUTE para anon (ESP32 usa chave anon)
-- Nada a alterar nelas.

-- Tabelas internas: remover exposição no Data API
REVOKE ALL ON public.bancada_secrets FROM anon, authenticated;
REVOKE ALL ON public.bench_rate_state FROM anon, authenticated;


-- ============================================================
-- 20260718143500_370802b1-b0d1-445f-acf0-858ccf5430d6.sql
-- ============================================================
CREATE TABLE public.solicitacoes_lgpd (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('exportacao','exclusao','transferencia')),
  formato text CHECK (formato IN ('json','csv','pdf')),
  status text NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','falhou','pendente')),
  ip inet,
  storage_path text,
  detalhes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.solicitacoes_lgpd TO authenticated;
GRANT ALL ON public.solicitacoes_lgpd TO service_role;

ALTER TABLE public.solicitacoes_lgpd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Titular vê próprias solicitações"
  ON public.solicitacoes_lgpd FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Titular registra própria solicitação"
  ON public.solicitacoes_lgpd FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_solicitacoes_lgpd_user ON public.solicitacoes_lgpd(user_id, created_at DESC);

-- Storage: titular só lê arquivos da própria pasta em lgpd-exports (path = user_id/...)
CREATE POLICY "Titular lê próprios exports LGPD"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'lgpd-exports' AND (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================
-- 20260718191316_9027a105-4eb5-40b2-b3d0-60c8a7a451f1.sql
-- ============================================================
-- =========================================
-- MUDAS
-- =========================================
CREATE TABLE public.mudas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador text NOT NULL,
  especie text,
  laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
  bancada_id uuid REFERENCES public.bancadas(id) ON DELETE SET NULL,
  data_inicio timestamptz NOT NULL DEFAULT now(),
  data_fim timestamptz,
  ativa boolean NOT NULL DEFAULT true,
  observacoes text,
  peso_inicial_g numeric(10,2),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (laboratorio_id, identificador)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mudas TO authenticated;
GRANT ALL ON public.mudas TO service_role;

ALTER TABLE public.mudas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mudas_select_auth" ON public.mudas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "mudas_write_operador_admin" ON public.mudas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE TRIGGER tg_mudas_updated_at
  BEFORE UPDATE ON public.mudas
  FOR EACH ROW EXECUTE FUNCTION public.tg_ar_updated_at();

CREATE TRIGGER tg_mudas_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.mudas
  FOR EACH ROW EXECUTE FUNCTION public.tg_auditoria();

CREATE INDEX idx_mudas_lab ON public.mudas(laboratorio_id) WHERE ativa;
CREATE INDEX idx_mudas_bancada ON public.mudas(bancada_id) WHERE ativa;

-- =========================================
-- BALANCAS (1 dispositivo físico compartilhado por lab)
-- =========================================
CREATE TABLE public.balancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laboratorio_id uuid NOT NULL REFERENCES public.laboratorios(id) ON DELETE CASCADE,
  nome text NOT NULL,
  device_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  fator_calibracao numeric(12,4) NOT NULL DEFAULT 1,
  tara_g numeric(10,2) NOT NULL DEFAULT 0,
  ultima_leitura_g numeric(10,2),
  ultima_sync timestamptz,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_token)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.balancas TO authenticated;
GRANT ALL ON public.balancas TO service_role;

ALTER TABLE public.balancas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "balancas_select_auth" ON public.balancas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "balancas_write_admin" ON public.balancas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_balancas_updated_at
  BEFORE UPDATE ON public.balancas
  FOR EACH ROW EXECUTE FUNCTION public.tg_ar_updated_at();

-- =========================================
-- MEDICOES DE PESO
-- =========================================
CREATE TABLE public.medicoes_peso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  muda_id uuid NOT NULL REFERENCES public.mudas(id) ON DELETE CASCADE,
  laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
  balanca_id uuid REFERENCES public.balancas(id) ON DELETE SET NULL,
  valor_g numeric(10,2) NOT NULL,
  medido_em timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'manual', -- manual | hx711
  operador_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicoes_peso TO authenticated;
GRANT ALL ON public.medicoes_peso TO service_role;

ALTER TABLE public.medicoes_peso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medicoes_peso_select_auth" ON public.medicoes_peso
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "medicoes_peso_write_operador_admin" ON public.medicoes_peso
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));

CREATE INDEX idx_medicoes_peso_muda ON public.medicoes_peso(muda_id, medido_em DESC);
CREATE INDEX idx_medicoes_peso_lab ON public.medicoes_peso(laboratorio_id, medido_em DESC);

-- =========================================
-- Balança HX711: RPC pra ESP32 dedicado enviar leituras
-- =========================================
CREATE OR REPLACE FUNCTION public.scale_push_reading(
  _device_token text,
  _muda_identificador text,
  _valor_g numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balanca record;
  v_muda    record;
BEGIN
  SELECT id, laboratorio_id INTO v_balanca
    FROM public.balancas
   WHERE device_token = _device_token AND ativa;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;

  UPDATE public.balancas
     SET ultima_leitura_g = _valor_g,
         ultima_sync = now()
   WHERE id = v_balanca.id;

  IF _muda_identificador IS NULL OR length(_muda_identificador) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'stored', false, 'reason', 'sem muda associada');
  END IF;

  SELECT id INTO v_muda
    FROM public.mudas
   WHERE laboratorio_id = v_balanca.laboratorio_id
     AND identificador = _muda_identificador
     AND ativa
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'stored', false, 'reason', 'muda nao encontrada');
  END IF;

  INSERT INTO public.medicoes_peso (muda_id, laboratorio_id, balanca_id, valor_g, origem)
  VALUES (v_muda.id, v_balanca.laboratorio_id, v_balanca.id, _valor_g, 'hx711');

  RETURN jsonb_build_object('ok', true, 'stored', true, 'muda_id', v_muda.id);
END;
$$;

REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scale_push_reading(text, text, numeric) TO anon, authenticated, service_role;


-- ============================================================
-- 20260718193007_837b78af-2cd3-4803-8919-a6b8745b223a.sql
-- ============================================================
-- Balança: janela de estabilização e filtro
ALTER TABLE public.balancas
  ADD COLUMN IF NOT EXISTS minutos_estabilizacao integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS outlier_delta_g numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS bancada_associada_id uuid NULL REFERENCES public.bancadas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ultimo_ciclo_fim timestamptz NULL,
  ADD COLUMN IF NOT EXISTS residuo_ultimo_ciclo_g numeric NULL;

-- Medições: fase da bancada no momento e resíduo estimado
ALTER TABLE public.medicoes_peso
  ADD COLUMN IF NOT EXISTS fase_bancada text NULL,
  ADD COLUMN IF NOT EXISTS residuo_estimado_g numeric NULL;

-- Trigger que atualiza ultimo_ciclo_fim das balanças quando qualquer bancada
-- da mesma sala sai de Injetando/Retornando/Pausado para Repouso.
CREATE OR REPLACE FUNCTION public.tg_bancada_fim_ciclo_balanca()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Repouso'
     AND OLD.status IN ('Injetando','Retornando','Pausado','Alivio') THEN
    UPDATE public.balancas
       SET ultimo_ciclo_fim = now()
     WHERE laboratorio_id = NEW.laboratorio_id
       AND ativa = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_bancada_fim_ciclo_balanca ON public.bancadas;
CREATE TRIGGER tg_bancada_fim_ciclo_balanca
AFTER UPDATE OF status ON public.bancadas
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.tg_bancada_fim_ciclo_balanca();

-- RPC pública consumida pelo endpoint /api/public/scale/status:
-- decide se a balança pode amostrar agora considerando fase de todas as
-- bancadas da sala + janela de estabilização.
CREATE OR REPLACE FUNCTION public.scale_can_sample(_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_qtd_ativas int;
  v_espera_ate timestamptz;
  v_amostrar boolean;
  v_motivo text;
BEGIN
  SELECT * INTO b
    FROM public.balancas
   WHERE device_token = _device_token AND ativa = true
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT COUNT(*) INTO v_qtd_ativas
    FROM public.bancadas
   WHERE laboratorio_id = b.laboratorio_id
     AND status IN ('Injetando','Retornando','Pausado','Alivio');

  v_espera_ate := b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao);

  IF v_qtd_ativas > 0 THEN
    v_amostrar := false;
    v_motivo := 'ciclo_hidraulico_ativo';
  ELSIF b.ultimo_ciclo_fim IS NOT NULL AND now() < v_espera_ate THEN
    v_amostrar := false;
    v_motivo := 'aguardando_estabilizacao';
  ELSE
    v_amostrar := true;
    v_motivo := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'amostrar', v_amostrar,
    'motivo', v_motivo,
    'espera_ate', v_espera_ate,
    'minutos_estabilizacao', b.minutos_estabilizacao,
    'outlier_delta_g', b.outlier_delta_g,
    'residuo_ultimo_ciclo_g', b.residuo_ultimo_ciclo_g,
    'balanca_id', b.id,
    'laboratorio_id', b.laboratorio_id
  );
END;
$$;

-- Atualiza scale_push_reading:
--  - grava fase_bancada
--  - se ciclo ativo, rejeita amostra
--  - aplica outlier filter (compara com últimas leituras estáveis)
CREATE OR REPLACE FUNCTION public.scale_push_reading(
  _device_token text,
  _muda_identificador text,
  _valor_g numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_muda RECORD;
  v_qtd_ativas int;
  v_fase text;
  v_ultima numeric;
  v_delta numeric;
  v_media_residuo numeric;
BEGIN
  SELECT * INTO b FROM public.balancas
   WHERE device_token = _device_token AND ativa = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;

  UPDATE public.balancas
     SET ultima_leitura_g = _valor_g, ultima_sync = now()
   WHERE id = b.id;

  SELECT COUNT(*) INTO v_qtd_ativas
    FROM public.bancadas
   WHERE laboratorio_id = b.laboratorio_id
     AND status IN ('Injetando','Retornando','Pausado','Alivio');
  IF v_qtd_ativas > 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ciclo_hidraulico_ativo');
  END IF;

  IF b.ultimo_ciclo_fim IS NOT NULL
     AND now() < b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'aguardando_estabilizacao');
  END IF;

  IF _muda_identificador IS NULL OR length(trim(_muda_identificador)) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'sem_muda_ativa');
  END IF;

  SELECT * INTO v_muda FROM public.mudas
   WHERE identificador = _muda_identificador
     AND laboratorio_id = b.laboratorio_id
     AND ativa = true
   ORDER BY data_inicio DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'muda_nao_encontrada');
  END IF;

  v_fase := 'Repouso';

  -- Outlier filter: compara com última leitura da mesma muda dentro de 30 min.
  SELECT valor_g INTO v_ultima FROM public.medicoes_peso
   WHERE muda_id = v_muda.id
     AND medido_em > now() - interval '30 minutes'
   ORDER BY medido_em DESC LIMIT 1;
  IF v_ultima IS NOT NULL THEN
    v_delta := abs(_valor_g - v_ultima);
    IF v_delta > b.outlier_delta_g THEN
      RETURN jsonb_build_object('ok', true, 'gravado', false, 'motivo', 'outlier', 'delta', v_delta);
    END IF;
  END IF;

  INSERT INTO public.medicoes_peso
    (muda_id, laboratorio_id, balanca_id, valor_g, origem, fase_bancada, residuo_estimado_g)
  VALUES
    (v_muda.id, b.laboratorio_id, b.id, _valor_g, 'hx711', v_fase, b.residuo_ultimo_ciclo_g);

  -- Se é a primeira leitura pós-ciclo (dentro de +5 min da janela), registra
  -- como resíduo estimado do ciclo: média das próximas leituras estáveis não
  -- é trivial em SQL — usamos essa primeira leitura como proxy.
  IF b.ultimo_ciclo_fim IS NOT NULL
     AND now() < b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao + 5) THEN
    SELECT AVG(valor_g) INTO v_media_residuo
      FROM public.medicoes_peso
     WHERE muda_id = v_muda.id
       AND medido_em > b.ultimo_ciclo_fim
       AND medido_em < b.ultimo_ciclo_fim + make_interval(mins => b.minutos_estabilizacao + 10);
    UPDATE public.balancas SET residuo_ultimo_ciclo_g = v_media_residuo WHERE id = b.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'gravado', true, 'muda_id', v_muda.id);
END;
$$;

REVOKE ALL ON FUNCTION public.scale_can_sample(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scale_can_sample(text) TO service_role;
REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scale_push_reading(text, text, numeric) TO service_role;


-- ============================================================
-- 20260718193415_22269b5b-c416-4422-bff5-d2878b4bfb04.sql
-- ============================================================
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


-- ============================================================
-- 20260721235531_5a7b1e86-493d-439e-ab5e-59d6a1a83c77.sql
-- ============================================================
ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS ciclo_iniciado_em timestamptz;

COMMENT ON COLUMN public.bancadas.ciclo_iniciado_em IS
  'Marco de início do ciclo de mudas atual. Definido pelo botão "Novo Ciclo" no card da prateleira.';


-- ============================================================
-- 20260722011043_ba6b1ef5-6d31-4398-88a3-eba88a7d00c7.sql
-- ============================================================
ALTER TABLE public.mudas DROP CONSTRAINT IF EXISTS mudas_laboratorio_id_identificador_key;
CREATE UNIQUE INDEX IF NOT EXISTS mudas_lab_identificador_ativa_uidx
  ON public.mudas (laboratorio_id, identificador)
  WHERE ativa = true;


-- ============================================================
-- 20260726013949_5e1f9e01-b573-416a-804b-7e7764e1e893.sql
-- ============================================================
ALTER TABLE public.ar_condicionados ADD COLUMN IF NOT EXISTS ir_learn_debug jsonb;

CREATE OR REPLACE FUNCTION public.bench_ir_debug(
  _ar_id uuid,
  _bancada_id uuid,
  _device_token text,
  _evento text,
  _pulsos int DEFAULT 0,
  _extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_ok boolean;
  v_owner    uuid;
BEGIN
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
     SET ir_learn_debug = jsonb_build_object(
           'evento', _evento,
           'pulsos', COALESCE(_pulsos, 0),
           'extra',  COALESCE(_extra, '{}'::jsonb),
           'em',     now()
         ),
         updated_at = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bench_ir_debug(uuid, uuid, text, text, int, jsonb) TO anon, authenticated, service_role;


-- ============================================================
-- 20260726151801_0731ca09-ece3-440e-bb4b-7a77941ab09d.sql
-- ============================================================
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
    IF r.ctrl_travado IS TRUE THEN CONTINUE; END IF;

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
      IF v_temp > r.setpoint_max THEN
        v_deseja_ligado := true; v_deseja_modo := 'cool';
        -- Alvo = teto da faixa (limite que dispara o frio)
        v_deseja_setpoint := r.setpoint_max;
      ELSIF v_temp < r.setpoint_min AND r.suporta_aquecimento THEN
        v_deseja_ligado := true; v_deseja_modo := 'heat';
        -- Alvo = piso da faixa (limite que dispara o quente)
        v_deseja_setpoint := r.setpoint_min;
      ELSIF v_temp < r.setpoint_min AND NOT r.suporta_aquecimento THEN
        v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
      ELSE
        v_deseja_ligado := r.ligado; v_deseja_modo := r.modo_atual; v_deseja_setpoint := r.setpoint_atual;
      END IF;

      IF r.ligado AND r.modo_atual = 'heat' AND v_temp >= r.setpoint_min + r.histerese THEN
        v_deseja_ligado := false; v_deseja_modo := 'off'; v_deseja_setpoint := NULL;
      END IF;
      IF r.ligado AND r.modo_atual = 'cool' AND v_temp <= r.setpoint_max - r.histerese THEN
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

-- Zera o alvo travado pra forçar recálculo com a nova fórmula
UPDATE public.ar_condicionados SET setpoint_atual = NULL WHERE ligado = false;


-- ============================================================
-- 20260726160914_ed086914-c57c-4611-804d-0f6c50154805.sql
-- ============================================================
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


-- ============================================================
-- 20260730225648_46bb6aca-9261-4839-8767-f5410e535374.sql
-- ============================================================
ALTER TABLE public.bancadas ADD COLUMN IF NOT EXISTS rtc_bateria_fraca boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.bench_push_telemetry(_bancada_id uuid, _device_token text, _status text, _valvulas jsonb, _proximo_ciclo_segundos integer, _firmware_version text, _ip_local text, _temperatura_planta numeric DEFAULT NULL::numeric, _luz_ligada boolean DEFAULT NULL::boolean, _tem_rtc boolean DEFAULT NULL::boolean, _sensor_travado boolean DEFAULT NULL::boolean, _sensor_reinicios integer DEFAULT NULL::integer, _temperatura_valida boolean DEFAULT NULL::boolean, _rtc_bateria_fraca boolean DEFAULT NULL::boolean)
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


-- ============================================================
-- 20260730230648_ee27912e-3260-4eb1-ba23-e2d1c8e951dd.sql
-- ============================================================
DROP FUNCTION IF EXISTS public.bench_push_telemetry(uuid,text,text,jsonb,integer,text,text,numeric,boolean,boolean,boolean,integer,boolean);


-- ============================================================
-- 20260731000930_fd2d852e-d26c-4b18-bf2a-2bc5763f522b.sql
-- ============================================================
UPDATE public.bancadas SET sensor_travado = false WHERE temperatura_planta IS NULL AND COALESCE(sensor_reinicios, 0) = 0;


-- ============================================================
-- 20260731224615_ad01944e-918d-4928-b774-98cb36328e36.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.temp_extremos_30d()
RETURNS TABLE (bancada_id uuid, minimo numeric, maximo numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.bancada_id, MIN(m.valor), MAX(m.valor)
  FROM public.medicoes_temperatura m
  WHERE m.minuto > now() - interval '30 days'
  GROUP BY m.bancada_id
$$;

GRANT EXECUTE ON FUNCTION public.temp_extremos_30d() TO authenticated;


-- ============================================================
-- 20260731224930_c1f8e1d5-cd66-437b-89b9-cc897b506670.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.temp_extremos_30d()
RETURNS TABLE(bancada_id uuid, minimo numeric, maximo numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.bancada_id, MIN(m.valor), MAX(m.valor)
    FROM public.medicoes_temperatura m
   WHERE m.minuto > now() - interval '30 days'
     AND m.valor > -10
     AND m.valor < 85
   GROUP BY m.bancada_id
$$;

GRANT EXECUTE ON FUNCTION public.temp_extremos_30d() TO authenticated;


-- ============================================================
-- 20260731225036_78b4c0e3-7227-46c5-853c-668b802d1831.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.bench_push_telemetry(_bancada_id uuid, _device_token text, _status text, _valvulas jsonb, _proximo_ciclo_segundos integer, _firmware_version text, _ip_local text, _temperatura_planta numeric DEFAULT NULL::numeric, _luz_ligada boolean DEFAULT NULL::boolean, _tem_rtc boolean DEFAULT NULL::boolean, _sensor_travado boolean DEFAULT NULL::boolean, _sensor_reinicios integer DEFAULT NULL::integer, _temperatura_valida boolean DEFAULT NULL::boolean, _rtc_bateria_fraca boolean DEFAULT NULL::boolean)
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

  -- 85 C (e valores abaixo de -10 C) sao codigos de erro do DS18B20: descarta
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


-- ============================================================
-- 20260801131613_b83d2493-ba26-4afb-be32-785e23bc6474.sql
-- ============================================================
ALTER TABLE public.ar_condicionados ADD COLUMN IF NOT EXISTS codigo_ir_raw_off jsonb;

CREATE OR REPLACE FUNCTION public.bench_ir_save_raw_off(_ar_id uuid, _bancada_id uuid, _device_token text, _raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
     SET codigo_ir_raw_off = _raw,
         updated_at        = now()
   WHERE id = _ar_id;

  RETURN jsonb_build_object('ok', true, 'pulsos', jsonb_array_length(_raw));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.bench_ir_save_raw_off(uuid, uuid, text, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decidir_ar_condicionado()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      -- Cada estado tem seu proprio codigo IR aprendido: desligar usa o codigo
      -- de OFF do controle real (antes reenviava o codigo de LIGAR, e o ar
      -- ligava mas nunca desligava).
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
$fn$;


-- ============================================================
-- 20260806183215_d7f14b7c-e51f-47e2-b1d7-8ce02bcbef53.sql
-- ============================================================
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


-- ============================================================
-- 20260807012742_1c500aef-9072-4ff5-a56b-55f2faca6195.sql
-- ============================================================
create or replace function public.admin_listar_usuarios()
returns table(user_id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, u.created_at
  from auth.users u
  where public.has_role(auth.uid(), 'admin')
  order by u.created_at asc
$$;

revoke all on function public.admin_listar_usuarios() from public;
grant execute on function public.admin_listar_usuarios() to authenticated;


-- ============================================================
-- 20260807012916_7aea60f3-ef09-4d85-a191-59405bcc7a2f.sql
-- ============================================================
grant insert on public.auditoria to authenticated;

drop policy if exists "Usuario registra propria auditoria" on public.auditoria;
create policy "Usuario registra propria auditoria"
on public.auditoria for insert to authenticated
with check (usuario_id = auth.uid());


-- ============================================================
-- AGENDAMENTOS (cron) - rode este bloco DEPOIS de habilitar as extensoes
-- em Database > Extensions: pg_cron e pg_net
-- ============================================================
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- -- 1) Disparo dos ciclos programados (a cada minuto)
-- SELECT cron.schedule(
--   'bancadas-horarios-disparo', '* * * * *',
--   $$SELECT public.trigger_scheduled_cycles();$$
-- );
--
-- -- 2) Deteccao de alertas + notificacao Telegram (a cada minuto)
-- --    Troque SEU_DOMINIO pela URL do app publicado (ex.: https://meuapp.vercel.app)
-- --    e SUA_ANON_KEY pela chave publishable/anon do SEU projeto.
-- SELECT cron.schedule(
--   'check-alerts-every-minute', '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://SEU_DOMINIO/api/public/hooks/check-alerts',
--     headers := '{"Content-Type":"application/json","apikey":"SUA_ANON_KEY"}'::jsonb,
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- -- 3) Controle do ar-condicionado (a cada minuto) - opcional
-- SELECT cron.schedule(
--   'decidir-ar-condicionado', '* * * * *',
--   $$SELECT public.decidir_ar_condicionado();$$
-- );
