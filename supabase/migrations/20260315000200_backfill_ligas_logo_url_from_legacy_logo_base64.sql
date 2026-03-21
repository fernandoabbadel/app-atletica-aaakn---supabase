begin;

update public.ligas_config
set
  "logoUrl" = coalesce(nullif("logoUrl", ''), nullif("logoBase64", ''), nullif(logo, '')),
  logo = coalesce(nullif(logo, ''), nullif("logoUrl", ''), nullif("logoBase64", ''))
where
  coalesce(nullif("logoUrl", ''), '') = ''
  and coalesce(nullif("logoBase64", ''), nullif(logo, '')) is not null;

update public.ligas_config
set
  logo = coalesce(nullif(logo, ''), nullif("logoUrl", ''))
where
  coalesce(nullif(logo, ''), '') = ''
  and coalesce(nullif("logoUrl", ''), '') <> '';

commit;
