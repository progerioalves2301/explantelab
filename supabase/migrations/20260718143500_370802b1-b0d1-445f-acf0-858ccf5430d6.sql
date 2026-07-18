
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
