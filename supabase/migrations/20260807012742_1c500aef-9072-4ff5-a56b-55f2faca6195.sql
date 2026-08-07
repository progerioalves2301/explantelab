create or replace function public.admin_listar_usuarios()
returns table(user_id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, u.created_at
  from auth.users u
  where public.has_role(auth.uid(), 'admin')
  order by u.created_at asc
$$;

revoke all on function public.admin_listar_usuarios() from public;
grant execute on function public.admin_listar_usuarios() to authenticated;