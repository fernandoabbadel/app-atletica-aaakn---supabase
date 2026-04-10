alter table public.mini_vendors enable row level security;

drop policy if exists "mini_vendors_insert" on public.mini_vendors;
create policy "mini_vendors_insert"
  on public.mini_vendors
  for insert
  to authenticated
  with check (
    tenant_id is not null
    and (
      user_id = auth.uid()::text
      or public.mt_can_manage_tenant(tenant_id)
    )
  );

notify pgrst, 'reload schema';
