REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.scale_push_reading(text, text, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.scale_push_reading(text, text, numeric) TO service_role;