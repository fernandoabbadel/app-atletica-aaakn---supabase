alter table public.tenant_invites
  add column if not exists is_revoked boolean not null default false;

alter table public.tenant_invites
  add column if not exists revoked_at timestamptz;

alter table public.tenant_invites
  add column if not exists revoked_by text;

create index if not exists idx_tenant_invites_created_by_created_at
  on public.tenant_invites (tenant_id, created_by, created_at desc);

create index if not exists idx_tenant_invites_revoked
  on public.tenant_invites (tenant_id, is_revoked);

create table if not exists public.tenant_mentorships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mentor_user_id text not null references public.users(uid) on delete cascade,
  mentee_user_id text not null references public.users(uid) on delete cascade,
  initiator_user_id text not null references public.users(uid) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  message text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_mentorships_users_diff_ck
    check (mentor_user_id <> mentee_user_id),
  constraint tenant_mentorships_pair_unique
    unique (tenant_id, mentor_user_id, mentee_user_id)
);

create index if not exists idx_tenant_mentorships_tenant_status_created
  on public.tenant_mentorships (tenant_id, status, created_at desc);

create index if not exists idx_tenant_mentorships_mentor
  on public.tenant_mentorships (tenant_id, mentor_user_id, created_at desc);

create index if not exists idx_tenant_mentorships_mentee
  on public.tenant_mentorships (tenant_id, mentee_user_id, created_at desc);

create unique index if not exists idx_tenant_mentorships_unique_active_mentor
  on public.tenant_mentorships (tenant_id, mentor_user_id)
  where status = 'accepted';

create unique index if not exists idx_tenant_mentorships_unique_active_mentee
  on public.tenant_mentorships (tenant_id, mentee_user_id)
  where status = 'accepted';

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgname = 'trg_tenant_mentorships_touch'
       and tgrelid = 'public.tenant_mentorships'::regclass
  ) then
    create trigger trg_tenant_mentorships_touch
      before update on public.tenant_mentorships
      for each row execute function public.mt_touch_updated_at();
  end if;
end $$;

alter table public.tenant_mentorships enable row level security;

drop policy if exists tenant_mentorships_select on public.tenant_mentorships;
create policy tenant_mentorships_select
  on public.tenant_mentorships
  for select
  to authenticated
  using (
    public.mt_can_access_tenant_row(tenant_id)
    and (
      status = 'accepted'
      or public.mt_is_platform_master()
      or public.mt_can_manage_tenant(tenant_id)
      or mentor_user_id = auth.uid()::text
      or mentee_user_id = auth.uid()::text
      or initiator_user_id = auth.uid()::text
    )
  );

drop policy if exists tenant_mentorships_insert on public.tenant_mentorships;
create policy tenant_mentorships_insert
  on public.tenant_mentorships
  for insert
  to authenticated
  with check (
    public.mt_can_access_tenant_row(tenant_id)
    and (
      public.mt_is_platform_master()
      or public.mt_can_manage_tenant(tenant_id)
      or (
        initiator_user_id = auth.uid()::text
        and (
          mentor_user_id = auth.uid()::text
          or mentee_user_id = auth.uid()::text
        )
      )
    )
  );

drop policy if exists tenant_mentorships_update on public.tenant_mentorships;
create policy tenant_mentorships_update
  on public.tenant_mentorships
  for update
  to authenticated
  using (
    public.mt_can_access_tenant_row(tenant_id)
    and (
      public.mt_is_platform_master()
      or public.mt_can_manage_tenant(tenant_id)
      or mentor_user_id = auth.uid()::text
      or mentee_user_id = auth.uid()::text
      or initiator_user_id = auth.uid()::text
    )
  )
  with check (
    public.mt_can_access_tenant_row(tenant_id)
    and (
      public.mt_is_platform_master()
      or public.mt_can_manage_tenant(tenant_id)
      or mentor_user_id = auth.uid()::text
      or mentee_user_id = auth.uid()::text
      or initiator_user_id = auth.uid()::text
    )
  );

notify pgrst, 'reload schema';
