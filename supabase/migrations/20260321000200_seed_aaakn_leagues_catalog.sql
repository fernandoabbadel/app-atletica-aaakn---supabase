do $$
declare
  aaakn_tenant_id constant uuid := 'c8cef191-22d0-4773-9447-3d0f91dc8b38';
  now_utc constant timestamptz := timezone('utc', now());
begin
  with source_rows (nome, sigla, area_label, senha_seed) as (
    values
      ('Liga Academica de Emergencia', 'LAMEI', 'Emergencia', 'LAMEI1234'),
      ('Liga Academica de Cirurgia Geral', 'LIAC', 'Cirurgia Geral', 'LIAC1234'),
      ('Liga Academica de Endocrinologia e Metabologia', 'LAEM', 'Endocrinologia e Metabologia', 'LAEM1234'),
      ('Liga Academica de Ginecologia e Obstetricia', 'LIAGO', 'Ginecologia e Obstetricia', 'LIAGO1234'),
      ('Liga Academica de Medicina Legal de Caraguatatuba', 'LAMELC', 'Medicina Legal de Caraguatatuba', 'LAMELC1234'),
      ('Liga Academica de Anatomia e Saude', 'LAAS', 'Anatomia e Saude', 'LAAS1234'),
      ('Liga Academica de Clinica Medica', 'LACM', 'Clinica Medica', 'LACM1234'),
      ('Liga Academica de Psiquiatria', 'LIAPS', 'Psiquiatria', 'LIAPS1234'),
      ('Liga Academica de Ortopedia e Medicina Esportiva', 'LAOME', 'Ortopedia e Medicina Esportiva', 'LAOME1234'),
      ('Liga Academica de Oncologia', 'LAONC', 'Oncologia', 'LAONC1234'),
      ('Liga Academica de Humanidades e Saude', 'LAHS', 'Humanidades e Saude', 'LAHS1234'),
      ('Liga Academica de Dermatologia', 'LADERM', 'Dermatologia', 'LADERM1234'),
      ('Liga Academica de Neonatologia e Pediatria', 'LANPED', 'Neonatologia e Pediatria', 'LANPED1234'),
      ('Liga Academica de Urologia', 'LIU', 'Urologia', 'LIU1234'),
      ('Liga de Neurologia e Neurocirurgia', 'LANN', 'Neurologia e Neurocirurgia', 'LANN1234'),
      ('Liga Academica de Oftalmologia', 'LAOFT', 'Oftalmologia', 'LAOFT1234'),
      ('Liga Academica de Cardiologia', 'LACARDIO', 'Cardiologia', 'LACARDIO1234'),
      ('Liga da Saude da Familia', '', 'Saude da Familia', 'SAUDEDAFAMILIA1234'),
      ('Liga Academica de Otorrinolaringologia', 'LAORL', 'Otorrinolaringologia', 'LAORL1234'),
      ('Liga Academica de Gastroenterologia e Cirurgia Digestiva', 'LAGAC', 'Gastroenterologia e Cirurgia Digestiva', 'LAGAC1234'),
      ('Liga Academica de Cardiologia e Cirurgia Cardiovascular', 'LAC', 'Cardiologia e Cirurgia Cardiovascular', 'LAC1234'),
      ('Liga Academica de Medicina Militar', 'LAMM', 'Medicina Militar', 'LAMM1234'),
      ('Liga de Simulacao Realistica', 'LASIR', 'Simulacao Realistica', 'LASIR1234'),
      ('Liga Academica de Laparoscopia e Robotica', 'LALR', 'Laparoscopia e Robotica', 'LALR1234')
  ),
  prepared_rows as (
    select
      nome,
      sigla,
      area_label,
      senha_seed,
      'Liga academica dedicada a estudos, extensao e experiencias praticas em ' || area_label || '.' as descricao,
      'Vivencias, debates e projetos para aprofundar ' || lower(area_label) || ' com a liga.' as bizu
    from source_rows
  )
  update public.ligas_config as current
     set tenant_id = aaakn_tenant_id,
         nome = src.nome,
         sigla = src.sigla,
         descricao = src.descricao,
         bizu = case
           when trim(coalesce(current.bizu, '')) = '' then src.bizu
           else current.bizu
         end,
         senha = case
           when trim(coalesce(current.senha, '')) = '' then src.senha_seed
           else current.senha
         end,
         status = case
           when trim(coalesce(current.status, '')) = '' then 'ativa'
           else current.status
         end,
         visivel = coalesce(current.visivel, true),
         ativa = coalesce(current.ativa, false),
         "updatedAt" = now_utc
    from prepared_rows as src
   where current.tenant_id = aaakn_tenant_id
     and (
       lower(coalesce(current.nome, '')) = lower(src.nome)
       or (
         src.sigla <> ''
         and lower(coalesce(current.sigla, '')) = lower(src.sigla)
       )
     );

  with source_rows (nome, sigla, area_label, senha_seed) as (
    values
      ('Liga Academica de Emergencia', 'LAMEI', 'Emergencia', 'LAMEI1234'),
      ('Liga Academica de Cirurgia Geral', 'LIAC', 'Cirurgia Geral', 'LIAC1234'),
      ('Liga Academica de Endocrinologia e Metabologia', 'LAEM', 'Endocrinologia e Metabologia', 'LAEM1234'),
      ('Liga Academica de Ginecologia e Obstetricia', 'LIAGO', 'Ginecologia e Obstetricia', 'LIAGO1234'),
      ('Liga Academica de Medicina Legal de Caraguatatuba', 'LAMELC', 'Medicina Legal de Caraguatatuba', 'LAMELC1234'),
      ('Liga Academica de Anatomia e Saude', 'LAAS', 'Anatomia e Saude', 'LAAS1234'),
      ('Liga Academica de Clinica Medica', 'LACM', 'Clinica Medica', 'LACM1234'),
      ('Liga Academica de Psiquiatria', 'LIAPS', 'Psiquiatria', 'LIAPS1234'),
      ('Liga Academica de Ortopedia e Medicina Esportiva', 'LAOME', 'Ortopedia e Medicina Esportiva', 'LAOME1234'),
      ('Liga Academica de Oncologia', 'LAONC', 'Oncologia', 'LAONC1234'),
      ('Liga Academica de Humanidades e Saude', 'LAHS', 'Humanidades e Saude', 'LAHS1234'),
      ('Liga Academica de Dermatologia', 'LADERM', 'Dermatologia', 'LADERM1234'),
      ('Liga Academica de Neonatologia e Pediatria', 'LANPED', 'Neonatologia e Pediatria', 'LANPED1234'),
      ('Liga Academica de Urologia', 'LIU', 'Urologia', 'LIU1234'),
      ('Liga de Neurologia e Neurocirurgia', 'LANN', 'Neurologia e Neurocirurgia', 'LANN1234'),
      ('Liga Academica de Oftalmologia', 'LAOFT', 'Oftalmologia', 'LAOFT1234'),
      ('Liga Academica de Cardiologia', 'LACARDIO', 'Cardiologia', 'LACARDIO1234'),
      ('Liga da Saude da Familia', '', 'Saude da Familia', 'SAUDEDAFAMILIA1234'),
      ('Liga Academica de Otorrinolaringologia', 'LAORL', 'Otorrinolaringologia', 'LAORL1234'),
      ('Liga Academica de Gastroenterologia e Cirurgia Digestiva', 'LAGAC', 'Gastroenterologia e Cirurgia Digestiva', 'LAGAC1234'),
      ('Liga Academica de Cardiologia e Cirurgia Cardiovascular', 'LAC', 'Cardiologia e Cirurgia Cardiovascular', 'LAC1234'),
      ('Liga Academica de Medicina Militar', 'LAMM', 'Medicina Militar', 'LAMM1234'),
      ('Liga de Simulacao Realistica', 'LASIR', 'Simulacao Realistica', 'LASIR1234'),
      ('Liga Academica de Laparoscopia e Robotica', 'LALR', 'Laparoscopia e Robotica', 'LALR1234')
  ),
  prepared_rows as (
    select
      nome,
      sigla,
      'Liga academica dedicada a estudos, extensao e experiencias praticas em ' || area_label || '.' as descricao,
      'Vivencias, debates e projetos para aprofundar ' || lower(area_label) || ' com a liga.' as bizu,
      senha_seed
    from source_rows
  )
  insert into public.ligas_config (
    tenant_id,
    nome,
    sigla,
    foto,
    logo,
    "logoBase64",
    data,
    ativa,
    visivel,
    "logoUrl",
    presidente,
    descricao,
    senha,
    membros,
    eventos,
    perguntas,
    likes,
    "membrosIds",
    status,
    bizu,
    "createdAt",
    "updatedAt"
  )
  select
    aaakn_tenant_id,
    src.nome,
    src.sigla,
    '',
    '',
    '',
    '{}'::jsonb,
    false,
    true,
    '',
    '',
    src.descricao,
    src.senha_seed,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    0,
    array[]::text[],
    'ativa',
    src.bizu,
    now_utc,
    now_utc
  from prepared_rows as src
  where not exists (
    select 1
      from public.ligas_config as current
     where current.tenant_id = aaakn_tenant_id
       and (
         lower(coalesce(current.nome, '')) = lower(src.nome)
         or (
           src.sigla <> ''
           and lower(coalesce(current.sigla, '')) = lower(src.sigla)
         )
       )
  );
end $$;
