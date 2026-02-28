-- Runtime compat patch (2026-02-28)
-- Objetivos:
-- 1) reduzir over-fetch via filtros mais seletivos e indices
-- 2) suportar RPC paginada para lista consolidada de presenca por evento
-- 3) segurar custo no free tier (menos CPU + menos egress)

-- Album ranking por turma (query pushdown)
create index if not exists idx_album_rankings_turma_totalcoletado
  on public.album_rankings (turma, "totalColetado" desc);

-- Eventos: leitura consolidada de presenca/pagamento
create index if not exists idx_eventos_rsvps_evento_timestamp_user
  on public.eventos_rsvps ("eventoId", timestamp desc, "userId");

create index if not exists idx_solic_ing_evento_data_user
  on public.solicitacoes_ingressos ("eventoId", "dataSolicitacao" desc, "userId");

-- Guia: filtro por categoria e ordenacao por ordem
create index if not exists idx_guia_data_categoria_ordem
  on public.guia_data (categoria, ordem);

-- Loja: fallback de indice mesmo se coluna "aprovado" ainda nao existir
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'produtos'
      and column_name = 'aprovado'
  ) then
    execute 'create index if not exists idx_produtos_active_aprovado_categoria_nome
             on public.produtos (active, aprovado, categoria, nome)';
  else
    execute 'create index if not exists idx_produtos_active_categoria_nome
             on public.produtos (active, categoria, nome)';
  end if;
end;
$$;

create or replace function public.admin_event_presence_page(
  p_event_id text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id text,
  "userId" text,
  "userName" text,
  "userAvatar" text,
  "userTurma" text,
  "rsvpStatus" text,
  pagamento text,
  lote text,
  quantidade integer,
  "valorTotal" text,
  "dataAprovacao" timestamptz,
  "aprovadoPor" text,
  "ticketRequestId" text
)
language sql
stable
as $$
  with rsvp_latest as (
    select distinct on (r."userId")
      r.id,
      r."userId",
      r."userName",
      r."userAvatar",
      r."userTurma",
      case
        when lower(coalesce(r.status, '')) = 'going' then 'going'
        else 'maybe'
      end as "rsvpStatus",
      r.timestamp
    from public.eventos_rsvps r
    where r."eventoId" = p_event_id
    order by r."userId", r.timestamp desc nulls last
  ),
  sale_latest as (
    select distinct on (s."userId")
      s.id as sale_id,
      s."userId",
      s."userName",
      s."userTurma",
      case
        when lower(coalesce(s.status, '')) = 'aprovado' then 'pago'
        when lower(coalesce(s.status, '')) = 'analise' then 'analise'
        else 'pendente'
      end as pagamento,
      coalesce(nullif(s."loteNome", ''), '-') as lote,
      greatest(1, coalesce(s.quantidade, 1)) as quantidade,
      coalesce(nullif(s."valorTotal", ''), '0') as "valorTotal",
      s."dataAprovacao",
      coalesce(s."aprovadoPor", '') as "aprovadoPor",
      s."dataSolicitacao"
    from public.solicitacoes_ingressos s
    where s."eventoId" = p_event_id
    order by s."userId", s."dataSolicitacao" desc nulls last
  ),
  merged as (
    select
      coalesce(r.id, s.sale_id) as id,
      coalesce(r."userId", s."userId") as "userId",
      coalesce(nullif(s."userName", ''), nullif(r."userName", ''), 'Aluno') as "userName",
      coalesce(nullif(r."userAvatar", ''), '') as "userAvatar",
      coalesce(nullif(s."userTurma", ''), nullif(r."userTurma", ''), '-') as "userTurma",
      case
        when s.sale_id is not null then 'going'
        else coalesce(r."rsvpStatus", 'maybe')
      end as "rsvpStatus",
      coalesce(s.pagamento, 'pendente') as pagamento,
      coalesce(s.lote, '-') as lote,
      coalesce(s.quantidade, 1) as quantidade,
      coalesce(s."valorTotal", '-') as "valorTotal",
      s."dataAprovacao",
      s."aprovadoPor",
      s.sale_id as "ticketRequestId"
    from rsvp_latest r
    full outer join sale_latest s on s."userId" = r."userId"
  )
  select
    merged.id,
    merged."userId",
    merged."userName",
    merged."userAvatar",
    merged."userTurma",
    merged."rsvpStatus",
    merged.pagamento,
    merged.lote,
    merged.quantidade,
    merged."valorTotal",
    merged."dataAprovacao",
    merged."aprovadoPor",
    merged."ticketRequestId"
  from merged
  order by lower(merged."userName"), merged."userId"
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 20), 1);
$$;

grant execute on function public.admin_event_presence_page(text, integer, integer) to anon, authenticated;
