-- Relationalize hot interaction paths that were still rewriting large arrays/jsonb
-- blobs in eventos, eventos_enquetes, treinos, album_summary and ligas_config.

alter table public.treinos
  add column if not exists "confirmedCount" integer not null default 0;

alter table public.ligas_config
  add column if not exists "membersCount" integer not null default 0;

create table if not exists public.eventos_likes (
  id text primary key default gen_random_uuid()::text,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  "userId" text not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("eventoId", "userId")
);

create index if not exists idx_eventos_likes_tenant_event_user
  on public.eventos_likes (tenant_id, "eventoId", "userId");

create index if not exists idx_eventos_likes_tenant_user_created_at
  on public.eventos_likes (tenant_id, "userId", "createdAt" desc);

create table if not exists public.eventos_enquete_votos (
  id text primary key default gen_random_uuid()::text,
  "enqueteId" text not null references public.eventos_enquetes(id) on delete cascade,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  "userId" text not null,
  "optionIndex" integer not null,
  "userTurma" text not null default 'Geral',
  tenant_id uuid references public.tenants(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("enqueteId", "userId", "optionIndex")
);

create index if not exists idx_eventos_enquete_votos_tenant_poll_user
  on public.eventos_enquete_votos (tenant_id, "enqueteId", "userId");

create index if not exists idx_eventos_enquete_votos_tenant_poll_option
  on public.eventos_enquete_votos (tenant_id, "enqueteId", "optionIndex");

create table if not exists public.ligas_membros (
  id text primary key default gen_random_uuid()::text,
  "ligaId" text not null references public.ligas_config(id) on delete cascade,
  "userId" text not null,
  cargo text not null default 'Membro',
  tenant_id uuid references public.tenants(id) on delete set null,
  "joinedAt" timestamptz not null default now(),
  unique ("ligaId", "userId")
);

create index if not exists idx_ligas_membros_tenant_liga_user
  on public.ligas_membros (tenant_id, "ligaId", "userId");

create index if not exists idx_ligas_membros_tenant_user_joined_at
  on public.ligas_membros (tenant_id, "userId", "joinedAt" desc);

create table if not exists public.album_summary_turmas (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  turma text not null,
  "capturedCount" integer not null default 0,
  tenant_id uuid references public.tenants(id) on delete set null,
  "updatedAt" timestamptz not null default now(),
  unique ("userId", turma)
);

create index if not exists idx_album_summary_turmas_tenant_user
  on public.album_summary_turmas (tenant_id, "userId");

grant select on table public.eventos_likes to anon, authenticated;
grant insert, delete on table public.eventos_likes to authenticated;

grant select on table public.eventos_enquete_votos to anon, authenticated;
grant insert, delete on table public.eventos_enquete_votos to authenticated;

grant select on table public.ligas_membros to authenticated;
grant insert, update, delete on table public.ligas_membros to authenticated;

grant select on table public.album_summary_turmas to authenticated;
grant insert, update, delete on table public.album_summary_turmas to authenticated;

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'eventos_likes',
    'eventos_enquete_votos',
    'ligas_membros',
    'album_summary_turmas'
  ] loop
    continue when to_regclass('public.' || table_name) is null;
    continue when to_regprocedure('public.mt_fill_tenant_id()') is null;

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
  end loop;
end;
$$;

insert into public.eventos_likes ("eventoId", "userId", tenant_id, "createdAt")
select
  e.id,
  trim(liked_uid),
  e.tenant_id,
  coalesce(e."updatedAt", e."createdAt", now())
from public.eventos e
cross join lateral unnest(coalesce(e."likesList", '{}'::text[])) as liked(liked_uid)
where nullif(trim(liked_uid), '') is not null
on conflict ("eventoId", "userId") do nothing;

insert into public.eventos_enquete_votos (
  "enqueteId",
  "eventoId",
  "userId",
  "optionIndex",
  "userTurma",
  tenant_id,
  "createdAt"
)
select
  eq.id,
  eq."eventoId",
  trim(vote_entry.key),
  option_entry.value::integer,
  coalesce(nullif(trim(u.turma), ''), 'Geral'),
  coalesce(eq.tenant_id, ev.tenant_id, u.tenant_id),
  coalesce(eq."updatedAt", eq."createdAt", now())
from public.eventos_enquetes eq
join public.eventos ev
  on ev.id = eq."eventoId"
