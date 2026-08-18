ALTER TABLE public.sensores_co2
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sensores_co2_pairing_code_uidx
  ON public.sensores_co2 (pairing_code)
  WHERE pairing_code IS NOT NULL;