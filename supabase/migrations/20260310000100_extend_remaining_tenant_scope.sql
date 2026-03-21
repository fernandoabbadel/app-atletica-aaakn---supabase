-- Extend tenant scope to the remaining tenant-owned tables.
-- Platform-level tables such as tenants, tenant_platform_config and
-- tenant_onboarding_requests are intentionally excluded.

create or replace function public.mt_extract_tenant_id_from_scoped_text_id(p_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clean text;
  v_candidate text;
begin
  v_clean := nullif(trim(coalesce(p_id, '')), '');
  if v_clean is null then
    return null;
  end if;

  if v_clean ~ '^tenant:[0-9a-fA-F-]{36}::' then
    v_candidate := substring(v_clean from '^tenant:([0-9a-fA-F-]{36})::');
  elsif v_clean ~ '__[0-9a-fA-F-]{36}$' then
    v_candidate := substring(v_clean from '__([0-9a-fA-F-]{36})$');
  else
    return null;
  end if;

  if nullif(trim(coalesce(v_candidate, '')), '') is null then
    return null;
  end if;

  return v_candidate::uuid;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.mt_extract_tenant_id_from_scoped_text_id(text) to authenticated;

do $$
declare
  table_name text;
  fk_name text;
  idx_name text;
begin
  foreach table_name in array array[
    'achievements_config',
    'achievements_logs',
    'activity_logs',
    'album_captures',
    'album_config',
    'app_config',
    'arena_matches',
    'assinaturas',
    'banned_appeals',
    'categorias',
    'community_category_reads',
    'guia_data',
    'gym_logs',
    'historic_events',
    'legal_docs',
    'ligas_config',
    'notifications',
    'parceiros',
    'patentes_config',
    'planos',
    'quiz_history',
    'scans',
    'settings',
    'site_config',
    'solicitacoes_adesao',
    'store_redemptions',
    'store_rewards',
    'support_requests',
    'users_followers',
    'users_following'
  ] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid', table_name);

    fk_name := format('%s_tenant_fk', table_name);
    if not exists (
      select 1
        from pg_constraint
       where conname = fk_name
         and conrelid = to_regclass('public.' || table_name)
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete set null',
        table_name,
        fk_name
      );
    end if;

    idx_name := format('idx_%s_tenant_id', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', idx_name, table_name);
  end loop;
end;
$$;

create or replace function public.mt_fill_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_tenant_id uuid;
  v_user_id text;
  v_evento_id text;
  v_treino_id text;
  v_post_id text;
  v_product_id text;
  v_reward_id text;
  v_partner_id text;
  v_row_id text;
begin
  if new.tenant_id is not null then
    return new;
  end if;

  v_payload := to_jsonb(new);
  v_row_id := nullif(trim(coalesce(v_payload ->> 'id', '')), '');

  v_user_id := nullif(trim(coalesce(
    v_payload ->> 'userId',
    v_payload ->> 'user_id',
    v_payload ->> 'requester_user_id',
    v_payload ->> 'reporterId',
    v_payload ->> 'criadorId',
    v_payload ->> 'treinadorId',
    v_payload ->> 'created_by',
    v_payload ->> 'uid',
    v_payload ->> 'collectorUserId',
    v_payload ->> 'targetUserId',
    v_payload ->> 'attackerId',
    v_payload ->> 'defenderId'
  )), '');

  if v_user_id is not null then
    select u.tenant_id
      into v_tenant_id
      from public.users u
     where u.uid = v_user_id
       and coalesce(u.tenant_status, 'approved') = 'approved'
     limit 1;
  end if;

  if v_tenant_id is null then
    v_evento_id := nullif(trim(coalesce(v_payload ->> 'eventoId', v_payload ->> 'evento_id')), '');
    if v_evento_id is not null then
      select e.tenant_id
        into v_tenant_id
        from public.eventos e
       where e.id = v_evento_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_treino_id := nullif(trim(coalesce(v_payload ->> 'treinoId', v_payload ->> 'treino_id')), '');
    if v_treino_id is not null then
      select t.tenant_id
        into v_tenant_id
        from public.treinos t
       where t.id = v_treino_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_post_id := nullif(trim(coalesce(v_payload ->> 'postId', v_payload ->> 'post_id')), '');
    if v_post_id is not null then
      select p.tenant_id
        into v_tenant_id
        from public.posts p
       where p.id = v_post_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_product_id := nullif(trim(coalesce(
      v_payload ->> 'productId',
      v_payload ->> 'productid',
      v_payload ->> 'produtoId',
      v_payload ->> 'produto_id'
    )), '');

    if v_product_id is not null then
      select pr.tenant_id
        into v_tenant_id
        from public.produtos pr
       where pr.id = v_product_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_reward_id := nullif(trim(coalesce(v_payload ->> 'rewardId', v_payload ->> 'reward_id')), '');
    if v_reward_id is not null then
      select sr.tenant_id
        into v_tenant_id
        from public.store_rewards sr
       where sr.id = v_reward_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_partner_id := nullif(trim(coalesce(v_payload ->> 'empresaId', v_payload ->> 'empresa_id')), '');
    if v_partner_id is not null then
      select p.tenant_id
        into v_tenant_id
        from public.parceiros p
       where p.id = v_partner_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null and v_row_id is not null then
    select t.id
      into v_tenant_id
      from public.tenants t
     where t.id = public.mt_extract_tenant_id_from_scoped_text_id(v_row_id)
     limit 1;
  end if;

  if v_tenant_id is null then
    v_tenant_id := public.mt_current_tenant_id();
  end if;

  new.tenant_id := v_tenant_id;
  return new;
end;
$$;

grant execute on function public.mt_fill_tenant_id() to authenticated;

-- Backfill by tenant-scoped row id conventions:
-- tenant:<tenant-id>::<base-id>
-- <base-id>__<tenant-id>
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'achievements_config',
    'achievements_logs',
    'activity_logs',
    'album_captures',
    'album_config',
    'app_config',
    'arena_matches',
    'assinaturas',
    'banned_appeals',
    'categorias',
    'community_category_reads',
    'guia_data',
    'gym_logs',
    'historic_events',
    'legal_docs',
    'ligas_config',
    'notifications',
    'parceiros',
    'patentes_config',
    'planos',
    'quiz_history',
    'scans',
    'settings',
    'site_config',
    'solicitacoes_adesao',
    'store_redemptions',
    'store_rewards',
    'support_requests',
    'users_followers',
    'users_following'
  ] loop
    execute format(
      'update public.%I
          set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
        where tenant_id is null
          and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null
          and exists (
            select 1
              from public.tenants t
             where t.id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
          )',
      table_name
    );
  end loop;
end;
$$;

-- User-linked rows
update public.achievements_logs al
   set tenant_id = u.tenant_id
  from public.users u
 where al.tenant_id is null
   and u.uid = al."userId"
   and u.tenant_id is not null;

update public.activity_logs al
   set tenant_id = u.tenant_id
  from public.users u
 where al.tenant_id is null
   and u.uid = al."userId"
   and u.tenant_id is not null;

update public.album_captures ac
   set tenant_id = u.tenant_id
  from public.users u
 where ac.tenant_id is null
   and u.uid = ac."collectorUserId"
   and u.tenant_id is not null;

update public.album_captures ac
   set tenant_id = u.tenant_id
  from public.users u
 where ac.tenant_id is null
   and u.uid = ac."targetUserId"
   and u.tenant_id is not null;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'arena_matches'
       and column_name = 'userId'
  ) then
    update public.arena_matches am
       set tenant_id = u.tenant_id
      from public.users u
     where am.tenant_id is null
       and u.uid = am."userId"
       and u.tenant_id is not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'arena_matches'
       and column_name = 'attackerId'
  ) then
    update public.arena_matches am
       set tenant_id = u.tenant_id
      from public.users u
     where am.tenant_id is null
       and u.uid = am."attackerId"
       and u.tenant_id is not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'arena_matches'
       and column_name = 'defenderId'
  ) then
    update public.arena_matches am
       set tenant_id = u.tenant_id
      from public.users u
     where am.tenant_id is null
       and u.uid = am."defenderId"
       and u.tenant_id is not null;
  end if;
