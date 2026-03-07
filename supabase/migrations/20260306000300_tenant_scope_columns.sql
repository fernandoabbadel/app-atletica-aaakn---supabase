-- Tenant scope columns (phase 5 foundation)

do $$
declare
  table_name text;
  fk_name text;
  idx_name text;
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
    execute format('alter table public.%I add column if not exists tenant_id uuid', table_name);

    fk_name := format('%s_tenant_fk', table_name);
    if not exists (
      select 1
      from pg_constraint
      where conname = fk_name
        and conrelid = to_regclass('public.' || table_name)
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete set null',
        table_name,
        fk_name
      );
    end if;

    idx_name := format('idx_%s_tenant_id', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', idx_name, table_name);
  end loop;
end;
$$;

-- Backfill de tenant_id com base no user vinculado
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

update public.eventos_comentarios c
   set tenant_id = u.tenant_id
  from public.users u
 where c.tenant_id is null
   and u.uid = c."userId"
   and u.tenant_id is not null;

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

update public.orders o
   set tenant_id = u.tenant_id
  from public.users u
 where o.tenant_id is null
   and u.uid = o."userId"
   and u.tenant_id is not null;

update public.reviews rv
   set tenant_id = u.tenant_id
  from public.users u
 where rv.tenant_id is null
   and u.uid = rv."userId"
   and u.tenant_id is not null;

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

update public.treinos_chamada tc
   set tenant_id = u.tenant_id
  from public.users u
 where tc.tenant_id is null
   and u.uid = tc."userId"
   and u.tenant_id is not null;

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
