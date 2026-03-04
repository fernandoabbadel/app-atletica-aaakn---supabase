import { Timestamp } from "@/lib/supabaseHelpers";

// ==========================================
// 🦈 USUÁRIO (PERFIL COMPLETO)
// ==========================================
export interface UserStats {
  accountCreated: number;
  loginCount: number;
  postsCount: number;
  commentsCount: number;
  likesGiven: number;
  hypesGiven: number;
  arenaWins: number;
  arenaLosses: number;
  scansT8?: number; // Usado no Álbum
}

export interface UserProfile {
  // Identificação
  uid: string;
  email: string;
  nome: string;
  apelido?: string;
  matricula?: string;
  foto?: string; // ou avatarURL
  
  // Perfil Pessoal & Social
  bio?: string;
  dataNascimento?: string;
  idade?: number;
  telefone?: string;
  cidadeOrigem?: string;
  estadoOrigem?: string;
  statusRelacionamento?: string;
  pets?: string;
  esportes?: string[];
  instagram?: string;
  linkedin?: string;
  
  // Acadêmico
  turma: string; // Ex: "T8", "T5"
  curso?: string; 
  
  // Sistema / Config
  role: "user" | "admin" | "master";
  status: "ativo" | "banido" | "inativo";
  isAnonymous: boolean;
  createdAt?: Timestamp | string;
  ultimoLoginDiario?: string;
  lastPostTime?: Timestamp | null;
  
  // Privacidade
  idadePublica: boolean;
  relacionamentoPublico: boolean;
  whatsappPublico: boolean;
  
  // Gamificação (CORE)
  xp: number;
  xpMultiplier: number;
  level: number;
  sharkCoins: number;
  selos: number;
  patente: string; // Ex: "Plâncton"
  tier: "bicho" | "cardume" | "atleta" | "lenda" | "veterano";
  
  // Plano / Associação
  plano: string; 
  plano_status: "ativo" | "pendente" | "cancelado";
  plano_badge: string;
  plano_cor: string;
  plano_icon: string;
  desconto_loja: number;
  nivel_prioridade: number;
  data_adesao?: string;
  
  // Estatísticas
  stats: UserStats;
}

// ==========================================
// 🏆 CONQUISTAS & PATENTES (GAMIFICATION)
// ==========================================
export type AchievementCategory = "Gym" | "Social" | "Games" | "Loja" | "Eventos" | "Todas";

export interface Patente {
  id: string;
  titulo: string;
  minXp: number;
  
  // Identidade Visual (Obrigatórios conforme seu código)
  cor: string;       // Ex: "text-emerald-400"
  iconName: string;  // Ex: "Fish", "Crown", "Swords"
  
  // Estilos Opcionais (Podem ser calculados ou salvos)
  bg?: string;       
  border?: string;   
  text?: string;     
  opacity?: boolean; // Para patentes iniciais mais apagadas
}

export interface Achievement {
  id: string;
  titulo: string;
  desc: string;
  xp: number;
  target: number;
  statKey: string;   // Ex: "loginCount"
  cat: AchievementCategory;
  iconName: string;
  active: boolean;
  repeatable: boolean;
}

export interface AchievementLog {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  achievementId: string;
  achievementTitle: string;
  xpEarned: number;
  // 🦈 Correção: Tipagem para suportar Timestamp do Supabase ou ISO string
  timestamp: Timestamp | string | number;
}

// ==========================================
// 🎉 EVENTOS (FESTAS & ENQUETES)
// ==========================================
export interface Lote {
  id: number;
  nome: string;
  preco: string;
  status: "ativo" | "encerrado" | "agendado";
  dataVirada?: string;
}

export interface EventoStats {
  confirmados: number;
  talvez: number;
  likes: number;
}

export interface VendasStats {
  vendidos: number;
  total: number;
  receita?: number;
}

export interface Evento {
  id: string;
  titulo: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  local: string;
  tipo: string; // "Festa", "Esporte"
  destaque: string;
  mapsUrl: string;
  imagem: string;
  imagePositionY: number; // 0-100 para object-position
  lotes: Lote[];
  descricao: string;
  status: "ativo" | "encerrado";
  isLowStock?: boolean;
  