end;
$$;

update public.assinaturas a
   set tenant_id = u.tenant_id
  from public.users u
 where a.tenant_id is null
   and u.uid = a."userId"
   and u.tenant_id is not null;

update public.banned_appeals ba
   set tenant_id = u.tenant_id
  from public.users u
 where ba.tenant_id is null
   and u.uid = ba."userId"
   and u.tenant_id is not null;

update public.community_category_reads ccr
   set tenant_id = u.tenant_id
  from public.users u
 where ccr.tenant_id is null
   and u.uid = ccr."userId"
   and u.tenant_id is not null;

update public.gym_logs gl
   set tenant_id = u.tenant_id
  from public.users u
 where gl.tenant_id is null
   and u.uid = gl."userId"
   and u.tenant_id is not null;

update public.notifications n
   set tenant_id = u.tenant_id
  from public.users u
 where n.tenant_id is null
   and u.uid = n."userId"
   and u.tenant_id is not null;

update public.quiz_history qh
   set tenant_id = u.tenant_id
  from public.users u
 where qh.tenant_id is null
   and u.uid = qh."userId"
   and u.tenant_id is not null;

update public.scans s
   set tenant_id = u.tenant_id
  from public.users u
 where s.tenant_id is null
   and u.uid = s."userId"
   and u.tenant_id is not null;

