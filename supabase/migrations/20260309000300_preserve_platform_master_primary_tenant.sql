create or replace function public.preserve_platform_master_primary_tenant()
returns trigger
language plpgsql
as $$
begin
  if
    lower(coalesce(old.role, '')) = 'master'
    and coalesce(old.tenant_status, '') = 'approved'
    and nullif(trim(coalesce(old.tenant_id::text, '')), '') is not null
    and coalesce(new.tenant_id::text, '') is distinct from coalesce(old.tenant_id::text, '')
  then
    new.tenant_id := old.tenant_id;
    new.tenant_role := old.tenant_role;
    new.tenant_status := old.tenant_status;
    new.invited_by := old.invited_by;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_platform_master_primary_tenant on public.users;

create trigger trg_preserve_platform_master_primary_tenant
before update on public.users
for each row
execute function public.preserve_platform_master_primary_tenant();