cross join lateral jsonb_each(coalesce(eq."userVotes", '{}'::jsonb)) as vote_entry(key, value)
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(vote_entry.value) = 'array' then vote_entry.value
    else '[]'::jsonb
  end
) as option_entry(value)
left join public.users u
  on u.uid = trim(vote_entry.key)
where nullif(trim(vote_entry.key), '') is not null
  and option_entry.value ~ '^\d+$'
on conflict ("enqueteId", "userId", "optionIndex") do nothing;

insert into public.ligas_membros ("ligaId", "userId", cargo, tenant_id, "joinedAt")
select
  l.id,
  trim(member_row ->> 'id'),
  coalesce(nullif(trim(member_row ->> 'cargo'), ''), 'Membro'),
  l.tenant_id,
  coalesce(l."updatedAt", l."createdAt", now())
from public.ligas_config l
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(coalesce(l.membros, '[]'::jsonb)) = 'array' then coalesce(l.membros, '[]'::jsonb)
    else '[]'::jsonb
  end
) as member(member_row)
where nullif(trim(member_row ->> 'id'), '') is not null
on conflict ("ligaId", "userId") do update
set cargo = excluded.cargo;

insert into public.ligas_membros ("ligaId", "userId", tenant_id, "joinedAt")
select
  l.id,
  trim(member_uid),
  l.tenant_id,
  coalesce(l."updatedAt", l."createdAt", now())
from public.ligas_config l
cross join lateral unnest(coalesce(l."membrosIds", '{}'::text[])) as member(member_uid)
where nullif(trim(member_uid), '') is not null
on conflict ("ligaId", "userId") do nothing;

insert into public.album_summary_turmas ("userId", turma, "capturedCount", tenant_id, "updatedAt")
select
  ac."collectorUserId",
  coalesce(nullif(trim(ac.turma), ''), 'OUTROS'),
  count(distinct ac."targetUserId")::integer,
  ac.tenant_id,
  max(coalesce(ac."dataColada", now()))
from public.album_captures ac
group by ac."collectorUserId", coalesce(nullif(trim(ac.turma), ''), 'OUTROS'), ac.tenant_id
on conflict ("userId", turma) do update
set
  "capturedCount" = excluded."capturedCount",
  tenant_id = excluded.tenant_id,
  "updatedAt" = excluded."updatedAt";

with event_like_counts as (
  select
    el."eventoId" as event_id,
    count(*)::integer as likes_count
  from public.eventos_likes el
  group by el."eventoId"
),
event_rsvp_counts as (
  select
    er."eventoId" as event_id,
    count(*) filter (where lower(coalesce(er.status, '')) = 'going')::integer as going_count,
    count(*) filter (where lower(coalesce(er.status, '')) = 'maybe')::integer as maybe_count
  from public.eventos_rsvps er
  group by er."eventoId"
)
update public.eventos e
set stats =
  coalesce(e.stats, '{}'::jsonb)
  || jsonb_build_object(
    'likes', coalesce(elc.likes_count, 0),
    'confirmados', coalesce(erc.going_count, 0),
    'talvez', coalesce(erc.maybe_count, 0)
  )
from event_like_counts elc
full join event_rsvp_counts erc
  on erc.event_id = elc.event_id
where e.id = coalesce(elc.event_id, erc.event_id);

update public.eventos e
set stats =
  coalesce(e.stats, '{}'::jsonb)
  || jsonb_build_object(
    'likes', 0,
    'confirmados', 0,
    'talvez', 0
  )
where not exists (
  select 1
  from public.eventos_likes el
  where el."eventoId" = e.id
)
and not exists (
  select 1
  from public.eventos_rsvps er
  where er."eventoId" = e.id
);

update public.treinos t
set "confirmedCount" = coalesce(src.confirmed_count, 0)
from (
  select
    tr."treinoId" as treino_id,
    count(*)::integer as confirmed_count
  from public.treinos_rsvps tr
  where lower(coalesce(tr.status, '')) = 'going'
  group by tr."treinoId"
) as src
where t.id = src.treino_id;

update public.treinos t
set "confirmedCount" = 0
where not exists (
  select 1
  from public.treinos_rsvps tr
  where tr."treinoId" = t.id
    and lower(coalesce(tr.status, '')) = 'going'
);

