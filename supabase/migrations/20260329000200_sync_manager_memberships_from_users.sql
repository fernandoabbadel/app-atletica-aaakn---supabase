with manager_roles as (
  select
    u.uid,
    u.tenant_id,
    case
      when lower(coalesce(u.tenant_role, '')) = 'admin_tenant' then 'admin_geral'
      when lower(coalesce(u.tenant_role, '')) in ('admin_geral', 'admin_gestor', 'master', 'master_tenant')
        then lower(u.tenant_role)
      else null
    end as next_role
  from public.users u
  where u.tenant_id is not null
    and lower(coalesce(u.tenant_status, '')) = 'approved'
)
update public.tenant_memberships m
   set role = manager_roles.next_role,
       status = 'approved',
       updated_at = now()
  from manager_roles
 where manager_roles.next_role is not null
   and m.user_id = manager_roles.uid
   and m.tenant_id = manager_roles.tenant_id
   and (
     lower(coalesce(m.role, '')) <> manager_roles.next_role
     or lower(coalesce(m.status, '')) <> 'approved'
   );
