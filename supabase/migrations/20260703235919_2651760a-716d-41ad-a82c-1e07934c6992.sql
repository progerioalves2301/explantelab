
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
