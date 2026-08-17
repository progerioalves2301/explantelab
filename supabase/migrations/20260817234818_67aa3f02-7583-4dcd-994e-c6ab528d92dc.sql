CREATE TABLE IF NOT EXISTS public.balancas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    laboratorio_id uuid REFERENCES public.laboratorios(id) ON DELETE SET NULL,
    device_token text UNIQUE NOT NULL,
    ativa boolean DEFAULT true,
    ultima_leitura_g numeric(10,2),
    ultima_sync timestamptz,
    ultimo_ciclo_fim timestamptz,
    minutos_estabilizacao integer DEFAULT 5,
    outlier_delta_g numeric(10,2) DEFAULT 10.00,
    residuo_ultimo_ciclo_g numeric(10,2),
    created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.balancas TO authenticated;
GRANT ALL ON public.balancas TO service_role;
GRANT SELECT ON public.balancas TO anon;

ALTER TABLE public.balancas ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Balanças visíveis por todos autenticados') THEN
        CREATE POLICY "Balanças visíveis por todos autenticados" ON public.balancas
            FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Apenas admins podem gerenciar balanças') THEN
        CREATE POLICY "Apenas admins podem gerenciar balanças" ON public.balancas
            FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
    END IF;
END $$;