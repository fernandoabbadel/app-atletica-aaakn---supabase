-- Multi-tenant foundation (v1)

alter table public.users
  add column if not exists tenant_id uuid,
  add column if not exists tenant_role text default 'visitante',
  add column if not exists tenant_status text default 'unlinked';

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null,
  sigla text not null,
  logo_url text,
  cidade text,
  faculdade text not null,
  curso text,
  area text,
  cnpj text,
  palette_key text not null default 'green',
  allow_public_signup boolean not null default true,
  status text not null default 'active',
  created_by text references public.users(uid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_palette_ck' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_palette_ck
      check (palette_key in ('green','yellow','red','blue','orange','purple','pink'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_status_ck' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_status_ck
      check (status in ('active','inactive','blocked'));
  end if;
end;
$$;

create unique index if not exists uq_tenants_slug on public.tenants (lower(slug));
create index if not exists idx_tenants_public on public.tenants (status, allow_public_signup);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_tenant_fk' and conrelid = 'public.users'::regclass) then
    alter table public.users
      add constraint users_tenant_fk foreign key (tenant_id) references public.tenants(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_tenant_role_ck' and conrelid = 'public.users'::regclass) then
    alter table public.users
      add constraint users_tenant_role_ck check (tenant_role in ('visitante','user','admin_tenant','master_tenant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_tenant_status_ck' and conrelid = 'public.users'::regclass) then
    alter table public.users
      add constraint users_tenant_status_ck check (tenant_status in ('unlinked','pending','approved','rejected','disabled'));
  end if;
end;
$$;

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id text not null references public.users(uid) on delete cascade,
  role text not null default 'visitante',
  status text not null default 'pending',
  invited_by text references public.users(uid) on delete set null,
  approved_by text references public.users(uid) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (user_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_memberships_role_ck' and conrelid = 'public.tenant_memberships'::regclass) then
    alter table public.tenant_memberships
      add constraint tenant_memberships_role_ck check (role in ('visitante','user','admin_tenant','master_tenant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_memberships_status_ck' and conrelid = 'public.tenant_memberships'::regclass) then
    alter table public.tenant_memberships
      add constraint tenant_memberships_status_ck check (status in ('pending','approved','rejected','disabled'));
  end if;
end;
$$;

create index if not exists idx_tenant_memberships_tenant_status on public.tenant_memberships (tenant_id, status);
create index if not exists idx_tenant_memberships_user_status on public.tenant_memberships (user_id, status);

create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  role_to_assign text not null default 'user',
  requires_approval boolean not null default true,
  max_uses integer not null default 25,
  uses_count integer not null default 0,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by text references public.users(uid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_invites_role_ck' and conrelid = 'public.tenant_invites'::regclass) then
    alter table public.tenant_invites
      add constraint tenant_invites_role_ck check (role_to_assign in ('visitante','user','admin_tenant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_invites_uses_ck' and conrelid = 'public.tenant_invites'::regclass) then
    alter table public.tenant_invites
      add constraint tenant_invites_uses_ck check (max_uses >= 1 and uses_count >= 0 and uses_count <= max_uses);
  end if;
end;
$$;

create index if not exists idx_tenant_invites_tenant_active on public.tenant_invites (tenant_id, is_active);

create table if not exists public.tenant_join_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requester_user_id text not null references public.users(uid) on delete cascade,
  invite_id uuid references public.tenant_invites(id) on delete set null,
  status text not null default 'pending',
  requested_role text not null default 'visitante',
  approved_role text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public.users(uid) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_join_requests_status_ck' and conrelid = 'public.tenant_join_requests'::regclass) then
    alter table public.tenant_join_requests
      add constraint tenant_join_requests_status_ck check (status in ('pending','approved','rejected','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_join_requests_requested_role_ck' and conrelid = 'public.tenant_join_requests'::regclass) then
    alter table public.tenant_join_requests
      add constraint tenant_join_requests_requested_role_ck check (requested_role in ('visitante','user','admin_tenant','master_tenant'));
  end if;
end;
$$;

create unique index if not exists uq_tenant_join_pending on public.tenant_join_requests (tenant_id, requester_user_id) where status = 'pending';
create index if not exists idx_tenant_join_tenant_status on public.tenant_join_requests (tenant_id, status, requested_at desc);

create table if not exists public.tenant_platform_config (
  id text primary key default 'global',
  tokenization_active boolean not null default true,
  updated_by text references public.users(uid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenant_platform_config (id, tokenization_active)
values ('global', true)
on conflict (id) do nothing;

create or replace function public.mt_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_tenants_touch' and tgrelid='public.tenants'::regclass) then
    create trigger trg_tenants_touch before update on public.tenants for each row execute function public.mt_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_tenant_memberships_touch' and tgrelid='public.tenant_memberships'::regclass) then
    create trigger trg_tenant_memberships_touch before update on public.tenant_memberships for each row execute function public.mt_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_tenant_invites_touch' and tgrelid='public.tenant_invites'::regclass) then
    create trigger trg_tenant_invites_touch before update on public.tenant_invites for each row execute function public.mt_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_tenant_join_requests_touch' and tgrelid='public.tenant_join_requests'::regclass) then
    create trigger trg_tenant_join_requests_touch before update on public.tenant_join_requests for each row execute function public.mt_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_tenant_platform_config_touch' and tgrelid='public.tenant_platform_config'::regclass) then
    create trigger trg_tenant_platform_config_touch before update on public.tenant_platform_config for each row execute function public.mt_touch_updated_at();
  end if;
end;
$$;

create or replace function public.mt_is_platform_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.users u
    where u.uid = auth.uid()::text
      and lower(coalesce(u.role, '')) = 'master'
  )
$$;

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
        and m.role in ('master_tenant','admin_tenant')
    )
$$;

create or replace function public.mt_build_invite_token()
returns text
language sql
volatile
as $$
  select rtrim(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=')
$$;

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
  values (v_tenant_id, v_uid, 'master_tenant', 'approved', v_uid, now())
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
   where uid = v_uid;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_create_with_master(text, text, text, text, text, text, text, text, text, boolean) to authenticated;

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

  v_role := case when p_role_to_assign in ('visitante','user','admin_tenant') then p_role_to_assign else 'user' end;
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
  v_role := case when v_invite.role_to_assign in ('visitante','user','admin_tenant') then v_invite.role_to_assign else 'user' end;

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
         tenant_status = 'pending',
         updatedAt = now()::text
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

  v_role := case when p_approved_role in ('visitante','user','admin_tenant') then p_approved_role else 'user' end;

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
         tenant_status = 'rejected',
         updatedAt = now()::text
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_reject_join_request(uuid, text) to authenticated;

create or replace function public.tenant_set_launch_tokenization(p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;
  if not public.mt_is_platform_master() then raise exception 'Apenas master da plataforma'; end if;

  insert into public.tenant_platform_config (id, tokenization_active, updated_by)
  values ('global', coalesce(p_active, true), v_uid)
  on conflict (id) do update
    set tokenization_active = excluded.tokenization_active,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

grant execute on function public.tenant_set_launch_tokenization(boolean) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_invites enable row level security;
alter table public.tenant_join_requests enable row level security;
alter table public.tenant_platform_config enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenants' and policyname='tenants_select_visible') then
    create policy tenants_select_visible on public.tenants
      for select to authenticated
      using (
        public.mt_is_platform_master()
        or (status = 'active' and allow_public_signup = true)
        or exists (select 1 from public.tenant_memberships m where m.tenant_id = tenants.id and m.user_id = auth.uid()::text)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenants' and policyname='tenants_update_manage') then
    create policy tenants_update_manage on public.tenants
      for update to authenticated
      using (public.mt_is_platform_master() or public.mt_can_manage_tenant(id))
      with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(id));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_memberships' and policyname='tenant_memberships_select_scoped') then
    create policy tenant_memberships_select_scoped on public.tenant_memberships
      for select to authenticated
      using (public.mt_is_platform_master() or user_id = auth.uid()::text or public.mt_can_manage_tenant(tenant_id));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_invites' and policyname='tenant_invites_select_manage') then
    create policy tenant_invites_select_manage on public.tenant_invites
      for select to authenticated
      using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_invites' and policyname='tenant_invites_insert_manage') then
    create policy tenant_invites_insert_manage on public.tenant_invites
      for insert to authenticated
      with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_invites' and policyname='tenant_invites_update_manage') then
    create policy tenant_invites_update_manage on public.tenant_invites
      for update to authenticated
      using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))
      with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_join_requests' and policyname='tenant_join_requests_select_scoped') then
    create policy tenant_join_requests_select_scoped on public.tenant_join_requests
      for select to authenticated
      using (public.mt_is_platform_master() or requester_user_id = auth.uid()::text or public.mt_can_manage_tenant(tenant_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_join_requests' and policyname='tenant_join_requests_insert_own') then
    create policy tenant_join_requests_insert_own on public.tenant_join_requests
      for insert to authenticated
      with check (requester_user_id = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_join_requests' and policyname='tenant_join_requests_update_manage') then
    create policy tenant_join_requests_update_manage on public.tenant_join_requests
      for update to authenticated
      using (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id))
      with check (public.mt_is_platform_master() or public.mt_can_manage_tenant(tenant_id));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_platform_config' and policyname='tenant_platform_config_select_authenticated') then
    create policy tenant_platform_config_select_authenticated on public.tenant_platform_config
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_platform_config' and policyname='tenant_platform_config_update_master') then
    create policy tenant_platform_config_update_master on public.tenant_platform_config
      for update to authenticated
      using (public.mt_is_platform_master())
      with check (public.mt_is_platform_master());
  end if;
end;
$$;

