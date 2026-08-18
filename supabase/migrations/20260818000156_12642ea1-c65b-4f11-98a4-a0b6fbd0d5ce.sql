BEGIN;
-- Copia os dados se houver algo em laboratorio_id (embora saibamos que está nulo ou errado)
UPDATE public.balancas SET bancada_associada_id = 'c99c0a36-3dda-4bdb-a4cc-fbf385bc84fa' 
WHERE device_token = '2tPtOixHziiblNWVkDL24XZ-DGFxjimZcwjip8tE1r8';

-- Remove a coluna antiga
ALTER TABLE public.balancas DROP COLUMN IF EXISTS laboratorio_id;

-- Garante a constraint na nova coluna
ALTER TABLE public.balancas DROP CONSTRAINT IF EXISTS balancas_bancada_associada_id_fkey;
ALTER TABLE public.balancas ADD CONSTRAINT balancas_bancada_associada_id_fkey 
  FOREIGN KEY (bancada_associada_id) REFERENCES public.bancadas(id) ON DELETE SET NULL;
COMMIT;