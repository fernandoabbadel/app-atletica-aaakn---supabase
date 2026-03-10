create or replace function public.tenant_create_with_master(
  p_nome text,
  p_sigla text,
  p_logo_url text default null,
  p_cidade text default null,
  p_faculdade text default null,
  p_curso text default null,
  p_area text default null,
  p_cnpj text default null,
  p_contato_email text default null,
  p_contato_telefone text default null,
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
    nome, slug, sigla, logo_url, cidade, faculdade, curso, area, cnpj, contato_email, contato_telefone,
    palette_key, allow_public_signup, status, created_by
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
    nullif(trim(coalesce(p_contato_email, '')), ''),
    nullif(trim(coalesce(p_contato_telefone, '')), ''),
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
         tenant_status = 'approved'
   where uid = v_uid;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_create_with_master(text, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.tenant_submit_onboarding_request(
  p_nome text,
  p_sigla text,
  p_logo_url text default null,
  p_cidade text default null,
  p_faculdade text default null,
  p_curso text default null,
  p_area text default null,
  p_cnpj text default null,
  p_contato_email text default null,
  p_contato_telefone text default null,
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
  v_request_id uuid;
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

  select r.id
    into v_request_id
    from public.tenant_onboarding_requests r
   where r.requester_user_id = v_uid
     and r.status = 'pending'
   order by r.created_at desc
   limit 1;

  if v_request_id is not null then
    return v_request_id;
  end if;

  insert into public.tenant_onboarding_requests (
    requester_user_id,
    nome,
    sigla,
    logo_url,
    cidade,
    faculdade,
    curso,
    area,
    cnpj,
    contato_email,
    contato_telefone,
    palette_key,
    allow_public_signup,
    status
  ) values (
    v_uid,
    trim(coalesce(p_nome, '')),
    trim(coalesce(p_sigla, '')),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cidade, '')), ''),
    trim(coalesce(nullif(p_faculdade, ''), p_nome)),
    nullif(trim(coalesce(p_curso, '')), ''),
    nullif(trim(coalesce(p_area, '')), ''),
    nullif(trim(coalesce(p_cnpj, '')), ''),
    nullif(trim(coalesce(p_contato_email, '')), ''),
    nullif(trim(coalesce(p_contato_telefone, '')), ''),
    case when p_palette_key in ('green','yellow','red','blue','orange','purple','pink') then p_palette_key else 'green' end,
    coalesce(p_allow_public_signup, true),
    'pending'
  ) returning id into v_request_id;

  update public.users
     set tenant_id = null,
         tenant_role = 'visitante',
         tenant_status = 'pending'
   where uid = v_uid;

  return v_request_id;
end;
$$;

grant execute on function public.tenant_submit_onboarding_request(text, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;

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
    contato_email, contato_telefone, palette_key, allow_public_signup, status, created_by
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
    nullif(trim(coalesce(v_request.contato_email, '')), ''),
    nullif(trim(coalesce(v_request.contato_telefone, '')), ''),
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
         tenant_status = 'approved'
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

create or replace function public.tenant_reject_onboarding_request(
  p_request_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_onboarding_requests%rowtype;
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
  if v_request.status <> 'pending' then
    return;
  end if;

  update public.tenant_onboarding_requests
     set status = 'rejected',
         reviewed_by = v_uid,
         reviewed_at = now(),
         rejection_reason = nullif(trim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = v_request.id;

  update public.users
     set tenant_id = null,
         tenant_role = 'visitante',
         tenant_status = 'rejected'
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_reject_onboarding_request(uuid, text) to authenticated;

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
  v_role := 'user';

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
         invited_by = coalesce(v_invite.created_by, invited_by)
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

create or replace function public.tenant_request_join_manual(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request_id uuid;
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

  if not exists (
    select 1 from public.tenants t
     where t.id = p_tenant_id
       and t.status = 'active'
       and t.allow_public_signup = true
  ) then
    raise exception 'Atletica indisponivel para cadastro publico.';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role, status)
  values (p_tenant_id, v_uid, 'visitante', 'pending')
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role,
        status = excluded.status,
        updated_at = now();

  update public.users
     set tenant_id = p_tenant_id,
         tenant_role = 'visitante',
         tenant_status = 'pending'
   where uid = v_uid;

  if exists (
    select 1 from public.tenant_join_requests r
     where r.tenant_id = p_tenant_id
       and r.requester_user_id = v_uid
       and r.status = 'pending'
  ) then
    select r.id into v_request_id
      from public.tenant_join_requests r
     where r.tenant_id = p_tenant_id
       and r.requester_user_id = v_uid
       and r.status = 'pending'
     order by r.requested_at desc
     limit 1;
    return v_request_id;
  end if;

  insert into public.tenant_join_requests (tenant_id, requester_user_id, status, requested_role, requested_at)
  values (p_tenant_id, v_uid, 'pending', 'visitante', now())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function public.tenant_request_join_manual(uuid) to authenticated;

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

  v_role := 'user';

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
         tenant_role = v_role,
         tenant_status = 'approved',
         invited_by = coalesce(v_invited_by, invited_by)
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_approve_join_request(uuid, text) to authenticated;

create or replace function public.tenant_reject_join_request(
  p_request_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_join_requests%rowtype;
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

  update public.tenant_join_requests
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = v_uid,
         rejection_reason = nullif(trim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = v_request.id;

  update public.tenant_memberships
     set status = 'rejected',
         updated_at = now()
   where tenant_id = v_request.tenant_id
     and user_id = v_request.requester_user_id;

  update public.users
     set tenant_id = null,
         tenant_role = 'visitante',
         tenant_status = 'rejected'
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_reject_join_request(uuid, text) to authenticated;
