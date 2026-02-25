begin;

create extension if not exists pgcrypto;

-- USERS / PERFIL / CADASTRO / DASHBOARD / CARTEIRINHA
create table if not exists public.users (
  uid text primary key,
  nome text not null default '',
  email text,
  foto text,
  capa text,
  apelido text,
  matricula text,
  turma text,
  instagram text,
  telefone text,
  "whatsappPublico" boolean not null default true,
  bio text,
  "dataNascimento" text,
  "idadePublica" boolean not null default true,
  "cidadeOrigem" text,
  "estadoOrigem" text,
  "statusRelacionamento" text,
  "relacionamentoPublico" boolean not null default true,
  esportes text[] not null default '{}',
  pets text,
  role text not null default 'guest',
  status text not null default 'ativo',
  stats jsonb not null default '{}'::jsonb,
  xp integer not null default 0,
  "xpMultiplier" numeric(8,2) not null default 1,
  level integer not null default 1,
  "sharkCoins" integer not null default 0,
  selos integer not null default 0,
  plano text not null default 'Visitante',
  plano_badge text,
  plano_cor text not null default 'zinc',
  plano_icon text not null default 'ghost',
  desconto_loja numeric(8,2) not null default 0,
  nivel_prioridade integer not null default 0,
  plano_status text,
  tier text not null default 'bicho',
  patente text,
  patente_icon text,
  patente_cor text,
  "isAnonymous" boolean not null default false,
  "ultimoLoginDiario" text,
  data_adesao timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  extra jsonb not null default '{}'::jsonb
);
create index if not exists idx_users_nome on public.users (nome);
create index if not exists idx_users_turma_nome on public.users (turma, nome);
create index if not exists idx_users_xp_desc on public.users (xp desc);
create index if not exists idx_users_role on public.users (role);

create table if not exists public.users_followers (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  uid text not null,
  nome text not null default '',
  foto text not null default '',
  turma text not null default 'Geral',
  "followedAt" timestamptz not null default now(),
  unique ("userId", uid)
);
create index if not exists idx_users_followers_user_followedAt on public.users_followers ("userId", "followedAt" desc);

create table if not exists public.users_following (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  uid text not null,
  nome text not null default '',
  foto text not null default '',
  turma text not null default 'Geral',
  "followedAt" timestamptz not null default now(),
  unique ("userId", uid)
);
create index if not exists idx_users_following_user_followedAt on public.users_following ("userId", "followedAt" desc);

