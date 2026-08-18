CREATE OR REPLACE FUNCTION public.tg_bancada_fim_ciclo_balanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'Repouso'
     AND OLD.status IN ('Injetando','Retornando','Pausado','Alivio') THEN
    BEGIN
      UPDATE public.balancas
         SET ultimo_ciclo_fim = now()
       WHERE ativa = true
         AND bancada_associada_id = NEW.id;
    EXCEPTION WHEN others THEN
      -- Nunca deixar a telemetria falhar por causa da balança.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$function$;