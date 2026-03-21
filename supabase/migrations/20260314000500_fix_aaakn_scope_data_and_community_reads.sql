do $$
declare
  aaakn_tenant_id constant uuid := 'c8cef191-22d0-4773-9447-3d0f91dc8b38';
  aaakn_partner_id constant text := 'ec21bc9c-7dec-4beb-a692-5e25f75a2a0a';
  aaakn_turmas_doc_id constant text := 'tenant:c8cef191-22d0-4773-9447-3d0f91dc8b38::turmas_config';
  global_turmas_data jsonb := '{}'::jsonb;
begin
  select coalesce(data, '{}'::jsonb)
    into global_turmas_data
    from public.app_config
   where id = 'turmas_config'
   limit 1;

  update public.parceiros
     set tenant_id = aaakn_tenant_id,
         "updatedAt" = now()
   where id = aaakn_partner_id
     and tenant_id is null;

  update public.scans
     set tenant_id = aaakn_tenant_id
   where "empresaId" = aaakn_partner_id
     and tenant_id is null;

  update public.users
     set tenant_id = aaakn_tenant_id,
         turma = 'T2',
         tenant_status = 'approved',
         "updatedAt" = now()
   where lower(email) = 'fernandoabbadel@gmail.com';

  if jsonb_typeof(global_turmas_data -> 'turmas') = 'array' then
    insert into public.app_config (
      id,
      tenant_id,
      data,
      "updatedAt"
    )
    values (
      aaakn_turmas_doc_id,
      aaakn_tenant_id,
      global_turmas_data,
      now()
    )
    on conflict (id) do update
      set tenant_id = excluded.tenant_id,
          data = excluded.data,
          "updatedAt" = excluded."updatedAt";
  end if;
end $$;

alter table public.community_category_reads
  drop constraint if exists "community_category_reads_userId_categoriaKey_key";

drop index if exists public.community_category_reads_userId_categoriaKey_key;

create unique index if not exists community_category_reads_tenant_user_categoria_key_uidx
  on public.community_category_reads (tenant_id, "userId", "categoriaKey")
  where tenant_id is not null;

create unique index if not exists community_category_reads_global_user_categoria_key_uidx
  on public.community_category_reads ("userId", "categoriaKey")
  where tenant_id is null;
