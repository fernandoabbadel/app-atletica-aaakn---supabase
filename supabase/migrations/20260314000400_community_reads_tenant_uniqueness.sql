with ranked_scoped as (
  select
    id,
    row_number() over (
      partition by tenant_id, "userId", "categoriaKey"
      order by coalesce("readAt", "updatedAt", "createdAt") desc nulls last, id desc
    ) as rn
  from public.community_category_reads
  where tenant_id is not null
),
ranked_global as (
  select
    id,
    row_number() over (
      partition by "userId", "categoriaKey"
      order by coalesce("readAt", "updatedAt", "createdAt") desc nulls last, id desc
    ) as rn
  from public.community_category_reads
  where tenant_id is null
),
duplicates as (
  select id from ranked_scoped where rn > 1
  union all
  select id from ranked_global where rn > 1
)
delete from public.community_category_reads target
using duplicates
where target.id = duplicates.id;

create unique index if not exists community_category_reads_tenant_user_categoria_key_uidx
  on public.community_category_reads (tenant_id, "userId", "categoriaKey");

create unique index if not exists community_category_reads_global_user_categoria_key_uidx
  on public.community_category_reads ("userId", "categoriaKey")
  where tenant_id is null;

notify pgrst, 'reload schema';
