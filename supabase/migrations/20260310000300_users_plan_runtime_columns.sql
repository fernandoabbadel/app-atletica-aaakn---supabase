begin;

alter table public.users
  add column if not exists "xpMultiplier" numeric(8,2) not null default 1,
  add column if not exists desconto_loja numeric(8,2) not null default 0,
  add column if not exists nivel_prioridade integer not null default 1,
  add column if not exists "isAnonymous" boolean not null default false;

with normalized_planos as (
  select
    regexp_replace(lower(trim(coalesce(nome, ''))), '^plano\s+', '') as nome_norm,
    coalesce("xpMultiplier", 1)::numeric(8,2) as xp_multiplier,
    coalesce("descontoLoja", 0)::numeric(8,2) as desconto_loja,
    greatest(coalesce("nivelPrioridade", 1), 1) as nivel_prioridade
  from public.planos
),
matched_planos as (
  select
    u.uid,
    p.xp_multiplier,
    p.desconto_loja,
    p.nivel_prioridade
  from public.users u
  join normalized_planos p
    on regexp_replace(lower(trim(coalesce(u.plano, ''))), '^plano\s+', '') = p.nome_norm
)
update public.users as u
   set "xpMultiplier" = mp.xp_multiplier,
       desconto_loja = mp.desconto_loja,
       nivel_prioridade = mp.nivel_prioridade,
       "updatedAt" = now()
  from matched_planos mp
 where u.uid = mp.uid
   and (
     u."xpMultiplier" is distinct from mp.xp_multiplier
     or u.desconto_loja is distinct from mp.desconto_loja
     or u.nivel_prioridade is distinct from mp.nivel_prioridade
   );

update public.users
   set "xpMultiplier" = coalesce("xpMultiplier", 1),
       desconto_loja = coalesce(desconto_loja, 0),
       nivel_prioridade = greatest(coalesce(nivel_prioridade, 1), 1),
       "isAnonymous" = coalesce("isAnonymous", false)
 where "xpMultiplier" is null
    or desconto_loja is null
    or nivel_prioridade is null
    or "isAnonymous" is null;

notify pgrst, 'reload schema';

commit;
