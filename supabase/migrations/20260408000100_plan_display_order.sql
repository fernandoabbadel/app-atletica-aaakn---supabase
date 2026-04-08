alter table public.planos
  add column if not exists "displayOrder" integer;

with ordered_planos as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by
        "createdAt" asc,
        id asc
    ) - 1 as next_display_order
  from public.planos
)
update public.planos as planos
   set "displayOrder" = ordered_planos.next_display_order
  from ordered_planos
 where planos.id = ordered_planos.id
   and planos."displayOrder" is null;

update public.planos
   set "displayOrder" = 0
 where "displayOrder" is null;

alter table public.planos
  alter column "displayOrder" set default 0,
  alter column "displayOrder" set not null;

create index if not exists idx_planos_tenant_display_order
  on public.planos (tenant_id, "displayOrder", nome);

notify pgrst, 'reload schema';
