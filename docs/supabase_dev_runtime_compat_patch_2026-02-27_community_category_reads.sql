-- Comunidade: leitura por categoria persistente por usuário (cross-device)
create table if not exists public.community_category_reads (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null references public.users(uid) on delete cascade,
  categoria text not null,
  "categoriaKey" text not null,
  "readAt" timestamptz not null default now(),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("userId", "categoriaKey")
);

create index if not exists idx_community_reads_user_readAt_desc
  on public.community_category_reads ("userId", "readAt" desc);

create index if not exists idx_community_reads_categoria_key
  on public.community_category_reads ("categoriaKey");

alter table public.community_category_reads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_category_reads'
      and policyname = 'community_reads_select_own'
  ) then
    create policy community_reads_select_own
      on public.community_category_reads
      for select
      to authenticated
      using (auth.uid()::text = "userId");
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_category_reads'
      and policyname = 'community_reads_insert_own'
  ) then
    create policy community_reads_insert_own
      on public.community_category_reads
      for insert
      to authenticated
      with check (auth.uid()::text = "userId");
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_category_reads'
      and policyname = 'community_reads_update_own'
  ) then
    create policy community_reads_update_own
      on public.community_category_reads
      for update
      to authenticated
      using (auth.uid()::text = "userId")
      with check (auth.uid()::text = "userId");
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_category_reads'
      and policyname = 'community_reads_delete_own'
  ) then
    create policy community_reads_delete_own
      on public.community_category_reads
      for delete
      to authenticated
      using (auth.uid()::text = "userId");
  end if;
end;
$$;
