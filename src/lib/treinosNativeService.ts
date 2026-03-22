import { getSupabaseClient } from "./supabase";
import {
  asObject,
  asString,
  asStringArray,
  boundedLimit,
  incrementUserStats,
  normalizeRowTimestamps,
  throwSupabaseError,
  type Row,
} from "./supabaseData";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";

const MAX_TREINOS_RESULTS = 260;
const MAX_MONTH_RESULTS = 220;
const MAX_USERS_RESULTS = 500;
const MAX_RSVP_RESULTS = 240;
const MAX_CHAMADA_RESULTS = 240;
const MAX_MODALIDADES = 30;
const MAX_RECURRING_WEEKS = 20;
const USER_DIRECTORY_SEGMENT_SIZE = 30;
const DEFAULT_MODALIDADES = ["Futsal", "Volei"];
const USER_DIRECTORY_SELECT_COLUMNS = "uid,nome,turma,foto,email";
const USER_DIRECTORY_BASE_GROUPS = [
  ["A", "B", "C", "D", "E", "F"],
  ["G", "H", "I", "J", "K", "L"],
  ["M", "N", "O", "P", "Q"],
  ["R", "S", "T"],
  ["U", "V", "W", "X", "Y", "Z"],
] as const;
const TREINOS_SELECT_COLUMNS =
  "id,modalidade,diaSemana,dia,horario,local,treinador,treinadorId,treinadorAvatar,descricao,imagem,ordemDia,status,confirmados,createdAt,updatedAt";
const TREINOS_RSVPS_SELECT_COLUMNS =
  "id,treinoId,userId,userName,userAvatar,userTurma,status,timestamp";
const TREINOS_CHAMADA_SELECT_COLUMNS =
  "id,treinoId,userId,nome,avatar,turma,status,origem,pagamento,timestamp,updatedAt";

const nowIso = (): string => new Date().toISOString();
const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const resolveTreinosTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());
const resolveTreinosSettingsIds = (tenantId?: string | null): string[] => {
  const scopedTenantId = resolveTreinosTenantId(tenantId);
  if (!scopedTenantId) return ["treinos"];
  return [buildTenantScopedRowId(scopedTenantId, "treinos")];
};

const normalizeModalidades = (value: unknown): string[] => {
  const unique = new Set<string>();
  asStringArray(value).forEach((entry) => {
    const clean = entry.trim().slice(0, 40);
    if (clean) unique.add(clean);
  });
  const normalized = Array.from(unique).slice(0, MAX_MODALIDADES);
  return normalized.length > 0 ? normalized : [...DEFAULT_MODALIDADES];
};

const normalizeModalidadeName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 40);

const toModalidadeKey = (value: string): string =>
  normalizeModalidadeName(value).toLowerCase();

const normalizeDirectoryLetters = (letters: string[]): string[] =>
  Array.from(
    new Set(
      letters
        .map((letter) => asString(letter).trim().slice(0, 1).toUpperCase())
        .filter((letter) => /^[A-Z]$/.test(letter))
    )
  );

const buildUserDirectoryInitialsClause = (letters: string[]): string =>
  normalizeDirectoryLetters(letters)
    .map((letter) => `nome.ilike.${letter}%`)
    .join(",");

const buildUserDirectorySegmentId = (
  letters: string[],
  offset: number,
  limit: number
): string => `${letters.join("")}:${offset}:${limit}`;

const buildUserDirectorySegmentLabel = (
  letters: string[],
  offset: number,
  limit: number,
  totalInGroup: number
): string => {
  const normalizedLetters = normalizeDirectoryLetters(letters);
  const startLetter = normalizedLetters[0] || "A";
  const endLetter = normalizedLetters[normalizedLetters.length - 1] || startLetter;
  const baseLabel = `${startLetter}-${endLetter}`;

  if (totalInGroup <= limit && offset === 0) {
    return baseLabel;
  }

  const pageIndex = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalInGroup / limit));
  return `${baseLabel} ${pageIndex}/${totalPages}`;
};

const normalizeModalidadeImagens = (
  value: unknown,
  modalidades: string[]
): Record<string, string> => {
  const data = asObject(value);
  if (!data) return {};

  const allowed = new Set(modalidades.map((item) => toModalidadeKey(item)));
  const images: Record<string, string> = {};
  Object.entries(data).forEach(([rawKey, rawValue]) => {
    const key = toModalidadeKey(rawKey);
    const url = asString(rawValue).trim().slice(0, 2000);
    if (!key || !url) return;
    if (allowed.size > 0 && !allowed.has(key)) return;
    images[key] = url;
  });
  return images;
};