  // Dados calculados
  stats?: EventoStats;
  vendasTotais?: VendasStats;
  
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PollOption {
  text: string;
  votes: number;
  creator?: string; 
  creatorName?: string;
  creatorAvatar?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  allowUserOptions: boolean;
  voters: string[]; // IDs de quem já votou
  createdAt?: Timestamp;
}

export interface ParticipanteEvento {
  id: string; 
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "maybe";
  pagamento?: "pago" | "pendente"; 
  lote?: string;
}

// ==========================================
// 🏋️ GYM (TREINOS & CAMPEONATOS)
// ==========================================
export interface Campeonato {
  id: number | string; // Suporta ID numérico (legacy) ou string
  titulo: string;
  inicio: string;
  fim: string;
  regras: string;
  status: "ativo" | "agendado" | "encerrado";
  inscritos: number;
  xpBonus: number;
  fotoCapa?: string;
}

export interface TipoTreino {
  id: number | string;
  nome: string;
  xp: number;
  icon: string; // Emoji ou nome de ícone
  count: number; // Quantas vezes foi feito
}

export interface ItemModeracao {
  id: number | string;
  usuario: string;
  usuarioHandle: string;
  turma: string; 
  foto: string;
  modalidade: string;
  data: string;
  tipo: "validacao" | "denuncia";
  status: "pendente" | "aprovado" | "rejeitado" | "punido";
  motivoDenuncia?: string;
  campeonatoId: number | string;
}

// ==========================================
// 💬 COMUNIDADE (POSTS & DENÚNCIAS)
// ==========================================
export interface Post {
  id: string;
  userId: string;
  userName: string;
  handle: string;
  avatar: string;
  texto: string;
  createdAt: Timestamp;
  
  // Métricas
  likes: number;
  comentarios: number;
  denunciasCount: number;
  
  // Controle
  blocked: boolean;
  fixado: boolean;
  commentsDisabled: boolean;
}

export interface Comentario {
  id: string;
  userId: string;
  userName: string;
  avatar: string;
  texto: string;
  createdAt: Timestamp;
}

export type ReportCategory = 'comunidade' | 'gym' | 'suporte' | 'banidos';
export type ReportStatus = 'pendente' | 'resolvida';

export interface Report {
  id: string;
  autor: string;
  alvo?: string;
  categoria: ReportCategory;
  motivo: string;
  descricao: string;
  data: string; // String formatada para exibição
  status: ReportStatus;
  respostaAdmin?: string;
  originCollection?: string; // 'mock' ou 'banned_appeals'
  reporterId?: string; // ID real do usuário
  postId?: string; // Se for denúncia de post
  postText?: string; // Snapshot do texto denunciado
}

// ==========================================
// 🛍️ LOJA & FIDELIDADE
// ==========================================
export interface Reward {
  id: string;
  title: string;
  cost: number;
  stock: number;
  image: string;
  active: boolean;
  // 🦈 Correção: createdAt tipado
  createdAt?: Timestamp | string | number;
}

export interface FidelityConfig {
  xpPerStamp: number;
  rules: string[];
}

// ==========================================
// 📘 GUIA DO BIXO
// ==========================================
export interface GuiaItem {
  id: string;
  categoria: 'academico' | 'transporte' | 'turismo' | 'emergencia';
  
  // Campos variáveis dependendo da categoria
  titulo?: string; // Academico
  url?: string;    // Academico
  nome?: string;   // Transporte, Turismo, Emergencia
  horario?: string;// Transporte
  detalhe?: string;// Transporte
  descricao?: string; // Turismo
  foto?: string;   // Turismo
  numero?: string; // Emergencia
  cor?: string;    // Emergencia ('red', 'blue', etc)
}

// ==========================================
// ⚙️ CONFIGURAÇÕES GERAIS (MENU & LEGAL)
// ==========================================
export type ConfigItemType = "link" | "toggle" | "action";

export interface ConfigItem {
  id: string;
  label: string;
  icon: string;
  type: ConfigItemType;
  path?: string;
  active: boolean;
}

export interface ConfigSection {
  id: string;
  title: string;
  items: ConfigItem[];
}

export interface LegalDoc {
  id: string;
  titulo: string;
  conteudo: string;
  iconName: string; // Nome do ícone Lucide
  tipo: "publico" | "interno";
  updatedAt?: Timestamp;
}

export interface AlbumConfig {
  capa: string;
  titulo: string;
  subtitulo: string;
  // 🦈 Correção: updatedAt tipado
  updatedAt?: Timestamp | string | number;
}

export interface CarteirinhaConfig {
  validade: string;
  backgrounds: Record<string, string>; // { "T1": "url...", "T2": "url..." }
}

