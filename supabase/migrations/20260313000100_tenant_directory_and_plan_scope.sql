alter table public.tenants
  add column if not exists visible_in_directory boolean not null default true;

create index if not exists idx_tenants_public_directory
  on public.tenants (status, visible_in_directory, nome);

drop policy if exists tenants_select_visible on public.tenants;

create policy tenants_select_visible on public.tenants
  for select to authenticated
  using (
    public.mt_is_platform_master()
    or status = 'active'
    or exists (
      select 1
        from public.tenant_memberships m
       where m.tenant_id = tenants.id
         and m.user_id = auth.uid()::text
    )
  );

create or replace function public.tenant_request_join_manual(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request_id uuid;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = p_tenant_id
       and t.status = 'active'
       and t.allow_public_signup = true
  ) then
    raise exception 'Atletica indisponivel para cadastro publico.';
  end if;

  if exists (
    select 1 from public.users u
     where u.uid = v_uid
       and u.tenant_id is not null
       and u.tenant_id <> p_tenant_id
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) and not public.mt_is_platform_master() then
    raise exception 'Usuario ja vinculado a outra atletica';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role, status)
  values (p_tenant_id, v_uid, 'visitante', 'pending')
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        status = excluded.status,
        updated_at = now();

  update public.users
     set tenant_id = p_tenant_id,
         tenant_role = 'visitante',
         tenant_status = 'pending'
   where uid = v_uid;

  if exists (
    select 1 from public.tenant_join_requests r
     where r.tenant_id = p_tenant_id
       and r.requester_user_id = v_uid
       and r.status = 'pending'
  ) then
    select r.id into v_request_id
      from public.tenant_join_requests r
     where r.tenant_id = p_tenant_id
       and r.requester_user_id = v_uid
       and r.status = 'pending'
     order by r.requested_at desc
     limit 1;
    return v_request_id;
  end if;

  insert into public.tenant_join_requests (tenant_id, requester_user_id, status, requested_role, requested_at)
  values (p_tenant_id, v_uid, 'pending', 'visitante', now())
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function public.tenant_request_join_manual(uuid) to authenticated;

update public.planos p
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(p.id)
 where p.tenant_id is null
   and p.id ~ '^tenant:[^:]+::.+$';

create temp table _plan_scope_map on commit drop as
select distinct
       source.legacy_id,
       source.tenant_id,
       'tenant:' || source.tenant_id::text || '::' || trim(source.legacy_id) as scoped_id
  from (
    select p.id as legacy_id, p.tenant_id
      from public.planos p
     where p.tenant_id is not null
       and coalesce(trim(p.id), '') <> ''
       and p.id !~ '^tenant:[^:]+::.+$'
    union
    select sa."planoId" as legacy_id, sa.tenant_id
      from public.solicitacoes_adesao sa
     where sa.tenant_id is not null
       and coalesce(trim(sa."planoId"), '') <> ''
       and sa."planoId" !~ '^tenant:[^:]+::.+$'
    union
    select a."planoId" as legacy_id, a.tenant_id
      from public.assinaturas a
     where a.tenant_id is not null
       and coalesce(trim(a."planoId"), '') <> ''
       and a."planoId" !~ '^tenant:[^:]+::.+$'
  ) source
 where exists (
         select 1
           from public.tenants t
          where t.id = source.tenant_id
       );

insert into public.planos (
  id,
  nome,
  preco,
  "precoVal",
  parcelamento,
  descricao,
  cor,
  icon,
  destaque,
  beneficios,
  "xpMultiplier",
  "nivelPrioridade",
  "descontoLoja",
  tenant_id,
  "createdAt",
  "updatedAt"
)
select
  m.scoped_id,
  p.nome,
  p.preco,
  p."precoVal",
  p.parcelamento,
  p.descricao,
  p.cor,
  p.icon,
  p.destaque,
  p.beneficios,
  p."xpMultiplier",
  p."nivelPrioridade",
  p."descontoLoja",
  p.tenant_id,
  p."createdAt",
  p."updatedAt"
  from public.planos p
  join _plan_scope_map m
    on m.legacy_id = p.id
   and m.tenant_id = p.tenant_id
 on conflict (id) do nothing;

update public.solicitacoes_adesao s
   set "planoId" = m.scoped_id
  from _plan_scope_map m
 where s.tenant_id = m.tenant_id
   and s."planoId" = m.legacy_id
   and exists (
     select 1
       from public.planos p
      where p.id = m.scoped_id
        and p.tenant_id = m.tenant_id
   );

update public.assinaturas a
   set "planoId" = m.scoped_id
  from _plan_scope_map m
 where a.tenant_id = m.tenant_id
   and a."planoId" = m.legacy_id
   and exists (
     select 1
       from public.planos p
      where p.id = m.scoped_id
        and p.tenant_id = m.tenant_id
   );

delete from public.planos p
 using _plan_scope_map m
 where p.id = m.legacy_id
   and p.tenant_id = m.tenant_id
   and not exists (
     select 1
       from public.solicitacoes_adesao s
      where s."planoId" = p.id
   )
   and not exists (
     select 1
       from public.assinaturas a
      where a."planoId" = p.id
   );

notify pgrst, 'reload schema';
