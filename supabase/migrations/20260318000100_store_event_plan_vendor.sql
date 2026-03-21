-- Loja / eventos / mini vendor

alter table public.produtos
  add column if not exists status text,
  add column if not exists plan_prices jsonb not null default '[]'::jsonb,
  add column if not exists plan_visibility jsonb not null default '[]'::jsonb,
  add column if not exists payment_config jsonb,
  add column if not exists seller_type text,
  add column if not exists seller_id text,
  add column if not exists seller_name text,
  add column if not exists seller_logo_url text;

update public.produtos
   set status = case
     when coalesce(active, true) = false then 'esgotado'
     else 'ativo'
   end
 where status is null;

update public.produtos
   set seller_type = 'tenant'
 where seller_type is null;

alter table public.produtos
  alter column status set default 'ativo',
  alter column seller_type set default 'tenant';

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'produtos_status_ck'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos drop constraint produtos_status_ck;
  end if;

  alter table public.produtos
    add constraint produtos_status_ck
    check (status in ('ativo', 'em_breve', 'esgotado'));
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'produtos_seller_type_ck'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos drop constraint produtos_seller_type_ck;
  end if;

  alter table public.produtos
    add constraint produtos_seller_type_ck
    check (seller_type in ('tenant', 'mini_vendor'));
end;
$$;

alter table public.categorias
  add column if not exists cover_img text,
  add column if not exists button_color text,
  add column if not exists logo_url text,
  add column if not exists seller_type text,
  add column if not exists seller_id text;

update public.categorias
   set seller_type = 'tenant'
 where seller_type is null;

alter table public.categorias
  alter column seller_type set default 'tenant';

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'categorias_seller_type_ck'
       and conrelid = 'public.categorias'::regclass
  ) then
    alter table public.categorias drop constraint categorias_seller_type_ck;
  end if;

  alter table public.categorias
    add constraint categorias_seller_type_ck
    check (seller_type in ('tenant', 'mini_vendor'));
end;
$$;

alter table public.eventos
  add column if not exists sale_status text,
  add column if not exists payment_config jsonb;

update public.eventos
   set sale_status = case
     when lower(coalesce(status, 'ativo')) = 'encerrado' then 'esgotado'
     else 'ativo'
   end
 where sale_status is null;

alter table public.eventos
  alter column sale_status set default 'ativo';

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'eventos_sale_status_ck'
       and conrelid = 'public.eventos'::regclass
  ) then
    alter table public.eventos drop constraint eventos_sale_status_ck;
  end if;

  alter table public.eventos
    add constraint eventos_sale_status_ck
    check (sale_status in ('ativo', 'em_breve', 'esgotado'));
end;
$$;

alter table public.orders
  add column if not exists seller_type text,
  add column if not exists seller_id text,
  add column if not exists seller_name text,
  add column if not exists seller_logo_url text,
  add column if not exists payment_config jsonb;

update public.orders
   set seller_type = 'tenant'
 where seller_type is null;

alter table public.orders
  alter column seller_type set default 'tenant';

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'orders_seller_type_ck'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_seller_type_ck;
  end if;

  alter table public.orders
    add constraint orders_seller_type_ck
    check (seller_type in ('tenant', 'mini_vendor'));
end;
$$;

alter table public.solicitacoes_ingressos
  add column if not exists payment_config jsonb;

create table if not exists public.mini_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id text not null references public.users(uid) on delete cascade,
  status text not null default 'pending',
  store_name text not null default '',
  slug text,
  description text,
  logo_url text,
  cover_url text,
  pix_key text,
  pix_bank text,
  pix_holder text,
  pix_whatsapp text,
  instagram text,
  instagram_enabled boolean not null default false,
  whatsapp text,
  whatsapp_enabled boolean not null default false,
  category_button_color text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_mini_vendors_tenant_user_unique
  on public.mini_vendors (tenant_id, user_id);

create index if not exists idx_mini_vendors_tenant_status
  on public.mini_vendors (tenant_id, status);

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'mini_vendors_status_ck'
       and conrelid = 'public.mini_vendors'::regclass
  ) then
    alter table public.mini_vendors drop constraint mini_vendors_status_ck;
  end if;

  alter table public.mini_vendors
    add constraint mini_vendors_status_ck
    check (status in ('pending', 'approved', 'rejected', 'disabled'));
end;
$$;

alter table public.mini_vendors enable row level security;

drop policy if exists "mini_vendors_select" on public.mini_vendors;
create policy "mini_vendors_select"
  on public.mini_vendors
  for select
  to authenticated
  using (
    user_id = auth.uid()::text
    or public.mt_can_manage_tenant(tenant_id)
    or status = 'approved'
  );

drop policy if exists "mini_vendors_insert" on public.mini_vendors;
create policy "mini_vendors_insert"
  on public.mini_vendors
  for insert
  to authenticated
  with check (
    user_id = auth.uid()::text
    and tenant_id is not null
  );

drop policy if exists "mini_vendors_update" on public.mini_vendors;
create policy "mini_vendors_update"
  on public.mini_vendors
  for update
  to authenticated
  using (
    user_id = auth.uid()::text
    or public.mt_can_manage_tenant(tenant_id)
  )
  with check (
    user_id = auth.uid()::text
    or public.mt_can_manage_tenant(tenant_id)
  );

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
        'mini_vendor','admin_tenant','master_tenant'
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
        'mini_vendor','admin_tenant','master_tenant'
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
        'mini_vendor','admin_tenant'
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
        'mini_vendor','admin_tenant','master_tenant'
      )
    );
end;
$$;