update public.solicitacoes_adesao sa
   set tenant_id = u.tenant_id
  from public.users u
 where sa.tenant_id is null
   and u.uid = sa."userId"
   and u.tenant_id is not null;

update public.store_redemptions sr
   set tenant_id = u.tenant_id
  from public.users u
 where sr.tenant_id is null
   and u.uid = sr."userId"
   and u.tenant_id is not null;

update public.support_requests sr
   set tenant_id = u.tenant_id
  from public.users u
 where sr.tenant_id is null
   and u.uid = sr."userId"
   and u.tenant_id is not null;

update public.users_followers uf
   set tenant_id = u.tenant_id
  from public.users u
 where uf.tenant_id is null
   and u.uid = uf."userId"
   and u.tenant_id is not null;

update public.users_followers uf
   set tenant_id = u.tenant_id
  from public.users u
 where uf.tenant_id is null
   and u.uid = uf.uid
   and u.tenant_id is not null;

update public.users_following uf
   set tenant_id = u.tenant_id
  from public.users u
 where uf.tenant_id is null
   and u.uid = uf."userId"
   and u.tenant_id is not null;

update public.users_following uf
   set tenant_id = u.tenant_id
  from public.users u
 where uf.tenant_id is null
   and u.uid = uf.uid
   and u.tenant_id is not null;

-- Parent/child inference where all linked rows point to a single tenant
with reward_candidates as (
  select sr."rewardId" as reward_id, sr.tenant_id
    from public.store_redemptions sr
   where sr.tenant_id is not null
     and nullif(trim(coalesce(sr."rewardId", '')), '') is not null
),
single_tenant_rewards as (
  select reward_id, min(tenant_id::text)::uuid as tenant_id
    from reward_candidates
   group by reward_id
  having count(distinct tenant_id) = 1
)
update public.store_rewards sr
   set tenant_id = str.tenant_id
  from single_tenant_rewards str
 where sr.tenant_id is null
   and sr.id = str.reward_id;

with plan_candidates as (
  select sa."planoId" as plan_id, sa.tenant_id
    from public.solicitacoes_adesao sa
   where sa.tenant_id is not null
     and nullif(trim(coalesce(sa."planoId", '')), '') is not null
  union all
  select a."planoId" as plan_id, a.tenant_id
    from public.assinaturas a
   where a.tenant_id is not null
     and nullif(trim(coalesce(a."planoId", '')), '') is not null
),
single_tenant_plans as (
  select plan_id, min(tenant_id::text)::uuid as tenant_id
    from plan_candidates
   group by plan_id
  having count(distinct tenant_id) = 1
)
update public.planos p
   set tenant_id = stp.tenant_id
  from single_tenant_plans stp
 where p.tenant_id is null
   and p.id = stp.plan_id;

with partner_candidates as (
  select s."empresaId" as partner_id, s.tenant_id
    from public.scans s
   where s.tenant_id is not null
     and nullif(trim(coalesce(s."empresaId", '')), '') is not null
),
single_tenant_partners as (
  select partner_id, min(tenant_id::text)::uuid as tenant_id
    from partner_candidates
   group by partner_id
  having count(distinct tenant_id) = 1
)
update public.parceiros p
   set tenant_id = stp.tenant_id
  from single_tenant_partners stp
 where p.tenant_id is null
   and p.id = stp.partner_id;

update public.scans s
   set tenant_id = p.tenant_id
  from public.parceiros p
 where s.tenant_id is null
   and s."empresaId" = p.id
   and p.tenant_id is not null;

