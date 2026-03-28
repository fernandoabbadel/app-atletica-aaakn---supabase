-- Stage 1 follow/partner list consolidation addendum.
--
-- Contracts:
-- 1) public.profile_follow_list_page(p_tenant_id uuid, p_target_user_id text, p_list_type text, ...)
--    Consumer: src/lib/profilePublicService.ts
--    Returns a compact paginated follow list bundle with:
--    - rows: uid/nome/foto/turma/followedAt only
--    - hasMore / nextCursor
--
-- 2) public.admin_partner_page_bundle(p_tenant_id uuid, p_status text, p_limit integer, ...)
--    Consumer: src/lib/partnersService.ts
--    Returns paginated admin partner rows tailored by view:
--    - summary: cards/counters tables
--    - contact: contact/data table
--    - editor: admin edit listing
--
-- 3) public.public_partner_list_bundle(p_tenant_id uuid, p_limit integer)
--    Consumer: src/lib/partnersPublicService.ts
--    Returns only the compact public partner fields used by /parceiros.
--
-- Notes:
-- - Additive/idempotent migration only.
-- - No blobs or sensitive fields are returned unless the specific admin view needs them.
-- - Existing direct queries/services remain compatible via service-level fallback.

create or replace function public.profile_follow_list_page(
  p_tenant_id uuid default null,
  p_target_user_id text default null,
  p_list_type text default 'followers',
  p_limit integer default 80,
  p_cursor_followed_at timestamptz default null,
  p_cursor_uid text default null
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    nullif(trim(coalesce(p_target_user_id, '')), '') as target_user_id,
    case
      when lower(coalesce(p_list_type, 'followers')) = 'following' then 'following'
      else 'followers'
    end as list_type,
    greatest(coalesce(p_limit, 80), 1) as page_limit,
    p_cursor_followed_at as cursor_followed_at,
    nullif(trim(coalesce(p_cursor_uid, '')), '') as cursor_uid
),
base_rows as (
  select
    uf.uid,
    uf.nome,
    uf.foto,
    uf.turma,
    uf."followedAt" as followed_at
  from public.users_followers uf
  cross join params p
  where p.list_type = 'followers'
    and p.target_user_id is not null
    and uf."userId" = p.target_user_id
    and (p.tenant_id is null or uf.tenant_id = p.tenant_id)

  union all

  select
    uf.uid,
    uf.nome,
    uf.foto,
    uf.turma,
    uf."followedAt" as followed_at
  from public.users_following uf
  cross join params p
  where p.list_type = 'following'
    and p.target_user_id is not null
    and uf."userId" = p.target_user_id
    and (p.tenant_id is null or uf.tenant_id = p.tenant_id)
),
windowed as (
  select
    br.uid,
    br.nome,
    br.foto,
    br.turma,
    br.followed_at
  from base_rows br
  cross join params p
  where
    p.cursor_followed_at is null
    or coalesce(br.followed_at, 'epoch'::timestamptz) < p.cursor_followed_at
    or (
      coalesce(br.followed_at, 'epoch'::timestamptz) = p.cursor_followed_at
      and br.uid > coalesce(p.cursor_uid, '')
    )
  order by br.followed_at desc nulls last, br.uid asc
  limit (select page_limit + 1 from params)
),
page_rows as (
  select
    w.uid,
    w.nome,
    w.foto,
    w.turma,
    w.followed_at,
    row_number() over (order by w.followed_at desc nulls last, w.uid asc) as row_num
  from windowed w
  limit (select page_limit from params)
),
pagination as (
  select
    count(*) > (select page_limit from params) as has_more
  from windowed
),
next_cursor as (
  select
    pr.followed_at,
    pr.uid
  from page_rows pr
  order by pr.row_num desc
  limit 1
)
select jsonb_build_object(
  'rows',
  coalesce(
    (
      select jsonb_agg(to_jsonb(row_payload) order by row_payload."followedAt" desc nulls last, row_payload.uid asc)
      from (
        select
          pr.uid,
          coalesce(nullif(pr.nome, ''), 'Atleta') as nome,
          coalesce(pr.foto, '') as foto,
          coalesce(nullif(pr.turma, ''), 'Geral') as turma,
          pr.followed_at as "followedAt"
        from page_rows pr
        order by pr.followed_at desc nulls last, pr.uid asc
      ) as row_payload
    ),
    '[]'::jsonb
  ),
  'hasMore',
  coalesce((select pg.has_more from pagination pg), false),
  'nextCursor',
  case
    when coalesce((select pg.has_more from pagination pg), false)
      then (
        select jsonb_build_object(
          'followedAt', nc.followed_at,
          'uid', nc.uid
        )
        from next_cursor nc
      )
    else null
  end
);
$$;

