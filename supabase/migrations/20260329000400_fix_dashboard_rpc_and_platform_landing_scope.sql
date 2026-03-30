-- Remove ambiguidade entre overloads do progresso do album
-- e garante que a row global da landing nao fique presa em um tenant.

drop function if exists public.dashboard_total_caca_calouros(uuid, text);

create or replace function public.dashboard_total_caca_calouros(
  p_tenant_id uuid,
  p_user_id text
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

create or replace function public.dashboard_total_caca_calouros()
returns bigint
language sql
stable
as $$
  select public.dashboard_total_caca_calouros(null::uuid, auth.uid()::text);
$$;

grant execute on function public.dashboard_total_caca_calouros() to anon, authenticated;

create or replace function public.dashboard_total_caca_calouros(
  p_tenant_id uuid default null
)
returns bigint
language sql
stable
as $$
  select public.dashboard_total_caca_calouros(p_tenant_id, auth.uid()::text);
$$;

grant execute on function public.dashboard_total_caca_calouros(uuid) to anon, authenticated;

do $$
begin
  insert into public.site_config (id, tenant_id, data, updated_at)
  select
    'landing_page__' || sc.tenant_id::text,
    sc.tenant_id,
    sc.data,
    coalesce(sc.updated_at, now())
  from public.site_config sc
  where sc.id = 'landing_page'
    and sc.tenant_id is not null
    and not exists (
      select 1
      from public.site_config scoped
      where scoped.id = 'landing_page__' || sc.tenant_id::text
    );

  update public.site_config
     set tenant_id = null,
         updated_at = now()
   where id = 'landing_page'
     and tenant_id is not null;
end;
$$;
