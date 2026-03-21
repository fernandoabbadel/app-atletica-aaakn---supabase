create or replace function public.mt_seed_new_tenant_bootstrap(
  p_tenant_id uuid,
  p_tenant_nome text default null,
  p_tenant_sigla text default null,
  p_contato_email text default null,
  p_contato_telefone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := p_tenant_id;
  v_nome text := trim(coalesce(p_tenant_nome, ''));
  v_sigla text := upper(trim(coalesce(p_tenant_sigla, '')));
  v_brand_label text := coalesce(nullif(v_sigla, ''), nullif(v_nome, ''), 'ATLETICA');
  v_titular text := coalesce(nullif(v_nome, ''), v_brand_label);
  v_contato_email text := coalesce(nullif(trim(coalesce(p_contato_email, '')), ''), '');
  v_contato_telefone text := coalesce(nullif(trim(coalesce(p_contato_telefone, '')), ''), '');
  v_modules jsonb := jsonb_build_object(
    'perfil', true,
    'carteirinha', true,
    'sharkround', true,
    'treinos', true,
    'album', true,
    'eventos', true,
    'ligas', true,
    'loja', true,
    'comunidade', true,
    'parceiros', true,
    'arena_games', true,
    'ranking', true,
    'avaliacao', true,
    'conquistas', true,
    'fidelidade', true
  );
begin
  if v_tenant_id is null then
    return;
  end if;

  insert into public.planos (
    id,
    nome,
    preco,
    "precoVal",
    parcelamento,
    descricao,
    cor,
    icon,
    destaque,
    beneficios,
    "xpMultiplier",
    "nivelPrioridade",
    "descontoLoja",
    tenant_id,
    "createdAt",
    "updatedAt"
  )
  values
    (
      'tenant:' || v_tenant_id::text || '::bicho_solto',
      'Bicho Solto',
      '0,00',
      0::numeric,
      'Acesso gratuito',
      'Entrada no ecossistema ' || v_brand_label,
      'zinc',
      'ghost',
      false,
      array[
        'Acesso ao app e carteira digital',
        'Participacao em eventos abertos',
        'Ranking e funcionalidades basicas'
      ]::text[],
      1::numeric,
      1::integer,
      0::numeric,
      v_tenant_id,
      now(),
      now()
    ),
    (
      'tenant:' || v_tenant_id::text || '::cardume_livre',
      'Cardume Livre',
      '14,90',
      14.9::numeric,
      'ou 12x de R$ 1,49',
      'Primeiro nivel premium',
      'blue',
      'fish',
      false,
      array[
        'Desconto em parceiros selecionados',
        'Prioridade moderada em lotes',
        'Acesso a conteudos exclusivos'
      ]::text[],
      1.1::numeric,
      2::integer,
      5::numeric,
      v_tenant_id,
      now(),
      now()
    ),
    (
      'tenant:' || v_tenant_id::text || '::atleta',
      'Atleta',
      '29,90',
      29.9::numeric,
      'ou 12x de R$ 2,99',
      'Plano oficial do atleta',
      'emerald',
      'star',
      true,
      array[
        'Prioridade em eventos e inscricoes',
        'Desconto ampliado na loja',
        'Multiplicador de XP turbinado'
      ]::text[],
      1.25::numeric,
      3::integer,
      10::numeric,
      v_tenant_id,
      now(),
      now()
    ),
    (
      'tenant:' || v_tenant_id::text || '::lenda',
      'Lenda',
      '59,90',
      59.9::numeric,
      'ou 12x de R$ 5,99',
      'Maximo nivel de beneficios',
      'yellow',
      'crown',
      true,
      array[
        'Prioridade maxima no ecossistema',
        'Maior desconto na loja',
        'Beneficios VIP em acoes especiais'
      ]::text[],
      1.5::numeric,
      4::integer,
      20::numeric,
      v_tenant_id,
      now(),
      now()
    )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    data,
    chave,
    banco,
    titular,
    whatsapp,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::financeiro',
    '{}'::jsonb,
    v_contato_email,
    '',
    v_titular,
    v_contato_telefone,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    data,
    titulo,
    subtitulo,
    cor,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::marketing_banner',
    '{}'::jsonb,
    'SEJA SOCIO ' || v_brand_label,
    'Beneficios oficiais da atletica',
    'dourado',
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::app_modules',
    jsonb_build_object('modules', v_modules),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::menu',
    jsonb_build_object('sections', '[]'::jsonb),
    now(),
    now()
  )
  on conflict (id) do nothing;
end;
$$;

