alter table public.categorias
  add column if not exists display_order integer;

with ordered_categories as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by
        case when coalesce(seller_type, 'tenant') = 'tenant' then 0 else 1 end,
        lower(coalesce(nome, '')),
        "createdAt" asc,
        id asc
    ) - 1 as next_display_order
  from public.categorias
)
update public.categorias as categorias
   set display_order = ordered_categories.next_display_order
  from ordered_categories
 where categorias.id = ordered_categories.id
   and categorias.display_order is null;

update public.categorias
   set display_order = 0
 where display_order is null;

alter table public.categorias
  alter column display_order set default 0,
  alter column display_order set not null;

create index if not exists idx_categorias_tenant_display_order
  on public.categorias (tenant_id, display_order, nome);

alter table public.mini_vendors
  add column if not exists profile_visible boolean not null default true,
  add column if not exists category_visible boolean not null default true,
  add column if not exists products_visible boolean not null default true;

create index if not exists idx_mini_vendors_tenant_public_flags
  on public.mini_vendors (
    tenant_id,
    status,
    profile_visible,
    category_visible,
    products_visible
  );
