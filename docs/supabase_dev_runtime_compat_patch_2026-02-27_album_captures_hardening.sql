-- Album: hardening para captura por QR sem Edge Functions
-- Objetivos:
-- 1) anti-duplicidade no banco (collector + target)
-- 2) indices para leitura rapida por coletor
-- 3) politicas RLS minimas para uso client-side seguro

create table if not exists public.album_captures (
  id text primary key default gen_random_uuid()::text,
  "collectorUserId" text not null references public.users(uid) on delete cascade,
  "targetUserId" text not null references public.users(uid) on delete cascade,
  nome text,
  turma text,
  "dataColada" timestamptz not null default now()
);

alter table public.album_captures
  add column if not exists "collectorUserId" text,
  add column if not exists "targetUserId" text,
  add column if not exists nome text,
  add column if not exists turma text,
  add column if not exists "dataColada" timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'album_captures_collector_fk'
      and conrelid = 'public.album_captures'::regclass
  ) then
    alter table public.album_captures
      add constraint album_captures_collector_fk
      foreign key ("collectorUserId") references public.users(uid) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'album_captures_target_fk'
      and conrelid = 'public.album_captures'::regclass
  ) then
    alter table public.album_captures
      add constraint album_captures_target_fk
      foreign key ("targetUserId") references public.users(uid) on delete cascade;
  end if;
end;
$$;

-- trava anti-duplicidade por dupla coletor/alvo
create unique index if not exists uq_album_captures_collector_target
  on public.album_captures ("collectorUserId", "targetUserId");

create index if not exists idx_album_captures_collector_data_desc
  on public.album_captures ("collectorUserId", "dataColada" desc);

create index if not exists idx_album_captures_target_data_desc
  on public.album_captures ("targetUserId", "dataColada" desc);

-- Migra legado users/uid/albumColado -> album_captures (se existir)
do $$
declare
  legacy_table text;
begin
  for legacy_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and lower(tablename) = lower('users_albumColado')
  loop
    execute format($sql$
      insert into public.album_captures (
        "collectorUserId",
        "targetUserId",
        nome,
        turma,
        "dataColada"
      )
      select
        coalesce(
          nullif(to_jsonb(src) ->> 'userId', ''),
          nullif(to_jsonb(src) ->> 'userid', '')
        ) as "collectorUserId",
        nullif(to_jsonb(src) ->> 'id', '') as "targetUserId",
        nullif(to_jsonb(src) ->> 'nome', '') as nome,
        upper(coalesce(nullif(to_jsonb(src) ->> 'turma', ''), 'OUTROS')) as turma,
        now() as "dataColada"
      from public.%I as src
      where coalesce(
        nullif(to_jsonb(src) ->> 'userId', ''),
        nullif(to_jsonb(src) ->> 'userid', '')
      ) is not null
        and nullif(to_jsonb(src) ->> 'id', '') is not null
      on conflict ("collectorUserId", "targetUserId") do nothing;
    $sql$, legacy_table);
  end loop;
end;
$$;

alter table public.album_captures enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'album_captures'
      and policyname = 'album_captures_select_own'
  ) then
    create policy album_captures_select_own
      on public.album_captures
      for select
      to authenticated
      using (auth.uid()::text = "collectorUserId");
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'album_captures'
      and policyname = 'album_captures_insert_own'
  ) then
    create policy album_captures_insert_own
      on public.album_captures
      for insert
      to authenticated
      with check (
        auth.uid()::text = "collectorUserId"
        and "collectorUserId" <> "targetUserId"
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'album_captures'
      and policyname = 'album_captures_delete_own'
  ) then
    create policy album_captures_delete_own
      on public.album_captures
      for delete
      to authenticated
      using (auth.uid()::text = "collectorUserId");
  end if;
end;
$$;
