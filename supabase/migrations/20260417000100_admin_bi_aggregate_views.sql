create or replace function public.bi_parse_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  cleaned := regexp_replace(coalesce(value, ''), '[^0-9,.-]', '', 'g');
  if cleaned = '' then
    return 0;
  end if;

  if position(',' in cleaned) > 0 then
    cleaned := replace(replace(cleaned, '.', ''), ',', '.');
  end if;

  return coalesce(cleaned::numeric, 0);
exception
  when others then
    return 0;
end;
$$;

create or replace function public.bi_periodo_dia(value timestamptz)
returns text
language sql
immutable
as $$
  select case
    when value is null then 'Sem horario'
    when extract(hour from value) < 6 then 'Madrugada'
    when extract(hour from value) < 12 then 'Manha'
    when extract(hour from value) < 18 then 'Tarde'
    else 'Noite'
  end;
$$;

create or replace function public.bi_dia_semana(value timestamptz)
returns text
language sql
immutable
as $$
  select case extract(dow from value)::int
    when 0 then 'Dom'
    when 1 then 'Seg'
    when 2 then 'Ter'
    when 3 then 'Qua'
    when 4 then 'Qui'
    when 5 then 'Sex'
    when 6 then 'Sab'
    else 'Sem data'
  end;
$$;

drop view if exists public.bi_eventos_vendas_dimensoes;
create view public.bi_eventos_vendas_dimensoes
with (security_invoker = true)
as
with approved as (
  select
    s.tenant_id,
    s."eventoId" as evento_id,
    coalesce(nullif(s."eventoNome", ''), 'Evento') as evento_nome,
    coalesce(nullif(s."userTurma", ''), 'Sem turma') as turma,
    coalesce(nullif(s."loteNome", ''), 'Lote') as lote,
    coalesce(nullif(s."aprovadoPor", ''), 'Sem aprovador') as aprovador,
    public.bi_dia_semana(s."dataSolicitacao"::timestamptz) as dia_semana,
    public.bi_periodo_dia(s."dataSolicitacao"::timestamptz) as periodo_dia,
    greatest(coalesce(s.quantidade, 1), 1) as quantidade,
    public.bi_parse_numeric(s."valorTotal") as valor
  from public.solicitacoes_ingressos s
  where lower(coalesce(s.status, '')) in ('aprovado', 'approved', 'pago', 'paid', 'entregue', 'presente')
)
select
  tenant_id,
  evento_id,
  evento_nome,
  dimension_type,
  dimension_value,
  count(*)::bigint as pedidos,
  sum(quantidade)::bigint as quantidade,
  sum(valor)::numeric as valor,
  case when sum(quantidade) > 0 then (sum(valor) / sum(quantidade)) else 0 end as ticket_medio
from approved
cross join lateral (
  values
    ('turma', turma),
    ('lote', lote),
    ('dia_semana', dia_semana),
    ('periodo', periodo_dia),
    ('aprovador', aprovador)
) as dimensions(dimension_type, dimension_value)
group by tenant_id, evento_id, evento_nome, dimension_type, dimension_value;

drop view if exists public.bi_eventos_checkins_hora;
create view public.bi_eventos_checkins_hora
with (security_invoker = true)
as
with ticket_entries as (
  select
    s.tenant_id,
    s."eventoId" as evento_id,
    coalesce(nullif(s."eventoNome", ''), 'Evento') as evento_nome,
    coalesce(nullif(s."userTurma", ''), 'Sem turma') as turma,
    coalesce(nullif(s."loteNome", ''), 'Lote') as lote,
    nullif(entry ->> 'scannedAt', '')::timestamptz as scanned_at,
    coalesce(nullif(entry ->> 'scannedByUserName', ''), nullif(entry ->> 'scannedBy', ''), 'Sem leitor') as leitor
  from public.solicitacoes_ingressos s
  cross join lateral jsonb_array_elements(
    coalesce(
      s.payment_config::jsonb -> 'ticketEntries',
      s.payment_config::jsonb -> 'tickets',
      s.payment_config::jsonb -> 'ingressos',
      '[]'::jsonb
    )
  ) as entry
  where lower(coalesce(s.status, '')) in ('aprovado', 'approved', 'pago', 'paid', 'entregue', 'presente')
    and nullif(entry ->> 'scannedAt', '') is not null
)
select
  tenant_id,
  evento_id,
  evento_nome,
  date_trunc('hour', scanned_at) as hora,
  to_char(date_trunc('hour', scanned_at), 'HH24:00') as hora_label,
  turma,
  lote,
  leitor,
  count(*)::bigint as checkins
from ticket_entries
group by tenant_id, evento_id, evento_nome, date_trunc('hour', scanned_at), turma, lote, leitor;

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
group by tenant_id, dimension_type, dimension_value;

