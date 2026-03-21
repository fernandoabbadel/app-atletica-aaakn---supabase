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
  v_brand_name text := coalesce(nullif(v_nome, ''), nullif(v_sigla, ''), 'Atletica');
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
  v_turmas_payload jsonb := jsonb_build_object('turmas', '[]'::jsonb);
  v_treino_modalidades text[] := array['Futsal', 'Volei']::text[];
begin
  if v_tenant_id is null then
    return;
  end if;

  select coalesce(
           jsonb_build_object(
             'turmas',
             jsonb_agg(
               jsonb_build_object(
                 'id', turma_id,
                 'slug', lower(turma_id),
                 'nome', turma_nome,
                 'mascote', turma_nome,
                 'capa', '/capa_t8.jpg',
                 'logo', '/logo.png',
                 'hidden', false
               )
               order by turma_ord
             )
           ),
           jsonb_build_object('turmas', '[]'::jsonb)
         )
    into v_turmas_payload
    from (
      select distinct
        ('T' || digits) as turma_id,
        case
          when digits <> '' then 'Turma ' || digits
          else trim(u.turma)
        end as turma_nome,
        coalesce(nullif(digits, ''), '999')::integer as turma_ord
      from (
        select
          trim(coalesce(turma, '')) as turma,
          regexp_replace(trim(coalesce(turma, '')), '\D', '', 'g') as digits
        from public.users
        where tenant_id = v_tenant_id
      ) u
      where u.turma <> ''
        and u.digits <> ''
    ) turmas;

  select coalesce(
           array_agg(distinct trim(t.modalidade) order by trim(t.modalidade)),
           array['Futsal', 'Volei']::text[]
         )
    into v_treino_modalidades
    from public.treinos t
   where t.tenant_id = v_tenant_id
     and trim(coalesce(t.modalidade, '')) <> '';

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
    tenant_id,
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
    v_tenant_id,
    jsonb_build_object(
      'chave', v_contato_email,
      'banco', 'Banco da Atletica',
      'titular', v_titular,
      'whatsapp', v_contato_telefone
    ),
    v_contato_email,
    'Banco da Atletica',
    v_titular,
    v_contato_telefone,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    titulo,
    subtitulo,
    cor,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::marketing_banner',
    v_tenant_id,
    jsonb_build_object(
      'titulo', 'SEJA SOCIO ' || v_brand_label,
      'subtitulo', 'Beneficios oficiais da atletica',
      'cor', 'dourado'
    ),
    'SEJA SOCIO ' || v_brand_label,
    'Beneficios oficiais da atletica',
    'dourado',
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::app_modules',
    v_tenant_id,
    jsonb_build_object('modules', v_modules),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::menu',
    v_tenant_id,
    jsonb_build_object('sections', '[]'::jsonb),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    titulo,
    subtitulo,
    "capaUrl",
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::album_ui',
    v_tenant_id,
    jsonb_build_object(
      'titulo', 'Album ' || v_brand_label,
      'subtitulo', 'Colecione a galera da sua atletica',
      'capaUrl', ''
    ),
    'Album ' || v_brand_label,
    'Colecione a galera da sua atletica',
    '',
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    titulo,
    subtitulo,
    "capaUrl",
    "limitMessages",
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::comunidade',
    v_tenant_id,
    jsonb_build_object(
      'titulo', 'Comunidade',
      'subtitulo', 'Espaco oficial da atletica',
      'capaUrl', '',
      'limitMessages', true,
      'categorias', jsonb_build_array(
        'Geral',
        'Futebol',
        'Volei',
        'Basquete',
        'Handebol',
        'Sinuca',
        'Truco',
        'Natacao',
        'Bateria',
        'Cheerleaders',
        'Sugestoes'
      )
    ),
    'Comunidade',
    'Espaco oficial da atletica',
    '',
    true,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::turmas_config',
    v_tenant_id,
    v_turmas_payload,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::fidelity',
    v_tenant_id,
    jsonb_build_object(
      'xpPerStamp', 100,
      'rules', jsonb_build_array()
    ),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    validade,
    backgrounds,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::carteirinha',
    v_tenant_id,
    jsonb_build_object(
      'backgrounds', jsonb_build_object(),
      'backgroundOpacity', 60
    ),
    'DEZ/2026',
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.app_config (
    id,
    tenant_id,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::sharkround',
    v_tenant_id,
    jsonb_build_object(
      'dailyRollsLimit', 5,
      'startingCoins', 100,
      'bailCost', 50,
      'heartTarget', 5,
      'heartHelpReward', 5,
      'cycleBaseReward', 50,
      'rules', jsonb_build_array(
        'Objetivo: dominar as ligas e acumular moedas.',
        'Evolucao: Terreno -> Clinica -> Hospital -> Ministerio.',
        'Cada jogador pode rolar o dado ate 5 vezes por dia.',
        'Ao completar uma volta no tabuleiro, recebe bonus de moedas.'
      )
    ),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.settings (
    id,
    tenant_id,
    modalidades,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::treinos',
    v_tenant_id,
    v_treino_modalidades,
    jsonb_build_object('modalidadeImagens', jsonb_build_object()),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.settings (
    id,
    tenant_id,
    modalidades,
    data,
    "createdAt",
    "updatedAt"
  )
  values (
    'tenant:' || v_tenant_id::text || '::permissions',
    v_tenant_id,
    array[]::text[],
    jsonb_build_object('permissionMatrix', jsonb_build_object()),
    now(),
    now()
  )
  on conflict (id) do nothing;
end;
$$;

update public.app_config
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
 where tenant_id is null
   and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null;

update public.settings
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
 where tenant_id is null
   and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null;

do $$
declare
  tenant_row record;
begin
  for tenant_row in
    select
      t.id,
      t.nome,
      t.sigla,
      t.contato_email,
      t.contato_telefone
    from public.tenants t
  loop
    perform public.mt_seed_new_tenant_bootstrap(
      tenant_row.id,
      tenant_row.nome,
      tenant_row.sigla,
      tenant_row.contato_email,
      tenant_row.contato_telefone
    );
  end loop;
end;
$$;

update public.app_config
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
 where tenant_id is null
   and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null;

update public.settings
   set tenant_id = public.mt_extract_tenant_id_from_scoped_text_id(id::text)
 where tenant_id is null
   and public.mt_extract_tenant_id_from_scoped_text_id(id::text) is not null;

notify pgrst, 'reload schema';
