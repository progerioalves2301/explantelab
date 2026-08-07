grant insert on public.auditoria to authenticated;

drop policy if exists "Usuario registra propria auditoria" on public.auditoria;
create policy "Usuario registra propria auditoria"
on public.auditoria for insert to authenticated
with check (usuario_id = auth.uid());