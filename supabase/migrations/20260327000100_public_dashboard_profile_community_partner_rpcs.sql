-- Foundation RPCs for Stage 1 (query consolidation / free-tier friendly).
--
-- Contracts:
-- 1) public.dashboard_public_home_bundle(p_tenant_id uuid, p_user_id text, p_reference_date date)
--    Consumer: src/lib/dashboardPublicService.ts
--    Returns a compact home bundle with:
--    - events: top public events with counts + viewer flags only
--    - produtos: active approved products with likesCount/viewerHasLiked/topTurmas
--    - parceiros: active partners summary
--    - ligas: followed visible leagues only, compact logoUrl fields (no logoBase64)
--    - mensagens: latest community highlights with likesCount/commentsCount/viewerHasLiked
--    - treinos: treino image urls only
--    - totalCaca / totalAlunos
--
-- 2) public.profile_public_bundle(p_tenant_id uuid, p_target_user_id text, p_viewer_user_id text, ...)
--    Consumer: src/lib/profilePublicService.ts
--    Returns a compact public profile bundle with:
--    - profile core fields from public.users
--    - followersCount / followingCount / isFollowing
--    - posts/events/treinos/ligas limited collections
--    - no followers list, no following list, no likes arrays, no logoBase64
--
-- 3) public.community_category_counts_bundle(p_tenant_id uuid, p_user_id text, p_categories text[], ...)
--    Consumer: src/lib/communityService.ts
--    Returns per-category counts in a single payload:
--    - recentCount
--    - unreadCount
--    - lastReadAt
--
-- 4) public.admin_partner_counts_bundle(p_tenant_id uuid)
--    Consumer: src/lib/partnersService.ts
--    Returns partner admin counters in one call:
--    - total / ativos / pendentes / desativados / ouro / prata / standard
--
-- Notes:
-- - New RPCs are additive. Existing RPCs remain intact.
-- - Payloads intentionally avoid blobs such as logoBase64, likesList, interessados
--   and full follower/following arrays when counts/flags are enough.
-- - Functions are STABLE and respect the current schema/multi-tenant model.

create or replace function public.mt_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_clean text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v_clean is null then
    return null;
  end if;

  return v_clean::timestamptz;
exception
  when others then
    return null;
end;
$$;

create or replace function public.mt_parse_local_date_text(p_value text)
returns date
language plpgsql
stable
as $$
declare
  v_clean text := nullif(trim(coalesce(p_value, '')), '');
  v_normalized text;
  v_parts text[];
  v_day integer;
  v_month integer;
  v_year integer;
  v_month_token text;
begin
  if v_clean is null then
    return null;
  end if;

  if v_clean ~ '^\d{4}-\d{2}-\d{2}$' then
    return to_date(v_clean, 'YYYY-MM-DD');
  end if;

  if v_clean ~ '^\d{2}/\d{2}/\d{4}$' then
    return to_date(v_clean, 'DD/MM/YYYY');
  end if;

  v_normalized := upper(v_clean);
  v_normalized := regexp_replace(v_normalized, '[.,/_-]+', ' ', 'g');
  v_normalized := regexp_replace(v_normalized, '\s+', ' ', 'g');
  v_parts := string_to_array(trim(v_normalized), ' ');

  if coalesce(array_length(v_parts, 1), 0) >= 2 and v_parts[1] ~ '^\d{1,2}$' then
    v_day := v_parts[1]::integer;
    v_month_token := left(v_parts[2], 3);
    v_month := case v_month_token
      when 'JAN' then 1
      when 'FEV' then 2
      when 'MAR' then 3
      when 'ABR' then 4
      when 'MAI' then 5
      when 'JUN' then 6
      when 'JUL' then 7
      when 'AGO' then 8
      when 'SET' then 9
      when 'OUT' then 10
      when 'NOV' then 11
      when 'DEZ' then 12
      else null
    end;

    if v_month is not null then
      v_year := case
        when coalesce(array_length(v_parts, 1), 0) >= 3 and v_parts[3] ~ '^\d{4}$'
          then v_parts[3]::integer
        else extract(year from timezone('America/Sao_Paulo', now()))::integer
      end;

      return make_date(v_year, v_month, v_day);
    end if;
  end if;

  begin
    return v_clean::date;
  exception
    when others then
      return null;
  end;
end;
$$;

