-- Phase 7: tenant contact fields + invite activation ranking

alter table public.tenants
  add column if not exists contato_email text,
  add column if not exists contato_telefone text;

alter table public.tenant_onboarding_requests
  add column if not exists contato_email text,
  add column if not exists contato_telefone text;

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
         tenant_status = 'approved',
         updatedAt = now()::text
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
         tenant_status = 'pending',
         updatedAt = now()::text
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

create or replace function public.tenant_invite_activation_ranking(
  p_tenant_id uuid,
  p_limit integer default 10
)
returns table(
  inviter_user_id text,
  approved_count bigint,
  pending_count bigint,
  total_count bigint,
  last_activation_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.uid()::text, '') = '' then
    raise exception 'Usuario nao autenticado';
  end if;

  if not public.mt_can_manage_tenant(p_tenant_id) then
    raise exception 'Sem permissao neste tenant';
  end if;

  return query
  select
    i.created_by as inviter_user_id,
    count(*) filter (where jr.status = 'approved') as approved_count,
    count(*) filter (where jr.status = 'pending') as pending_count,
    count(*) as total_count,
    max(coalesce(jr.reviewed_at, jr.requested_at)) as last_activation_at
  from public.tenant_join_requests jr
  join public.tenant_invites i on i.id = jr.invite_id
  where jr.tenant_id = p_tenant_id
    and i.created_by is not null
  group by i.created_by
  order by
    count(*) filter (where jr.status = 'approved') desc,
    count(*) desc,
    max(coalesce(jr.reviewed_at, jr.requested_at)) desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

grant execute on function public.tenant_invite_activation_ranking(uuid, integer) to authenticated;
