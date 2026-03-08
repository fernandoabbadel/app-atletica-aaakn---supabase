create or replace function public.tenant_create_member_invite(
  p_tenant_id uuid,
  p_max_uses integer default 1,
  p_expires_in_hours integer default 72
)
returns table(invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_token text;
  v_expires_at timestamptz;
  v_launch_enabled boolean := true;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then
    raise exception 'Usuario nao autenticado';
  end if;

  select coalesce(tokenization_active, true)
    into v_launch_enabled
    from public.tenant_platform_config
   where id = 'global'
   limit 1;

  if not coalesce(v_launch_enabled, true) then
    raise exception 'Tokenizacao desativada no momento.';
  end if;

  if not (
    public.mt_is_platform_master()
    or exists (
      select 1
        from public.tenant_memberships m
       where m.tenant_id = p_tenant_id
         and m.user_id = v_uid
         and m.status = 'approved'
         and coalesce(m.role, '') <> 'visitante'
    )
  ) then
    raise exception 'Sem permissao neste tenant';
  end if;

  v_expires_at := now() + (greatest(1, least(coalesce(p_expires_in_hours, 72), 24 * 7)) || ' hours')::interval;

  loop
    v_token := public.mt_build_invite_token();
    exit when not exists (
      select 1
        from public.tenant_invites i
       where i.token = v_token
    );
  end loop;

  insert into public.tenant_invites (
    tenant_id,
    token,
    role_to_assign,
    requires_approval,
    max_uses,
    uses_count,
    expires_at,
    is_active,
    created_by
  ) values (
    p_tenant_id,
    v_token,
    'user',
    true,
    greatest(1, least(coalesce(p_max_uses, 1), 5)),
    0,
    v_expires_at,
    true,
    v_uid
  ) returning id, tenant_invites.token, tenant_invites.expires_at into invite_id, token, expires_at;

  return next;
end;
$$;

grant execute on function public.tenant_create_member_invite(uuid, integer, integer) to authenticated;
