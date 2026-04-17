drop view if exists public.bi_treinos_presencas_dimensoes;

create view public.bi_treinos_presencas_dimensoes
with (security_invoker = true)
as
with presentes as (
  select
    c.tenant_id,
    c."treinoId" as treino_id,
    coalesce(nullif(t.modalidade, ''), 'Treino') as modalidade,
    coalesce(nullif(t."diaSemana", ''), public.bi_dia_semana(t.dia::timestamptz)) as dia_semana,
    coalesce(nullif(t.horario, ''), 'Sem horario') as horario,
    coalesce(nullif(t.treinador, ''), 'Sem treinador') as treinador,
    coalesce(nullif(c.turma, ''), 'Sem turma') as turma,
    coalesce(nullif(c.nome, ''), 'Aluno') as usuario,
    c."userId" as user_id,
    c.origem,
    c."performanceRating" as performance_rating
  from public.treinos_chamada c
  left join public.treinos t on t.id = c."treinoId"
  where lower(coalesce(c.status, '')) = 'presente'
)
select
  tenant_id,
  modalidade,
  dimension_type,
  dimension_value,
  count(*)::bigint as presencas,
  count(distinct treino_id)::bigint as treinos_com_presenca,
  count(distinct user_id)::bigint as usuarios_unicos,
  avg(performance_rating) filter (where performance_rating between 1 and 5) as nota_media
from presentes
cross join lateral (
  values
    ('turma', turma),
    ('usuario', usuario),
    ('modalidade', modalidade),
    ('dia_semana', dia_semana),
    ('horario', horario),
    ('treinador', treinador),
    ('origem', coalesce(nullif(origem, ''), 'Sem origem'))
) as dimensions(dimension_type, dimension_value)
group by tenant_id, modalidade, dimension_type, dimension_value;