grant execute on function public.profile_follow_list_page(uuid, text, text, integer, timestamptz, text) to anon, authenticated;

comment on function public.profile_follow_list_page(uuid, text, text, integer, timestamptz, text) is
  'Consumer: src/lib/profilePublicService.ts. Compact paginated follow list bundle for followers/following.';

create or replace function public.admin_partner_page_bundle(
  p_tenant_id uuid default null,
  p_status text default 'all',
  p_limit integer default 20,
  p_cursor_id text default null,
  p_view text default 'editor'
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    case lower(coalesce(p_status, 'all'))
      when 'active' then 'active'
      when 'pending' then 'pending'
      when 'disabled' then 'disabled'
      else 'all'
    end as status_filter,
    greatest(coalesce(p_limit, 20), 1) as page_limit,
    nullif(trim(coalesce(p_cursor_id, '')), '') as cursor_id,
    case lower(coalesce(p_view, 'editor'))
      when 'summary' then 'summary'
      when 'contact' then 'contact'
      else 'editor'
    end as view_mode
),
cursor_row as (
  select
    pa.nome,
    pa.id
  from public.parceiros pa
  join params p on p.cursor_id is not null and pa.id = p.cursor_id
  where p.tenant_id is null or pa.tenant_id = p.tenant_id
  limit 1
),
base_rows as (
  select
    pa.id,
    pa.nome,
    pa.categoria,
    pa.tier,
    pa.status,
    pa.cnpj,
    pa.responsavel,
    pa.email,
    pa.telefone,
    pa.descricao,
    pa.endereco,
    pa.horario,
    pa.insta,
    pa.site,
    pa.whats,
    pa."imgCapa",
    pa."imgLogo",
    pa."totalScans",
    pa."createdAt"
  from public.parceiros pa
  cross join params p
  where (p.tenant_id is null or pa.tenant_id = p.tenant_id)
    and (
      p.status_filter = 'all'
      or lower(coalesce(pa.status, 'active')) = p.status_filter
    )
),
windowed as (
  select
    br.*
  from base_rows br
  cross join params p
  left join cursor_row cr on true
  where
    cr.id is null
    or br.nome > cr.nome
    or (br.nome = cr.nome and br.id > cr.id)
  order by br.nome asc, br.id asc
  limit (select page_limit + 1 from params)
),
page_rows as (
  select
    w.*,
    row_number() over (order by w.nome asc, w.id asc) as row_num
  from windowed w
  limit (select page_limit from params)
),
pagination as (
  select
    count(*) > (select page_limit from params) as has_more
  from windowed
),
next_cursor as (
  select
    pr.id
  from page_rows pr
  order by pr.row_num desc
  limit 1
)
select jsonb_build_object(
  'partners',
  coalesce(
    (
      select jsonb_agg(item_payload.item order by item_payload.nome asc, item_payload.id asc)
      from (
        select
          pr.id,
          pr.nome,
          case
            when p.view_mode = 'summary' then jsonb_strip_nulls(
              jsonb_build_object(
                'id', pr.id,
                'nome', pr.nome,
                'categoria', pr.categoria,
                'tier', pr.tier,
                'status', pr.status,
                'imgCapa', pr."imgCapa",
                'imgLogo', pr."imgLogo",
                'totalScans', coalesce(pr."totalScans", 0),
                'createdAt', pr."createdAt"
              )
            )
            when p.view_mode = 'contact' then jsonb_strip_nulls(
              jsonb_build_object(
                'id', pr.id,
                'nome', pr.nome,
                'categoria', pr.categoria,
                'tier', pr.tier,
                'status', pr.status,
                'responsavel', pr.responsavel,
                'cnpj', pr.cnpj,
                'telefone', pr.telefone,
                'email', pr.email,
                'createdAt', pr."createdAt"
              )
            )
            else jsonb_strip_nulls(
              jsonb_build_object(
                'id', pr.id,
                'nome', pr.nome,
                'categoria', pr.categoria,
                'tier', pr.tier,
                'status', pr.status,
                'cnpj', pr.cnpj,
                'responsavel', pr.responsavel,
                'email', pr.email,
                'telefone', pr.telefone,
                'descricao', pr.descricao,
                'endereco', pr.endereco,
                'horario', pr.horario,
                'insta', pr.insta,
                'site', pr.site,
                'whats', pr.whats,
                'imgCapa', pr."imgCapa",
                'imgLogo', pr."imgLogo",
                'totalScans', coalesce(pr."totalScans", 0),
                'createdAt', pr."createdAt"
              )
            )
          end as item
        from page_rows pr
        cross join params p
      ) as item_payload
    ),
    '[]'::jsonb
  ),
  'hasMore',
  coalesce((select pg.has_more from pagination pg), false),
  'nextCursor',
  case
    when coalesce((select pg.has_more from pagination pg), false)
      then (select nc.id from next_cursor nc)
    else null
  end
);
$$;