create or replace function public.mt_parse_event_datetime(
  p_date text,
  p_time text default null
)
returns timestamp without time zone
language plpgsql
stable
as $$
declare
  v_date date;
  v_time_clean text := trim(coalesce(p_time, ''));
  v_hours integer := 0;
  v_minutes integer := 0;
begin
  v_date := public.mt_parse_local_date_text(p_date);
  if v_date is null then
    return null;
  end if;

  if v_time_clean ~ '^\d{1,2}:\d{2}$' then
    v_hours := greatest(0, least(23, split_part(v_time_clean, ':', 1)::integer));
    v_minutes := greatest(0, least(59, split_part(v_time_clean, ':', 2)::integer));
  end if;

  return v_date::timestamp + make_time(v_hours, v_minutes, 0);
end;
$$;

create or replace function public.mt_parse_day_end(p_value text)
returns timestamp without time zone
language plpgsql
stable
as $$
declare
  v_date date;
begin
  v_date := public.mt_parse_local_date_text(p_value);
  if v_date is null then
    return null;
  end if;

  return v_date::timestamp + time '23:59:59.999';
end;
$$;

create index if not exists idx_album_captures_tenant_target_user
  on public.album_captures (tenant_id, "targetUserId");

create index if not exists idx_posts_tenant_created_at_visible
  on public.posts (tenant_id, "createdAt" desc)
  where coalesce(blocked, false) is false;

create index if not exists idx_posts_tenant_categoria_created_at_visible
  on public.posts (tenant_id, categoria, "createdAt" desc)
  where coalesce(blocked, false) is false;

create index if not exists idx_posts_tenant_user_created_at
  on public.posts (tenant_id, "userId", "createdAt" desc);

create index if not exists idx_eventos_tenant_status_created_at
  on public.eventos (tenant_id, status, "createdAt" desc);

create index if not exists idx_eventos_interessados_gin
  on public.eventos using gin (interessados);

create index if not exists idx_treinos_tenant_status_created_at
  on public.treinos (tenant_id, status, "createdAt" desc);

create index if not exists idx_treinos_confirmados_gin
  on public.treinos using gin (confirmados);

create index if not exists idx_treinos_rsvps_tenant_user_status_timestamp
  on public.treinos_rsvps (tenant_id, "userId", status, timestamp desc);

create index if not exists idx_ligas_config_membros_ids_gin
  on public.ligas_config using gin ("membrosIds");

create index if not exists idx_ligas_config_tenant_status_created_at
  on public.ligas_config (tenant_id, status, "createdAt" desc);

create index if not exists idx_community_category_reads_user_categoria_read_at
  on public.community_category_reads ("userId", "categoriaKey", "readAt" desc);

create index if not exists idx_users_followers_user_followed_at
  on public.users_followers ("userId", "followedAt" desc);

create index if not exists idx_users_followers_user_uid
  on public.users_followers ("userId", uid);

create index if not exists idx_users_following_user_followed_at
  on public.users_following ("userId", "followedAt" desc);

create index if not exists idx_users_following_user_uid
  on public.users_following ("userId", uid);

create index if not exists idx_parceiros_tenant_status_nome
  on public.parceiros (tenant_id, status, nome);

create index if not exists idx_parceiros_tenant_status_tier
  on public.parceiros (tenant_id, status, tier);

create index if not exists idx_scans_tenant_empresa_timestamp
  on public.scans (tenant_id, "empresaId", timestamp desc);