create or replace function public.tenant_create_with_master(
  p_nome text,
  p_sigla text,
  p_logo_url text default null,
  p_cidade text default null,
  p_faculdade text default null,
  p_curso text default null,
  p_area text default null,
  p_cnpj text default null,
  p_contato_email text default null,
  p_contato_telefone text default null,
  p_palette_key text default 'green',
  p_allow_public_signup boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_slug text;
  v_base_slug text;
  v_counter integer := 1;
  v_tenant_id uuid;
  v_launch_enabled boolean := true;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then raise exception 'Usuario nao autenticado'; end if;

  select coalesce(tokenization_active, true)
    into v_launch_enabled
    from public.tenant_platform_config
   where id = 'global'
   limit 1;

  if not coalesce(v_launch_enabled, true) and not public.mt_is_platform_master() then
    raise exception 'Tokenizacao desativada no momento.';
  end if;

  if exists (
    select 1
      from public.users u
     where u.uid = v_uid
       and u.tenant_id is not null
       and coalesce(u.tenant_status, 'approved') = 'approved'
  ) and not public.mt_is_platform_master() then
    raise exception 'Usuario ja vinculado a uma atletica aprovada.';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(p_sigla), ''), nullif(trim(p_nome), ''), 'atletica')), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then v_base_slug := 'atletica'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.tenants t where lower(t.slug) = lower(v_slug)) loop
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter::text;
  end loop;

  insert into public.tenants (
    nome, slug, sigla, logo_url, cidade, faculdade, curso, area, cnpj, contato_email, contato_telefone,
    palette_key, allow_public_signup, status, created_by
  ) values (
    trim(coalesce(p_nome, '')),
    v_slug,
    trim(coalesce(p_sigla, '')),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cidade, '')), ''),
    trim(coalesce(nullif(p_faculdade, ''), p_nome)),
    nullif(trim(coalesce(p_curso, '')), ''),
    nullif(trim(coalesce(p_area, '')), ''),
    nullif(trim(coalesce(p_cnpj, '')), ''),
    nullif(trim(coalesce(p_contato_email, '')), ''),
    nullif(trim(coalesce(p_contato_telefone, '')), ''),
    case when p_palette_key in ('green','yellow','red','blue','orange','purple','pink') then p_palette_key else 'green' end,
    coalesce(p_allow_public_signup, true),
    'active',
    v_uid
  ) returning id into v_tenant_id;

  perform public.mt_seed_new_tenant_bootstrap(
    v_tenant_id,
    trim(coalesce(p_nome, '')),
    trim(coalesce(p_sigla, '')),
    p_contato_email,
    p_contato_telefone
  );

  insert into public.tenant_memberships (tenant_id, user_id, role, status, approved_by, approved_at)
  values (v_tenant_id, v_uid, 'master', 'approved', v_uid, now())
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        status = excluded.status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_tenant_id,
         tenant_role = 'master',
         tenant_status = 'approved'
   where uid = v_uid;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_create_with_master(text, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.tenant_approve_onboarding_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
  v_request public.tenant_onboarding_requests%rowtype;
  v_tenant_id uuid;
  v_slug text;
  v_base_slug text;
  v_counter integer := 1;
begin
  v_uid := auth.uid()::text;
  if coalesce(v_uid, '') = '' then
    raise exception 'Usuario nao autenticado';
  end if;
  if not public.mt_is_platform_master() then
    raise exception 'Apenas master da plataforma';
  end if;

  select *
    into v_request
    from public.tenant_onboarding_requests r
   where r.id = p_request_id
   limit 1;

  if not found then
    raise exception 'Solicitacao de onboarding nao encontrada';
  end if;

  if v_request.status = 'approved' and v_request.approved_tenant_id is not null then
    return v_request.approved_tenant_id;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Solicitacao nao esta pendente';
  end if;

  if exists (
    select 1
      from public.users u
     where u.uid = v_request.requester_user_id
       and u.tenant_id is not null
       and coalesce(u.tenant_status, 'approved') = 'approved'
       and lower(coalesce(u.role, '')) <> 'master'
  ) then
    raise exception 'Solicitante ja vinculado a tenant aprovado';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(v_request.sigla), ''), nullif(trim(v_request.nome), ''), 'atletica')), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then
    v_base_slug := 'atletica';
  end if;
  v_slug := v_base_slug;

  while exists (select 1 from public.tenants t where lower(t.slug) = lower(v_slug)) loop
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || v_counter::text;
  end loop;

  insert into public.tenants (
    nome, slug, sigla, logo_url, cidade, faculdade, curso, area, cnpj,
    contato_email, contato_telefone, palette_key, allow_public_signup, status, created_by
  ) values (
    trim(v_request.nome),
    v_slug,
    trim(v_request.sigla),
    v_request.logo_url,
    v_request.cidade,
    trim(coalesce(v_request.faculdade, v_request.nome)),
    v_request.curso,
    v_request.area,
    v_request.cnpj,
    nullif(trim(coalesce(v_request.contato_email, '')), ''),
    nullif(trim(coalesce(v_request.contato_telefone, '')), ''),
    case when v_request.palette_key in ('green','yellow','red','blue','orange','purple','pink') then v_request.palette_key else 'green' end,
    coalesce(v_request.allow_public_signup, true),
    'active',
    v_request.requester_user_id
  )
  returning id into v_tenant_id;

  perform public.mt_seed_new_tenant_bootstrap(
    v_tenant_id,
    trim(coalesce(v_request.nome, '')),
    trim(coalesce(v_request.sigla, '')),
    v_request.contato_email,
    v_request.contato_telefone
  );

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, approved_by, approved_at
  ) values (
    v_tenant_id, v_request.requester_user_id, 'master', 'approved', v_uid, now()
  )
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        status = excluded.status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  update public.users
     set tenant_id = v_tenant_id,
         tenant_role = 'master',
         tenant_status = 'approved'
   where uid = v_request.requester_user_id;

  update public.tenant_onboarding_requests
     set status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         approved_tenant_id = v_tenant_id,
         rejection_reason = null,
         updated_at = now()
   where id = v_request.id;

  return v_tenant_id;
end;
$$;

grant execute on function public.tenant_approve_onboarding_request(uuid) to authenticated;

notify pgrst, 'reload schema';