update public.ligas_config l
set "membersCount" = coalesce(src.members_count, 0)
from (
  select
    lm."ligaId" as liga_id,
    count(*)::integer as members_count
  from public.ligas_membros lm
  group by lm."ligaId"
) as src
where l.id = src.liga_id;

update public.ligas_config l
set "membersCount" = 0
where not exists (
  select 1
  from public.ligas_membros lm
  where lm."ligaId" = l.id
);

update public.album_summary s
set
  "totalCollected" = coalesce(src.total_collected, 0),
  "lastCaptureId" = src.last_capture_id,
  "lastCaptureAt" = src.last_capture_at,
  "updatedAt" = coalesce(src.updated_at, s."updatedAt")
from (
  select
    ac."collectorUserId" as user_id,
    count(distinct ac."targetUserId")::integer as total_collected,
    (
      array_agg(ac."targetUserId" order by ac."dataColada" desc nulls last, ac.id desc)
    )[1] as last_capture_id,
    max(ac."dataColada") as last_capture_at,
    max(ac."dataColada") as updated_at
  from public.album_captures ac
  group by ac."collectorUserId"
) as src
where s."userId" = src.user_id;

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
event_like_counts as (
  select
    el."eventoId" as event_id,
    count(*)::integer as likes_count
  from public.eventos_likes el
  cross join params p
  where p.tenant_id is null or el.tenant_id = p.tenant_id
  group by el."eventoId"
),
event_interest_counts as (
  select
    er."eventoId" as event_id,
    count(*)::integer as interested_count
  from public.eventos_rsvps er
  cross join params p
  where p.tenant_id is null or er.tenant_id = p.tenant_id
  group by er."eventoId"
),
event_viewer_likes as (
  select distinct el."eventoId" as event_id
  from public.eventos_likes el
  cross join params p
  where p.user_id is not null
    and el."userId" = p.user_id
    and (p.tenant_id is null or el.tenant_id = p.tenant_id)
),
event_viewer_rsvps as (
  select distinct er."eventoId" as event_id
  from public.eventos_rsvps er
  cross join params p
  where p.user_id is not null
    and er."userId" = p.user_id
    and (p.tenant_id is null or er.tenant_id = p.tenant_id)
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
    coalesce(
      elc.likes_count,
      greatest(coalesce((e.stats ->> 'likes')::integer, 0), 0)
    ) as "likesCount",
    coalesce(
      eic.interested_count,
      greatest(coalesce((e.stats ->> 'confirmados')::integer, 0), 0)
      + greatest(coalesce((e.stats ->> 'talvez')::integer, 0), 0)
    ) as "interessadosCount",
    (evl.event_id is not null) as "viewerHasLiked",
    (evr.event_id is not null) as "viewerIsInterested"
  from public.eventos e
  cross join params p
  left join event_like_counts elc on elc.event_id = e.id
  left join event_interest_counts eic on eic.event_id = e.id
  left join event_viewer_likes evl on evl.event_id = e.id
  left join event_viewer_rsvps evr on evr.event_id = e.id
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
    l."membersCount",
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
          lr."membersCount"
        from league_rows lr
        order by lr.likes desc, lr.id
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
      select jsonb_agg(tr.imagem)
      from treino_rows tr
    ),
    '[]'::jsonb
  ),
  'totalCaca',
  (select "totalCaca" from totals),
  'totalAlunos',
  (select "totalAlunos" from totals)
);
$$;

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
    u.stats
  from public.users u
  join params p on u.uid = p.target_user_id
  where p.tenant_id is null or u.tenant_id = p.tenant_id
  limit 1
),
follow_counts as (
  select
    (
      select count(*)::integer
      from public.users_followers uf
      join params p on uf."userId" = p.target_user_id
      where p.tenant_id is null or uf.tenant_id = p.tenant_id
    ) as "followersCount",
    (
      select count(*)::integer
      from public.users_following uf
      join params p on uf."userId" = p.target_user_id
      where p.tenant_id is null or uf.tenant_id = p.tenant_id
    ) as "followingCount",
    exists (
      select 1
      from public.users_followers uf
      join params p on true
      where p.viewer_user_id is not null
        and uf."userId" = p.target_user_id
        and uf.uid = p.viewer_user_id
        and (p.tenant_id is null or uf.tenant_id = p.tenant_id)
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
profile_event_ids as (
  select distinct er."eventoId" as event_id
  from public.eventos_rsvps er
  cross join params p
  where er."userId" = p.target_user_id
    and (p.tenant_id is null or er.tenant_id = p.tenant_id)
),
profile_event_like_counts as (
  select
    el."eventoId" as event_id,
    count(*)::integer as likes_count
  from public.eventos_likes el
  cross join params p
  where p.tenant_id is null or el.tenant_id = p.tenant_id
  group by el."eventoId"
),
profile_event_interest_counts as (
  select
    er."eventoId" as event_id,
    count(*)::integer as interested_count
  from public.eventos_rsvps er
  cross join params p
  where p.tenant_id is null or er.tenant_id = p.tenant_id
  group by er."eventoId"
),
profile_event_viewer_likes as (
  select distinct el."eventoId" as event_id
  from public.eventos_likes el
  cross join params p
  where p.viewer_user_id is not null
    and el."userId" = p.viewer_user_id
    and (p.tenant_id is null or el.tenant_id = p.tenant_id)
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
    coalesce(
      elc.likes_count,
      greatest(coalesce((e.stats ->> 'likes')::integer, 0), 0)
    ) as "likesCount",
    coalesce(
      eic.interested_count,
      greatest(coalesce((e.stats ->> 'confirmados')::integer, 0), 0)
      + greatest(coalesce((e.stats ->> 'talvez')::integer, 0), 0)
    ) as "interessadosCount",
    (evl.event_id is not null) as "viewerHasLiked"
  from public.eventos e
  join profile_event_ids pei on pei.event_id = e.id
  cross join params p
  left join profile_event_like_counts elc on elc.event_id = e.id
  left join profile_event_interest_counts eic on eic.event_id = e.id
  left join profile_event_viewer_likes evl on evl.event_id = e.id
  where p.tenant_id is null or e.tenant_id = p.tenant_id
),
profile_events as (
  select *
  from profile_events_base
  order by event_at asc nulls last, "createdAt" desc nulls last, id
  limit (select events_limit from params)
),
profile_treino_ids as (
  select distinct tr."treinoId" as treino_id
  from public.treinos_rsvps tr
  cross join params p
  where tr."userId" = p.target_user_id
    and lower(coalesce(tr.status, '')) = 'going'
    and (p.tenant_id is null or tr.tenant_id = p.tenant_id)
),
profile_treino_counts as (
  select
    tr."treinoId" as treino_id,
    count(*)::integer as confirmed_count
  from public.treinos_rsvps tr
  cross join params p
  where lower(coalesce(tr.status, '')) = 'going'
    and (p.tenant_id is null or tr.tenant_id = p.tenant_id)
  group by tr."treinoId"
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
    coalesce(tc.confirmed_count, t."confirmedCount", 0) as "confirmadosCount"
  from public.treinos t
  join profile_treino_ids pti on pti.treino_id = t.id
  cross join params p
  left join profile_treino_counts tc on tc.treino_id = t.id
  where p.tenant_id is null or t.tenant_id = p.tenant_id
),
profile_treinos as (
  select *
  from profile_treinos_base pt
  cross join params p
  where pt.treino_end_at is null or pt.treino_end_at >= p.now_local
  order by pt.treino_end_at desc nulls last, pt."createdAt" desc nulls last, pt.id
  limit (select treinos_limit from params)
),
profile_liga_ids as (
  select distinct lm."ligaId" as liga_id
  from public.ligas_membros lm
  cross join params p
  where lm."userId" = p.target_user_id
    and (p.tenant_id is null or lm.tenant_id = p.tenant_id)
),
profile_liga_counts as (
  select
    lm."ligaId" as liga_id,
    count(*)::integer as members_count
  from public.ligas_membros lm
  cross join params p
  where p.tenant_id is null or lm.tenant_id = p.tenant_id
  group by lm."ligaId"
),
profile_ligas as (
  select
    l.id,
    l.nome,
    l.sigla,
    l.foto,
    coalesce(l."logoUrl", l.logo) as "logoUrl",
    l.likes,
    coalesce(lc.members_count, l."membersCount", 0) as "membrosCount"
  from public.ligas_config l
  join profile_liga_ids pli on pli.liga_id = l.id
  cross join params p
  left join profile_liga_counts lc on lc.liga_id = l.id
  where p.tenant_id is null or l.tenant_id = p.tenant_id
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
