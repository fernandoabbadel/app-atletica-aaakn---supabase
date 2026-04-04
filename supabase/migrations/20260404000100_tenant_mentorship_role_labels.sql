alter table public.tenant_mentorships
  add column if not exists mentor_role_label text;

alter table public.tenant_mentorships
  add column if not exists mentee_role_label text;

notify pgrst, 'reload schema';
