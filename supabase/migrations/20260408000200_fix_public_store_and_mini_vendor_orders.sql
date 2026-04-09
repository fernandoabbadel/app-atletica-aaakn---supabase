alter table public.produtos enable row level security;
alter table public.categorias enable row level security;
alter table public.mini_vendors enable row level security;
alter table public.orders enable row level security;

drop policy if exists public_store_products_select on public.produtos;
create policy public_store_products_select
  on public.produtos
  for select
  to public
  using (
    tenant_id is not null
    and active is true
    and aprovado is true
    and (
      coalesce(seller_type, 'tenant') <> 'mini_vendor'
      or exists (
        select 1
          from public.mini_vendors mv
         where mv.id::text = produtos.seller_id
           and mv.tenant_id = produtos.tenant_id
           and mv.status = 'approved'
           and coalesce(mv.products_visible, true)
      )
    )
  );

drop policy if exists public_store_categories_select on public.categorias;
create policy public_store_categories_select
  on public.categorias
  for select
  to public
  using (
    tenant_id is not null
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

drop policy if exists public_mini_vendors_select on public.mini_vendors;
create policy public_mini_vendors_select
  on public.mini_vendors
  for select
  to public
  using (
    status = 'approved'
    and coalesce(profile_visible, true)
  );

drop policy if exists tenant_orders_select on public.orders;
create policy tenant_orders_select
  on public.orders
  for select
  to authenticated
  using (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or "userId" = auth.uid()::text
    or (
      coalesce(seller_type, 'tenant') = 'mini_vendor'
      and exists (
        select 1
          from public.mini_vendors mv
         where mv.id::text = orders.seller_id
           and mv.tenant_id = orders.tenant_id
           and mv.user_id = auth.uid()::text
      )
    )
  );

drop policy if exists tenant_orders_update on public.orders;
create policy tenant_orders_update
  on public.orders
  for update
  to authenticated
  using (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or (
      coalesce(seller_type, 'tenant') = 'mini_vendor'
      and exists (
        select 1
          from public.mini_vendors mv
         where mv.id::text = orders.seller_id
           and mv.tenant_id = orders.tenant_id
           and mv.user_id = auth.uid()::text
      )
    )
  )
  with check (
    public.mt_is_platform_master()
    or public.mt_can_manage_tenant(tenant_id)
    or (
      coalesce(seller_type, 'tenant') = 'mini_vendor'
      and exists (
        select 1
          from public.mini_vendors mv
         where mv.id::text = orders.seller_id
           and mv.tenant_id = orders.tenant_id
           and mv.user_id = auth.uid()::text
      )
    )
  );

notify pgrst, 'reload schema';