create or replace function public.dashboard_public_home_bundle(
  p_tenant_id uuid default null,
  p_user_id text default null,
  p_reference_date date default current_date
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    nullif(trim(coalesce(p_user_id, '')), '') as user_id,
    coalesce(p_reference_date, current_date) as reference_date,
    timezone('America/Sao_Paulo', now())::timestamp without time zone as now_local
),
viewer as (
  select
    u.uid,
    coalesce(u.extra::jsonb, '{}'::jsonb) as extra
  from public.users u
  join params p on p.user_id is not null and u.uid = p.user_id
  where p.tenant_id is null or u.tenant_id = p.tenant_id
  limit 1
),
followed_leagues as (
  select distinct trim(entry.value) as league_id
  from viewer v
  cross join params p
  cross join lateral jsonb_array_elements_text(
    case
      when p.tenant_id is not null
        and jsonb_typeof(coalesce(v.extra -> 'followedLeagueIdsByTenant' -> (p.tenant_id::text), '[]'::jsonb)) = 'array'
        then coalesce(v.extra -> 'followedLeagueIdsByTenant' -> (p.tenant_id::text), '[]'::jsonb)
      when jsonb_typeof(coalesce(v.extra -> 'followedLeagueIds', '[]'::jsonb)) = 'array'
        then coalesce(v.extra -> 'followedLeagueIds', '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as entry(value)
  where trim(entry.value) <> ''
),
event_base as (
  select
    e.id,
    e.titulo,
    e.data,
    e.hora,
    e.local,
    e.imagem,
    e.tipo,
    e.status,
    e."imagePositionY",
    e."createdAt",
    public.mt_parse_event_datetime(e.data, e.hora) as event_at,
    cardinality(coalesce(e."likesList", '{}'::text[]))::integer as "likesCount",
    cardinality(coalesce(e.interessados, '{}'::text[]))::integer as "interessadosCount",
    exists (
      select 1
      from params p
      where p.user_id is not null
        and p.user_id = any(coalesce(e."likesList", '{}'::text[]))
    ) as "viewerHasLiked",
    exists (
      select 1
      from params p
      where p.user_id is not null
        and p.user_id = any(coalesce(e.interessados, '{}'::text[]))
    ) as "viewerIsInterested"
  from public.eventos e
  cross join params p
  where (p.tenant_id is null or e.tenant_id = p.tenant_id)
    and coalesce(lower(nullif(e.status, '')), 'ativo') not in ('encerrado', 'cancelado', 'inativo')
),
event_rows as (
  select *
  from event_base eb
  cross join params p
  where eb.event_at is null or eb.event_at + interval '24 hours' >= p.now_local
  order by eb.event_at asc nulls last, eb."createdAt" desc nulls last, eb.id
  limit 5
),
product_rows as (
  select
    pr.id,
    pr.nome,
    pr.preco,
    pr.img,
    pr."createdAt",
    cardinality(coalesce(pr.likes, '{}'::text[]))::integer as "likesCount",
    exists (
      select 1
      from params p
      where p.user_id is not null
        and p.user_id = any(coalesce(pr.likes, '{}'::text[]))
    ) as "viewerHasLiked",
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('turma', turma_stats.turma, 'count', turma_stats.total)
          order by turma_stats.total desc, turma_stats.turma
        )
        from (
          select
            regexp_replace(coalesce(u.turma, ''), '\D', '', 'g') as turma,
            count(*)::integer as total
          from unnest(coalesce(pr.likes, '{}'::text[])) as liked(uid)
          join public.users u on u.uid = liked.uid
          join params p2 on true
          where regexp_replace(coalesce(u.turma, ''), '\D', '', 'g') <> ''
            and (p2.tenant_id is null or u.tenant_id = p2.tenant_id)
          group by 1
          order by total desc, turma
          limit 3
        ) as turma_stats
      ),
      '[]'::jsonb
    ) as "topTurmas"
  from public.produtos pr
  cross join params p
  where (p.tenant_id is null or pr.tenant_id = p.tenant_id)
    and pr.active is true
    and pr.aprovado is true
  order by pr."createdAt" desc nulls last, pr.id
  limit 8
),
partner_rows as (
  select
    pa.id,
    pa.nome,
    pa."imgLogo",
    pa."imgCapa",
    pa.categoria,
    pa.tier,
    pa.status,
    pa."totalScans"
  from public.parceiros pa
  cross join params p
  where (p.tenant_id is null or pa.tenant_id = p.tenant_id)
    and coalesce(lower(nullif(pa.status, '')), 'active') = 'active'
  order by
    case lower(coalesce(pa.tier, ''))
      when 'ouro' then 0
      when 'prata' then 1
      else 2
    end,
    pa.nome asc,
    pa.id
  limit 50
),
league_rows as (
  select
    l.id,
    l.nome,
    l.sigla,
    l.foto,
    coalesce(l."logoUrl", l.logo) as "logoUrl",
    l.descricao,
    l.bizu,
    l.ativa,
    l.visivel,
    l.status,
    l.likes,
    l."createdAt",
    l."updatedAt"
  from public.ligas_config l
  join followed_leagues fl on fl.league_id = l.id
  cross join params p
  where (p.tenant_id is null or l.tenant_id = p.tenant_id)
    and l.visivel is true
  order by md5(coalesce(p.user_id, 'anon') || ':' || p.reference_date::text || ':' || l.id), l.likes desc, l.id
  limit 2
),
message_rows as (
  select
    po.id,
    po."userId",
    po."userName",
    po.avatar,
    po."createdAt",
    po.texto,
    cardinality(coalesce(po.likes, '{}'::text[]))::integer as "likesCount",
    coalesce(po.comentarios, 0)::integer as "commentsCount",
    exists (
      select 1
      from params p
      where p.user_id is not null
        and p.user_id = any(coalesce(po.likes, '{}'::text[]))
    ) as "viewerHasLiked"
  from public.posts po
  cross join params p
  where (p.tenant_id is null or po.tenant_id = p.tenant_id)
    and coalesce(po.blocked, false) is false
  order by po."createdAt" desc nulls last, po.id
  limit 2
),
viewer_treinos as (
  select distinct on (tr."treinoId")
    tr."treinoId" as treino_id,
    tr.timestamp as rsvp_timestamp
  from public.treinos_rsvps tr
  cross join params p
  where p.user_id is not null
    and tr."userId" = p.user_id
    and lower(coalesce(tr.status, '')) = 'going'
    and (p.tenant_id is null or tr.tenant_id = p.tenant_id)
  order by tr."treinoId", tr.timestamp desc nulls last
),
treino_base as (
  select
    t.id,
    t.imagem,
    t.dia,
    t."createdAt",
    public.mt_parse_day_end(t.dia) as treino_end_at,
    case when vt.treino_id is not null then 0 else 1 end as priority
  from public.treinos t
  cross join params p
  left join viewer_treinos vt on vt.treino_id = t.id
  where (p.tenant_id is null or t.tenant_id = p.tenant_id)
    and nullif(trim(coalesce(t.imagem, '')), '') is not null
    and (
      vt.treino_id is not null
      or lower(coalesce(t.status, '')) = 'ativo'
    )
),
treino_rows as (
  select tb.imagem
  from treino_base tb
  cross join params p
  where tb.treino_end_at is null or tb.treino_end_at >= p.now_local
  order by tb.priority, tb.treino_end_at desc nulls last, tb."createdAt" desc nulls last, tb.id
  limit 4
),
totals as (
  select
    (
      select count(*)::integer
      from public.users u
      cross join params p
      where p.tenant_id is null or u.tenant_id = p.tenant_id
    ) as "totalAlunos",
    coalesce(
      (
        select public.dashboard_total_caca_calouros(p.tenant_id)
        from params p
      ),
      0
    )::bigint as "totalCaca"
)
select jsonb_build_object(
  'events',
  coalesce(
    (
      select jsonb_agg(to_jsonb(event_payload))
      from (
        select
          er.id,
          er.titulo,
          er.data,
          er.hora,
          er.local,
          er.imagem,
          er.tipo,
          er.status,
          er."imagePositionY",
          er."likesCount",
          er."interessadosCount",
          er."viewerHasLiked",
          er."viewerIsInterested"
        from event_rows er
        order by er.event_at asc nulls last, er."createdAt" desc nulls last, er.id
      ) as event_payload
    ),
    '[]'::jsonb
  ),
  'produtos',
  coalesce(
    (
      select jsonb_agg(to_jsonb(product_payload))
      from (
        select
          pr.id,
          pr.nome,
          pr.preco,
          pr.img,
          pr."likesCount",
          pr."viewerHasLiked",
          pr."topTurmas"
        from product_rows pr
        order by pr."createdAt" desc nulls last, pr.id
      ) as product_payload
    ),
    '[]'::jsonb
  ),
  'parceiros',
  coalesce(
    (
      select jsonb_agg(to_jsonb(partner_payload))
      from (
        select
          pa.id,
          pa.nome,
          pa."imgLogo",
          pa."imgCapa",
          pa.categoria,
          pa.tier,
          pa.status,
          pa."totalScans"
        from partner_rows pa
        order by
          case lower(coalesce(pa.tier, ''))
            when 'ouro' then 0
            when 'prata' then 1
            else 2
          end,
          pa.nome asc,
          pa.id
      ) as partner_payload
    ),
    '[]'::jsonb
  ),
  'ligas',
  coalesce(
    (
      select jsonb_agg(to_jsonb(league_payload))
      from (
        select
          lr.id,
          lr.nome,
          lr.sigla,
          lr.foto,
          lr."logoUrl",
          lr.descricao,
          lr.bizu,
          lr.ativa,
          lr.visivel,
          lr.status,
          lr.likes,
          lr."createdAt",
          lr."updatedAt"
        from league_rows lr
      ) as league_payload
    ),
    '[]'::jsonb
  ),
  'mensagens',
  coalesce(
    (
      select jsonb_agg(to_jsonb(message_payload))
      from (
        select
          mr.id,
          mr."userId",
          mr."userName",
          mr.avatar,
          mr."createdAt",
          mr.texto,
          mr."likesCount",
          mr."commentsCount",
          mr."viewerHasLiked"
        from message_rows mr
        order by mr."createdAt" desc nulls last, mr.id
      ) as message_payload
    ),
    '[]'::jsonb
  ),
  'treinos',
  coalesce(
    (
      select jsonb_agg(to_jsonb(tr.imagem))
      from treino_rows tr
    ),
    '[]'::jsonb
  ),
  'totalAlunos',
  (select t."totalAlunos" from totals t),
  'totalCaca',
  (select t."totalCaca" from totals t)
);
$$;

