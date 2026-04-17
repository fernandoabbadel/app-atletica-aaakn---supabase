-- Harden profile follow toggles against hidden legacy follow rows.
--
-- Older follow rows can have a null tenant_id or be invisible to the tenant-only
-- SELECT policy. Browser-side upserts then hit RLS during the ON CONFLICT path.
-- This RPC validates the authenticated viewer, normalizes legacy rows into the
-- active tenant, and keeps the denormalized stats counters in sync.

drop policy if exists tenant_follow_select on public.users_followers;
create policy tenant_follow_select on public.users_followers
  for select to authenticated
  using (
    public.mt_can_access_tenant_row(tenant_id)
    or uid = auth.uid()::text
    or "userId" = auth.uid()::text
  );

drop policy if exists tenant_follow_select on public.users_following;
create policy tenant_follow_select on public.users_following
  for select to authenticated
  using (
    public.mt_can_access_tenant_row(tenant_id)
    or uid = auth.uid()::text
    or "userId" = auth.uid()::text
  );

create or replace function public.profile_toggle_follow(
  p_tenant_id uuid default null,
  p_viewer_user_id text default null,
  p_target_user_id text default null,
  p_currently_following boolean default false,
  p_viewer_data jsonb default '{}'::jsonb,
  p_target_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid text := auth.uid()::text;
  v_viewer_uid text := nullif(trim(coalesce(p_viewer_user_id, '')), '');
  v_target_uid text := nullif(trim(coalesce(p_target_user_id, '')), '');
  v_tenant_id uuid := p_tenant_id;
  v_viewer_payload jsonb := coalesce(p_viewer_data, '{}'::jsonb);
  v_target_payload jsonb := coalesce(p_target_data, '{}'::jsonb);
  v_viewer_exists boolean := false;
  v_target_exists boolean := false;
  v_followed_at timestamptz := now();
  v_viewer_nome text;
  v_viewer_foto text;
  v_viewer_turma text;
  v_target_nome text;
  v_target_foto text;
  v_target_turma text;
  v_followers_count integer := 0;
  v_following_count integer := 0;
begin
  if coalesce(v_auth_uid, '') = '' then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_viewer_uid is null or v_target_uid is null or v_viewer_uid = v_target_uid then
    raise exception 'INVALID_FOLLOW_RELATION' using errcode = '22023';
  end if;

  if v_viewer_uid <> v_auth_uid then
    raise exception 'FOLLOW_VIEWER_MISMATCH' using errcode = '42501';
  end if;

  if v_tenant_id is null then
    select u.tenant_id
      into v_tenant_id
      from public.users u
     where u.uid = v_viewer_uid
       and coalesce(u.tenant_status, 'approved') = 'approved'
     limit 1;
  end if;

  if v_tenant_id is not null then
    select exists (
      select 1
        from public.users u
       where u.uid = v_viewer_uid
         and u.tenant_id = v_tenant_id
    )
      into v_viewer_exists;

    select exists (
      select 1
        from public.users u
       where u.uid = v_target_uid
         and u.tenant_id = v_tenant_id
    )
      into v_target_exists;
  else
    select exists (select 1 from public.users u where u.uid = v_viewer_uid)
      into v_viewer_exists;
    select exists (select 1 from public.users u where u.uid = v_target_uid)
      into v_target_exists;
  end if;

  if not v_viewer_exists or not v_target_exists then
    raise exception 'FOLLOW_TENANT_MISMATCH' using errcode = '42501';
  end if;

  v_viewer_nome := left(coalesce(nullif(trim(v_viewer_payload ->> 'nome'), ''), 'Atleta'), 120);
  v_viewer_foto := coalesce(trim(v_viewer_payload ->> 'foto'), '');
  v_viewer_turma := left(coalesce(nullif(trim(v_viewer_payload ->> 'turma'), ''), 'Geral'), 40);
  v_target_nome := left(coalesce(nullif(trim(v_target_payload ->> 'nome'), ''), 'Atleta'), 120);
  v_target_foto := coalesce(trim(v_target_payload ->> 'foto'), '');
  v_target_turma := left(coalesce(nullif(trim(v_target_payload ->> 'turma'), ''), 'Geral'), 40);

  if coalesce(p_currently_following, false) then
    delete from public.users_followers uf
     where uf."userId" = v_target_uid
       and uf.uid = v_viewer_uid
       and (v_tenant_id is null or uf.tenant_id = v_tenant_id or uf.tenant_id is null);

    delete from public.users_following uf
     where uf."userId" = v_viewer_uid
       and uf.uid = v_target_uid
       and (v_tenant_id is null or uf.tenant_id = v_tenant_id or uf.tenant_id is null);
  else
    insert into public.users_followers (
      "userId",
      uid,
      nome,
      foto,
      turma,
      "followedAt",
      tenant_id
    )
    values (
      v_target_uid,
      v_viewer_uid,
      v_viewer_nome,
      v_viewer_foto,
      v_viewer_turma,
      v_followed_at,
      v_tenant_id
    )
    on conflict ("userId", uid) do update
      set nome = excluded.nome,
          foto = excluded.foto,
          turma = excluded.turma,
          "followedAt" = excluded."followedAt",
          tenant_id = coalesce(excluded.tenant_id, public.users_followers.tenant_id);

    insert into public.users_following (
      "userId",
      uid,
      nome,
      foto,
      turma,
      "followedAt",
      tenant_id
    )
    values (
      v_viewer_uid,
      v_target_uid,
      v_target_nome,
      v_target_foto,
      v_target_turma,
      v_followed_at,
      v_tenant_id
    )
    on conflict ("userId", uid) do update
      set nome = excluded.nome,
          foto = excluded.foto,
          turma = excluded.turma,
          "followedAt" = excluded."followedAt",
          tenant_id = coalesce(excluded.tenant_id, public.users_following.tenant_id);

    insert into public.notifications (
      "userId",
      title,
      message,
      link,
      read,
      type,
      "createdAt",
      "updatedAt",
      tenant_id
    )
    values (
      v_target_uid,
      'Novo Seguidor!',
      v_viewer_nome || ' comecou a te seguir.',
      '/perfil/' || v_viewer_uid,
      false,
      'social',
      v_followed_at,
      v_followed_at,
      v_tenant_id
    );
  end if;

  select count(*)::integer
    into v_followers_count
    from public.users_followers uf
   where uf."userId" = v_target_uid
     and (v_tenant_id is null or uf.tenant_id = v_tenant_id);

  select count(*)::integer
    into v_following_count
    from public.users_following uf
   where uf."userId" = v_viewer_uid
     and (v_tenant_id is null or uf.tenant_id = v_tenant_id);

  update public.users u
     set stats = jsonb_set(
           coalesce(u.stats::jsonb, '{}'::jsonb),
           '{followersCount}',
           to_jsonb(v_followers_count),
           true
         ),
         "updatedAt" = v_followed_at
   where u.uid = v_target_uid
     and (v_tenant_id is null or u.tenant_id = v_tenant_id);

  update public.users u
     set stats = jsonb_set(
           coalesce(u.stats::jsonb, '{}'::jsonb),
           '{followingCount}',
           to_jsonb(v_following_count),
           true
         ),
         "updatedAt" = v_followed_at
   where u.uid = v_viewer_uid
     and (v_tenant_id is null or u.tenant_id = v_tenant_id);

  return jsonb_build_object(
    'isFollowing', not coalesce(p_currently_following, false),
    'followersCount', v_followers_count,
    'followingCount', v_following_count
  );
end;
$$;

grant execute on function public.profile_toggle_follow(uuid, text, text, boolean, jsonb, jsonb) to authenticated;

comment on function public.profile_toggle_follow(uuid, text, text, boolean, jsonb, jsonb) is
  'Consumer: src/lib/profilePublicService.ts. Secure tenant-aware follow toggle that repairs legacy hidden follow rows.';

notify pgrst, 'reload schema';
