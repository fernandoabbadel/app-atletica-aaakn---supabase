-- Corrige a RPC de progresso do album para retornar o total do usuario atual
-- e remove a tabela legada que serviu apenas como fonte de migracao.

create or replace function public.dashboard_total_caca_calouros(
  p_tenant_id uuid default null,
  p_user_id text default null
)
returns bigint
language sql
stable
as $$
with viewer as (
  select u.uid
  from public.users u
  where nullif(trim(coalesce(p_user_id, '')), '') is not null
    and u.uid = nullif(trim(coalesce(p_user_id, '')), '')
    and (p_tenant_id is null or u.tenant_id = p_tenant_id)
  limit 1
),
capture_total as (
  select count(distinct ac."targetUserId")::bigint as total
  from viewer v
  left join public.album_captures ac
    on ac."collectorUserId" = v.uid
   and (p_tenant_id is null or ac.tenant_id = p_tenant_id)
  left join public.users target
    on target.uid = ac."targetUserId"
   and (p_tenant_id is null or target.tenant_id = p_tenant_id)
  where ac."targetUserId" is not null
    and target.uid is not null
)
select
  case
    when exists (select 1 from viewer)
      then greatest(1::bigint, coalesce((select total from capture_total), 0::bigint))
    else 0::bigint
  end;
$$;

grant execute on function public.dashboard_total_caca_calouros(uuid, text) to anon, authenticated;

do $$
declare
  legacy_table text;
begin
  for legacy_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and lower(tablename) = lower('users_albumColado')
  loop
    execute format('drop table if exists public.%I', legacy_table);
  end loop;
end;
$$;
