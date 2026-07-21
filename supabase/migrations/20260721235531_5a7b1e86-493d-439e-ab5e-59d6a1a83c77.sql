ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS ciclo_iniciado_em timestamptz;

COMMENT ON COLUMN public.bancadas.ciclo_iniciado_em IS
  'Marco de início do ciclo de mudas atual. Definido pelo botão "Novo Ciclo" no card da prateleira.';