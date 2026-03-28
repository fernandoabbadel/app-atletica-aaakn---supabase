-- Tenantiza definitivamente os estados derivados do album para evitar
-- colisao entre tenants no free tier e manter os resumos coerentes.

-- 1) Garante tenant_id preenchido na origem do album.
update public.album_captures ac
set tenant_id = u.tenant_id
from public.users u
where ac.tenant_id is null
  and u.uid = ac."collectorUserId"
  and u.tenant_id is not null;

do $$
declare
  v_active_count integer;
  v_default_tenant uuid;
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
      update public.album_captures
         set tenant_id = v_default_tenant
       where tenant_id is null;
    end if;
  end if;
end;
$$;

-- 2) Capturas passam a ser unicas por tenant + collector + target.
drop index if exists public.uq_album_captures_collector_target;

create unique index if not exists uq_album_captures_tenant_collector_target
  on public.album_captures (tenant_id, "collectorUserId", "targetUserId");

create index if not exists idx_album_captures_tenant_collector_data_desc
  on public.album_captures (tenant_id, "collectorUserId", "dataColada" desc);

create index if not exists idx_album_captures_tenant_target_data_desc
  on public.album_captures (tenant_id, "targetUserId", "dataColada" desc);

alter table public.album_captures
  alter column tenant_id set not null;

-- 3) album_summary vira resumo derivado por tenant + user.
alter table public.album_summary
  drop constraint if exists album_summary_pkey;

truncate table public.album_summary;

insert into public.album_summary (
  "userId",
  "totalCollected",
  "lastCaptureId",
  "lastCaptureAt",
  "updatedAt",
  tenant_id
)
with ranked_captures as (
  select
    ac.tenant_id,
    ac."collectorUserId" as user_id,
    ac."targetUserId" as target_user_id,
    ac."dataColada" as captured_at,
    row_number() over (
      partition by ac.tenant_id, ac."collectorUserId"
      order by ac."dataColada" desc nulls last, ac.id desc
    ) as capture_rank
  from public.album_captures ac
),
capture_totals as (
  select
    rc.tenant_id,
    rc.user_id,
    count(distinct rc.target_user_id)::integer as total_collected,
    max(rc.captured_at) as updated_at
  from ranked_captures rc
  group by rc.tenant_id, rc.user_id
),
last_capture as (
  select
    rc.tenant_id,
    rc.user_id,
    rc.target_user_id as last_capture_id,
    rc.captured_at as last_capture_at
  from ranked_captures rc
  where rc.capture_rank = 1
)
select
  ct.user_id,
  ct.total_collected,
  lc.last_capture_id,
  lc.last_capture_at,
  coalesce(lc.last_capture_at, ct.updated_at, now()) as "updatedAt",
  ct.tenant_id
from capture_totals ct
left join last_capture lc
  on lc.tenant_id = ct.tenant_id
 and lc.user_id = ct.user_id;

alter table public.album_summary
  alter column tenant_id set not null;

alter table public.album_summary
  add constraint album_summary_pkey primary key (tenant_id, "userId");

create index if not exists idx_album_summary_tenant_updated_at
  on public.album_summary (tenant_id, "updatedAt" desc);

-- 4) album_summary_turmas tambem passa a ser derivado por tenant.
alter table public.album_summary_turmas
  drop constraint if exists "album_summary_turmas_userId_turma_key";

truncate table public.album_summary_turmas;

insert into public.album_summary_turmas (
  "userId",
  turma,
  "capturedCount",
  tenant_id,
  "updatedAt"
)
select
  ac."collectorUserId",
  coalesce(nullif(trim(ac.turma), ''), 'OUTROS'),
  count(distinct ac."targetUserId")::integer,
  ac.tenant_id,
  max(coalesce(ac."dataColada", now()))
from public.album_captures ac
group by ac.tenant_id, ac."collectorUserId", coalesce(nullif(trim(ac.turma), ''), 'OUTROS');

alter table public.album_summary_turmas
  alter column tenant_id set not null;

create unique index if not exists uq_album_summary_turmas_tenant_user_turma
  on public.album_summary_turmas (tenant_id, "userId", turma);

create index if not exists idx_album_summary_turmas_tenant_user_turma
  on public.album_summary_turmas (tenant_id, "userId", turma);

-- 5) album_rankings tambem precisa ser tenant-scoped para nao mesclar colecoes.
alter table public.album_rankings
  drop constraint if exists "album_rankings_userId_key";

truncate table public.album_rankings;

insert into public.album_rankings (
  id,
  "userId",
  nome,
  foto,
  turma,
  "totalColetado",
  "scansT8",
  "ultimoScan",
  "updatedAt",
  tenant_id
)
with capture_stats as (
  select
    ac.tenant_id,
    ac."collectorUserId" as user_id,
    count(distinct ac."targetUserId")::integer as total_coletado,
    count(*) filter (where upper(coalesce(ac.turma, '')) = 'T8')::integer as scans_t8,
    max(ac."dataColada") as ultimo_scan
  from public.album_captures ac
  group by ac.tenant_id, ac."collectorUserId"
)
select
  'tenant:' || cs.tenant_id::text || '::' || cs.user_id as id,
  cs.user_id,
  coalesce(u.nome, 'Sem nome'),
  coalesce(nullif(trim(u.foto), ''), 'https://github.com/shadcn.png'),
  coalesce(u.turma, ''),
  cs.total_coletado,
  cs.scans_t8,
  cs.ultimo_scan,
  coalesce(cs.ultimo_scan, now()),
  cs.tenant_id
from capture_stats cs
left join public.users u
  on u.uid = cs.user_id
 and u.tenant_id = cs.tenant_id;

alter table public.album_rankings
  alter column tenant_id set not null;

create unique index if not exists uq_album_rankings_tenant_user
  on public.album_rankings (tenant_id, "userId");

create index if not exists idx_album_rankings_tenant_total
  on public.album_rankings (tenant_id, "totalColetado" desc, "scansT8" desc);

create index if not exists idx_album_rankings_tenant_turma_total
  on public.album_rankings (tenant_id, turma, "totalColetado" desc);
