update public.users
   set tenant_id = 'c8cef191-22d0-4773-9447-3d0f91dc8b38'::uuid,
       turma = 'T2',
       tenant_status = 'approved',
       "updatedAt" = now()
 where uid = '3e4fc3ca-de64-4287-9749-990b08d5a7ac';
