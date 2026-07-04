ALTER TABLE public.bancadas
  ADD COLUMN IF NOT EXISTS status_desde timestamptz DEFAULT now();

UPDATE public.bancadas
   SET status_desde = COALESCE(ultima_sync, created_at, now())
 WHERE status_desde IS NULL;

CREATE TABLE IF NOT EXISTS public.bancada_status_log (
  id bigserial PRIMARY KEY,
  bancada_id uuid NOT NULL REFERENCES public.bancadas(id) ON DELETE CASCADE,
  status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bancada_status_log_bancada_time_idx
  ON public.bancada_status_log(bancada_id, changed_at DESC);

GRANT SELECT ON public.bancada_status_log TO authenticated;
GRANT ALL ON public.bancada_status_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bancada_status_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.bancada_status_log_id_seq TO service_role;

ALTER TABLE public.bancada_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read status log" ON public.bancada_status_log;
CREATE POLICY "auth read status log" ON public.bancada_status_log
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_bancada_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_desde := now();
    INSERT INTO public.bancada_status_log(bancada_id, status)
    VALUES (NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bancada_status_change ON public.bancadas;
CREATE TRIGGER trg_bancada_status_change
BEFORE UPDATE ON public.bancadas
FOR EACH ROW EXECUTE FUNCTION public.log_bancada_status_change();

INSERT INTO public.bancada_status_log(bancada_id, status, changed_at)
SELECT b.id, b.status, COALESCE(b.status_desde, b.ultima_sync, b.created_at, now())
  FROM public.bancadas b
 WHERE NOT EXISTS (
   SELECT 1 FROM public.bancada_status_log l WHERE l.bancada_id = b.id
 );