-- Loja runtime compat (dev)
-- Garante colunas usadas por checkout da loja, aprovacao e cadastro/edicao de produto.

alter table if exists public.produtos add column if not exists cores text;
alter table if exists public.produtos add column if not exists active boolean not null default true;
alter table if exists public.produtos add column if not exists aprovado boolean not null default true;
alter table if exists public.produtos add column if not exists vendidos integer not null default 0;

alter table if exists public.orders add column if not exists userName text;
alter table if exists public.orders add column if not exists productId text;
alter table if exists public.orders add column if not exists productName text;
alter table if exists public.orders add column if not exists price numeric;
alter table if exists public.orders add column if not exists quantidade integer not null default 1;
alter table if exists public.orders add column if not exists itens integer not null default 1;
alter table if exists public.orders add column if not exists total numeric;
alter table if exists public.orders add column if not exists data jsonb;
alter table if exists public.orders add column if not exists approvedBy text;
alter table if exists public.orders add column if not exists updatedAt timestamptz;

select pg_notify('pgrst', 'reload schema');
