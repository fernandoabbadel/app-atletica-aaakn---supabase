alter table public.ligas_config
  add column if not exists links jsonb not null default '[]'::jsonb,
  add column if not exists payment_config jsonb;

comment on column public.ligas_config.links
  is 'Public links shown on the USC league profile, grouped by link type.';

comment on column public.ligas_config.payment_config
  is 'Default league payment information used by the league profile and as fallback for league events.';
