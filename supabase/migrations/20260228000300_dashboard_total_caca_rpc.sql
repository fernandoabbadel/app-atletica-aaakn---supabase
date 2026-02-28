-- Dashboard publico: soma de caca aos calouros direto no banco
-- Evita overfetch da tabela album_rankings e reduz payload para bytes.

create or replace function public.dashboard_total_caca_calouros()
returns bigint
language sql
stable
as $$
  select coalesce(sum(coalesce("totalColetado", 0)::bigint), 0)::bigint
  from public.album_rankings;
$$;

grant execute on function public.dashboard_total_caca_calouros() to anon, authenticated;
