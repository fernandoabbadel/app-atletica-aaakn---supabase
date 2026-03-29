-- Keep invite token generation compatible with projects that do not expose
-- pgcrypto's gen_random_bytes().
create or replace function public.mt_build_invite_token()
returns text
language sql
volatile
as $$
  select lower(
    replace(gen_random_uuid()::text, '-', '') ||
    substr(md5(clock_timestamp()::text || random()::text), 1, 8)
  )
$$;
