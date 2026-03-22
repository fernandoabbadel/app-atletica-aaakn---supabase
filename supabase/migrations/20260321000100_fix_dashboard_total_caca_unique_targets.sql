create or replace function public.dashboard_total_caca_calouros(
  p_tenant_id uuid default null
)
returns bigint
language sql
stable
as $$
  select coalesce(count(distinct "targetUserId"), 0)::bigint
  from public.album_captures
  where p_tenant_id is null or tenant_id = p_tenant_id;
$$;

grant execute on function public.dashboard_total_caca_calouros(uuid) to anon, authenticated;