grant execute on function public.dashboard_public_home_bundle(uuid, text, date) to anon, authenticated;

comment on function public.dashboard_public_home_bundle(uuid, text, date) is
  'Consumer: src/lib/dashboardPublicService.ts. Compact home bundle with viewer flags/counts and no heavy arrays.';

create or replace function public.profile_public_bundle(
  p_tenant_id uuid default null,
  p_target_user_id text default null,
  p_viewer_user_id text default null,
  p_posts_limit integer default 8,
  p_events_limit integer default 8,
  p_treinos_limit integer default 8,
  p_ligas_limit integer default 8
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    nullif(trim(coalesce(p_target_user_id, '')), '') as target_user_id,
    nullif(trim(coalesce(p_viewer_user_id, '')), '') as viewer_user_id,
    greatest(coalesce(p_posts_limit, 8), 1) as posts_limit,
    greatest(coalesce(p_events_limit, 8), 1) as events_limit,
    greatest(coalesce(p_treinos_limit, 8), 1) as treinos_limit,
    greatest(coalesce(p_ligas_limit, 8), 1) as ligas_limit,
    timezone('America/Sao_Paulo', now())::timestamp without time zone as now_local
),
target_profile as (
  select
    u.uid,
    u.nome,
    u.apelido,
    u.foto,
    u.turma,
    u.bio,
    u.instagram,
    u.telefone,
    u."cidadeOrigem",
    u."dataNascimento",
    u.role,
    u.tenant_role,
    u.status,
    u."whatsappPublico",
    u."idadePublica",
    u."relacionamentoPublico",
    u.esportes,
    u.pets,
    u."statusRelacionamento",
    u.plano,
    u.plano_cor,
    u.plano_icon,
    u.patente,
    u.patente_icon,
    u.patente_cor,
    u.tier,
    u.level,
    u.xp,
    coalesce(u.stats::jsonb, '{}'::jsonb) as stats
  from public.users u
  join params p on p.target_user_id is not null and u.uid = p.target_user_id
  where p.tenant_id is null or u.tenant_id = p.tenant_id
  limit 1
),
follow_counts as (
  select
    (
      select count(*)::integer
      from public.users_followers uf
      cross join params p
      where uf."userId" = p.target_user_id
        and (p.tenant_id is null or uf.tenant_id = p.tenant_id)
    ) as "followersCount",
    (
      select count(*)::integer
      from public.users_following uf
      cross join params p
      where uf."userId" = p.target_user_id
        and (p.tenant_id is null or uf.tenant_id = p.tenant_id)
    ) as "followingCount",
    (
      select exists (
        select 1
        from public.users_followers uf
        cross join params p
        where p.viewer_user_id is not null
          and uf."userId" = p.target_user_id
          and uf.uid = p.viewer_user_id
          and (p.tenant_id is null or uf.tenant_id = p.tenant_id)
      )
    ) as "isFollowing"
),
profile_posts as (
  select
    po.id,
    po.texto,
    po.imagem,
    po."createdAt",
    cardinality(coalesce(po.likes, '{}'::text[]))::integer as "likesCount",
    coalesce(po.comentarios, 0)::integer as "commentsCount",
    exists (
      select 1
      from params p
      where p.viewer_user_id is not null
        and p.viewer_user_id = any(coalesce(po.likes, '{}'::text[]))
    ) as "viewerHasLiked"
  from public.posts po
  cross join params p
  where po."userId" = p.target_user_id
    and (p.tenant_id is null or po.tenant_id = p.tenant_id)
  order by po."createdAt" desc nulls last, po.id
  limit (select posts_limit from params)
),
profile_events_base as (
  select
    e.id,
    e.titulo,
    e.data,
    e.local,
    e.imagem,
    e."imagePositionY",
    e."createdAt",
    public.mt_parse_event_datetime(e.data, e.hora) as event_at,
    cardinality(coalesce(e."likesList", '{}'::text[]))::integer as "likesCount",
    cardinality(coalesce(e.interessados, '{}'::text[]))::integer as "interessadosCount",
    exists (
      select 1
      from params p
      where p.viewer_user_id is not null
        and p.viewer_user_id = any(coalesce(e."likesList", '{}'::text[]))
    ) as "viewerHasLiked"
  from public.eventos e
  cross join params p
  where p.target_user_id = any(coalesce(e.interessados, '{}'::text[]))
    and (p.tenant_id is null or e.tenant_id = p.tenant_id)
),
profile_events as (
  select *
  from profile_events_base
  order by event_at asc nulls last, "createdAt" desc nulls last, id
  limit (select events_limit from params)
),
profile_treinos_base as (
  select
    t.id,
    t.modalidade,
    t.dia,
    t.horario,
    t.imagem,
    t.local,
    t."createdAt",
    public.mt_parse_day_end(t.dia) as treino_end_at,
    cardinality(coalesce(t.confirmados, '{}'::text[]))::integer as "confirmadosCount"
  from public.treinos t
  cross join params p
  where p.target_user_id = any(coalesce(t.confirmados, '{}'::text[]))
    and (p.tenant_id is null or t.tenant_id = p.tenant_id)
),
profile_treinos as (
  select *
  from profile_treinos_base pt
  cross join params p
  where pt.treino_end_at is null or pt.treino_end_at >= p.now_local
  order by pt.treino_end_at desc nulls last, pt."createdAt" desc nulls last, pt.id
  limit (select treinos_limit from params)
),
profile_ligas as (
  select
    l.id,
    l.nome,
    l.sigla,
    l.foto,
    coalesce(l."logoUrl", l.logo) as "logoUrl",
    l.likes,
    cardinality(coalesce(l."membrosIds", '{}'::text[]))::integer as "membrosCount"
  from public.ligas_config l
  cross join params p
  where p.target_user_id = any(coalesce(l."membrosIds", '{}'::text[]))
    and (p.tenant_id is null or l.tenant_id = p.tenant_id)
  order by l.likes desc, l."createdAt" desc nulls last, l.id
  limit (select ligas_limit from params)
)
select
  case
    when not exists (select 1 from target_profile) then null
    else jsonb_build_object(
      'profile',
      (
        select jsonb_strip_nulls(
          jsonb_build_object(
            'uid', tp.uid,
            'nome', tp.nome,
            'apelido', tp.apelido,
            'foto', tp.foto,
            'turma', tp.turma,
            'bio', tp.bio,
            'instagram', tp.instagram,
            'telefone', tp.telefone,
            'cidadeOrigem', tp."cidadeOrigem",
            'dataNascimento', tp."dataNascimento",
            'role', tp.role,
            'tenant_role', tp.tenant_role,
            'status', tp.status,
            'whatsappPublico', tp."whatsappPublico",
            'idadePublica', tp."idadePublica",
            'relacionamentoPublico', tp."relacionamentoPublico",
            'esportes', tp.esportes,
            'pets', tp.pets,
            'statusRelacionamento', tp."statusRelacionamento",
            'plano', tp.plano,
            'plano_cor', tp.plano_cor,
            'plano_icon', tp.plano_icon,
            'patente', tp.patente,
            'patente_icon', tp.patente_icon,
            'patente_cor', tp.patente_cor,
            'tier', tp.tier,
            'level', tp.level,
            'xp', tp.xp,
            'stats', tp.stats
          )
        )
        from target_profile tp
      ),
      'followersCount',
      (select fc."followersCount" from follow_counts fc),
      'followingCount',
      (select fc."followingCount" from follow_counts fc),
      'isFollowing',
      (select fc."isFollowing" from follow_counts fc),
      'posts',
      coalesce(
        (
          select jsonb_agg(to_jsonb(post_payload))
          from (
            select
              pp.id,
              pp.texto,
              pp.imagem,
              pp."createdAt",
              pp."likesCount",
              pp."commentsCount",
              pp."viewerHasLiked"
            from profile_posts pp
            order by pp."createdAt" desc nulls last, pp.id
          ) as post_payload
        ),
        '[]'::jsonb
      ),
      'events',
      coalesce(
        (
          select jsonb_agg(to_jsonb(event_payload))
          from (
            select
              pe.id,
              pe.titulo,
              pe.data,
              pe.local,
              pe.imagem,
              pe."imagePositionY",
              pe."likesCount",
              pe."interessadosCount",
              pe."viewerHasLiked"
            from profile_events pe
            order by pe.event_at asc nulls last, pe."createdAt" desc nulls last, pe.id
          ) as event_payload
        ),
        '[]'::jsonb
      ),
      'treinos',
      coalesce(
        (
          select jsonb_agg(to_jsonb(treino_payload))
          from (
            select
              pt.id,
              pt.modalidade,
              pt.dia,
              pt.horario,
              pt.imagem,
              pt.local,
              pt."confirmadosCount"
            from profile_treinos pt
            order by pt.treino_end_at desc nulls last, pt."createdAt" desc nulls last, pt.id
          ) as treino_payload
        ),
        '[]'::jsonb
      ),
      'ligas',
      coalesce(
        (
          select jsonb_agg(to_jsonb(liga_payload))
          from (
            select
              pl.id,
              pl.nome,
              pl.sigla,
              pl.foto,
              pl."logoUrl",
              pl.likes,
              pl."membrosCount"
            from profile_ligas pl
            order by pl.likes desc, pl.id
          ) as liga_payload
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

grant execute on function public.profile_public_bundle(uuid, text, text, integer, integer, integer, integer) to anon, authenticated;

comment on function public.profile_public_bundle(uuid, text, text, integer, integer, integer, integer) is
  'Consumer: src/lib/profilePublicService.ts. Compact public profile bundle with counts/flags and limited collections.';

create or replace function public.community_category_counts_bundle(
  p_tenant_id uuid default null,
  p_user_id text default null,
  p_categories text[] default null,
  p_recent_window_days integer default 2,
  p_unread_since_days integer default 90,
  p_include_blocked boolean default false
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    nullif(trim(coalesce(p_user_id, '')), '') as user_id,
    greatest(coalesce(p_recent_window_days, 2), 1) as recent_window_days,
    greatest(coalesce(p_unread_since_days, 90), 1) as unread_since_days,
    coalesce(p_include_blocked, false) as include_blocked,
    now() - make_interval(days => greatest(coalesce(p_recent_window_days, 2), 1)) as recent_since,
    now() - make_interval(days => greatest(coalesce(p_unread_since_days, 90), 1)) as unread_since
),
requested_categories as (
  select
    left(trim(regexp_replace(source.cat, '\s+', ' ', 'g')), 40) as categoria,
    lower(left(trim(regexp_replace(source.cat, '\s+', ' ', 'g')), 40)) as categoria_key,
    min(source.ord)::integer as ord
  from (
    select
      cat,
      ord
    from unnest(
      case
        when coalesce(array_length(p_categories, 1), 0) > 0 then p_categories
        else coalesce(
          (
            select array_agg(
              distinct left(trim(regexp_replace(coalesce(po.categoria, ''), '\s+', ' ', 'g')), 40)
              order by left(trim(regexp_replace(coalesce(po.categoria, ''), '\s+', ' ', 'g')), 40)
            )
            from public.posts po
            cross join params p
            where left(trim(regexp_replace(coalesce(po.categoria, ''), '\s+', ' ', 'g')), 40) <> ''
              and (p.tenant_id is null or po.tenant_id = p.tenant_id)
          ),
          array[]::text[]
        )
      end
    ) with ordinality as input(cat, ord)
  ) as source
  where left(trim(regexp_replace(source.cat, '\s+', ' ', 'g')), 40) <> ''
  group by 1, 2
),
viewer as (
  select
    coalesce(u.extra::jsonb, '{}'::jsonb) as extra
  from public.users u
  join params p on p.user_id is not null and u.uid = p.user_id
  where p.tenant_id is null or u.tenant_id = p.tenant_id
  limit 1
),
db_reads as (
  select
    rc.categoria_key,
    max(ccr."readAt")::timestamptz as read_at
  from requested_categories rc
  cross join params p
  left join public.community_category_reads ccr
    on ccr."userId" = p.user_id
   and ccr."categoriaKey" = rc.categoria_key
   and (p.tenant_id is null or ccr.tenant_id = p.tenant_id)
  group by rc.categoria_key
),
legacy_reads as (
  select
    rc.categoria_key,
    case
      when p.user_id is null then null
      when p.tenant_id is not null then public.mt_safe_timestamptz(v.extra -> 'communityReadsByTenant' -> (p.tenant_id::text) ->> rc.categoria_key)
      else public.mt_safe_timestamptz(v.extra -> 'communityReads' ->> rc.categoria_key)
    end as read_at
  from requested_categories rc
  cross join params p
  left join viewer v on true
),
effective_reads as (
  select
    rc.categoria,
    rc.categoria_key,
    rc.ord,
    case
      when p.user_id is null then null
      else coalesce(dr.read_at, lr.read_at, p.unread_since)
    end as read_at
  from requested_categories rc
  cross join params p
  left join db_reads dr on dr.categoria_key = rc.categoria_key
  left join legacy_reads lr on lr.categoria_key = rc.categoria_key
),
posts_scoped as (
  select
    lower(left(trim(regexp_replace(coalesce(po.categoria, ''), '\s+', ' ', 'g')), 40)) as categoria_key,
    po."createdAt"::timestamptz as created_at
  from public.posts po
  cross join params p
  where (p.tenant_id is null or po.tenant_id = p.tenant_id)
    and (p.include_blocked or coalesce(po.blocked, false) is false)
),
counts as (
  select
    er.categoria,
    er.categoria_key,
    er.ord,
    coalesce(
      sum(
        case when ps.created_at >= p.recent_since then 1 else 0 end
      ),
      0
    )::integer as "recentCount",
    coalesce(
      sum(
        case
          when p.user_id is not null and er.read_at is not null and ps.created_at > er.read_at then 1
          else 0
        end
      ),
      0
    )::integer as "unreadCount",
    er.read_at as "lastReadAt"
  from effective_reads er
  cross join params p
  left join posts_scoped ps on ps.categoria_key = er.categoria_key
  group by er.categoria, er.categoria_key, er.ord, er.read_at
)
select jsonb_build_object(
  'categories',
  coalesce(
    (
      select jsonb_agg(to_jsonb(category_payload))
      from (
        select
          c.categoria,
          c."recentCount",
          c."unreadCount",
          c."lastReadAt"
        from counts c
        order by c.ord
      ) as category_payload
    ),
    '[]'::jsonb
  )
);
$$;

grant execute on function public.community_category_counts_bundle(uuid, text, text[], integer, integer, boolean) to anon, authenticated;

comment on function public.community_category_counts_bundle(uuid, text, text[], integer, integer, boolean) is
  'Consumer: src/lib/communityService.ts. Per-category recent/unread counts in one call, with legacy read fallback.';

create or replace function public.admin_partner_counts_bundle(
  p_tenant_id uuid default null
)
returns jsonb
language sql
stable
as $$
with scoped as (
  select
    lower(coalesce(status, 'active')) as status_norm,
    lower(coalesce(tier, 'standard')) as tier_norm
  from public.parceiros p
  where p_tenant_id is null or p.tenant_id = p_tenant_id
)
select jsonb_build_object(
  'total', count(*)::integer,
  'ativos', count(*) filter (where status_norm = 'active')::integer,
  'pendentes', count(*) filter (where status_norm = 'pending')::integer,
  'desativados', count(*) filter (where status_norm = 'disabled')::integer,
  'ouro', count(*) filter (where status_norm = 'active' and tier_norm = 'ouro')::integer,
  'prata', count(*) filter (where status_norm = 'active' and tier_norm = 'prata')::integer,
  'standard', count(*) filter (where status_norm = 'active' and tier_norm not in ('ouro', 'prata'))::integer
) from scoped;
$$;

grant execute on function public.admin_partner_counts_bundle(uuid) to anon, authenticated;

comment on function public.admin_partner_counts_bundle(uuid) is
  'Consumer: src/lib/partnersService.ts. Consolidated admin partner counts by tenant.';

notify pgrst, 'reload schema';