grant execute on function public.admin_partner_page_bundle(uuid, text, integer, text, text) to anon, authenticated;

comment on function public.admin_partner_page_bundle(uuid, text, integer, text, text) is
  'Consumer: src/lib/partnersService.ts. Paginated partner list bundle with summary/contact/editor views.';

create or replace function public.public_partner_list_bundle(
  p_tenant_id uuid default null,
  p_limit integer default 240
)
returns jsonb
language sql
stable
as $$
with params as (
  select
    p_tenant_id as tenant_id,
    greatest(coalesce(p_limit, 240), 1) as page_limit
),
partner_rows as (
  select
    pa.id,
    pa.nome,
    pa.categoria,
    pa.tier,
    pa.status,
    pa.descricao,
    pa."imgCapa",
    pa."imgLogo",
    pa."createdAt"
  from public.parceiros pa
  cross join params p
  where (p.tenant_id is null or pa.tenant_id = p.tenant_id)
    and lower(coalesce(pa.status, 'active')) = 'active'
  order by
    case lower(coalesce(pa.tier, 'standard'))
      when 'ouro' then 0
      when 'prata' then 1
      else 2
    end,
    pa.nome asc,
    pa.id
  limit (select page_limit from params)
)
select jsonb_build_object(
  'partners',
  coalesce(
    (
      select jsonb_agg(to_jsonb(partner_payload))
      from (
        select
          pr.id,
          pr.nome,
          pr.categoria,
          pr.tier,
          pr.status,
          pr.descricao,
          pr."imgCapa",
          pr."imgLogo",
          pr."createdAt"
        from partner_rows pr
        order by
          case lower(coalesce(pr.tier, 'standard'))
            when 'ouro' then 0
            when 'prata' then 1
            else 2
          end,
          pr.nome asc,
          pr.id
      ) as partner_payload
    ),
    '[]'::jsonb
  )
);
$$;

grant execute on function public.public_partner_list_bundle(uuid, integer) to anon, authenticated;

comment on function public.public_partner_list_bundle(uuid, integer) is
  'Consumer: src/lib/partnersPublicService.ts. Compact public partner list without contact/sensitive fields.';

notify pgrst, 'reload schema';
