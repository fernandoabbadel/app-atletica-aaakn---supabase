begin;

create extension if not exists pgcrypto;

-- Compat tables used by the Firestore-like layer but absent from the core free schema
create table if not exists public.guia_data (j
  id text primary key default gen_random_uuid()::text,
  categoria text,
  ordem integer,
  titulo text,
  url text,
  nome text,
  horario text,
  detalhe text,
  descricao text,
  foto text,
  numero text,
  cor text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_guia_data_categoria_ordem on public.guia_data (categoria, ordem);

create table if not exists public.historic_events (
  id text primary key default gen_random_uuid()::text,
  titulo text,
  data text,
  ano text,
  descricao text,
  local text,
  foto text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data_extra jsonb not null default '{}'::jsonb
);
create index if not exists idx_historic_events_data on public.historic_events (data desc);
create index if not exists idx_historic_events_updatedAt on public.historic_events ("updatedAt" desc);

create table if not exists public.store_rewards (
  id text primary key default gen_random_uuid()::text,
  title text not null default 'Premio',
  cost integer not null default 0,
  stock integer not null default 0,
  image text,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_store_rewards_active_cost on public.store_rewards (active, cost);

create table if not exists public.store_redemptions (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Atleta',
  "rewardId" text references public.store_rewards(id) on delete set null,
  "rewardTitle" text not null default 'Premio',
  cost integer not null default 0,
  status text not null default 'pendente',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_store_redemptions_user_createdAt on public.store_redemptions ("userId", "createdAt" desc);
create index if not exists idx_store_redemptions_status_createdAt on public.store_redemptions (status, "createdAt" desc);

create table if not exists public.legal_docs (
  id text primary key default gen_random_uuid()::text,
  titulo text not null default 'Sem titulo',
  conteudo text not null default '',
  tipo text not null default 'publico',
  "iconName" text not null default 'FileText',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_legal_docs_titulo on public.legal_docs (titulo asc);
create index if not exists idx_legal_docs_tipo_titulo on public.legal_docs (tipo, titulo asc);

create table if not exists public.support_requests (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Usuario',
  "userEmail" text,
  category text not null default 'geral',
  subject text not null default 'Suporte',
  message text not null default '',
  module text,
  status text not null default 'pending',
  response text,
  "readByAdmin" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "createdAtMs" bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  "resolvedAt" timestamptz,
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_support_requests_user_createdAt on public.support_requests ("userId", "createdAt" desc);
create index if not exists idx_support_requests_category_createdAt on public.support_requests (category, "createdAt" desc);
create index if not exists idx_support_requests_read_createdAt on public.support_requests ("readByAdmin", "createdAt" desc);

create table if not exists public.banned_appeals (
  id text primary key default gen_random_uuid()::text,
  "userId" text,
  "userName" text not null default 'Usuario',
  "userEmail" text,
  message text not null default '',
  reason text,
  status text not null default 'pending',
  response text,
  "readByAdmin" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "createdAtMs" bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  "resolvedAt" timestamptz,
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_banned_appeals_createdAt on public.banned_appeals ("createdAt" desc);
create index if not exists idx_banned_appeals_read_createdAt on public.banned_appeals ("readByAdmin", "createdAt" desc);

-- Legacy collection alias still referenced by settingsService (read-only)
create or replace view public.pedidos_loja as
select
  id,
  "userId",
  "userName",
  "productId",
  "productName",
  price,
  quantidade,
  itens,
  total,
  status,
  "approvedBy",
  "createdAt",
  "updatedAt",
  data
from public.orders;

-- Ensure uploads bucket exists and is public (app default)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = excluded.public;

-- RLS/grants for dev to keep the app functional with anon/authenticated clients.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- New storage read policy for signed/public URL fallbacks.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth insert'
  ) then
    execute 'create policy "uploads auth insert" on storage.objects for insert to authenticated with check (bucket_id = ''uploads'')';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth update'
  ) then
    execute 'create policy "uploads auth update" on storage.objects for update to authenticated using (bucket_id = ''uploads'') with check (bucket_id = ''uploads'')';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth delete'
  ) then
    execute 'create policy "uploads auth delete" on storage.objects for delete to authenticated using (bucket_id = ''uploads'')';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads public select'
  ) then
    execute 'create policy "uploads public select" on storage.objects for select to anon, authenticated using (bucket_id = ''uploads'')';
  end if;
end $$;

-- Dev-only permissive policies on all public tables so existing screens do not fail under RLS.
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = r.tablename
        and policyname = 'dev_allow_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
        'dev_allow_all',
        r.tablename
      );
    end if;
  end loop;
end $$;

commit;
