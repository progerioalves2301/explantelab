-- Criação da tabela de balanças se não existir
CREATE TABLE IF NOT EXISTS public.balancas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    laboratorio_id UUID REFERENCES public.laboratorios(id) ON DELETE SET NULL,
    device_token TEXT UNIQUE NOT NULL,
    ativa BOOLEAN DEFAULT true,
    ultima_leitura_g DECIMAL(10,2),
    ultima_sync TIMESTAMPTZ,
    ultimo_ciclo_fim TIMESTAMPTZ,
    minutos_estabilizacao INTEGER DEFAULT 5,
    outlier_delta_g DECIMAL(10,2) DEFAULT 10.0,
    residuo_ultimo_ciclo_g DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.balancas ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON public.balancas TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.balancas TO authenticated;
GRANT ALL ON public.balancas TO service_role;

-- Políticas
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can read balancas') THEN
        CREATE POLICY "Authenticated users can read balancas" ON public.balancas
            FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins/Tecnicos can manage balancas') THEN
        CREATE POLICY "Admins/Tecnicos can manage balancas" ON public.balancas
            FOR ALL TO authenticated 
            USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'));
    END IF;
END $$;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_balancas_updated_at') THEN
        CREATE TRIGGER update_balancas_updated_at
            BEFORE UPDATE ON public.balancas
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;
