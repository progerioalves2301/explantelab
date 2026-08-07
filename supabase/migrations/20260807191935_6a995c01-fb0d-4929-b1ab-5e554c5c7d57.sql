UPDATE public.app_settings 
SET value = value || '{"tempo_injecao_segundos": 180, "tempo_retorno_segundos": 240}'::jsonb 
WHERE key = 'default_ciclo';