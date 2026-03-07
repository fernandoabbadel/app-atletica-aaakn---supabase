-- Tenant onboarding (phase 2)

create table if not exists public.tenant_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id text not null references public.users(uid) on delete cascade,
  nome text not null,
  sigla text not null,
  logo_url text,
  cidade text,
  faculdade text not null,
  curso text,
  area text,
  cnpj text,
  palette_key text not null default 'green',
  allow_public_signup boolean not null default true,
  status text not null default 'pending',
  reviewed_by text references public.users(uid) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  approved_tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_onboarding_palette_ck'
      and conrelid = 'public.tenant_onboarding_requests'::regclass
  ) then
    alter table public.tenant_onboarding_requests
      add constraint tenant_onboarding_palette_ck
      check (palette_key in ('green','yellow','red','blue','orange','purple','pink'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_onboarding_status_ck'
      and conrelid = 'public.tenant_onboarding_requests'::regclass
  ) then
    alter table public.tenant_onboarding_requests
      add constraint tenant_onboarding_status_ck
      check (status in ('pending','approved','rejected','cancelled'));
  end if;
end;
$$;

create unique index if not exists uq_tenant_onboarding_pending_per_user
  on public.tenant_onboarding_requests (requester_user_id)
  where status = 'pending';

create index if not exists idx_tenant_onboarding_status_created
  on public.tenant_onboarding_requests (status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_tenant_onboarding_touch'
      and tgrelid = 'public.tenant_onboarding_requests'::regclass
  ) then
    create trigger trg_tenant_onboarding_touch
    before update on public.tenant_onboarding_requests
    for each row execute function public.mt_touch_updated_at();
  end if;
end;
$$;

create or replace function public.tenant_submit_onboarding_request(
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

grant execute on function public.tenant_submit_onboarding_request(text, text, text, text, text, text, text, text, text, boolean) to authenticated;

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
    v_tenant_id, v_request.requester_user_id, 'master_tenant', 'approved', v_uid, now()
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
         tenant_role = 'master_tenant',
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
         tenant_status = 'rejected',
         updatedAt = now()::text
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_reject_onboarding_request(uuid, text) to authenticated;

alter table public.tenant_onboarding_requests enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_onboarding_requests'
      and policyname = 'tenant_onboarding_select_scoped'
  ) then
    create policy tenant_onboarding_select_scoped
      on public.tenant_onboarding_requests
      for select
      to authenticated
      using (public.mt_is_platform_master() or requester_user_id = auth.uid()::text);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_onboarding_requests'
      and policyname = 'tenant_onboarding_insert_own'
  ) then
    create policy tenant_onboarding_insert_own
      on public.tenant_onboarding_requests
      for insert
      to authenticated
      with check (requester_user_id = auth.uid()::text);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_onboarding_requests'
      and policyname = 'tenant_onboarding_update_master'
  ) then
    create policy tenant_onboarding_update_master
      on public.tenant_onboarding_requests
      for update
      to authenticated
      using (public.mt_is_platform_master())
      with check (public.mt_is_platform_master());
  end if;
end;
$$;
