alter table public.users
  alter column plano_badge set default 'Visitante';

create or replace function public.mt_apply_default_approved_plan_to_user(
  p_user_id text,
  p_tenant_id uuid default null,
  p_force boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_name text := 'Bicho Solto';
  v_plan_color text := 'zinc';
  v_plan_icon text := 'ghost';
  v_plan_xp_multiplier numeric := 1;
  v_plan_priority integer := 1;
  v_plan_discount numeric := 0;
  v_user_plan text := '';
begin
  if coalesce(btrim(p_user_id), '') = '' then
    return false;
  end if;

  select
    coalesce(nullif(btrim(p.nome), ''), v_plan_name),
    coalesce(nullif(btrim(p.cor), ''), v_plan_color),
    coalesce(nullif(btrim(p.icon), ''), v_plan_icon),
    coalesce(p."xpMultiplier", v_plan_xp_multiplier),
    greatest(coalesce(p."nivelPrioridade", v_plan_priority), 1),
    greatest(coalesce(p."descontoLoja", v_plan_discount), 0)
  into
    v_plan_name,
    v_plan_color,
    v_plan_icon,
    v_plan_xp_multiplier,
    v_plan_priority,
    v_plan_discount
  from public.planos p
  where lower(btrim(p.nome)) = 'bicho solto'
    and (p.tenant_id = p_tenant_id or p.tenant_id is null)
  order by
    case when p.tenant_id = p_tenant_id then 0 else 1 end,
    p."nivelPrioridade" asc,
    p."updatedAt" desc
  limit 1;

  select lower(coalesce(nullif(btrim(u.plano), ''), ''))
    into v_user_plan
  from public.users u
  where u.uid = p_user_id
  limit 1;

  if not found then
    return false;
  end if;

  if not (p_force or v_user_plan in ('', 'visitante')) then
    return false;
  end if;

  update public.users
     set plano = v_plan_name,
         plano_status = 'ativo',
         plano_badge = v_plan_name,
         plano_cor = v_plan_color,
         plano_icon = v_plan_icon,
         tier = 'bicho',
         "xpMultiplier" = v_plan_xp_multiplier,
         desconto_loja = v_plan_discount,
         nivel_prioridade = v_plan_priority,
         data_adesao = coalesce(data_adesao, now()),
         "updatedAt" = now()
   where uid = p_user_id;

  return found;
end;
$$;

create or replace function public.tenant_approve_join_request(
  p_request_id uuid,
  p_approved_role text default 'user'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_join_requests%rowtype;
  v_role text;
  v_invited_by text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select * into v_request
    from public.tenant_join_requests
   where id = p_request_id
   limit 1;
  if not found then raise exception 'Solicitacao nao encontrada'; end if;
  if not public.mt_can_manage_tenant(v_request.tenant_id) then raise exception 'Sem permissao'; end if;
  if v_request.status <> 'pending' then return; end if;

  v_role := case
    when p_approved_role = 'admin_tenant' then 'admin_geral'
    when p_approved_role in (
      'visitante',
      'user',
      'treinador',
      'empresa',
      'admin_treino',
      'admin_geral',
      'admin_gestor',
      'vendas',
      'master_tenant',
      'master'
    ) then p_approved_role
    else 'user'
  end;

  update public.tenant_join_requests
     set status = 'approved',
         approved_role = v_role,
         reviewed_at = now(),
         reviewed_by = v_uid,
         updated_at = now()
   where id = v_request.id;

  update public.tenant_memberships
     set status = 'approved',
         role = v_role,
         approved_by = v_uid,
         approved_at = now(),
         updated_at = now()
   where tenant_id = v_request.tenant_id
     and user_id = v_request.requester_user_id;

  select tm.invited_by
    into v_invited_by
    from public.tenant_memberships tm
   where tm.tenant_id = v_request.tenant_id
     and tm.user_id = v_request.requester_user_id
   limit 1;

  if coalesce(v_invited_by, '') = '' and v_request.invite_id is not null then
    select i.created_by
      into v_invited_by
      from public.tenant_invites i
     where i.id = v_request.invite_id
     limit 1;
  end if;

  update public.users
     set tenant_id = v_request.tenant_id,
         role = case
           when lower(coalesce(role, '')) in ('', 'guest', 'visitante') then 'user'
           else role
         end,
         tenant_role = v_role,
         tenant_status = 'approved',
         invited_by = coalesce(v_invited_by, invited_by),
         "updatedAt" = now()
   where uid = v_request.requester_user_id;

  perform public.mt_apply_default_approved_plan_to_user(
    v_request.requester_user_id,
    v_request.tenant_id,
    false
  );
end;
$$;

grant execute on function public.tenant_approve_join_request(uuid, text) to authenticated;

update public.users
   set plano = 'Visitante',
       plano_badge = 'Visitante',
       "updatedAt" = now()
 where lower(coalesce(tenant_status, '')) <> 'approved'
   and coalesce(lower(nullif(btrim(plano), '')), '') in ('', 'visitante')
   and coalesce(lower(nullif(btrim(plano_badge), '')), '') <> 'visitante';

do $$
declare
  v_user record;
begin
  for v_user in
    select u.uid, u.tenant_id
     from public.users u
     where lower(coalesce(u.tenant_status, '')) = 'approved'
       and coalesce(lower(nullif(btrim(u.plano), '')), '') in ('', 'visitante')
  loop
    perform public.mt_apply_default_approved_plan_to_user(v_user.uid, v_user.tenant_id, true);
  end loop;
end;
$$;
