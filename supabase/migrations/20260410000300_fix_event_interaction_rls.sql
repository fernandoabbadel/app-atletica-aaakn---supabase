alter table public.eventos_likes enable row level security;
alter table public.eventos_rsvps enable row level security;

drop policy if exists eventos_likes_select_public on public.eventos_likes;
drop policy if exists eventos_likes_insert_own on public.eventos_likes;
drop policy if exists eventos_likes_delete_own on public.eventos_likes;

create policy eventos_likes_select_public
  on public.eventos_likes
  for select
  to anon, authenticated
  using (true);

create policy eventos_likes_insert_own
  on public.eventos_likes
  for insert
  to authenticated
  with check (
    "userId" = auth.uid()::text
    and exists (
      select 1
        from public.eventos e
       where e.id = "eventoId"
         and (eventos_likes.tenant_id is null or e.tenant_id = eventos_likes.tenant_id)
    )
  );

create policy eventos_likes_delete_own
  on public.eventos_likes
  for delete
  to authenticated
  using (
    "userId" = auth.uid()::text
  );

drop policy if exists eventos_rsvps_select_public on public.eventos_rsvps;
drop policy if exists eventos_rsvps_insert_own on public.eventos_rsvps;
drop policy if exists eventos_rsvps_update_own on public.eventos_rsvps;
drop policy if exists eventos_rsvps_delete_own on public.eventos_rsvps;

create policy eventos_rsvps_select_public
  on public.eventos_rsvps
  for select
  to anon, authenticated
  using (true);

create policy eventos_rsvps_insert_own
  on public.eventos_rsvps
  for insert
  to authenticated
  with check (
    "userId" = auth.uid()::text
    and exists (
      select 1
        from public.eventos e
       where e.id = "eventoId"
         and (eventos_rsvps.tenant_id is null or e.tenant_id = eventos_rsvps.tenant_id)
    )
  );

create policy eventos_rsvps_update_own
  on public.eventos_rsvps
  for update
  to authenticated
  using (
    "userId" = auth.uid()::text
  )
  with check (
    "userId" = auth.uid()::text
    and exists (
      select 1
        from public.eventos e
       where e.id = "eventoId"
         and (eventos_rsvps.tenant_id is null or e.tenant_id = eventos_rsvps.tenant_id)
    )
  );

create policy eventos_rsvps_delete_own
  on public.eventos_rsvps
  for delete
  to authenticated
  using (
    "userId" = auth.uid()::text
  );

notify pgrst, 'reload schema';
