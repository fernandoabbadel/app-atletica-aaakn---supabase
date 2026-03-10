create or replace function public.mt_track_invite_activation_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter_id text;
  v_current_stats jsonb;
  v_next_total integer;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.status, '') <> 'approved' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.status, '') <> 'approved' or coalesce(old.status, '') = 'approved' then
      return new;
    end if;
  else
    return new;
  end if;

  if new.invite_id is not null then
    select i.created_by
      into v_inviter_id
      from public.tenant_invites i
     where i.id = new.invite_id
     limit 1;
  end if;

  if coalesce(v_inviter_id, '') = '' then
    select tm.invited_by
      into v_inviter_id
      from public.tenant_memberships tm
     where tm.tenant_id = new.tenant_id
       and tm.user_id = new.requester_user_id
     limit 1;
  end if;

  if coalesce(v_inviter_id, '') = '' then
    return new;
  end if;

  select coalesce(u.stats::jsonb, '{}'::jsonb)
    into v_current_stats
    from public.users u
   where u.uid = v_inviter_id
   limit 1;

  v_next_total := greatest(
    0,
    coalesce((v_current_stats ->> 'inviteActivations')::integer, 0) + 1
  );

  update public.users
     set stats = jsonb_set(
       coalesce(stats::jsonb, '{}'::jsonb),
       '{inviteActivations}',
       to_jsonb(v_next_total),
       true
     )
   where uid = v_inviter_id;

  return new;
end;
$$;

grant execute on function public.mt_track_invite_activation_stats() to authenticated;

drop trigger if exists trg_tenant_join_requests_invite_activation_stats on public.tenant_join_requests;

create trigger trg_tenant_join_requests_invite_activation_stats
after insert or update on public.tenant_join_requests
for each row
execute function public.mt_track_invite_activation_stats();
