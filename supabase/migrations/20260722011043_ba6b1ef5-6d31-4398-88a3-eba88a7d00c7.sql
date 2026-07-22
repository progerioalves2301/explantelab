ALTER TABLE public.mudas DROP CONSTRAINT IF EXISTS mudas_laboratorio_id_identificador_key;
CREATE UNIQUE INDEX IF NOT EXISTS mudas_lab_identificador_ativa_uidx
  ON public.mudas (laboratorio_id, identificador)
  WHERE ativa = true;