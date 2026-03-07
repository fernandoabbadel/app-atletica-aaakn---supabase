-- Phase 5 hardening: tenant-scoped RLS + tenant_id auto-fill

create or replace function public.mt_current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.tenant_id
  from public.users u
  where u.uid = auth.uid()::text
    and coalesce(u.tenant_status, 'unlinked') = 'approved'
  limit 1
$$;

grant execute on function public.mt_current_tenant_id() to authenticated;

create or replace function public.mt_can_access_tenant_row(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.mt_is_platform_master()
    or (
      p_tenant_id is not null
      and p_tenant_id = public.mt_current_tenant_id()
    )
$$;

grant execute on function public.mt_can_access_tenant_row(uuid) to authenticated;

create or replace function public.mt_fill_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_tenant_id uuid;
  v_user_id text;
  v_evento_id text;
  v_treino_id text;
  v_post_id text;
  v_product_id text;
begin
  if new.tenant_id is not null then
    return new;
  end if;

  v_payload := to_jsonb(new);

  v_user_id := nullif(trim(coalesce(
    v_payload ->> 'userId',
    v_payload ->> 'user_id',
    v_payload ->> 'requester_user_id',
    v_payload ->> 'reporterId',
    v_payload ->> 'criadorId',
    v_payload ->> 'treinadorId',
    v_payload ->> 'created_by'
  )), '');

  if v_user_id is not null then
    select u.tenant_id
      into v_tenant_id
      from public.users u
     where u.uid = v_user_id
       and coalesce(u.tenant_status, 'approved') = 'approved'
     limit 1;
  end if;

  if v_tenant_id is null then
    v_evento_id := nullif(trim(coalesce(v_payload ->> 'eventoId', v_payload ->> 'evento_id')), '');
    if v_evento_id is not null then
      select e.tenant_id
        into v_tenant_id
        from public.eventos e
       where e.id = v_evento_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_treino_id := nullif(trim(coalesce(v_payload ->> 'treinoId', v_payload ->> 'treino_id')), '');
    if v_treino_id is not null then
      select t.tenant_id
        into v_tenant_id
        from public.treinos t
       where t.id = v_treino_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_post_id := nullif(trim(coalesce(v_payload ->> 'postId', v_payload ->> 'post_id')), '');
    if v_post_id is not null then
      select p.tenant_id
        into v_tenant_id
        from public.posts p
       where p.id = v_post_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_product_id := nullif(trim(coalesce(
      v_payload ->> 'productId',
      v_payload ->> 'productid',
      v_payload ->> 'produtoId',
      v_payload ->> 'produto_id'
    )), '');

    if v_product_id is not null then
      select pr.tenant_id
        into v_tenant_id
        from public.produtos pr
       where pr.id = v_product_id
       limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    v_tenant_id := public.mt_current_tenant_id();
  end if;

  new.tenant_id := v_tenant_id;
  return new;
end;
$$;

grant execute on function public.mt_fill_tenant_id() to authenticated;

-- Backfill por relacionamento de usuario/entidade
update public.eventos e
   set tenant_id = u.tenant_id
  from public.users u
 where e.tenant_id is null
   and u.uid = e."criadorId"
   and u.tenant_id is not null;

update public.eventos_rsvps r
   set tenant_id = u.tenant_id
  from public.users u
 where r.tenant_id is null
   and u.uid = r."userId"
   and u.tenant_id is not null;

update public.eventos_rsvps r
   set tenant_id = e.tenant_id
  from public.eventos e
 where r.tenant_id is null
   and r."eventoId" = e.id
   and e.tenant_id is not null;

update public.eventos_comentarios c
   set tenant_id = u.tenant_id
  from public.users u
 where c.tenant_id is null
   and u.uid = c."userId"
   and u.tenant_id is not null;

update public.eventos_comentarios c
   set tenant_id = e.tenant_id
  from public.eventos e
 where c.tenant_id is null
   and c."eventoId" = e.id
   and e.tenant_id is not null;

update public.eventos_enquetes q
   set tenant_id = e.tenant_id
  from public.eventos e
 where q.tenant_id is null
   and q."eventoId" = e.id
   and e.tenant_id is not null;

update public.solicitacoes_ingressos s
   set tenant_id = u.tenant_id
  from public.users u
 where s.tenant_id is null
   and u.uid = s."userId"
   and u.tenant_id is not null;

update public.solicitacoes_ingressos s
   set tenant_id = e.tenant_id
  from public.eventos e
 where s.tenant_id is null
   and s."eventoId" = e.id
   and e.tenant_id is not null;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'produtos'
       and column_name = 'createdBy'
  ) then
    update public.produtos p
       set tenant_id = u.tenant_id
      from public.users u
     where p.tenant_id is null
       and u.uid = p."createdBy"
       and u.tenant_id is not null;
  end if;
end;
$$;

update public.orders o
   set tenant_id = u.tenant_id
  from public.users u
 where o.tenant_id is null
   and u.uid = o."userId"
   and u.tenant_id is not null;

update public.orders o
   set tenant_id = p.tenant_id
  from public.produtos p
 where o.tenant_id is null
   and coalesce(o."productId", o.productid) = p.id
   and p.tenant_id is not null;

