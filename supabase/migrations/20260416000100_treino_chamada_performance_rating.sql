alter table public.treinos_chamada
  add column if not exists "performanceRating" integer,
  add column if not exists "performanceRatedBy" text,
  add column if not exists "performanceRatedAt" timestamptz;

alter table public.treinos_chamada
  drop constraint if exists treinos_chamada_performance_rating_ck;

alter table public.treinos_chamada
  add constraint treinos_chamada_performance_rating_ck
  check ("performanceRating" is null or ("performanceRating" between 1 and 5));

create index if not exists idx_treinos_chamada_tenant_rating
  on public.treinos_chamada (tenant_id, "treinoId", "performanceRating")
  where "performanceRating" is not null;
