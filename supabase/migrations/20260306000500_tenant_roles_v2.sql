-- Phase 6: tenant roles v2 (platform master + tenant-scoped roles)

-- 1) Expand role constraints to support tenant-scoped roles from the app model.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'users_tenant_role_ck'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users drop constraint users_tenant_role_ck;
  end if;

  alter table public.users
    add constraint users_tenant_role_ck
    check (
      tenant_role in (
        'visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','master','vendas',
        'admin_tenant','master_tenant'
      )
    );
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'tenant_memberships_role_ck'
       and conrelid = 'public.tenant_memberships'::regclass
  ) then
    alter table public.tenant_memberships drop constraint tenant_memberships_role_ck;
  end if;

  alter table public.tenant_memberships
    add constraint tenant_memberships_role_ck
    check (
      role in (
        'visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','master','vendas',
        'admin_tenant','master_tenant'
      )
    );
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'tenant_invites_role_ck'
       and conrelid = 'public.tenant_invites'::regclass
  ) then
    alter table public.tenant_invites drop constraint tenant_invites_role_ck;
  end if;

  alter table public.tenant_invites
    add constraint tenant_invites_role_ck
    check (
      role_to_assign in (
        'visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','vendas',
        'admin_tenant'
      )
    );
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'tenant_join_requests_requested_role_ck'
       and conrelid = 'public.tenant_join_requests'::regclass
  ) then
    alter table public.tenant_join_requests drop constraint tenant_join_requests_requested_role_ck;
  end if;

  alter table public.tenant_join_requests
    add constraint tenant_join_requests_requested_role_ck
    check (
      requested_role in (
        'visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','master','vendas',
        'admin_tenant','master_tenant'
      )
    );
end;
$$;

-- 2) Normalize legacy role values already persisted in the DB.
update public.users
   set tenant_role = case
     when tenant_role = 'admin_tenant' then 'admin_geral'
     when tenant_role = 'master_tenant' then 'master'
     else tenant_role
   end
 where tenant_role in ('admin_tenant', 'master_tenant');

update public.tenant_memberships
   set role = case
     when role = 'admin_tenant' then 'admin_geral'
     when role = 'master_tenant' then 'master'
     else role
   end
 where role in ('admin_tenant', 'master_tenant');

update public.tenant_invites
   set role_to_assign = case
     when role_to_assign = 'admin_tenant' then 'admin_geral'
     else role_to_assign
   end
 where role_to_assign in ('admin_tenant');

update public.tenant_join_requests
   set requested_role = case
     when requested_role = 'admin_tenant' then 'admin_geral'
     when requested_role = 'master_tenant' then 'master'
     else requested_role
   end
 where requested_role in ('admin_tenant', 'master_tenant');

update public.tenant_join_requests
   set approved_role = case
     when approved_role = 'admin_tenant' then 'admin_geral'
     when approved_role = 'master_tenant' then 'master'
     else approved_role
   end
 where approved_role in ('admin_tenant', 'master_tenant');

