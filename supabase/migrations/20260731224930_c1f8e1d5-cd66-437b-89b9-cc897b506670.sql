CREATE OR REPLACE FUNCTION public.temp_extremos_30d()
RETURNS TABLE(bancada_id uuid, minimo numeric, maximo numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.bancada_id, MIN(m.valor), MAX(m.valor)
    FROM public.medicoes_temperatura m
   WHERE m.minuto > now() - interval '30 days'
     AND m.valor > -10
     AND m.valor < 85
   GROUP BY m.bancada_id
$$;

GRANT EXECUTE ON FUNCTION public.temp_extremos_30d() TO authenticated;