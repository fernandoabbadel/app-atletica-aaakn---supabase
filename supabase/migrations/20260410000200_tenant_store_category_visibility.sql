alter table public.categorias
  add column if not exists visible boolean not null default true;

update public.categorias
   set visible = true
 where visible is null;

alter table public.categorias
  alter column visible set default true;

alter table public.categorias enable row level security;

drop policy if exists public_store_categories_select on public.categorias;
create policy public_store_categories_select
  on public.categorias
  for select
  to public
  using (
    tenant_id is not null
    and coalesce(visible, true)
    and (
      coalesce(seller_type, 'tenant') <> 'mini_vendor'
      or exists (
        select 1
          from public.mini_vendors mv
         where mv.id::text = categorias.seller_id
           and mv.tenant_id = categorias.tenant_id
           and mv.status = 'approved'
           and coalesce(mv.category_visible, true)
      )
    )
  );

notify pgrst, 'reload schema';
