ALTER TABLE public.balancas
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS balancas_pairing_code_uidx
  ON public.balancas (pairing_code)
  WHERE pairing_code IS NOT NULL;