-- 3) Role helpers for tenant management.
create or replace function public.mt_can_manage_tenant(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.mt_is_platform_master()
    or exists(
      select 1
        from public.tenant_memberships m
       where m.tenant_id = target_tenant
         and m.user_id = auth.uid()::text
         and m.status = 'approved'
         and m.role in ('master','admin_geral','admin_gestor','master_tenant','admin_tenant')
    )
$$;

-- 4) Keep tenant creation aligned with the new tenant master role.
create or replace function public.tenant_create_with_master(
  p_nome text,
  p_sigla text,
  p_logo_url text default null,
  p_cidade text default null,
  p_faculdade text default null,
  p_curso text default null,
  p_area text default null,
  p_cnpj text default null,
  p_palette_key text default 'green',
  p_allow_public_signup boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_slug text;
  v_base_slug text;
  v_counter integer := 1;
  v_tenant_id uuid;
  v_launch_enabled boolean := true;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select coalesce(tokenization_active, true)
    into v_launch_enabled
    from public.tenant_platform_config
   where id = 'global'
   limit 1;

  if not coalesce(v_launch_enabled, true) and not public.mt_is_platform_master() then
    raise exception 'Tokenizacao desativada no momento.';
  end if;

  if exists (
    select 1
      from public.users u
     where u.uid = v_uid
       and u.tenant_id is not null
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) then
    raise exception 'Usuario ja vinculado a uma atletica aprovada.';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(p_sigla), ''), nullif(trim(p_nome), ''), 'atletica')), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then v_base_slug := 'atletica'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.tenants t where lower(t.slug) = lower(v_slug)) loop
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter::text;
  end loop;

  insert into public.tenants (
    nome, slug, sigla, logo_url, cidade, faculdade, curso, area, cnpj, palette_key, allow_public_signup, status, created_by
  ) values (
    trim(coalesce(p_nome, '')),
    v_slug,
    trim(coalesce(p_sigla, '')),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cidade, '')), ''),
    trim(coalesce(nullif(p_faculdade, ''), p_nome)),
    nullif(trim(coalesce(p_curso, '')), ''),
    nullif(trim(coalesce(p_area, '')), ''),
    nullif(trim(coalesce(p_cnpj, '')), ''),
    case when p_palette_key in ('green','yellow','red','blue','orange','purple','pink') then p_palette_key else 'green' end,
    coalesce(p_allow_public_signup, true),
    'active',
    v_uid
  ) returning id into v_tenant_id;

  insert into public.tenant_memberships (tenant_id, user_id, role, status, approved_by, approved_at)
  values (v_tenant_id, v_uid, 'master', 'approved', v_uid, now())
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role,
        status = excluded.status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_tenant_id,
         tenant_role = 'master',
         tenant_status = 'approved',
         updatedAt = now()::text
   where uid = v_uid;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_create_with_master(text, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- 5) Onboarding approval now creates tenant masters using role = master.
create or replace function public.tenant_approve_onboarding_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_onboarding_requests%rowtype;
  v_tenant_id uuid;
  v_slug text;
  v_base_slug text;
  v_counter integer := 1;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then
    raise exception 'Usuario nao autenticado';
  end if;
  if not public.mt_is_platform_master() then
    raise exception 'Apenas master da plataforma';
  end if;

  select *
    into v_request
    from public.tenant_onboarding_requests r
   where r.id = p_request_id
   limit 1;

  if not found then
    raise exception 'Solicitacao de onboarding nao encontrada';
  end if;

  if v_request.status = 'approved' and v_request.approved_tenant_id is not null then
    return v_request.approved_tenant_id;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Solicitacao nao esta pendente';
  end if;

  if exists (
    select 1
      from public.users u
     where u.uid = v_request.requester_user_id
       and u.tenant_id is not null
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) then
    raise exception 'Solicitante ja vinculado a tenant aprovado';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(v_request.sigla), ''), nullif(trim(v_request.nome), ''), 'atletica')), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then
    v_base_slug := 'atletica';
  end if;
  v_slug := v_base_slug;

  while exists (select 1 from public.tenants t where lower(t.slug) = lower(v_slug)) loop
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter::text;
  end loop;

  insert into public.tenants (
    nome, slug, sigla, logo_url, cidade, faculdade, curso, area, cnpj,
    palette_key, allow_public_signup, status, created_by
  ) values (
    trim(v_request.nome),
    v_slug,
    trim(v_request.sigla),
    v_request.logo_url,
    v_request.cidade,
    trim(coalesce(v_request.faculdade, v_request.nome)),
    v_request.curso,
    v_request.area,
    v_request.cnpj,
    case when v_request.palette_key in ('green','yellow','red','blue','orange','purple','pink') then v_request.palette_key else 'green' end,
    coalesce(v_request.allow_public_signup, true),
    'active',
    v_request.requester_user_id
  )
  returning id into v_tenant_id;

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, approved_by, approved_at
  ) values (
    v_tenant_id, v_request.requester_user_id, 'master', 'approved', v_uid, now()
  )
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role,
        status = excluded.status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_tenant_id,
         tenant_role = 'master',
         tenant_status = 'approved',
         updatedAt = now()::text
   where uid = v_request.requester_user_id;

  update public.tenant_onboarding_requests
     set status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         approved_tenant_id = v_tenant_id,
         rejection_reason = null,
         updated_at = now()
   where id = v_request.id;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_approve_onboarding_request(uuid) to authenticated;

