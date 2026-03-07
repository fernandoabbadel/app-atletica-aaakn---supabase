alter table public.users
  add column if not exists invited_by text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'users_invited_by_fk'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_invited_by_fk
      foreign key (invited_by) references public.users(uid) on delete set null;
  end if;
end;
$$;

create index if not exists idx_users_invited_by on public.users (invited_by);

update public.users as u
   set invited_by = tm.invited_by
  from public.tenant_memberships as tm
 where tm.user_id = u.uid
   and coalesce(tm.invited_by, '') <> ''
   and coalesce(u.invited_by, '') = '';

create or replace function public.tenant_create_invite(
  p_tenant_id uuid,
  p_role_to_assign text default 'user',
  p_max_uses integer default 25,
  p_expires_in_hours integer default 72,
  p_requires_approval boolean default true
)
returns table(invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_token text;
  v_expires_at timestamptz;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;
  if not public.mt_can_manage_tenant(p_tenant_id) then raise exception 'Sem permissao neste tenant'; end if;

  v_expires_at := now() + (greatest(1, coalesce(p_expires_in_hours, 72)) || ' hours')::interval;

  loop
    v_token := public.mt_build_invite_token();
    exit when not exists (select 1 from public.tenant_invites i where i.token = v_token);
  end loop;

  insert into public.tenant_invites (
    tenant_id, token, role_to_assign, requires_approval, max_uses, uses_count, expires_at, is_active, created_by
  ) values (
    p_tenant_id,
    v_token,
    'user',
    coalesce(p_requires_approval, true),
    greatest(1, coalesce(p_max_uses, 25)),
    0,
    v_expires_at,
    true,
    v_uid
  ) returning id, tenant_invites.token, tenant_invites.expires_at into invite_id, token, expires_at;

  return next;
end;
$$;

grant execute on function public.tenant_create_invite(uuid, text, integer, integer, boolean) to authenticated;

create or replace function public.tenant_request_join_with_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_invite public.tenant_invites%rowtype;
  v_request_id uuid;
  v_status text;
  v_role text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select * into v_invite
    from public.tenant_invites
   where token = trim(coalesce(p_token, ''))
     and is_active = true
   limit 1;
  if not found then raise exception 'Token invalido ou inativo'; end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then raise exception 'Token expirado'; end if;
  if v_invite.uses_count >= v_invite.max_uses then raise exception 'Token esgotado'; end if;

  if exists (
    select 1 from public.users u
     where u.uid = v_uid
       and u.tenant_id is not null
       and u.tenant_id <> v_invite.tenant_id
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) then
    raise exception 'Usuario ja vinculado a outra atletica';
  end if;

  v_status := case when v_invite.requires_approval then 'pending' else 'approved' end;
  v_role := 'user';

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, invited_by, approved_by, approved_at
  ) values (
    v_invite.tenant_id,
    v_uid,
    case when v_status = 'approved' then v_role else 'visitante' end,
    v_status,
    v_invite.created_by,
    case when v_status = 'approved' then coalesce(v_invite.created_by, v_uid) else null end,
    case when v_status = 'approved' then now() else null end
  )
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role,
        status = excluded.status,
        invited_by = excluded.invited_by,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_invite.tenant_id,
         tenant_role = case when v_status = 'approved' then v_role else 'visitante' end,
         tenant_status = v_status,
         invited_by = coalesce(v_invite.created_by, invited_by),
         updatedAt = now()::text
   where uid = v_uid;

  insert into public.tenant_join_requests (
    tenant_id, requester_user_id, invite_id, status, requested_role, approved_role, requested_at, reviewed_at, reviewed_by
  ) values (
    v_invite.tenant_id,
    v_uid,
    v_invite.id,
    v_status,
    'visitante',
    case when v_status = 'approved' then v_role else null end,
    now(),
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'approved' then coalesce(v_invite.created_by, v_uid) else null end
  ) returning id into v_request_id;

  update public.tenant_invites
     set uses_count = uses_count + 1,
         is_active = case when uses_count + 1 >= max_uses then false else is_active end,
         updated_at = now()
   where id = v_invite.id;

  return v_request_id;
end;
$$;

grant execute on function public.tenant_request_join_with_invite(text) to authenticated;

create or replace function public.tenant_approve_join_request(
  p_request_id uuid,
  p_approved_role text default 'user'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_join_requests%rowtype;
  v_role text;
  v_invited_by text;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select * into v_request
    from public.tenant_join_requests
   where id = p_request_id
   limit 1;
  if not found then raise exception 'Solicitacao nao encontrada'; end if;
  if not public.mt_can_manage_tenant(v_request.tenant_id) then raise exception 'Sem permissao'; end if;
  if v_request.status <> 'pending' then return; end if;

  v_role := 'user';

  update public.tenant_join_requests
     set status = 'approved',
         approved_role = v_role,
         reviewed_at = now(),
         reviewed_by = v_uid,
         updated_at = now()
   where id = v_request.id;

  update public.tenant_memberships
     set status = 'approved',
         role = v_role,
         approved_by = v_uid,
         approved_at = now(),
         updated_at = now()
   where tenant_id = v_request.tenant_id
     and user_id = v_request.requester_user_id;

  select tm.invited_by
    into v_invited_by
    from public.tenant_memberships tm
   where tm.tenant_id = v_request.tenant_id
     and tm.user_id = v_request.requester_user_id
   limit 1;

  if coalesce(v_invited_by, '') = '' and v_request.invite_id is not null then
    select i.created_by
      into v_invited_by
      from public.tenant_invites i
     where i.id = v_request.invite_id
     limit 1;
  end if;

  update public.users
     set tenant_id = v_request.tenant_id,
         tenant_role = v_role,
         tenant_status = 'approved',
         invited_by = coalesce(v_invited_by, invited_by),
         updatedAt = now()::text
   where uid = v_request.requester_user_id;
end;
$$;

grant execute on function public.tenant_approve_join_request(uuid, text) to authenticated;
