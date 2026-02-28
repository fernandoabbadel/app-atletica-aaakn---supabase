-- Backfill de visuais de plano em users e snapshots derivados.
-- 1) users.plano_icon/plano_cor devem refletir public.planos.
-- 2) eventos_comentarios, posts e posts_comments carregam snapshot
--    de plano e tambem precisam acompanhar o cadastro atual do usuario.

with normalized_planos as (
  select
    nome,
    cor,
    icon,
    regexp_replace(lower(trim(nome)), '^plano\s+', '') as nome_norm
  from public.planos
),
updated_users as (
  update public.users as u
  set
    plano_icon = p.icon,
    plano_cor = p.cor
  from normalized_planos as p
  where regexp_replace(lower(trim(coalesce(u.plano, ''))), '^plano\s+', '') = p.nome_norm
    and (
      u.plano_icon is distinct from p.icon
      or u.plano_cor is distinct from p.cor
    )
  returning u.uid
),
updated_event_comments as (
  update public.eventos_comentarios as ec
  set
    "userPlanoIcon" = u.plano_icon,
    "userPlanoCor" = u.plano_cor
  from public.users as u
  where ec."userId" = u.uid
    and (
      ec."userPlanoIcon" is distinct from u.plano_icon
      or ec."userPlanoCor" is distinct from u.plano_cor
    )
  returning ec.id
),
updated_posts as (
  update public.posts as p
  set
    plano_icon = u.plano_icon,
    plano_cor = u.plano_cor
  from public.users as u
  where p."userId" = u.uid
    and (
      p.plano_icon is distinct from u.plano_icon
      or p.plano_cor is distinct from u.plano_cor
    )
  returning p.id
),
updated_post_comments as (
  update public.posts_comments as pc
  set
    plano_icon = u.plano_icon,
    plano_cor = u.plano_cor
  from public.users as u
  where pc."userId" = u.uid
    and (
      pc.plano_icon is distinct from u.plano_icon
      or pc.plano_cor is distinct from u.plano_cor
    )
  returning pc.id
)
select
  (select count(*)::int from updated_users) as updated_users,
  (select count(*)::int from updated_event_comments) as updated_event_comments,
  (select count(*)::int from updated_posts) as updated_posts,
  (select count(*)::int from updated_post_comments) as updated_post_comments;
