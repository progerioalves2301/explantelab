
-- 1. bancadas: remover leitura pública
DROP POLICY IF EXISTS "public read bancadas" ON public.bancadas;
CREATE POLICY "auth read bancadas" ON public.bancadas
  FOR SELECT TO authenticated USING (true);

-- 2. laboratorios: remover leitura pública
DROP POLICY IF EXISTS "public read laboratorios" ON public.laboratorios;
CREATE POLICY "auth read laboratorios" ON public.laboratorios
  FOR SELECT TO authenticated USING (true);

-- 3. comandos: remover leitura pública, restringir a autenticados; permitir INSERT para operador/admin
DROP POLICY IF EXISTS "public read comandos" ON public.comandos;
CREATE POLICY "auth read comandos" ON public.comandos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "operador/admin insert comandos" ON public.comandos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
  );
CREATE POLICY "admin manage comandos" ON public.comandos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. alerta_destinos: apenas admin lê (contém chat_ids sensíveis)
DROP POLICY IF EXISTS "auth read destinos" ON public.alerta_destinos;
-- policy "admin manage destinos" (ALL) já cobre SELECT para admin

-- 5. app_settings: apenas admin lê
DROP POLICY IF EXISTS "authenticated read settings" ON public.app_settings;
-- policy "admins write settings" (ALL) já cobre SELECT para admin

-- 6. Storage: policies explícitas para bucket firmware
CREATE POLICY "admin read firmware" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin insert firmware" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin update firmware" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin delete firmware" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firmware' AND public.has_role(auth.uid(), 'admin'::app_role));
