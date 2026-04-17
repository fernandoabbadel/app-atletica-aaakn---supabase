create or replace view public.bi_treinos_modalidades
with (security_invoker = true)
as
with sessoes as (
  select
    t.tenant_id,
    coalesce(nullif(t.modalidade, ''), 'Treino') as modalidade,
    count(distinct t.id)::bigint as sessoes
  from public.treinos t
  group by t.tenant_id, coalesce(nullif(t.modalidade, ''), 'Treino')
),
presencas as (
  select
    c.tenant_id,
    coalesce(nullif(t.modalidade, ''), 'Treino') as modalidade,
    count(*)::bigint as presencas,
    avg(c."performanceRating") filter (where c."performanceRating" between 1 and 5) as nota_media
  from public.treinos_chamada c
  left join public.treinos t on t.id = c."treinoId"
  where lower(coalesce(c.status, '')) = 'presente'
  group by c.tenant_id, coalesce(nullif(t.modalidade, ''), 'Treino')
),
confirmacoes as (
  select
    r.tenant_id,
    coalesce(nullif(t.modalidade, ''), 'Treino') as modalidade,
    count(*)::bigint as confirmacoes,
    count(*) filter (
      where not exists (
        select 1
        from public.treinos_chamada c
        where c."treinoId" = r."treinoId"
          and c."userId" = r."userId"
          and lower(coalesce(c.status, '')) = 'presente'
      )
    )::bigint as no_shows
  from public.treinos_rsvps r
  left join public.treinos t on t.id = r."treinoId"
  where lower(coalesce(r.status, '')) in ('going', 'confirmado', 'confirmed')
  group by r.tenant_id, coalesce(nullif(t.modalidade, ''), 'Treino')
),
chaves as (
  select tenant_id, modalidade from sessoes
  union
  select tenant_id, modalidade from presencas
  union
  select tenant_id, modalidade from confirmacoes
)
select
  chaves.tenant_id,
  chaves.modalidade,
  coalesce(sessoes.sessoes, 0)::bigint as sessoes,
  coalesce(presencas.presencas, 0)::bigint as presencas,
  coalesce(confirmacoes.confirmacoes, 0)::bigint as confirmacoes,
  coalesce(confirmacoes.no_shows, 0)::bigint as no_shows,
  presencas.nota_media
from chaves
left join sessoes
  on sessoes.tenant_id is not distinct from chaves.tenant_id
  and sessoes.modalidade = chaves.modalidade
left join presencas
  on presencas.tenant_id is not distinct from chaves.tenant_id
  and presencas.modalidade = chaves.modalidade
left join confirmacoes
  on confirmacoes.tenant_id is not distinct from chaves.tenant_id
  and confirmacoes.modalidade = chaves.modalidade;
