begin;

create extension if not exists pgcrypto;

alter table public.ligas_config
  add column if not exists tenant_id uuid,
  add column if not exists descricao text,
  add column if not exists presidente text,
  add column if not exists senha text,
  add column if not exists logo text,
  add column if not exists "logoUrl" text,
  add column if not exists bizu text,
  add column if not exists visivel boolean not null default true,
  add column if not exists ativa boolean not null default true,
  add column if not exists membros jsonb not null default '[]'::jsonb,
  add column if not exists eventos jsonb not null default '[]'::jsonb,
  add column if not exists perguntas jsonb not null default '[]'::jsonb,
  add column if not exists likes integer not null default 0,
  add column if not exists "membrosIds" text[] not null default '{}'::text[],
  add column if not exists "membersCount" integer not null default 0,
  add column if not exists category text not null default 'liga',
  add column if not exists "turmaId" text,
  add column if not exists "visaoGeral" text not null default '';

update public.ligas_config
   set category = 'comissao',
       "updatedAt" = now()
 where lower(trim(coalesce(data ->> 'category', ''))) in ('comissao', 'comissões', 'comissoes');

update public.ligas_config
   set "turmaId" = upper(trim(data ->> 'turmaId')),
       "updatedAt" = now()
 where nullif(trim(coalesce(data ->> 'turmaId', '')), '') is not null
   and nullif(trim(coalesce("turmaId", '')), '') is null;

with turma_docs as (
  select
    coalesce(
      app_config.tenant_id,
      case
        when app_config.id ~ '^tenant:[0-9a-fA-F-]{36}::turmas_config$'
          then substring(app_config.id from '^tenant:([0-9a-fA-F-]{36})::')::uuid
        else null
      end
    ) as tenant_id,
    turma.value as turma_data
  from public.app_config
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(app_config.data -> 'turmas', '[]'::jsonb)) = 'array'
        then coalesce(app_config.data -> 'turmas', '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as turma(value)
  where app_config.id = 'turmas_config'
     or app_config.id ~ '^tenant:[0-9a-fA-F-]{36}::turmas_config$'
),
normalized_turmas as (
  select
    tenant_id,
    case
      when upper(trim(coalesce(turma_data ->> 'id', ''))) ~ '^T[0-9]{1,3}$'
        then 'T' || ((regexp_replace(upper(trim(turma_data ->> 'id')), '\D', '', 'g'))::integer)::text
      when regexp_replace(upper(trim(coalesce(turma_data ->> 'id', ''))), '\D', '', 'g') <> ''
        then 'T' || ((regexp_replace(upper(trim(turma_data ->> 'id')), '\D', '', 'g'))::integer)::text
      else ''
    end as turma_id,
    coalesce(nullif(trim(turma_data ->> 'nome'), ''), 'Turma') as turma_nome,
    coalesce(nullif(trim(turma_data ->> 'capa'), ''), nullif(trim(turma_data ->> 'logo'), ''), '/logo.png') as foto,
    lower(trim(coalesce(turma_data ->> 'hidden', 'false'))) as hidden_flag
  from turma_docs
  where tenant_id is not null
),
visible_turmas as (
  select
    tenant_id,
    turma_id,
    case
      when turma_nome = 'Turma' and regexp_replace(turma_id, '\D', '', 'g') <> ''
        then 'Turma ' || regexp_replace(turma_id, '\D', '', 'g')
      else turma_nome
    end as turma_nome,
    foto
  from normalized_turmas
  where turma_id <> ''
    and hidden_flag not in ('true', '1', 'yes', 'sim')
)
insert into public.ligas_config (
  id,
  tenant_id,
  nome,
  sigla,
  presidente,
  descricao,
  "visaoGeral",
  foto,
  logo,
  "logoUrl",
  visivel,
  ativa,
  membros,
  "membrosIds",
  "membersCount",
  eventos,
  perguntas,
  likes,
  status,
  category,
  "turmaId",
  bizu,
  data,
  "createdAt",
  "updatedAt"
)
select
  gen_random_uuid()::text,
  visible_turmas.tenant_id,
  'Comissão ' || visible_turmas.turma_nome,
  visible_turmas.turma_id,
  '',
  'Página oficial da comissão da ' || visible_turmas.turma_nome || '.',
  'Representação da ' || visible_turmas.turma_nome || E'.\nMembros oficiais.\nAgenda interna e aberta.\nLoja da comissão.',
  visible_turmas.foto,
  visible_turmas.foto,
  visible_turmas.foto,
  true,
  true,
  '[]'::jsonb,
  array[]::text[],
  0,
  '[]'::jsonb,
  '[]'::jsonb,
  0,
  'approved',
  'comissao',
  visible_turmas.turma_id,
  '',
  jsonb_build_object(
    'nome', 'Comissão ' || visible_turmas.turma_nome,
    'sigla', visible_turmas.turma_id,
    'presidente', '',
    'descricao', 'Página oficial da comissão da ' || visible_turmas.turma_nome || '.',
    'visaoGeral', 'Representação da ' || visible_turmas.turma_nome || E'.\nMembros oficiais.\nAgenda interna e aberta.\nLoja da comissão.',
    'foto', visible_turmas.foto,
    'logo', visible_turmas.foto,
    'logoUrl', visible_turmas.foto,
    'visivel', true,
    'ativa', true,
    'membros', '[]'::jsonb,
    'membrosIds', '[]'::jsonb,
    'membersCount', 0,
    'eventos', '[]'::jsonb,
    'perguntas', '[]'::jsonb,
    'likes', 0,
    'status', 'approved',
    'category', 'comissao',
    'turmaId', visible_turmas.turma_id,
    'bizu', ''
  ),
  now(),
  now()
from visible_turmas
where not exists (
  select 1
    from public.ligas_config existing
   where existing.tenant_id is not distinct from visible_turmas.tenant_id
     and lower(trim(coalesce(existing.category, existing.data ->> 'category', 'liga'))) in ('comissao', 'comissões', 'comissoes')
     and upper(trim(coalesce(existing."turmaId", existing.data ->> 'turmaId', ''))) = visible_turmas.turma_id
);

notify pgrst, 'reload schema';

commit;
