alter table public.ligas_config
  add column if not exists "visaoGeral" text not null default '';

comment on column public.ligas_config."visaoGeral"
  is 'Resumo de ate 500 caracteres sobre o que a liga faz na visao geral publica.';