const normalizeStatus = (statusRaw: string): "ativo" | "cancelado" =>
  statusRaw === "cancelado" ? "cancelado" : "ativo";

const parseDateValue = (value: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(`${value}T12:00:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortTreinosByDateDesc = (rows: TreinoRecord[]): TreinoRecord[] =>
  [...rows].sort((a, b) => parseDateValue(b.dia) - parseDateValue(a.dia));

const getDayLabel = (date: Date): string => {
  const labels = [
    "Domingo",
    "Segunda-feira",
    "Terca-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sabado",
  ];
  return labels[date.getDay()] ?? "";
};

const getDayOrder = (date: Date): number => date.getDay();
const createIsoDate = (date: Date): string => date.toISOString().split("T")[0] || "";

const parseOffsetCursor = (cursorId?: string | null): number => {
  if (!cursorId) return 0;
  const parsed = Number(cursorId);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const nextOffsetCursor = (offset: number, pageSize: number, hasMore: boolean): string | null =>
  hasMore ? String(offset + pageSize) : null;

const normalizeTreino = (id: string, raw: unknown): TreinoRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const imagem = asString(data.imagem).trim() || undefined;
  const treinadorId = asString(data.treinadorId).trim() || undefined;
  const treinadorAvatar = asString(data.treinadorAvatar).trim() || undefined;
  const descricao = asString(data.descricao).trim() || undefined;

  return {
    id,
    modalidade: asString(data.modalidade, "Treino").trim().slice(0, 80) || "Treino",
    diaSemana: asString(data.diaSemana, "").trim().slice(0, 40),
    dia: asString(data.dia, "").trim().slice(0, 10),
    horario: asString(data.horario, "").trim().slice(0, 20),
    local: asString(data.local, "").trim().slice(0, 140),
    treinador: asString(data.treinador, "").trim().slice(0, 120),
    ...(treinadorId ? { treinadorId } : {}),
    ...(treinadorAvatar ? { treinadorAvatar } : {}),
    ...(descricao ? { descricao } : {}),
    ...(imagem ? { imagem } : {}),
    ordemDia: Math.max(0, asNumber(data.ordemDia, 0)),
    status: normalizeStatus(asString(data.status, "ativo")),
    confirmados: asStringArray(data.confirmados).slice(0, 600),
  };
};

const normalizeRsvp = (raw: unknown): TreinoRsvpRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const userId = asString(data.userId).trim();
  if (!userId) return null;

  return {
    userId,
    userName: asString(data.userName, "Aluno").trim().slice(0, 120) || "Aluno",
    userAvatar: asString(data.userAvatar).trim(),
    userTurma: asString(data.userTurma, "Geral").trim().slice(0, 30) || "Geral",
    status: asString(data.status) === "not_going" ? "not_going" : "going",
  };
};

const normalizeChamada = (id: string, raw: unknown): TreinoChamadaRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const userId = asString(data.userId, id).trim();
  if (!userId) return null;

  const statusRaw = asString(data.status, "presente");
  const status: TreinoChamadaRecord["status"] =
    statusRaw === "falta" || statusRaw === "justificado" || statusRaw === "inscrito"
      ? statusRaw
      : "presente";

  const origemRaw = asString(data.origem, "manual");
  const origem: TreinoChamadaRecord["origem"] = origemRaw === "app" ? "app" : "manual";

  const pagamentoRaw = asString(data.pagamento);
  const pagamento: TreinoChamadaRecord["pagamento"] =
    pagamentoRaw === "pago" || pagamentoRaw === "pendente" ? pagamentoRaw : undefined;

  return {
    id,
    userId,
    nome: asString(data.nome, "Aluno").trim().slice(0, 120) || "Aluno",
    avatar: asString(data.avatar).trim(),
    turma: asString(data.turma, "Geral").trim().slice(0, 30) || "Geral",
    status,
    origem,
    ...(pagamento ? { pagamento } : {}),
  };
};

const normalizeUserDirectoryEntry = (id: string, raw: unknown): TreinoUserDirectoryItem | null => {
  const data = asObject(raw);
  if (!data) return null;
  const nome = asString(data.nome).trim();
  if (!nome) return null;

  return {
    uid: id,
    nome: nome.slice(0, 120),
    turma: asString(data.turma, "Geral").trim().slice(0, 30) || "Geral",
    foto: asString(data.foto).trim(),
    email: asString(data.email).trim().slice(0, 160),
  };
};

const normalizeTreinoPayload = (
  payload: Partial<TreinoRecord>,
  diaSemanaOverride?: string,
  ordemDiaOverride?: number
): Omit<TreinoRecord, "id"> => {
  const dia = asString(payload.dia).trim().slice(0, 10);
  const modalidade = asString(payload.modalidade, "Treino").trim().slice(0, 80) || "Treino";
  const diaSemana = (diaSemanaOverride ?? asString(payload.diaSemana, "").trim().slice(0, 40)) || "";
  const ordemDia = Number.isFinite(ordemDiaOverride)
    ? Math.max(0, Math.floor(ordemDiaOverride ?? 0))
    : Math.max(0, asNumber(payload.ordemDia, 0));
  const treinador = asString(payload.treinador).trim().slice(0, 120);
  const treinadorId = asString(payload.treinadorId).trim().slice(0, 120);
  const treinadorAvatar = asString(payload.treinadorAvatar).trim().slice(0, 800);
  const descricao = asString(payload.descricao).trim().slice(0, 700);
  const imagem = asString(payload.imagem).trim().slice(0, 2000);

  return {
    modalidade,
    diaSemana,
    dia,
    horario: asString(payload.horario).trim().slice(0, 20),
    local: asString(payload.local).trim().slice(0, 140),
    treinador,
    ...(treinadorId ? { treinadorId } : {}),
    ...(treinadorAvatar ? { treinadorAvatar } : {}),
    ...(descricao ? { descricao } : {}),
    ...(imagem ? { imagem } : {}),
    ordemDia,
    status: normalizeStatus(asString(payload.status, "ativo")),
    confirmados: asStringArray(payload.confirmados).slice(0, 600),
  };
};

export interface TreinoRecord {
  id: string;
  modalidade: string;
  diaSemana: string;
  dia: string;
  horario: string;
  local: string;
  treinador: string;
  treinadorId?: string;
  treinadorAvatar?: string;
  descricao?: string;
  imagem?: string;
  ordemDia: number;
  status: "ativo" | "cancelado";
  confirmados: string[];
}

export interface TreinoRsvpRecord {
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "not_going";
}
export interface TreinoChamadaRecord {
  id: string;
  userId: string;
  nome: string;
  avatar: string;
  turma: string;
  status: "presente" | "falta" | "justificado" | "inscrito";
  origem: "app" | "manual";
  pagamento?: "pago" | "pendente";
}

export interface TreinoUserDirectoryItem {
  uid: string;
  nome: string;
  turma: string;
  foto: string;
  email: string;
}

export interface TreinoUserDirectorySegment {
  id: string;
  label: string;
  letters: string[];
  count: number;
  totalInGroup: number;
  offset: number;
  limit: number;
}

export interface TreinoRankingItem {
  userId: string;
  nome: string;
  avatar: string;
  turma: string;
  count: number;
}

export interface TreinoGhostItem {
  id: string;
  nome: string;
  avatar: string;
  turma: string;
  treinoData: string;
  treinoMod: string;
}

export interface TreinoDashboardMetrics {
  rankings: Record<string, TreinoRankingItem[]>;
  listaVergonha: TreinoGhostItem[];
}

export interface TreinoParticipantsPage<T> {
  rows: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TreinoSettingsRecord {
  modalidades: string[];
  modalidadeImagens: Record<string, string>;
}

export async function fetchTreinoSettings(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<TreinoSettingsRecord> {
  void options;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("settings")
    .select("modalidades, data")
    .in("id", resolveTreinosSettingsIds(options?.tenantId));
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const selected = resolveTreinosSettingsIds(options?.tenantId)
    .map((id) => rows.find((row) => asString(row.id) === id))
    .find((row) => Boolean(row));
  if (error) throwSupabaseError(error);

  const modalidades = normalizeModalidades(selected?.modalidades);
  const payload = asObject(selected?.data) ?? {};
  const modalidadeImagens = normalizeModalidadeImagens(payload.modalidadeImagens, modalidades);
  return { modalidades, modalidadeImagens };
}

export async function saveTreinoSettings(payload: {
  modalidades: string[];
  modalidadeImagens?: Record<string, string>;
}, options?: { tenantId?: string | null }): Promise<void> {
  const supabase = getSupabaseClient();
  const normalized = normalizeModalidades(payload.modalidades);
  const modalidadeImagens = normalizeModalidadeImagens(payload.modalidadeImagens, normalized);
  const settingsId = buildTenantScopedRowId(resolveTreinosTenantId(options?.tenantId), "treinos") || "treinos";

  const { data: currentData, error: currentError } = await supabase
    .from("settings")
    .select("data")
    .eq("id", settingsId)
    .maybeSingle();
  if (currentError) throwSupabaseError(currentError);

  const currentSettingsData = asObject(currentData?.data) ?? {};
  const nextSettingsData: Row = {
    ...currentSettingsData,
    modalidadeImagens,
  };

  const { error } = await supabase.from("settings").upsert(
    {
      id: settingsId,
      ...(resolveTreinosTenantId(options?.tenantId) ? { tenant_id: resolveTreinosTenantId(options?.tenantId) } : {}),
      modalidades: normalized,
      data: nextSettingsData,
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);
}

export async function fetchTreinosAdminList(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<TreinoRecord[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_TREINOS_RESULTS);
  let query = supabase
    .from("treinos")
    .select(TREINOS_SELECT_COLUMNS)
    .order("dia", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeTreino(asString(entry.id), normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoRecord => entry !== null);
}

export async function fetchTreinosByDateRange(payload: {
  startDate: string;
  endDate: string;
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<TreinoRecord[]> {
  const startDate = payload.startDate.trim().slice(0, 10);
  const endDate = payload.endDate.trim().slice(0, 10);
  if (!startDate || !endDate) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  const maxResults = boundedLimit(payload.maxResults ?? 120, MAX_MONTH_RESULTS);
  let query = supabase
    .from("treinos")
    .select(TREINOS_SELECT_COLUMNS)
    .gte("dia", startDate)
    .lte("dia", endDate)
    .order("dia", { ascending: true });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeTreino(asString(entry.id), normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoRecord => entry !== null);
}

export async function fetchTreinoById(
  treinoId: string,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<TreinoRecord | null> {
  void options;
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return null;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  let query = supabase
    .from("treinos")
    .select(TREINOS_SELECT_COLUMNS)
    .eq("id", cleanTreinoId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwSupabaseError(error);
  if (!data) return null;

  return normalizeTreino(asString((data as Row).id, cleanTreinoId), normalizeRowTimestamps(data as Row));
}

export async function fetchTreinoRsvps(
  treinoId: string,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<TreinoRsvpRecord[]> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_RSVP_RESULTS);
  let query = supabase
    .from("treinos_rsvps")
    .select(TREINOS_RSVPS_SELECT_COLUMNS)
    .eq("treinoId", cleanTreinoId)
    .order("timestamp", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeRsvp(normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoRsvpRecord => entry !== null);
}

export async function fetchTreinoRsvpsPage(
  treinoId: string,
  options?: { pageSize?: number; cursorId?: string | null; forceRefresh?: boolean; tenantId?: string | null }
): Promise<TreinoParticipantsPage<TreinoRsvpRecord>> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return { rows: [], nextCursor: null, hasMore: false };

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const pageSize = boundedLimit(options?.pageSize ?? 10, MAX_RSVP_RESULTS);
  const offset = parseOffsetCursor(options?.cursorId);
  let query = supabase
    .from("treinos_rsvps")
    .select(TREINOS_RSVPS_SELECT_COLUMNS)
    .eq("treinoId", cleanTreinoId)
    .order("timestamp", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.range(offset, offset + pageSize);
  if (error) throwSupabaseError(error);

  const rawRows = (data ?? []) as Row[];
  const hasMore = rawRows.length > pageSize;
  const rows = rawRows
    .slice(0, pageSize)
    .map((entry) => normalizeRsvp(normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoRsvpRecord => entry !== null);

  return { rows, hasMore, nextCursor: nextOffsetCursor(offset, pageSize, hasMore) };
}
export async function fetchTreinoChamada(
  treinoId: string,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<TreinoChamadaRecord[]> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_CHAMADA_RESULTS);
  let query = supabase
    .from("treinos_chamada")
    .select(TREINOS_CHAMADA_SELECT_COLUMNS)
    .eq("treinoId", cleanTreinoId)
    .order("timestamp", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeChamada(asString(entry.id), normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoChamadaRecord => entry !== null);
}

export async function fetchTreinoChamadaPage(
  treinoId: string,
  options?: { pageSize?: number; cursorId?: string | null; forceRefresh?: boolean; tenantId?: string | null }
): Promise<TreinoParticipantsPage<TreinoChamadaRecord>> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return { rows: [], nextCursor: null, hasMore: false };

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const pageSize = boundedLimit(options?.pageSize ?? 10, MAX_CHAMADA_RESULTS);
  const offset = parseOffsetCursor(options?.cursorId);
  let query = supabase
    .from("treinos_chamada")
    .select(TREINOS_CHAMADA_SELECT_COLUMNS)
    .eq("treinoId", cleanTreinoId)
    .order("timestamp", { ascending: false });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.range(offset, offset + pageSize);
  if (error) throwSupabaseError(error);

  const rawRows = (data ?? []) as Row[];
  const hasMore = rawRows.length > pageSize;
  const rows = rawRows
    .slice(0, pageSize)
    .map((entry) => normalizeChamada(asString(entry.id), normalizeRowTimestamps(entry)))
    .filter((entry): entry is TreinoChamadaRecord => entry !== null);

  return { rows, hasMore, nextCursor: nextOffsetCursor(offset, pageSize, hasMore) };
}

export async function fetchUserDirectory(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<TreinoUserDirectoryItem[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const maxResults = boundedLimit(options?.maxResults ?? 320, MAX_USERS_RESULTS);
  let query = supabase
    .from("users")
    .select(USER_DIRECTORY_SELECT_COLUMNS)
    .order("nome", { ascending: true });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeUserDirectoryEntry(asString(entry.uid), entry))
    .filter((entry): entry is TreinoUserDirectoryItem => entry !== null);
}

const countUserDirectoryByLetters = async (
  letters: string[],
  tenantId?: string | null
): Promise<number> => {
  const normalizedLetters = normalizeDirectoryLetters(letters);
  if (normalizedLetters.length === 0) return 0;

  const supabase = getSupabaseClient();
  let query = supabase.from("users").select("uid", { count: "exact", head: true });
  const scopedTenantId = resolveTreinosTenantId(tenantId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  if (normalizedLetters.length === 1) {
    query = query.ilike("nome", `${normalizedLetters[0]}%`);
  } else {
    query = query.or(buildUserDirectoryInitialsClause(normalizedLetters));
  }

  const { count, error } = await query;
  if (error) throwSupabaseError(error);
  return Math.max(0, count ?? 0);
};

const expandUserDirectoryGroup = async (
  letters: string[],
  tenantId: string,
  maxUsersPerSegment: number
): Promise<TreinoUserDirectorySegment[]> => {
  const normalizedLetters = normalizeDirectoryLetters(letters);
  if (normalizedLetters.length === 0) return [];

  const count = await countUserDirectoryByLetters(normalizedLetters, tenantId);
  if (count === 0) return [];

  if (count <= maxUsersPerSegment) {
    return [
      {
        id: buildUserDirectorySegmentId(normalizedLetters, 0, maxUsersPerSegment),
        label: buildUserDirectorySegmentLabel(
          normalizedLetters,
          0,
          maxUsersPerSegment,
          count
        ),
        letters: normalizedLetters,
        count,
        totalInGroup: count,
        offset: 0,
        limit: maxUsersPerSegment,
      },
    ];
  }

  if (normalizedLetters.length > 1) {
    const middleIndex = Math.ceil(normalizedLetters.length / 2);
    const [leftSegments, rightSegments] = await Promise.all([
      expandUserDirectoryGroup(
        normalizedLetters.slice(0, middleIndex),
        tenantId,
        maxUsersPerSegment
      ),
      expandUserDirectoryGroup(
        normalizedLetters.slice(middleIndex),
        tenantId,
        maxUsersPerSegment
      ),
    ]);
    return [...leftSegments, ...rightSegments];
  }

  const segments: TreinoUserDirectorySegment[] = [];
  for (let offset = 0; offset < count; offset += maxUsersPerSegment) {
    const pageCount = Math.min(maxUsersPerSegment, count - offset);
    segments.push({
      id: buildUserDirectorySegmentId(
        normalizedLetters,
        offset,
        maxUsersPerSegment
      ),
      label: buildUserDirectorySegmentLabel(
        normalizedLetters,
        offset,
        maxUsersPerSegment,
        count
      ),
      letters: normalizedLetters,
      count: pageCount,
      totalInGroup: count,
      offset,
      limit: maxUsersPerSegment,
    });
  }
  return segments;
};

export async function fetchUserDirectorySegments(options?: {
  forceRefresh?: boolean;
  maxUsersPerSegment?: number;
  tenantId?: string | null;
}): Promise<TreinoUserDirectorySegment[]> {
  void options?.forceRefresh;
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  const maxUsersPerSegment = boundedLimit(
    options?.maxUsersPerSegment ?? USER_DIRECTORY_SEGMENT_SIZE,
    USER_DIRECTORY_SEGMENT_SIZE
  );

  const groups = await Promise.all(
    USER_DIRECTORY_BASE_GROUPS.map((letters) =>
      expandUserDirectoryGroup([...letters], scopedTenantId, maxUsersPerSegment)
    )
  );

  return groups.flat();
}

export async function fetchUserDirectorySegmentUsers(payload: {
  segment: TreinoUserDirectorySegment;
  tenantId?: string | null;
}): Promise<TreinoUserDirectoryItem[]> {
  const normalizedLetters = normalizeDirectoryLetters(payload.segment.letters);
  if (normalizedLetters.length === 0) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  let query = supabase
    .from("users")
    .select(USER_DIRECTORY_SELECT_COLUMNS)
    .order("nome", { ascending: true });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  if (normalizedLetters.length === 1) {
    query = query.ilike("nome", `${normalizedLetters[0]}%`);
  } else {
    query = query.or(buildUserDirectoryInitialsClause(normalizedLetters));
  }

  const start = Math.max(0, payload.segment.offset);
  const end = start + Math.max(1, payload.segment.limit) - 1;
  const { data, error } = await query.range(start, end);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeUserDirectoryEntry(asString(entry.uid), entry))
    .filter((entry): entry is TreinoUserDirectoryItem => entry !== null);
}

export async function searchUserDirectoryByName(options: {
  query: string;
  maxResults?: number;
  tenantId?: string | null;
}): Promise<TreinoUserDirectoryItem[]> {
  const searchTerm = asString(options.query).trim();
  if (searchTerm.length < 2) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options.tenantId);
  const maxResults = boundedLimit(options.maxResults ?? 8, 20);
  let query = supabase
    .from("users")
    .select(USER_DIRECTORY_SELECT_COLUMNS)
    .ilike("nome", `%${searchTerm}%`)
    .order("nome", { ascending: true });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  const { data, error } = await query.limit(maxResults);
  if (error) throwSupabaseError(error);

  return ((data ?? []) as Row[])
    .map((entry) => normalizeUserDirectoryEntry(asString(entry.uid), entry))
    .filter((entry): entry is TreinoUserDirectoryItem => entry !== null);
}

export async function fetchTreinoDashboardMetrics(payload: {
  treinos: TreinoRecord[];
  maxRankingTreinos?: number;
  maxGhostTreinos?: number;
  formatDate?: (isoDate: string) => string;
  tenantId?: string | null;
}): Promise<TreinoDashboardMetrics> {
  const maxRankingTreinos = boundedLimit(payload.maxRankingTreinos ?? 20, 50);
  const maxGhostTreinos = boundedLimit(payload.maxGhostTreinos ?? 5, 12);
  const formatDate = payload.formatDate ?? ((isoDate: string) => isoDate);

  const pastTreinos = sortTreinosByDateDesc(payload.treinos).filter((entry) => {
    const millis = parseDateValue(entry.dia);
    return millis > 0 && millis < Date.now();
  });

  const rankingTreinos = pastTreinos.slice(0, maxRankingTreinos);
  const ghostTreinos = pastTreinos.slice(0, maxGhostTreinos);
  const rankingMap: Record<string, Record<string, TreinoRankingItem>> = {};

  const chamadasPorTreino = await Promise.all(
    rankingTreinos.map(async (treino) => ({
      treino,
      chamada: await fetchTreinoChamada(treino.id, {
        maxResults: 200,
        tenantId: payload.tenantId,
      }),
    }))
  );

  chamadasPorTreino.forEach(({ treino, chamada }) => {
    const modalidade = treino.modalidade || "Geral";
    if (!rankingMap[modalidade]) rankingMap[modalidade] = {};
    chamada.forEach((entry) => {
      if (entry.status !== "presente") return;
      if (!rankingMap[modalidade][entry.userId]) {
        rankingMap[modalidade][entry.userId] = {
          userId: entry.userId,
          nome: entry.nome,
          avatar: entry.avatar,
          turma: entry.turma,
          count: 0,
        };
      }
      rankingMap[modalidade][entry.userId].count += 1;
    });
  });

  const rankings: Record<string, TreinoRankingItem[]> = {};
  Object.entries(rankingMap).forEach(([modalidade, ranking]) => {
    rankings[modalidade] = Object.values(ranking).sort((a, b) => b.count - a.count);
  });

  const vergonhaRows = await Promise.all(
    ghostTreinos.map(async (treino) => {
      const [rsvps, chamada] = await Promise.all([
        fetchTreinoRsvps(treino.id, {
          maxResults: 220,
          tenantId: payload.tenantId,
        }),
        fetchTreinoChamada(treino.id, {
          maxResults: 220,
          tenantId: payload.tenantId,
        }),
      ]);

      const presentesIds = new Set(
        chamada.filter((entry) => entry.status === "presente").map((entry) => entry.userId)
      );

      return rsvps
        .filter((entry) => entry.status === "going" && !presentesIds.has(entry.userId))
        .map((entry) => ({
          id: `${treino.id}:${entry.userId}`,
          nome: entry.userName,
          avatar: entry.userAvatar,
          turma: entry.userTurma,
          treinoData: formatDate(treino.dia),
          treinoMod: treino.modalidade,
        }));
    })
  );

  return { rankings, listaVergonha: vergonhaRows.flat().slice(0, 120) };
}

export async function upsertTreino(payload: {
  id?: string;
  data: Partial<TreinoRecord>;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const cleanId = payload.id?.trim() || "";
  const baseData = normalizeTreinoPayload(payload.data);
  if (!baseData.dia || !baseData.modalidade) throw new Error("Dados invalidos para treino.");

  const diaObj = new Date(`${baseData.dia}T12:00:00`);
  const normalizedData = normalizeTreinoPayload(baseData, getDayLabel(diaObj), getDayOrder(diaObj));
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);

  if (cleanId) {
    let query = supabase
      .from("treinos")
      .update({ ...normalizedData, updatedAt: nowIso() })
      .eq("id", cleanId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { error } = await query;
    if (error) throwSupabaseError(error);
    return { id: cleanId };
  }

  const { data, error } = await supabase
    .from("treinos")
    .insert({
      ...normalizedData,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .select("id")
    .single();
  if (error) throwSupabaseError(error);
  return { id: asString((data as Row | null)?.id) };
}

export async function createRecurringTreinos(payload: {
  data: Partial<TreinoRecord>;
  startDate: string;
  endDate: string;
  tenantId?: string | null;
}): Promise<{ count: number }> {
  const startDate = payload.startDate.trim().slice(0, 10);
  const endDate = payload.endDate.trim().slice(0, 10);
  if (!startDate || !endDate) return { count: 0 };

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return { count: 0 };

  const baseData = normalizeTreinoPayload(payload.data);
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  const rows: Row[] = [];
  const current = new Date(start);
  let count = 0;
  while (current <= end && count < MAX_RECURRING_WEEKS) {
    const dia = createIsoDate(current);
    const dataByDay = normalizeTreinoPayload({ ...baseData, dia }, getDayLabel(current), getDayOrder(current));
    rows.push({
      ...dataByDay,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    current.setDate(current.getDate() + 7);
    count += 1;
  }

  if (rows.length > 0) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("treinos").insert(rows);
    if (error) throwSupabaseError(error);
  }

  return { count };
}

export async function toggleTreinoStatus(payload: {
  treinoId: string;
  status: "ativo" | "cancelado";
  tenantId?: string | null;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  if (!treinoId) return;
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  let query = supabase
    .from("treinos")
    .update({ status: normalizeStatus(payload.status), updatedAt: nowIso() })
    .eq("id", treinoId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
}

export async function deleteTreino(
  treinoId: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return;
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(options?.tenantId);
  let query = supabase.from("treinos").delete().eq("id", cleanTreinoId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
}
export async function setTreinoRsvp(payload: {
  treinoId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "not_going";
  tenantId?: string | null;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const userId = payload.userId.trim();
  if (!treinoId || !userId) return;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  const [{ data: treinoRow, error: treinoError }, { data: existing, error: existingError }] = await Promise.all([
    (() => {
      let query = supabase.from("treinos").select("confirmados").eq("id", treinoId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      return query.maybeSingle();
    })(),
    (() => {
      let query = supabase
        .from("treinos_rsvps")
        .select("id")
        .eq("treinoId", treinoId)
        .eq("userId", userId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      return query.maybeSingle();
    })(),
  ]);
  if (treinoError) throwSupabaseError(treinoError);
  if (existingError) throwSupabaseError(existingError);

  const currentConfirmados = asStringArray(treinoRow?.confirmados);
  const hadExistingRsvp = Boolean(existing?.id);
  const nextConfirmados =
    payload.status === "not_going"
      ? currentConfirmados.filter((entry) => entry !== userId)
      : currentConfirmados.includes(userId)
      ? currentConfirmados
      : [...currentConfirmados, userId];

  if (payload.status === "not_going") {
    let query = supabase.from("treinos_rsvps").delete().eq("treinoId", treinoId).eq("userId", userId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { error } = await query;
    if (error) throwSupabaseError(error);
  } else {
    const { error } = await supabase.from("treinos_rsvps").upsert(
      {
        ...(existing?.id ? { id: existing.id } : {}),
        treinoId,
        userId,
        userName: payload.userName.trim().slice(0, 120) || "Atleta",
        userAvatar: payload.userAvatar.trim().slice(0, 2000),
        userTurma: payload.userTurma.trim().slice(0, 30) || "Geral",
        status: "going",
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        timestamp: nowIso(),
      },
      { onConflict: "treinoId,userId" }
    );
    if (error) throwSupabaseError(error);
  }

  // Atualizacao em duas etapas para evitar RPC/Edge Function no plano free.
  let updateQuery = supabase
    .from("treinos")
    .update({ confirmados: nextConfirmados, updatedAt: nowIso() })
    .eq("id", treinoId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: treinoUpdateError } = await updateQuery;
  if (treinoUpdateError) throwSupabaseError(treinoUpdateError);

  if (!hadExistingRsvp && payload.status === "going") {
    try {
      await incrementUserStats(
        userId,
        { treinoRsvps: 1 },
        { tenantId: scopedTenantId || undefined }
      );
    } catch (statsError: unknown) {
      console.warn("Treinos: falha ao sincronizar RSVP.", statsError);
    }
  }
}

export async function upsertChamadaPresence(payload: {
  treinoId: string;
  userId: string;
  nome: string;
  turma: string;
  avatar: string;
  origem: "app" | "manual";
  status?: "presente" | "falta" | "justificado";
  tenantId?: string | null;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const userId = payload.userId.trim();
  if (!treinoId || !userId) return;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  let existingQuery = supabase
    .from("treinos_chamada")
    .select("status")
    .eq("treinoId", treinoId)
    .eq("userId", userId);
  if (scopedTenantId) {
    existingQuery = existingQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: existingRow, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throwSupabaseError(existingError);

  const nextStatus = payload.status ?? "presente";
  const { error } = await supabase.from("treinos_chamada").upsert(
    {
      treinoId,
      userId,
      id: `${treinoId}:${userId}`,
      nome: payload.nome.trim().slice(0, 120) || "Aluno",
      turma: payload.turma.trim().slice(0, 30) || "Geral",
      avatar: payload.avatar.trim().slice(0, 2000),
      origem: payload.origem,
      status: nextStatus,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      timestamp: nowIso(),
      updatedAt: nowIso(),
    },
    { onConflict: "treinoId,userId" }
  );
  if (error) throwSupabaseError(error);

  if (nextStatus === "presente" && existingRow?.status !== "presente") {
    try {
      await incrementUserStats(
        userId,
        {
          treinoPresenceConfirmed: 1,
          confirmedTrainings: 1,
        },
        { tenantId: scopedTenantId || undefined }
      );
    } catch (statsError: unknown) {
      console.warn("Treinos: falha ao sincronizar chamada.", statsError);
    }
  }
}

const resolveChamadaFilter = async (
  treinoId: string,
  chamadaId: string,
  tenantId?: string | null
): Promise<{ column: "id" | "userId"; value: string }> => {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(tenantId);
  let query = supabase
    .from("treinos_chamada")
    .select("id")
    .eq("treinoId", treinoId)
    .eq("id", chamadaId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwSupabaseError(error);
  return data ? { column: "id", value: chamadaId } : { column: "userId", value: chamadaId };
};

export async function updateChamadaStatus(payload: {
  treinoId: string;
  chamadaId: string;
  status: "presente" | "falta" | "justificado";
  tenantId?: string | null;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const chamadaId = payload.chamadaId.trim();
  if (!treinoId || !chamadaId) return;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  const selector = await resolveChamadaFilter(treinoId, chamadaId, scopedTenantId);
  let query = supabase.from("treinos_chamada").update({ status: payload.status, updatedAt: nowIso() }).eq("treinoId", treinoId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  query = query.eq(selector.column, selector.value);
  const { error } = await query;
  if (error) throwSupabaseError(error);
}

export async function deleteChamadaEntry(payload: {
  treinoId: string;
  chamadaId: string;
  tenantId?: string | null;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const chamadaId = payload.chamadaId.trim();
  if (!treinoId || !chamadaId) return;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTreinosTenantId(payload.tenantId);
  const selector = await resolveChamadaFilter(treinoId, chamadaId, scopedTenantId);
  let query = supabase.from("treinos_chamada").delete().eq("treinoId", treinoId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  query = query.eq(selector.column, selector.value);
  const { error } = await query;
  if (error) throwSupabaseError(error);
}

export async function addUserToChamada(payload: {
  treinoId: string;
  user: TreinoUserDirectoryItem;
  tenantId?: string | null;
}): Promise<void> {
  await upsertChamadaPresence({
    treinoId: payload.treinoId,
    userId: payload.user.uid,
    nome: payload.user.nome,
    turma: payload.user.turma || "Geral",
    avatar: payload.user.foto || "",
    origem: "manual",
    status: "presente",
    tenantId: payload.tenantId,
  });
}

export function clearTreinosServiceCaches(): void {
  void 0;
}
