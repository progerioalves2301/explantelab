-- Adiciona a coluna is_teste à tabela bancadas
ALTER TABLE public.bancadas ADD COLUMN IF NOT EXISTS is_teste boolean NOT NULL DEFAULT false;

-- Atualiza as políticas de RLS para a tabela bancadas
-- Remove as políticas antigas
DROP POLICY IF EXISTS "public read bancadas" ON public.bancadas;
DROP POLICY IF EXISTS "admin gerencia bancadas" ON public.bancadas;

-- Política de leitura: usuários comuns veem apenas equipamentos não-teste
CREATE POLICY "read non-test benches" 
ON public.bancadas 
FOR SELECT 
TO authenticated 
USING (is_teste = false);

-- Política de leitura: administradores veem tudo
CREATE POLICY "admin read all benches" 
ON public.bancadas 
FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

-- Política de gerenciamento: apenas administradores podem inserir/atualizar/deletar
CREATE POLICY "admin manage all benches" 
ON public.bancadas 
FOR ALL 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Garante que o service_role tenha acesso total
GRANT ALL ON public.bancadas TO service_role;
