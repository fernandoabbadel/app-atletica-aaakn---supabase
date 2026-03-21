create table if not exists public.mini_vendor_followers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mini_vendor_id uuid not null references public.mini_vendors(id) on delete cascade,
  user_id text not null references public.users(uid) on delete cascade,
  user_name text not null default '',
  user_avatar text,
  user_turma text,
  followed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_mini_vendor_followers_unique
  on public.mini_vendor_followers (tenant_id, mini_vendor_id, user_id);

create index if not exists idx_mini_vendor_followers_vendor
  on public.mini_vendor_followers (tenant_id, mini_vendor_id);

create index if not exists idx_mini_vendor_followers_user
  on public.mini_vendor_followers (tenant_id, user_id);

create table if not exists public.mini_vendor_likes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mini_vendor_id uuid not null references public.mini_vendors(id) on delete cascade,
  user_id text not null references public.users(uid) on delete cascade,
  user_name text not null default '',
  user_avatar text,
  user_turma text,
  liked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_mini_vendor_likes_unique
  on public.mini_vendor_likes (tenant_id, mini_vendor_id, user_id);

create index if not exists idx_mini_vendor_likes_vendor
  on public.mini_vendor_likes (tenant_id, mini_vendor_id);

create index if not exists idx_mini_vendor_likes_user
  on public.mini_vendor_likes (tenant_id, user_id);

alter table public.mini_vendor_followers enable row level security;
alter table public.mini_vendor_likes enable row level security;

drop policy if exists mini_vendor_followers_select on public.mini_vendor_followers;
create policy mini_vendor_followers_select
  on public.mini_vendor_followers
  for select
  to authenticated
  using (public.mt_can_access_tenant_row(tenant_id));

drop policy if exists mini_vendor_followers_insert on public.mini_vendor_followers;
create policy mini_vendor_followers_insert
  on public.mini_vendor_followers
  for insert
  to authenticated
  with check (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or user_id = auth.uid()::text
  );

drop policy if exists mini_vendor_followers_delete on public.mini_vendor_followers;
create policy mini_vendor_followers_delete
  on public.mini_vendor_followers
  for delete
  to authenticated
  using (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or user_id = auth.uid()::text
  );

drop policy if exists mini_vendor_likes_select on public.mini_vendor_likes;
create policy mini_vendor_likes_select
  on public.mini_vendor_likes
  for select
  to authenticated
  using (public.mt_can_access_tenant_row(tenant_id));

drop policy if exists mini_vendor_likes_insert on public.mini_vendor_likes;
create policy mini_vendor_likes_insert
  on public.mini_vendor_likes
  for insert
  to authenticated
  with check (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or user_id = auth.uid()::text
  );

drop policy if exists mini_vendor_likes_delete on public.mini_vendor_likes;
create policy mini_vendor_likes_delete
  on public.mini_vendor_likes
  for delete
  to authenticated
  using (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or user_id = auth.uid()::text
  );

notify pgrst, 'reload schema';