with category_candidates as (
  select c.id as category_id, p.tenant_id
    from public.categorias c
    join public.produtos p
      on lower(trim(coalesce(p.categoria, ''))) = lower(trim(coalesce(c.nome, '')))
   where p.tenant_id is not null
     and nullif(trim(coalesce(c.nome, '')), '') is not null
),
single_tenant_categories as (
  select category_id, min(tenant_id::text)::uuid as tenant_id
    from category_candidates
   group by category_id
  having count(distinct tenant_id) = 1
)
update public.categorias c
   set tenant_id = stc.tenant_id
  from single_tenant_categories stc
 where c.tenant_id is null
   and c.id = stc.category_id;

with league_candidates as (
  select l.id as league_id, u.tenant_id
    from public.ligas_config l
    join lateral unnest(coalesce(l."membrosIds", '{}'::text[])) as member_uid(member_id) on true
    join public.users u
      on u.uid = member_uid.member_id
   where u.tenant_id is not null
),
single_tenant_leagues as (
  select league_id, min(tenant_id::text)::uuid as tenant_id
    from league_candidates
   group by league_id
  having count(distinct tenant_id) = 1
)
update public.ligas_config l
   set tenant_id = stl.tenant_id
  from single_tenant_leagues stl
 where l.tenant_id is null
   and l.id = stl.league_id;

-- In a still-single-tenant database, assign remaining nulls to the only active tenant.
do $$
declare
  v_active_count integer;
  v_default_tenant uuid;
  table_name text;
begin
  select count(*)
    into v_active_count
    from public.tenants
   where status = 'active';

  if v_active_count = 1 then
    select t.id
      into v_default_tenant
      from public.tenants t
     where t.status = 'active'
     order by t.created_at asc
     limit 1;

    if v_default_tenant is not null then
      foreach table_name in array array[
        'achievements_config',
        'achievements_logs',
        'activity_logs',
        'album_captures',
        'album_config',
        'app_config',
        'arena_matches',
        'assinaturas',
        'banned_appeals',
        'categorias',
        'community_category_reads',
        'guia_data',
        'gym_logs',
        'historic_events',
        'legal_docs',
        'ligas_config',
        'notifications',
        'parceiros',
        'patentes_config',
        'planos',
        'quiz_history',
        'scans',
        'settings',
        'site_config',
        'solicitacoes_adesao',
        'store_redemptions',
        'store_rewards',
        'support_requests',
        'users_followers',
        'users_following'
      ] loop
        execute format(
          'update public.%I set tenant_id = %L::uuid where tenant_id is null',
          table_name,
          v_default_tenant::text
        );
      end loop;
    end if;
  end if;
end;
$$;

-- Tenant-scoped RLS + automatic tenant fill
do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'achievements_config',
    'achievements_logs',
    'activity_logs',
    'album_captures',
    'album_config',
    'app_config',
    'arena_matches',
    'assinaturas',
    'banned_appeals',
    'categorias',
    'community_category_reads',
    'guia_data',
    'gym_logs',
    'historic_events',
    'legal_docs',
    'ligas_config',
    'notifications',
    'parceiros',
    'patentes_config',
    'planos',
    'quiz_history',
    'scans',
    'settings',
    'site_config',
    'solicitacoes_adesao',
    'store_redemptions',
    'store_rewards',
    'support_requests',
    'users_followers',
    'users_following'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);

    if exists (
      select 1
        from pg_policies
       where schemaname = 'public'
         and tablename = table_name
         and policyname = 'dev_allow_all'
    ) then
      execute format('drop policy dev_allow_all on public.%I', table_name);
    end if;

    trigger_name := format('trg_%s_tenant_fill', table_name);
    if exists (
      select 1
        from pg_trigger
       where tgname = trigger_name
         and tgrelid = to_regclass('public.' || table_name)
    ) then
      execute format('drop trigger %I on public.%I', trigger_name, table_name);
    end if;

    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.mt_fill_tenant_id()',
      trigger_name,
      table_name
    );

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);

    execute format(
      'create policy tenant_scope_select on public.%I for select to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_insert on public.%I for insert to authenticated with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_update on public.%I for update to authenticated using (public.mt_can_access_tenant_row(tenant_id)) with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_delete on public.%I for delete to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );
  end loop;
end;
$$;
