-- Dev runtime compatibility patch (2026-02-26)
-- Objetivo:
-- 1) compatibilizar criacao de produtos (campo "aprovado")
-- 2) garantir bucket/policies de uploads para modulos de imagem

alter table public.produtos
  add column if not exists aprovado boolean not null default true;

update public.produtos
set aprovado = true
where aprovado is null;

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads public select'
  ) then
    create policy "uploads public select"
      on storage.objects
      for select
      to anon, authenticated
      using (bucket_id = 'uploads');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth insert'
  ) then
    create policy "uploads auth insert"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'uploads');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth update'
  ) then
    create policy "uploads auth update"
      on storage.objects
      for update
      to authenticated
      using (bucket_id = 'uploads')
      with check (bucket_id = 'uploads');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'uploads auth delete'
  ) then
    create policy "uploads auth delete"
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'uploads');
  end if;
end $$;

notify pgrst, 'reload schema';
