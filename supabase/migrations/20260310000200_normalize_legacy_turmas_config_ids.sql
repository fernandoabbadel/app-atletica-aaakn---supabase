-- Move legacy app_config.turmas_config rows to tenant-scoped ids.
-- This lets the frontend stop falling back to the shared/global id safely.

update public.app_config legacy
   set id = 'tenant:' || legacy.tenant_id::text || '::turmas_config',
       "updatedAt" = now()
 where legacy.id = 'turmas_config'
   and legacy.tenant_id is not null
   and not exists (
     select 1
       from public.app_config scoped
      where scoped.id = 'tenant:' || legacy.tenant_id::text || '::turmas_config'
   );
