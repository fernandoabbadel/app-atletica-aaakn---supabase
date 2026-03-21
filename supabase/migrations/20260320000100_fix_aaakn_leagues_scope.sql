do $$
declare
  aaakn_tenant_id constant uuid := 'c8cef191-22d0-4773-9447-3d0f91dc8b38';
begin
  update public.ligas_config
     set tenant_id = aaakn_tenant_id,
         "updatedAt" = now()
   where id in (
     'a153ef50-03f0-4f9f-b330-8eacf94729d0',
     '9e6e8e39-59ae-45e7-974b-bea26c72a1af'
   )
     and coalesce(tenant_id, aaakn_tenant_id) <> aaakn_tenant_id;
end $$;