drop view if exists public.bi_treinos_modalidades;
create view public.bi_treinos_modalidades
with (security_invoker = true)
as
select
  t.tenant_id,
  coalesce(nullif(t.modalidade, ''), 'Treino') as modalidade,
  count(distinct t.id)::bigint as sessoes,
  count(c.id) filter (where lower(coalesce(c.status, '')) = 'presente')::bigint as presencas,
  count(r.id) filter (where lower(coalesce(r.status, '')) in ('going', 'confirmado', 'confirmed'))::bigint as confirmacoes,
  count(r.id) filter (
    where lower(coalesce(r.status, '')) in ('going', 'confirmado', 'confirmed')
      and not exists (
        select 1
        from public.treinos_chamada c2
        where c2."treinoId" = r."treinoId"
          and c2."userId" = r."userId"
          and lower(coalesce(c2.status, '')) = 'presente'
      )
  )::bigint as no_shows,
  avg(c."performanceRating") filter (
    where lower(coalesce(c.status, '')) = 'presente'
      and c."performanceRating" between 1 and 5
  ) as nota_media
from public.treinos t
left join public.treinos_chamada c on c."treinoId" = t.id
left join public.treinos_rsvps r on r."treinoId" = t.id
group by t.tenant_id, coalesce(nullif(t.modalidade, ''), 'Treino');

drop view if exists public.bi_produtos_vendas_dimensoes;
create view public.bi_produtos_vendas_dimensoes
with (security_invoker = true)
as
with approved_orders as (
  select
    o.tenant_id,
    o."productId" as produto_id,
    coalesce(nullif(o."productName", ''), nullif(p.nome, ''), 'Produto') as produto_nome,
    coalesce(nullif(p.lote, ''), 'Sem lote') as lote,
    coalesce(
      nullif(o.data::jsonb ->> 'userTurma', ''),
      nullif(o.data::jsonb ->> 'turma', ''),
      nullif(u.turma, ''),
      'Sem turma'
    ) as turma,
    coalesce(nullif(o."userName", ''), 'Usuario') as usuario,
    case
      when coalesce(o.seller_type, p.seller_type, 'tenant') = 'mini_vendor'
        then coalesce(nullif(o.seller_name, ''), nullif(p.seller_name, ''), 'Mini vendor')
      when coalesce(o.seller_type, p.seller_type, 'tenant') = 'league'
        then coalesce(nullif(o.seller_name, ''), nullif(p.seller_name, ''), 'Liga')
      else 'Tenant'
    end as vendedor,
    public.bi_dia_semana(o."createdAt"::timestamptz) as dia_semana,
    greatest(coalesce(o.quantidade, 1), 1) as quantidade,
    coalesce(o.total, o.price * greatest(coalesce(o.quantidade, 1), 1), 0) as valor
  from public.orders o
  left join public.produtos p on p.id = o."productId"
  left join public.users u on u.uid = o."userId"
  where lower(coalesce(o.status, '')) in ('aprovado', 'approved', 'pago', 'paid', 'entregue', 'presente')
)
select
  tenant_id,
  produto_id,
  produto_nome,
  dimension_type,
  dimension_value,
  count(*)::bigint as pedidos,
  sum(quantidade)::bigint as quantidade,
  sum(valor)::numeric as valor,
  case when count(*) > 0 then (sum(valor) / count(*)) else 0 end as ticket_medio
from approved_orders
cross join lateral (
  values
    ('lote', lote),
    ('dia_semana', dia_semana),
    ('turma', turma),
    ('usuario', usuario),
    ('vendedor', vendedor)
) as dimensions(dimension_type, dimension_value)
group by tenant_id, produto_id, produto_nome, dimension_type, dimension_value;

drop view if exists public.bi_produtos_engajamento;
create view public.bi_produtos_engajamento
with (security_invoker = true)
as
select
  p.tenant_id,
  p.id as produto_id,
  coalesce(nullif(p.nome, ''), 'Produto') as produto_nome,
  coalesce(nullif(p.lote, ''), 'Sem lote') as lote,
  coalesce(nullif(p.categoria, ''), 'Sem categoria') as categoria,
  coalesce(p.seller_type, 'tenant') as seller_type,
  p.seller_id,
  coalesce(nullif(p.seller_name, ''), case when coalesce(p.seller_type, 'tenant') = 'mini_vendor' then 'Mini vendor' else 'Tenant' end) as seller_name,
  coalesce(array_length(p.likes, 1), 0)::bigint as likes,
  coalesce(p.cliques, 0)::bigint as cliques,
  coalesce(p.vendidos, 0)::bigint as vendidos,
  case when coalesce(p.cliques, 0) > 0 then coalesce(p.vendidos, 0)::numeric / p.cliques else 0 end as conversao_clique_compra
from public.produtos p;

grant select on
  public.bi_eventos_vendas_dimensoes,
  public.bi_eventos_checkins_hora,
  public.bi_treinos_presencas_dimensoes,
  public.bi_treinos_modalidades,
  public.bi_produtos_vendas_dimensoes,
  public.bi_produtos_engajamento
to authenticated;
