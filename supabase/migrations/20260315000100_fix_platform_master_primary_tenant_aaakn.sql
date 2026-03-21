do $$
declare
  target_user_id constant text := '3e4fc3ca-de64-4287-9749-990b08d5a7ac';
  aaakn_tenant_id constant uuid := 'c8cef191-22d0-4773-9447-3d0f91dc8b38';
  aaaenf_tenant_id constant uuid := '1dd3304b-73fc-4a60-b2b6-577f973ab60e';
begin
  alter table public.users disable trigger trg_preserve_platform_master_primary_tenant;

  update public.users
     set tenant_id = aaakn_tenant_id,
         turma = 'T2',
         tenant_role = 'master',
         tenant_status = 'approved',
         "updatedAt" = now()
   where uid = target_user_id;

  update public.tenant_memberships
     set role = 'master',
         status = 'approved',
         updated_at = now()
   where user_id = target_user_id
     and tenant_id = aaakn_tenant_id;

  delete
    from public.tenant_memberships
   where user_id = target_user_id
     and tenant_id = aaaenf_tenant_id;

  alter table public.users enable trigger trg_preserve_platform_master_primary_tenant;
end $$;
