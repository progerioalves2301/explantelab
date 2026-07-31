CREATE OR REPLACE FUNCTION public.temp_extremos_30d()
RETURNS TABLE (bancada_id uuid, minimo numeric, maximo numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.bancada_id, MIN(m.valor), MAX(m.valor)
  FROM public.medicoes_temperatura m
  WHERE m.minuto > now() - interval '30 days'
  GROUP BY m.bancada_id
$$;

GRANT EXECUTE ON FUNCTION public.temp_extremos_30d() TO authenticated;