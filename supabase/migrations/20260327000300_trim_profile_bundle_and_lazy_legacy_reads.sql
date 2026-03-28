-- Keep public profile/community bundles compact and make legacy community reads
-- a true last resort instead of a primary read path.

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
    coalesce(l.likes, 0)::integer as "likesCount",
    cardinality(coalesce(l."membrosIds", '{}'::text[]))::integer as "membrosCount",
    l."createdAt"
  from public.ligas_config l
  cross join params p
  where p.target_user_id = any(coalesce(l."membrosIds", '{}'::text[]))
    and (p.tenant_id is null or l.tenant_id = p.tenant_id)
  order by "likesCount" desc, l."createdAt" desc nulls last, l.id
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
              pl."membrosCount"
            from profile_ligas pl
            order by pl."likesCount" desc, pl.id
          ) as liga_payload
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

grant execute on function public.profile_public_bundle(uuid, text, text, integer, integer, integer, integer) to anon, authenticated;

comment on function public.profile_public_bundle(uuid, text, text, integer, integer, integer, integer) is
  'Consumer: src/lib/profilePublicService.ts. Compact public profile bundle with counts/flags and no league likes arrays.';

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
needs_legacy_reads as (
  select exists (
    select 1
    from requested_categories rc
    cross join params p
    left join db_reads dr on dr.categoria_key = rc.categoria_key
    where p.user_id is not null
      and dr.read_at is null
  ) as enabled
),
viewer as (
  select
    coalesce(u.extra::jsonb, '{}'::jsonb) as extra
  from public.users u
  join params p on p.user_id is not null and u.uid = p.user_id
  join needs_legacy_reads nlr on nlr.enabled
  where p.tenant_id is null or u.tenant_id = p.tenant_id
  limit 1
),
legacy_reads as (
  select
    rc.categoria_key,
    case
      when not coalesce((select enabled from needs_legacy_reads), false) then null
      when p.user_id is null then null
      when dr.read_at is not null then null
      when p.tenant_id is not null then public.mt_safe_timestamptz(v.extra -> 'communityReadsByTenant' -> (p.tenant_id::text) ->> rc.categoria_key)
      else public.mt_safe_timestamptz(v.extra -> 'communityReads' ->> rc.categoria_key)
    end as read_at
  from requested_categories rc
  cross join params p
  left join db_reads dr on dr.categoria_key = rc.categoria_key
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
  'Consumer: src/lib/communityService.ts. Per-category recent/unread counts using community_category_reads first and users.extra only as last resort.';
