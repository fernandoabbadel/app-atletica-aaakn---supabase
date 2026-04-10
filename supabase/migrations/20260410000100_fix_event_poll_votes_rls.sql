alter table public.eventos_enquete_votos enable row level security;

drop policy if exists eventos_enquete_votos_select_public on public.eventos_enquete_votos;
drop policy if exists eventos_enquete_votos_insert_own on public.eventos_enquete_votos;
drop policy if exists eventos_enquete_votos_delete_own on public.eventos_enquete_votos;

create policy eventos_enquete_votos_select_public
on public.eventos_enquete_votos
for select
to anon, authenticated
using (true);

create policy eventos_enquete_votos_insert_own
on public.eventos_enquete_votos
for insert
to authenticated
with check (
  coalesce("userId", '') = auth.uid()::text
);

create policy eventos_enquete_votos_delete_own
on public.eventos_enquete_votos
for delete
to authenticated
using (
  coalesce("userId", '') = auth.uid()::text
);