update public.reviews rv
   set tenant_id = u.tenant_id
  from public.users u
 where rv.tenant_id is null
   and u.uid = rv."userId"
   and u.tenant_id is not null;

update public.reviews rv
   set tenant_id = p.tenant_id
  from public.produtos p
 where rv.tenant_id is null
   and rv."productId" = p.id
   and p.tenant_id is not null;

update public.posts p
   set tenant_id = u.tenant_id
  from public.users u
 where p.tenant_id is null
   and u.uid = p."userId"
   and u.tenant_id is not null;

update public.posts_comments pc
   set tenant_id = u.tenant_id
  from public.users u
 where pc.tenant_id is null
   and u.uid = pc."userId"
   and u.tenant_id is not null;

update public.posts_comments pc
   set tenant_id = p.tenant_id
  from public.posts p
 where pc.tenant_id is null
   and pc."postId" = p.id
   and p.tenant_id is not null;

update public.denuncias d
   set tenant_id = u.tenant_id
  from public.users u
 where d.tenant_id is null
   and u.uid = d."reporterId"
   and u.tenant_id is not null;

update public.treinos t
   set tenant_id = u.tenant_id
  from public.users u
 where t.tenant_id is null
   and u.uid = t."treinadorId"
   and u.tenant_id is not null;

update public.treinos_rsvps tr
   set tenant_id = u.tenant_id
  from public.users u
 where tr.tenant_id is null
   and u.uid = tr."userId"
   and u.tenant_id is not null;

update public.treinos_rsvps tr
   set tenant_id = t.tenant_id
  from public.treinos t
 where tr.tenant_id is null
   and tr."treinoId" = t.id
   and t.tenant_id is not null;

update public.treinos_chamada tc
   set tenant_id = u.tenant_id
  from public.users u
 where tc.tenant_id is null
   and u.uid = tc."userId"
   and u.tenant_id is not null;

update public.treinos_chamada tc
   set tenant_id = t.tenant_id
  from public.treinos t
 where tc.tenant_id is null
   and tc."treinoId" = t.id
   and t.tenant_id is not null;

update public.album_summary "as"
   set tenant_id = u.tenant_id
  from public.users u
 where "as".tenant_id is null
   and u.uid = "as"."userId"
   and u.tenant_id is not null;

update public.album_rankings ar
   set tenant_id = u.tenant_id
  from public.users u
 where ar.tenant_id is null
   and u.uid = ar."userId"
   and u.tenant_id is not null;

-- Se o banco ainda estiver em estado single-tenant (1 tenant ativo),
-- preenche sobras com esse tenant para evitar orphan rows inacessiveis.
do $$
declare
  v_active_count integer;
  v_default_tenant uuid;
  table_name text;
begin
  select count(*)
    into v_active_count
    from public.tenants
   where status = 'active';

  if v_active_count = 1 then
    select t.id
      into v_default_tenant
      from public.tenants t
     where t.status = 'active'
     order by t.created_at asc
     limit 1;

    if v_default_tenant is not null then
      foreach table_name in array array[
        'eventos',
        'eventos_rsvps',
        'eventos_comentarios',
        'eventos_enquetes',
        'solicitacoes_ingressos',
        'produtos',
        'orders',
        'reviews',
        'posts',
        'posts_comments',
        'denuncias',
        'treinos',
        'treinos_rsvps',
        'treinos_chamada',
        'album_summary',
        'album_rankings'
      ] loop
        execute format(
          'update public.%I set tenant_id = %L::uuid where tenant_id is null',
          table_name,
          v_default_tenant::text
        );
      end loop;
    end if;
  end if;
end;
$$;

-- RLS tenant-scoped + trigger de preenchimento automatico

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'eventos',
    'eventos_rsvps',
    'eventos_comentarios',
    'eventos_enquetes',
    'solicitacoes_ingressos',
    'produtos',
    'orders',
    'reviews',
    'posts',
    'posts_comments',
    'denuncias',
    'treinos',
    'treinos_rsvps',
    'treinos_chamada',
    'album_summary',
    'album_rankings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);

    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = 'dev_allow_all'
    ) then
      execute format('drop policy dev_allow_all on public.%I', table_name);
    end if;

    trigger_name := format('trg_%s_tenant_fill', table_name);
    if exists (
      select 1
      from pg_trigger
      where tgname = trigger_name
        and tgrelid = to_regclass('public.' || table_name)
    ) then
      execute format('drop trigger %I on public.%I', trigger_name, table_name);
    end if;

    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.mt_fill_tenant_id()',
      trigger_name,
      table_name
    );

    execute format('drop policy if exists tenant_scope_select on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_update on public.%I', table_name);
    execute format('drop policy if exists tenant_scope_delete on public.%I', table_name);

    execute format(
      'create policy tenant_scope_select on public.%I for select to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_insert on public.%I for insert to authenticated with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_update on public.%I for update to authenticated using (public.mt_can_access_tenant_row(tenant_id)) with check (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );

    execute format(
      'create policy tenant_scope_delete on public.%I for delete to authenticated using (public.mt_can_access_tenant_row(tenant_id))',
      table_name
    );
  end loop;
end;
$$;