-- 6) Invite creation with v2 roles.
create or replace function public.tenant_create_invite(
  p_tenant_id uuid,
  p_role_to_assign text default 'user',
  p_max_uses integer default 25,
  p_expires_in_hours integer default 72,
  p_requires_approval boolean default true
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
  v_role text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;
  if not public.mt_can_manage_tenant(p_tenant_id) then raise exception 'Sem permissao neste tenant'; end if;

  v_role := case
    when p_role_to_assign = 'admin_tenant' then 'admin_geral'
    when p_role_to_assign in ('visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','vendas') then p_role_to_assign
    else 'user'
  end;

  v_expires_at := now() + (greatest(1, coalesce(p_expires_in_hours, 72)) || ' hours')::interval;

  loop
    v_token := public.mt_build_invite_token();
    exit when not exists (select 1 from public.tenant_invites i where i.token = v_token);
  end loop;

  insert into public.tenant_invites (
    tenant_id, token, role_to_assign, requires_approval, max_uses, uses_count, expires_at, is_active, created_by
  ) values (
    p_tenant_id, v_token, v_role, coalesce(p_requires_approval, true), greatest(1, coalesce(p_max_uses, 25)), 0, v_expires_at, true, v_uid
  ) returning id, tenant_invites.token, tenant_invites.expires_at into invite_id, token, expires_at;

  return next;
end;
$$;

grant execute on function public.tenant_create_invite(uuid, text, integer, integer, boolean) to authenticated;

-- 7) Join-by-invite flow with v2 roles.
create or replace function public.tenant_request_join_with_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_invite public.tenant_invites%rowtype;
  v_request_id uuid;
  v_status text;
  v_role text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select * into v_invite
    from public.tenant_invites
   where token = trim(coalesce(p_token, ''))
     and is_active = true
   limit 1;
  if not found then raise exception 'Token invalido ou inativo'; end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then raise exception 'Token expirado'; end if;
  if v_invite.uses_count >= v_invite.max_uses then raise exception 'Token esgotado'; end if;

  if exists (
    select 1 from public.users u
     where u.uid = v_uid
       and u.tenant_id is not null
       and u.tenant_id <> v_invite.tenant_id
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) then
    raise exception 'Usuario ja vinculado a outra atletica';
  end if;

  v_status := case when v_invite.requires_approval then 'pending' else 'approved' end;
  v_role := case
    when v_invite.role_to_assign = 'admin_tenant' then 'admin_geral'
    when v_invite.role_to_assign in ('visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','vendas') then v_invite.role_to_assign
    else 'user'
  end;

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, invited_by, approved_by, approved_at
  ) values (
    v_invite.tenant_id,
    v_uid,
    case when v_status = 'approved' then v_role else 'visitante' end,
    v_status,
    v_invite.created_by,
    case when v_status = 'approved' then coalesce(v_invite.created_by, v_uid) else null end,
    case when v_status = 'approved' then now() else null end
  )
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role,
        status = excluded.status,
        invited_by = excluded.invited_by,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_invite.tenant_id,
         tenant_role = case when v_status = 'approved' then v_role else 'visitante' end,
         tenant_status = v_status,
         updatedAt = now()::text
   where uid = v_uid;

  insert into public.tenant_join_requests (
    tenant_id, requester_user_id, invite_id, status, requested_role, approved_role, requested_at, reviewed_at, reviewed_by
  ) values (
    v_invite.tenant_id,
    v_uid,
    v_invite.id,
    v_status,
    'visitante',
    case when v_status = 'approved' then v_role else null end,
    now(),
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'approved' then coalesce(v_invite.created_by, v_uid) else null end
  ) returning id into v_request_id;

  update public.tenant_invites
     set uses_count = uses_count + 1,
         is_active = case when uses_count + 1 >= max_uses then false else is_active end,
         updated_at = now()
   where id = v_invite.id;

  return v_request_id;
end;
$$;

grant execute on function public.tenant_request_join_with_invite(text) to authenticated;

-- 8) Manual approval flow with v2 roles.
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
    when p_approved_role in ('visitante','user','treinador','empresa','admin_treino','admin_geral','admin_gestor','vendas') then p_approved_role
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

  update public.users
     set tenant_id = v_request.tenant_id,
         tenant_role = v_role,
         tenant_status = 'approved',
         updatedAt = now()::text
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_approve_join_request(uuid, text) to authenticated;
