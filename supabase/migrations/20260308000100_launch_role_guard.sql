update public.users as u
   set role = 'user'
 where coalesce(lower(trim(u.role)), 'guest') = 'guest'
   and coalesce(lower(trim(u.tenant_status)), '') = 'approved'
   and exists (
     select 1
       from public.tenant_memberships as m
      where m.user_id = u.uid
        and m.status = 'approved'
   );

create or replace function public.mt_guard_launch_public_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_launch_enabled boolean := true;
  v_has_approved_membership boolean := false;
  v_previous_role text := 'guest';
begin
  if tg_op = 'UPDATE' then
    v_previous_role := lower(trim(coalesce(old.role, 'guest')));
  end if;

  select coalesce(tokenization_active, true)
    into v_launch_enabled
    from public.tenant_platform_config
   where id = 'global'
   limit 1;

  select exists (
    select 1
      from public.tenant_memberships as m
     where m.user_id = new.uid
       and m.status = 'approved'
  )
    into v_has_approved_membership;

  if coalesce(lower(trim(coalesce(new.tenant_status, ''))), '') = 'approved'
     or v_has_approved_membership then
    if lower(trim(coalesce(new.role, 'guest'))) = 'guest' then
      new.role := 'user';
    end if;
    return new;
  end if;

  if coalesce(v_launch_enabled, true)
     and lower(trim(coalesce(new.role, 'guest'))) = 'user'
     and v_previous_role = 'guest'
     and not v_has_approved_membership then
    new.role := 'guest';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_guard_launch_public_role on public.users;

create trigger trg_users_guard_launch_public_role
before insert or update on public.users
for each row
execute function public.mt_guard_launch_public_role();