create table if not exists public.notifications (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  title text not null default '',
  message text not null default '',
  link text,
  read boolean not null default false,
  type text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_notifications_user_createdAt on public.notifications ("userId", "createdAt" desc);

-- CONFIGS (comunidade, financeiro, marketing_banner, carteirinha, album_ui)
create table if not exists public.app_config (
  id text primary key,
  titulo text,
  subtitulo text,
  cor text,
  capa text,
  "capaUrl" text,
  "limitMessages" boolean,
  validade text,
  backgrounds jsonb,
  chave text,
  banco text,
  titular text,
  whatsapp text,
  data jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Landing pública usa esta tabela (adminLandingService)
create table if not exists public.site_config (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id text primary key,
  modalidades text[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- COMUNIDADE
create table if not exists public.posts (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Anonimo',
  handle text not null default '@atleta',
  avatar text not null default '',
  texto text not null default '',
  imagem text,
  likes text[] not null default '{}',
  hype text[] not null default '{}',
  comentarios integer not null default 0,
  "denunciasCount" integer not null default 0,
  categoria text not null default 'Geral',
  blocked boolean not null default false,
  "commentsDisabled" boolean not null default false,
  fixado boolean not null default false,
  plano text, plano_cor text, plano_icon text,
  patente text, patente_icon text, patente_cor text,
  role text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_posts_createdAt_desc on public.posts ("createdAt" desc);
create index if not exists idx_posts_user_createdAt_desc on public.posts ("userId", "createdAt" desc);
create index if not exists idx_posts_categoria_createdAt_desc on public.posts (categoria, "createdAt" desc);

create table if not exists public.posts_comments (
  id text primary key default gen_random_uuid()::text,
  "postId" text not null references public.posts(id) on delete cascade,
  "userId" text not null,
  "userName" text not null default 'Anonimo',
  avatar text not null default '',
  texto text not null default '',
  likes text[] not null default '{}',
  role text, plano text, plano_cor text, plano_icon text, patente text, patente_icon text, patente_cor text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_posts_comments_post_createdAt on public.posts_comments ("postId", "createdAt" desc);

create table if not exists public.denuncias (
  id text primary key default gen_random_uuid()::text,
  "targetId" text not null,
  "targetType" text not null default 'post',
  "postText" text,
  "reporterId" text not null,
  reason text not null default '',
  status text not null default 'pendente',
  timestamp timestamptz not null default now(),
  "reviewedAt" timestamptz,
  "reviewedBy" text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_denuncias_status_timestamp on public.denuncias (status, timestamp desc);

-- EVENTOS
create table if not exists public.eventos (
  id text primary key default gen_random_uuid()::text,
  titulo text not null default 'Evento',
  data text,
  hora text,
  local text,
  tipo text,
  destaque text,
  "mapsUrl" text,
  imagem text,
  "imagePositionY" integer not null default 50,
  descricao text,
  lotes jsonb not null default '[]'::jsonb,
  status text not null default 'ativo',
  "isLowStock" boolean not null default false,
  stats jsonb not null default '{"confirmados":0,"talvez":0,"likes":0}'::jsonb,
  "vendasTotais" jsonb not null default '{"vendidos":0,"total":0}'::jsonb,
  "pixChave" text, "pixBanco" text, "pixTitular" text, "contatoComprovante" text,
  interessados text[] not null default '{}',
  "likesList" text[] not null default '{}',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data_extra jsonb not null default '{}'::jsonb
);
create index if not exists idx_eventos_data on public.eventos (data);
create index if not exists idx_eventos_createdAt_desc on public.eventos ("createdAt" desc);
create index if not exists idx_eventos_interessados_gin on public.eventos using gin (interessados);

create table if not exists public.eventos_rsvps (
  id text primary key default gen_random_uuid()::text,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  "userId" text not null,
  status text not null,
  "userName" text not null default 'Anonimo',
  "userAvatar" text not null default '',
  "userTurma" text not null default 'Geral',
  timestamp timestamptz not null default now(),
  unique ("eventoId", "userId")
);
create index if not exists idx_eventos_rsvps_evento_status on public.eventos_rsvps ("eventoId", status);

create table if not exists public.eventos_comentarios (
  id text primary key default gen_random_uuid()::text,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  text text not null default '',
  "userId" text not null,
  "userName" text not null default 'Anonimo',
  "userAvatar" text not null default '',
  "userTurma" text not null default 'Geral',
  "userPlanoCor" text, "userPlanoIcon" text, "userPatente" text, role text,
  likes text[] not null default '{}',
  reports text[] not null default '{}',
  hidden boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_eventos_comentarios_evento_createdAt on public.eventos_comentarios ("eventoId", "createdAt" desc);

create table if not exists public.eventos_enquetes (
  id text primary key default gen_random_uuid()::text,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  question text not null default '',
  "allowUserOptions" boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  voters text[] not null default '{}',
  "userVotes" jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists idx_eventos_enquetes_evento_createdAt on public.eventos_enquetes ("eventoId", "createdAt" desc);

create table if not exists public.solicitacoes_ingressos (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Aluno',
  "userTurma" text not null default 'Geral',
  "userPhone" text,
  "eventoId" text not null references public.eventos(id) on delete cascade,
  "eventoNome" text not null default 'Evento',
  "loteNome" text not null default 'Lote',
  "loteId" text not null,
  quantidade integer not null default 1,
  "valorUnitario" text not null default '0',
  "valorTotal" text not null default '0',
  metodo text not null default 'whatsapp',
  status text not null default 'pendente',
  "dataSolicitacao" timestamptz not null default now(),
  "dataAprovacao" timestamptz,
  "aprovadoPor" text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_solic_ing_evento_data on public.solicitacoes_ingressos ("eventoId", "dataSolicitacao" desc);
create index if not exists idx_solic_ing_user_evento on public.solicitacoes_ingressos ("userId", "eventoId");

-- LOJA
create table if not exists public.categorias (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  "createdAt" timestamptz not null default now()
);

create table if not exists public.produtos (
  id text primary key default gen_random_uuid()::text,
  nome text not null default 'Produto',
  categoria text not null default 'Geral',
  descricao text not null default '',
  img text,
  preco numeric(12,2) not null default 0,
  "precoAntigo" numeric(12,2),
  estoque integer not null default 0,
  lote text,
  "tagLabel" text, "tagColor" text, "tagEffect" text,
  variantes jsonb not null default '[]'::jsonb,
  caracteristicas text[] not null default '{}',
  likes text[] not null default '{}',
  cliques integer not null default 0,
  vendidos integer not null default 0,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_produtos_nome on public.produtos (nome);
create index if not exists idx_produtos_categoria_nome on public.produtos (categoria, nome);

create table if not exists public.orders (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Aluno',
  "productId" text not null references public.produtos(id) on delete cascade,
  "productName" text not null default 'Produto',
  price numeric(12,2) not null default 0,
  quantidade integer not null default 1,
  itens integer generated always as (quantidade) stored,
  total numeric(12,2) generated always as (round((price * quantidade)::numeric, 2)) stored,
  status text not null default 'pendente',
  "approvedBy" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_orders_user_createdAt on public.orders ("userId", "createdAt" desc);
create index if not exists idx_orders_product_createdAt on public.orders ("productId", "createdAt" desc);

create or replace view public.store_orders as
select id, "userId", "userName", "productId", "productName", price, quantidade, itens, total, status, "approvedBy", "createdAt", "updatedAt", data
from public.orders;

create table if not exists public.reviews (
  id text primary key default gen_random_uuid()::text,
  "productId" text not null references public.produtos(id) on delete cascade,
  "userId" text not null,
  "userName" text not null default 'Aluno',
  "userAvatar" text,
  rating integer not null,
  comment text not null default '',
  status text not null default 'pending',
  approved boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_reviews_product_createdAt on public.reviews ("productId", "createdAt" desc);

-- PARCEIROS / EMPRESA
create table if not exists public.parceiros (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  categoria text not null default 'Parceiro',
  tier text not null default 'standard',
  status text not null default 'pending',
  cnpj text, cpf text,
  responsavel text, email text, telefone text,
  descricao text, endereco text, horario text, insta text, site text, whats text,
  "imgCapa" text, "imgLogo" text,
  mensalidade numeric(12,2) not null default 0,
  "vendasTotal" numeric(12,2) not null default 0,
  "totalScans" integer not null default 0,
  cupons jsonb not null default '[]'::jsonb,
  senha text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_parceiros_status_nome on public.parceiros (status, nome);
create index if not exists idx_parceiros_tier_status on public.parceiros (tier, status);
create index if not exists idx_parceiros_email on public.parceiros (email);

create table if not exists public.scans (
  id text primary key default gen_random_uuid()::text,
  "empresaId" text not null references public.parceiros(id) on delete cascade,
  empresa text not null default 'Empresa',
  usuario text not null default 'Aluno',
  "userId" text,
  cupom text,
  "valorEconomizado" text,
  data text, hora text,
  timestamp timestamptz not null default now(),
  extra jsonb not null default '{}'::jsonb
);
create index if not exists idx_scans_empresa_timestamp on public.scans ("empresaId", timestamp desc);

-- PLANOS
create table if not exists public.planos (
  id text primary key default gen_random_uuid()::text,
  nome text not null default 'Plano',
  preco text not null default '0,00',
  "precoVal" numeric(12,2) not null default 0,
  parcelamento text,
  descricao text,
  cor text,
  icon text,
  destaque boolean not null default false,
  beneficios text[] not null default '{}',
  "xpMultiplier" numeric(8,2) not null default 1,
  "nivelPrioridade" integer not null default 1,
  "descontoLoja" numeric(8,2) not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists idx_planos_precoVal on public.planos ("precoVal");

create table if not exists public.solicitacoes_adesao (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  "userName" text not null default 'Aluno',
  "userTurma" text not null default 'T??',
  "planoId" text not null references public.planos(id) on delete restrict,
  "planoNome" text not null default 'Plano',
  valor numeric(12,2) not null default 0,
  "comprovanteUrl" text,
  metodo text not null default 'whatsapp',
  status text not null default 'pendente',
  "dataSolicitacao" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_solic_adesao_user_data on public.solicitacoes_adesao ("userId", "dataSolicitacao" desc);

create table if not exists public.assinaturas (
  id text primary key default gen_random_uuid()::text,
  aluno text not null default 'Aluno',
  turma text not null default 'T??',
  foto text,
  "planoId" text not null references public.planos(id) on delete restrict,
  "planoNome" text not null default 'Plano',
  "valorPago" numeric(12,2) not null default 0,
  "dataInicio" text,
  status text not null default 'ativo',
  metodo text not null default 'pix',
  "userId" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_assinaturas_user_createdAt on public.assinaturas ("userId", "createdAt" desc);

-- TREINOS
create table if not exists public.treinos (
  id text primary key default gen_random_uuid()::text,
  modalidade text not null,
  "diaSemana" text,
  dia text not null,
  horario text not null,
  local text not null default '',
  treinador text not null default '',
  "treinadorId" text, "treinadorAvatar" text,
  descricao text, imagem text,
  "ordemDia" integer not null default 0,
  status text not null default 'ativo',
  confirmados text[] not null default '{}',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_treinos_dia on public.treinos (dia);
create index if not exists idx_treinos_confirmados_gin on public.treinos using gin (confirmados);

create table if not exists public.treinos_rsvps (
  id text primary key default gen_random_uuid()::text,
  "treinoId" text not null references public.treinos(id) on delete cascade,
  "userId" text not null,
  "userName" text not null default 'Atleta',
  "userAvatar" text not null default '',
  "userTurma" text not null default 'Geral',
  status text not null,
  timestamp timestamptz not null default now(),
  unique ("treinoId", "userId")
);
create index if not exists idx_treinos_rsvps_treino on public.treinos_rsvps ("treinoId", timestamp desc);

create table if not exists public.treinos_chamada (
  id text primary key default gen_random_uuid()::text,
  "treinoId" text not null references public.treinos(id) on delete cascade,
  "userId" text not null,
  nome text not null default 'Aluno',
  avatar text not null default '',
  turma text not null default 'Geral',
  status text not null,
  origem text not null,
  pagamento text,
  timestamp timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("treinoId", "userId")
);
create index if not exists idx_treinos_chamada_treino on public.treinos_chamada ("treinoId", timestamp desc);

create table if not exists public.gym_logs (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  local text,
  date timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

-- CONQUISTAS
create table if not exists public.achievements_config (
  id text primary key,
  titulo text not null,
  "desc" text not null default '',
  xp integer not null default 0,
  target integer not null default 1,
  "statKey" text not null,
  cat text not null default 'Geral',
  "iconName" text not null default 'Star',
  active boolean not null default true,
  repeatable boolean not null default false,
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.patentes_config (
  id text primary key,
  titulo text not null,
  "minXp" integer not null default 0,
  cor text not null default 'text-zinc-400',
  "iconName" text not null default 'Fish',
  bg text, border text, text text,
  "updatedAt" timestamptz not null default now()
);
create index if not exists idx_patentes_minXp on public.patentes_config ("minXp");

create table if not exists public.achievements_logs (
  id text primary key default gen_random_uuid()::text,
  "userId" text,
  "userName" text not null default 'Usuario',
  "achievementId" text,
  "achievementTitle" text not null default 'Conquista',
  xp integer not null default 0,
  timestamp timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_ach_logs_user_timestamp on public.achievements_logs ("userId", timestamp desc);

-- ALBUM + DASHBOARD DEPENDÊNCIAS
create table if not exists public.album_config (
  id text primary key,
  capa text, titulo text, subtitulo text,
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.album_captures (
  id text primary key default gen_random_uuid()::text,
  "collectorUserId" text not null,
  "targetUserId" text not null,
  nome text, turma text,
  "dataColada" timestamptz not null default now(),
  unique ("collectorUserId", "targetUserId")
);
create index if not exists idx_album_captures_collector on public.album_captures ("collectorUserId", "dataColada" desc);

create table if not exists public.album_summary (
  "userId" text primary key,
  "totalCollected" integer not null default 0,
  "capturedByTurma" jsonb not null default '{}'::jsonb,
  "lastCaptureId" text,
  "lastCaptureAt" timestamptz,
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.album_rankings (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null unique,
  nome text not null default 'Sem nome',
  foto text not null default '',
  turma text not null default '',
  "totalColetado" integer not null default 0,
  "scansT8" integer not null default 0,
  "ultimoScan" timestamptz,
  "updatedAt" timestamptz not null default now()
);
create index if not exists idx_album_rank_total on public.album_rankings ("totalColetado" desc, "scansT8" desc);

create table if not exists public.ligas_config (
  id text primary key default gen_random_uuid()::text,
  nome text, sigla text, foto text, logo text, "logoBase64" text, bizu text,
  "membrosIds" text[] not null default '{}',
  status text not null default 'ativa',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists idx_ligas_membros_gin on public.ligas_config using gin ("membrosIds");

create table if not exists public.arena_matches (
  id text primary key default gen_random_uuid()::text,
  "userId" text not null,
  game text,
  result text,
  date timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

-- Seeds mínimos
insert into public.app_config (id, chave, banco, titular) values
  ('financeiro', 'financeiro@aaakn.com.br', 'Banco Inter', 'AAAKN')
on conflict (id) do nothing;
insert into public.app_config (id, titulo, subtitulo, cor) values
  ('marketing_banner', 'VIRE TUBARAO REI', 'Domine o Oceano', 'dourado')
on conflict (id) do nothing;
insert into public.app_config (id, validade, backgrounds) values
  ('carteirinha', 'DEZ/2026', '{}'::jsonb)
on conflict (id) do nothing;
insert into public.app_config (id, titulo, subtitulo, capa) values
  ('album_ui', 'Album AAAKN', 'Colecione sua turma', null)
on conflict (id) do nothing;
insert into public.app_config (id, titulo, subtitulo, "capaUrl", "limitMessages") values
  ('comunidade', 'Comunidade', 'Feed da AAAKN', null, true)
on conflict (id) do nothing;
insert into public.site_config (id, data) values
  ('landing_page', '{}'::jsonb)
on conflict (id) do nothing;
insert into public.settings (id, modalidades) values
  ('treinos', array['Futebol','Volei','Basquete'])
on conflict (id) do nothing;

commit;
