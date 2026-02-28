-- Ligas: historico do quiz por usuario (compativel com users/*/quiz_history)
create table if not exists public.quiz_history (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null references public.users(uid) on delete cascade,
  date timestamptz not null default now(),
  "topMatch" text not null default '',
  keywords text[] not null default '{}',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create index if not exists idx_quiz_history_user_date_desc
  on public.quiz_history ("userId", date desc);

alter table public.quiz_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quiz_history'
      and policyname = 'quiz_history_select_own'
  ) then
    create policy quiz_history_select_own
      on public.quiz_history
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
      and tablename = 'quiz_history'
      and policyname = 'quiz_history_insert_own'
  ) then
    create policy quiz_history_insert_own
      on public.quiz_history
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
      and tablename = 'quiz_history'
      and policyname = 'quiz_history_update_own'
  ) then
    create policy quiz_history_update_own
      on public.quiz_history
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
      and tablename = 'quiz_history'
      and policyname = 'quiz_history_delete_own'
  ) then
    create policy quiz_history_delete_own
      on public.quiz_history
      for delete
      to authenticated
      using (auth.uid()::text = "userId");
  end if;
end;
$$;
