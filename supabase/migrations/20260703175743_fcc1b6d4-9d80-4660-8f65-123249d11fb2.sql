
ALTER TABLE public.bancada_secrets
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS bancada_secrets_pairing_code_active_idx
  ON public.bancada_secrets (pairing_code)
  WHERE pairing_code IS NOT NULL;
