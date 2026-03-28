begin;

update public.ligas_config
set
  "logoUrl" = coalesce(nullif("logoUrl", ''), nullif(logo, ''), nullif(foto, ''), nullif("logoBase64", '')),
  logo = coalesce(nullif(logo, ''), nullif("logoUrl", ''), nullif(foto, ''), nullif("logoBase64", '')),
  foto = coalesce(nullif(foto, ''), nullif("logoUrl", ''), nullif(logo, ''), nullif("logoBase64", ''))
where
  coalesce(nullif("logoBase64", ''), '') <> '';

update public.ligas_config
set perguntas = coalesce(
  (
    select jsonb_agg(
      case
        when jsonb_typeof(question) <> 'object' then question
        when coalesce(nullif(question->>'imageUrl', ''), nullif(question->>'imagemBase64', '')) is null
          then question - 'imagemBase64'
        else jsonb_set(
          question - 'imagemBase64',
          '{imageUrl}',
          to_jsonb(coalesce(nullif(question->>'imageUrl', ''), nullif(question->>'imagemBase64', ''))),
          true
        )
      end
    )
    from jsonb_array_elements(coalesce(public.ligas_config.perguntas, '[]'::jsonb)) as question
  ),
  '[]'::jsonb
)
where exists (
  select 1
  from jsonb_array_elements(coalesce(public.ligas_config.perguntas, '[]'::jsonb)) as question
  where coalesce(nullif(question->>'imagemBase64', ''), '') <> ''
);

alter table public.ligas_config
  drop column if exists "logoBase64";

commit;
