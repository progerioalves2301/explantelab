
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
