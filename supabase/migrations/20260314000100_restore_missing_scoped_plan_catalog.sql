-- Reconstroi o catalogo padrao scoped por atletica sem sobrescrever planos ja existentes.
-- Prioridade da fonte:
-- 1. linha global legacy (tenant_id null) com o mesmo base_id
-- 2. qualquer linha scoped sobrevivente com o mesmo base_id
-- 3. fallback hardcoded dos 4 planos padrao

create temp table _default_catalog on commit drop as
select *
  from (
    values
      (
        'bicho_solto',
        'Bicho Solto',
        '0,00',
        0::numeric,
        'Acesso gratuito',
        'Entrada no ecossistema AAAKN',
        'zinc',
        'ghost',
        false,
        array[
          'Acesso ao app e carteira digital',
          'Participacao em eventos abertos',
          'Ranking e funcionalidades basicas'
        ]::text[],
        1::numeric,
        1::integer,
        0::numeric
      ),
      (
        'cardume_livre',
        'Cardume Livre',
        '14,90',
        14.9::numeric,
        'ou 12x de R$ 1,49',
        'Primeiro nivel premium',
        'blue',
        'fish',
        false,
        array[
          'Desconto em parceiros selecionados',
          'Prioridade moderada em lotes',
          'Acesso a conteudos exclusivos'
        ]::text[],
        1.1::numeric,
        2::integer,
        5::numeric
      ),
      (
        'atleta',
        'Atleta',
        '29,90',
        29.9::numeric,
        'ou 12x de R$ 2,99',
        'Plano oficial do atleta',
        'emerald',
        'star',
        true,
        array[
          'Prioridade em eventos e inscricoes',
          'Desconto ampliado na loja',
          'Multiplicador de XP turbinado'
        ]::text[],
        1.25::numeric,
        3::integer,
        10::numeric
      ),
      (
        'lenda',
        'Lenda',
        '59,90',
        59.9::numeric,
        'ou 12x de R$ 5,99',
        'Maximo nivel de beneficios',
        'yellow',
        'crown',
        true,
        array[
          'Prioridade maxima no ecossistema',
          'Maior desconto na loja',
          'Beneficios VIP em acoes especiais'
        ]::text[],
        1.5::numeric,
        4::integer,
        20::numeric
      )
  ) as defaults(
    base_id,
    nome,
    preco,
    "precoVal",
    parcelamento,
    descricao,
    cor,
    icon,
    destaque,
    beneficios,
    "xpMultiplier",
    "nivelPrioridade",
    "descontoLoja"
  );

with
source_rows as (
  select
    defaults.base_id,
    coalesce(global_row.nome, scoped_row.nome, defaults.nome) as nome,
    coalesce(global_row.preco, scoped_row.preco, defaults.preco) as preco,
    coalesce(global_row."precoVal", scoped_row."precoVal", defaults."precoVal") as "precoVal",
    coalesce(global_row.parcelamento, scoped_row.parcelamento, defaults.parcelamento) as parcelamento,
    coalesce(global_row.descricao, scoped_row.descricao, defaults.descricao) as descricao,
    coalesce(global_row.cor, scoped_row.cor, defaults.cor) as cor,
    coalesce(global_row.icon, scoped_row.icon, defaults.icon) as icon,
    coalesce(global_row.destaque, scoped_row.destaque, defaults.destaque) as destaque,
    coalesce(global_row.beneficios, scoped_row.beneficios, defaults.beneficios) as beneficios,
    coalesce(global_row."xpMultiplier", scoped_row."xpMultiplier", defaults."xpMultiplier") as "xpMultiplier",
    coalesce(global_row."nivelPrioridade", scoped_row."nivelPrioridade", defaults."nivelPrioridade") as "nivelPrioridade",
    coalesce(global_row."descontoLoja", scoped_row."descontoLoja", defaults."descontoLoja") as "descontoLoja",
    coalesce(global_row."createdAt", scoped_row."createdAt", now()) as "createdAt",
    now() as "updatedAt"
    from _default_catalog defaults
    left join lateral (
      select p.*
        from public.planos p
       where p.tenant_id is null
         and trim(p.id) = defaults.base_id
       order by p."updatedAt" desc nulls last, p."createdAt" desc nulls last
       limit 1
    ) global_row on true
    left join lateral (
      select p.*
        from public.planos p
       where regexp_replace(p.id, '^tenant:[^:]+::', '') = defaults.base_id
       order by p."updatedAt" desc nulls last, p."createdAt" desc nulls last
       limit 1
    ) scoped_row on true
),
missing_scoped_rows as (
  select
    t.id as tenant_id,
    'tenant:' || t.id::text || '::' || source.base_id as scoped_id,
    source.*
    from public.tenants t
    cross join source_rows source
    left join public.planos existing
      on existing.id = 'tenant:' || t.id::text || '::' || source.base_id
   where existing.id is null
)
insert into public.planos (
  id,
  nome,
  preco,
  "precoVal",
  parcelamento,
  descricao,
  cor,
  icon,
  destaque,
  beneficios,
  "xpMultiplier",
  "nivelPrioridade",
  "descontoLoja",
  tenant_id,
  "createdAt",
  "updatedAt"
)
select
  missing.scoped_id,
  missing.nome,
  missing.preco,
  missing."precoVal",
  missing.parcelamento,
  missing.descricao,
  missing.cor,
  missing.icon,
  missing.destaque,
  missing.beneficios,
  missing."xpMultiplier",
  missing."nivelPrioridade",
  missing."descontoLoja",
  missing.tenant_id,
  missing."createdAt",
  missing."updatedAt"
  from missing_scoped_rows missing
on conflict (id) do nothing;

with plan_ids as (
  select
    t.id as tenant_id,
    defaults.base_id,
    'tenant:' || t.id::text || '::' || defaults.base_id as scoped_id
    from public.tenants t
    cross join _default_catalog defaults
)
update public.solicitacoes_adesao s
   set "planoId" = ids.scoped_id
  from plan_ids ids
 where s.tenant_id = ids.tenant_id
   and s."planoId" = ids.base_id
   and exists (
     select 1
       from public.planos p
      where p.id = ids.scoped_id
   );

with plan_ids as (
  select
    t.id as tenant_id,
    defaults.base_id,
    'tenant:' || t.id::text || '::' || defaults.base_id as scoped_id
    from public.tenants t
    cross join _default_catalog defaults
)
update public.assinaturas a
   set "planoId" = ids.scoped_id
  from plan_ids ids
 where a.tenant_id = ids.tenant_id
   and a."planoId" = ids.base_id
   and exists (
     select 1
       from public.planos p
      where p.id = ids.scoped_id
   );

notify pgrst, 'reload schema';
