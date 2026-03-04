import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from "@/lib/supabaseHelpers";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const MAX_TREINOS_RESULTS = 260;
const MAX_MONTH_RESULTS = 220;
const MAX_USERS_RESULTS = 500;
const MAX_RSVP_RESULTS = 240;
const MAX_CHAMADA_RESULTS = 240;
const MAX_MODALIDADES = 30;
const MAX_RECURRING_WEEKS = 20;

const TREINO_SETTINGS_GET_CALLABLE = "treinoAdminGetSettings";
const TREINO_SETTINGS_SAVE_CALLABLE = "treinoAdminSaveSettings";
const TREINO_UPSERT_CALLABLE = "treinoAdminUpsert";
const TREINO_RECURRING_CALLABLE = "treinoAdminCreateRecurring";
const TREINO_TOGGLE_STATUS_CALLABLE = "treinoAdminToggleStatus";
const TREINO_DELETE_CALLABLE = "treinoAdminDelete";
const TREINO_RSVP_CALLABLE = "treinoSetRsvp";
const TREINO_CHAMADA_UPSERT_CALLABLE = "treinoAdminUpsertChamada";
const TREINO_CHAMADA_STATUS_CALLABLE = "treinoAdminUpdateChamadaStatus";
const TREINO_CHAMADA_DELETE_CALLABLE = "treinoAdminDeleteChamada";

const DEFAULT_MODALIDADES = ["Futsal", "Volei"];

const treinosAdminCache = new Map<string, CacheEntry<TreinoRecord[]>>();
const treinosByMonthCache = new Map<string, CacheEntry<TreinoRecord[]>>();
const treinoByIdCache = new Map<string, CacheEntry<TreinoRecord | null>>();
const treinoRsvpsCache = new Map<string, CacheEntry<TreinoRsvpRecord[]>>();
const treinoChamadaCache = new Map<string, CacheEntry<TreinoChamadaRecord[]>>();
const treinoRsvpsPageCache = new Map<string, CacheEntry<TreinoParticipantsPage<TreinoRsvpRecord>>>();
const treinoChamadaPageCache = new Map<string, CacheEntry<TreinoParticipantsPage<TreinoChamadaRecord>>>();
const userDirectoryCache = new Map<string, CacheEntry<TreinoUserDirectoryItem[]>>();
let modalidadesCache: CacheEntry<string[]> | null = null;
let modalidadesInFlight: Promise<string[]> | null = null;

const TREINO_SETTINGS_SESSION_KEY = "aaakn:treino-settings";
const TREINO_SETTINGS_SESSION_TS_KEY = "aaakn:treino-settings:ts";

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getMapCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setMapCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const getSessionCachedModalidades = (): string[] | null => {
  if (typeof window === "undefined") return null;

  const rawValue = window.sessionStorage.getItem(TREINO_SETTINGS_SESSION_KEY);
  const rawTs = window.sessionStorage.getItem(TREINO_SETTINGS_SESSION_TS_KEY);
  if (!rawValue || !rawTs) return null;

  const timestamp = Number(rawTs);
  if (!Number.isFinite(timestamp)) return null;
  if (Date.now() - timestamp > READ_CACHE_TTL_MS) return null;

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    const normalized = normalizeModalidades(parsed);
    return normalized;
  } catch {
    return null;
  }
};

const setSessionCachedModalidades = (modalidades: string[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      TREINO_SETTINGS_SESSION_KEY,
      JSON.stringify(modalidades)
    );
    window.sessionStorage.setItem(
      TREINO_SETTINGS_SESSION_TS_KEY,
      String(Date.now())
    );
  } catch {
    // Storage pode falhar em modo privado; cache em memoria continua.
  }
};

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

const clearTreinoReadCaches = (): void => {
  treinosAdminCache.clear();
  treinosByMonthCache.clear();
  treinoByIdCache.clear();
  treinoRsvpsCache.clear();
  treinoChamadaCache.clear();
  treinoRsvpsPageCache.clear();
  treinoChamadaPageCache.clear();
};

const clearTreinoParticipantsPageCaches = (treinoId: string): void => {
  treinoRsvpsPageCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoRsvpsPageCache.delete(key);
    }
  });
  treinoChamadaPageCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoChamadaPageCache.delete(key);
    }
  });
};

const parseDateValue = (value: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(`${value}T12:00:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortTreinosByDateDesc = (rows: TreinoRecord[]): TreinoRecord[] =>
  [...rows].sort((left, right) => parseDateValue(right.dia) - parseDateValue(left.dia));

const normalizeModalidades = (value: unknown): string[] => {
  const unique = new Set<string>();
  asStringArray(value).forEach((entry) => {
    const clean = entry.trim().slice(0, 40);
    if (clean) unique.add(clean);
  });

  const normalized = Array.from(unique).slice(0, MAX_MODALIDADES);
  return normalized.length > 0 ? normalized : [...DEFAULT_MODALIDADES];
};

const normalizeStatus = (statusRaw: string): "ativo" | "cancelado" =>
  statusRaw === "cancelado" ? "cancelado" : "ativo";

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
    local: asString(data.local, "").trim().slice(0, 120),
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

  const statusRaw = asString(data.status, "going");
  const status: TreinoRsvpRecord["status"] =
    statusRaw === "not_going" ? "not_going" : "going";

  return {
    userId,
    userName: asString(data.userName, "Aluno").trim().slice(0, 120) || "Aluno",
    userAvatar: asString(data.userAvatar).trim(),
    userTurma: asString(data.userTurma, "Geral").trim().slice(0, 30) || "Geral",
    status,
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

const normalizeUserDirectoryEntry = (
  id: string,
  raw: unknown
): TreinoUserDirectoryItem | null => {
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
  const status = normalizeStatus(asString(payload.status, "ativo"));
  const confirmados = asStringArray(payload.confirmados).slice(0, 600);

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
    status,
    confirmados,
  };
};

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

const createIsoDate = (date: Date): string => date.toISOString().split("T")[0];

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

export async function fetchTreinoSettings(options?: {
  forceRefresh?: boolean;
}): Promise<string[]> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (
    !forceRefresh &&
    modalidadesCache &&
    Date.now() - modalidadesCache.cachedAt <= READ_CACHE_TTL_MS
  ) {
    return modalidadesCache.value;
  }

  if (!forceRefresh) {
    const sessionCached = getSessionCachedModalidades();
    if (sessionCached) {
      modalidadesCache = { cachedAt: Date.now(), value: sessionCached };
      return sessionCached;
    }

    if (modalidadesInFlight) {
      return modalidadesInFlight;
    }
  }

  const request = callWithFallback<
    { forceRefresh: boolean },
    { modalidades?: string[] }
  >(
    TREINO_SETTINGS_GET_CALLABLE,
    { forceRefresh },
    async () => {
      const snap = await getDoc(doc(db, "settings", "treinos"));
      const modalidades = snap.exists()
        ? normalizeModalidades((snap.data() as { modalidades?: unknown }).modalidades)
        : [...DEFAULT_MODALIDADES];
      return { modalidades };
    }
  )
    .then((result) => {
      const modalidades = normalizeModalidades(result.modalidades);
      modalidadesCache = { cachedAt: Date.now(), value: modalidades };
      setSessionCachedModalidades(modalidades);
      return modalidades;
    })
    .finally(() => {
      modalidadesInFlight = null;
    });

  modalidadesInFlight = request;
  return request;
}

export async function saveTreinoSettings(modalidades: string[]): Promise<void> {
  const normalized = normalizeModalidades(modalidades);

  await callWithFallback<{ modalidades: string[] }, { ok: boolean }>(
    TREINO_SETTINGS_SAVE_CALLABLE,
    { modalidades: normalized },
    async () => {
      await setDoc(doc(db, "settings", "treinos"), { modalidades: normalized }, { merge: true });
      return { ok: true };
    }
  );

  modalidadesCache = { cachedAt: Date.now(), value: normalized };
  setSessionCachedModalidades(normalized);
}

export async function fetchTreinosAdminList(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<TreinoRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_TREINOS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinosAdminCache, cacheKey);
    if (cached) return cached;
  }

  let rows: TreinoRecord[] = [];
  try {
    const q = query(collection(db, "treinos"), orderBy("dia", "desc"), limit(maxResults));
    const snap = await getDocs(q);
    rows = snap.docs
      .map((entry) => normalizeTreino(entry.id, entry.data()))
      .filter((entry): entry is TreinoRecord => entry !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) throw error;

    const fallbackQ = query(collection(db, "treinos"), limit(maxResults));
    const fallbackSnap = await getDocs(fallbackQ);
    rows = sortTreinosByDateDesc(
      fallbackSnap.docs
        .map((entry) => normalizeTreino(entry.id, entry.data()))
        .filter((entry): entry is TreinoRecord => entry !== null)
    );
  }

  setMapCachedValue(treinosAdminCache, cacheKey, rows);
  return rows;
}

export async function fetchTreinosByDateRange(payload: {
  startDate: string;
  endDate: string;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<TreinoRecord[]> {
  const startDate = payload.startDate.trim().slice(0, 10);
  const endDate = payload.endDate.trim().slice(0, 10);
  if (!startDate || !endDate) return [];

  const maxResults = boundedLimit(payload.maxResults ?? 120, MAX_MONTH_RESULTS);
  const forceRefresh = payload.forceRefresh ?? false;
  const cacheKey = `${startDate}:${endDate}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinosByMonthCache, cacheKey);
    if (cached) return cached;
  }

  let rows: TreinoRecord[] = [];
  try {
    const q = query(
      collection(db, "treinos"),
      where("dia", ">=", startDate),
      where("dia", "<=", endDate),
      orderBy("dia", "asc"),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    rows = snap.docs
      .map((entry) => normalizeTreino(entry.id, entry.data()))
      .filter((entry): entry is TreinoRecord => entry !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) throw error;
    const fallbackRows = await fetchTreinosAdminList({ maxResults, forceRefresh });
    rows = fallbackRows
      .filter((entry) => entry.dia >= startDate && entry.dia <= endDate)
      .sort((left, right) => parseDateValue(left.dia) - parseDateValue(right.dia));
  }

  setMapCachedValue(treinosByMonthCache, cacheKey, rows);
  return rows;
}

export async function fetchTreinoById(
  treinoId: string,
  options?: { forceRefresh?: boolean }
): Promise<TreinoRecord | null> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cached = getMapCachedValue(treinoByIdCache, cleanTreinoId);
    if (cached !== null) return cached;
  }

  const snap = await getDoc(doc(db, "treinos", cleanTreinoId));
  if (!snap.exists()) {
    setMapCachedValue(treinoByIdCache, cleanTreinoId, null);
    return null;
  }

  const normalized = normalizeTreino(snap.id, snap.data());
  const value = normalized ?? null;
  setMapCachedValue(treinoByIdCache, cleanTreinoId, value);
  return value;
}

export async function fetchTreinoRsvps(
  treinoId: string,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<TreinoRsvpRecord[]> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_RSVP_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanTreinoId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinoRsvpsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "treinos", cleanTreinoId, "rsvps"), limit(maxResults));
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((entry) => normalizeRsvp(entry.data()))
    .filter((entry): entry is TreinoRsvpRecord => entry !== null);

  setMapCachedValue(treinoRsvpsCache, cacheKey, rows);
  return rows;
}

export async function fetchTreinoRsvpsPage(
  treinoId: string,
  options?: {
    pageSize?: number;
    cursorId?: string | null;
    forceRefresh?: boolean;
  }
): Promise<TreinoParticipantsPage<TreinoRsvpRecord>> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options?.pageSize ?? 10, MAX_RSVP_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanTreinoId}:${pageSize}:${cursorId || "first"}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinoRsvpsPageCache, cacheKey);
    if (cached) return cached;
  }

  const constraints: QueryConstraint[] = [limit(pageSize + 1)];
  if (cursorId) {
    const cursorSnap = await getDoc(doc(db, "treinos", cleanTreinoId, "rsvps", cursorId));
    if (cursorSnap.exists()) {
      constraints.splice(0, 0, startAfter(cursorSnap));
    }
  }

  const snap = await getDocs(
    query(collection(db, "treinos", cleanTreinoId, "rsvps"), ...constraints)
  );
  const docs = snap.docs.slice(0, pageSize);
  const rows = docs
    .map((entry) => normalizeRsvp(entry.data()))
    .filter((entry): entry is TreinoRsvpRecord => entry !== null);

  const result: TreinoParticipantsPage<TreinoRsvpRecord> = {
    rows,
    hasMore: snap.docs.length > pageSize,
    nextCursor: docs.length ? docs[docs.length - 1].id : null,
  };
  setMapCachedValue(treinoRsvpsPageCache, cacheKey, result);
  return result;
}

export async function fetchTreinoChamada(
  treinoId: string,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<TreinoChamadaRecord[]> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_CHAMADA_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanTreinoId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinoChamadaCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "treinos", cleanTreinoId, "chamada"), limit(maxResults));
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((entry) => normalizeChamada(entry.id, entry.data()))
    .filter((entry): entry is TreinoChamadaRecord => entry !== null);

  setMapCachedValue(treinoChamadaCache, cacheKey, rows);
  return rows;
}

export async function fetchTreinoChamadaPage(
  treinoId: string,
  options?: {
    pageSize?: number;
    cursorId?: string | null;
    forceRefresh?: boolean;
  }
): Promise<TreinoParticipantsPage<TreinoChamadaRecord>> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options?.pageSize ?? 10, MAX_CHAMADA_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanTreinoId}:${pageSize}:${cursorId || "first"}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(treinoChamadaPageCache, cacheKey);
    if (cached) return cached;
  }

  const constraints: QueryConstraint[] = [limit(pageSize + 1)];
  if (cursorId) {
    const cursorSnap = await getDoc(doc(db, "treinos", cleanTreinoId, "chamada", cursorId));
    if (cursorSnap.exists()) {
      constraints.splice(0, 0, startAfter(cursorSnap));
    }
  }

  const snap = await getDocs(
    query(collection(db, "treinos", cleanTreinoId, "chamada"), ...constraints)
  );
  const docs = snap.docs.slice(0, pageSize);
  const rows = docs
    .map((entry) => normalizeChamada(entry.id, entry.data()))
    .filter((entry): entry is TreinoChamadaRecord => entry !== null);

  const result: TreinoParticipantsPage<TreinoChamadaRecord> = {
    rows,
    hasMore: snap.docs.length > pageSize,
    nextCursor: docs.length ? docs[docs.length - 1].id : null,
  };
  setMapCachedValue(treinoChamadaPageCache, cacheKey, result);
  return result;
}

export async function fetchUserDirectory(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<TreinoUserDirectoryItem[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 320, MAX_USERS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCachedValue(userDirectoryCache, cacheKey);
    if (cached) return cached;
  }

  let rows: TreinoUserDirectoryItem[] = [];
  try {
    const q = query(collection(db, "users"), orderBy("nome", "asc"), limit(maxResults));
    const snap = await getDocs(q);
    rows = snap.docs
      .map((entry) => normalizeUserDirectoryEntry(entry.id, entry.data()))
      .filter((entry): entry is TreinoUserDirectoryItem => entry !== null);
  } catch (error: unknown) {
    if (!isIndexRequiredError(error)) throw error;
    const fallbackQ = query(collection(db, "users"), limit(maxResults));
    const fallbackSnap = await getDocs(fallbackQ);
    rows = fallbackSnap.docs
      .map((entry) => normalizeUserDirectoryEntry(entry.id, entry.data()))
      .filter((entry): entry is TreinoUserDirectoryItem => entry !== null)
      .sort((left, right) => left.nome.localeCompare(right.nome));
  }

  setMapCachedValue(userDirectoryCache, cacheKey, rows);
  return rows;
}

export async function fetchTreinoDashboardMetrics(payload: {
  treinos: TreinoRecord[];
  maxRankingTreinos?: number;
  maxGhostTreinos?: number;
  formatDate?: (isoDate: string) => string;
}): Promise<TreinoDashboardMetrics> {
  const maxRankingTreinos = boundedLimit(payload.maxRankingTreinos ?? 20, 50);
  const maxGhostTreinos = boundedLimit(payload.maxGhostTreinos ?? 5, 12);
  const formatDate = payload.formatDate ?? ((isoDate: string) => isoDate);

  const pastTreinos = sortTreinosByDateDesc(payload.treinos).filter((entry) => {
    const millis = parseDateValue(entry.dia);
    if (millis <= 0) return false;
    return millis < Date.now();
  });

  const rankingTreinos = pastTreinos.slice(0, maxRankingTreinos);
  const ghostTreinos = pastTreinos.slice(0, maxGhostTreinos);

  const rankingMap: Record<string, Record<string, TreinoRankingItem>> = {};

  const chamadasPorTreino = await Promise.all(
    rankingTreinos.map(async (treino) => ({
      treino,
      chamada: await fetchTreinoChamada(treino.id, { maxResults: 200 }),
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
    rankings[modalidade] = Object.values(ranking).sort((left, right) => right.count - left.count);
  });

  const vergonhaRows = await Promise.all(
    ghostTreinos.map(async (treino) => {
      const [rsvps, chamada] = await Promise.all([
        fetchTreinoRsvps(treino.id, { maxResults: 220 }),
        fetchTreinoChamada(treino.id, { maxResults: 220 }),
      ]);

      const presentesIds = new Set(
        chamada.filter((entry) => entry.status === "presente").map((entry) => entry.userId)
      );

      const ghosts: TreinoGhostItem[] = [];
      rsvps.forEach((entry) => {
        if (entry.status !== "going") return;
        if (presentesIds.has(entry.userId)) return;
        ghosts.push({
          id: `${treino.id}:${entry.userId}`,
          nome: entry.userName,
          avatar: entry.userAvatar,
          turma: entry.userTurma,
          treinoData: formatDate(treino.dia),
          treinoMod: treino.modalidade,
        });
      });

      return ghosts;
    })
  );

  return {
    rankings,
    listaVergonha: vergonhaRows.flat().slice(0, 120),
  };
}

export async function upsertTreino(payload: {
  id?: string;
  data: Partial<TreinoRecord>;
}): Promise<{ id: string }> {
  const cleanId = payload.id?.trim() || "";
  const baseData = normalizeTreinoPayload(payload.data);
  if (!baseData.dia || !baseData.modalidade) {
    throw new Error("Dados invalidos para treino.");
  }

  const diaObj = new Date(`${baseData.dia}T12:00:00`);
  const normalizedData = normalizeTreinoPayload(
    baseData,
    getDayLabel(diaObj),
    getDayOrder(diaObj)
  );

  const requestPayload = {
    id: cleanId,
    data: normalizedData,
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    TREINO_UPSERT_CALLABLE,
    requestPayload,
    async () => {
      if (cleanId) {
        await updateDoc(doc(db, "treinos", cleanId), {
          ...normalizedData,
          updatedAt: serverTimestamp(),
        });
        return { id: cleanId };
      }

      const ref = await addDoc(collection(db, "treinos"), {
        ...normalizedData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { id: ref.id };
    }
  );

  clearTreinoReadCaches();
  return result;
}

export async function createRecurringTreinos(payload: {
  data: Partial<TreinoRecord>;
  startDate: string;
  endDate: string;
}): Promise<{ count: number }> {
  const startDate = payload.startDate.trim().slice(0, 10);
  const endDate = payload.endDate.trim().slice(0, 10);
  if (!startDate || !endDate) return { count: 0 };

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { count: 0 };
  }

  const baseData = normalizeTreinoPayload(payload.data);
  const requestPayload = {
    data: baseData,
    startDate,
    endDate,
  };

  const result = await callWithFallback<typeof requestPayload, { count: number }>(
    TREINO_RECURRING_CALLABLE,
    requestPayload,
    async () => {
      const batch = writeBatch(db);
      const current = new Date(start);
      let created = 0;

      while (current <= end && created < MAX_RECURRING_WEEKS) {
        const dia = createIsoDate(current);
        const payloadByDay = normalizeTreinoPayload(
          { ...baseData, dia },
          getDayLabel(current),
          getDayOrder(current)
        );

        const ref = doc(collection(db, "treinos"));
        batch.set(ref, {
          ...payloadByDay,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        current.setDate(current.getDate() + 7);
        created += 1;
      }

      if (created > 0) {
        await batch.commit();
      }

      return { count: created };
    }
  );

  clearTreinoReadCaches();
  return result;
}

export async function toggleTreinoStatus(payload: {
  treinoId: string;
  status: "ativo" | "cancelado";
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  if (!treinoId) return;

  const status = normalizeStatus(payload.status);
  const requestPayload = { treinoId, status };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    TREINO_TOGGLE_STATUS_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "treinos", treinoId), {
        status,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  clearTreinoReadCaches();
}

export async function deleteTreino(treinoId: string): Promise<void> {
  const cleanTreinoId = treinoId.trim();
  if (!cleanTreinoId) return;

  await callWithFallback<{ treinoId: string }, { ok: boolean }>(
    TREINO_DELETE_CALLABLE,
    { treinoId: cleanTreinoId },
    async () => {
      await deleteDoc(doc(db, "treinos", cleanTreinoId));
      return { ok: true };
    }
  );

  clearTreinoReadCaches();
}

export async function setTreinoRsvp(payload: {
  treinoId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "not_going";
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const userId = payload.userId.trim();
  if (!treinoId || !userId) return;

  const status: "going" | "not_going" = payload.status === "not_going" ? "not_going" : "going";
  const requestPayload = {
    treinoId,
    userId,
    userName: payload.userName.trim().slice(0, 120) || "Atleta",
    userAvatar: payload.userAvatar.trim().slice(0, 2000),
    userTurma: payload.userTurma.trim().slice(0, 30) || "Geral",
    status,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    TREINO_RSVP_CALLABLE,
    requestPayload,
    async () => {
      await runTransaction(db, async (tx) => {
        const rsvpRef = doc(db, "treinos", treinoId, "rsvps", userId);
        const treinoRef = doc(db, "treinos", treinoId);

        if (status === "not_going") {
          tx.delete(rsvpRef);
          tx.update(treinoRef, { confirmados: arrayRemove(userId), updatedAt: serverTimestamp() });
          return;
        }

        tx.set(rsvpRef, {
          userId,
          userName: requestPayload.userName,
          userAvatar: requestPayload.userAvatar,
          userTurma: requestPayload.userTurma,
          status: "going",
          timestamp: serverTimestamp(),
        });
        tx.update(treinoRef, { confirmados: arrayUnion(userId), updatedAt: serverTimestamp() });
      });

      return { ok: true };
    }
  );

  treinoRsvpsCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoRsvpsCache.delete(key);
    }
  });
  clearTreinoParticipantsPageCaches(treinoId);
  treinoByIdCache.delete(treinoId);
  treinosAdminCache.clear();
  treinosByMonthCache.clear();
}

export async function upsertChamadaPresence(payload: {
  treinoId: string;
  userId: string;
  nome: string;
  turma: string;
  avatar: string;
  origem: "app" | "manual";
  status?: "presente" | "falta" | "justificado";
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const userId = payload.userId.trim();
  if (!treinoId || !userId) return;

  const requestPayload = {
    treinoId,
    userId,
    nome: payload.nome.trim().slice(0, 120) || "Aluno",
    turma: payload.turma.trim().slice(0, 30) || "Geral",
    avatar: payload.avatar.trim().slice(0, 2000),
    origem: payload.origem,
    status: payload.status ?? "presente",
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    TREINO_CHAMADA_UPSERT_CALLABLE,
    requestPayload,
    async () => {
      await setDoc(doc(db, "treinos", treinoId, "chamada", userId), {
        userId,
        nome: requestPayload.nome,
        turma: requestPayload.turma,
        avatar: requestPayload.avatar,
        status: requestPayload.status,
        origem: requestPayload.origem,
        timestamp: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  treinoChamadaCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoChamadaCache.delete(key);
    }
  });
  clearTreinoParticipantsPageCaches(treinoId);
}

export async function updateChamadaStatus(payload: {
  treinoId: string;
  chamadaId: string;
  status: "presente" | "falta" | "justificado";
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const chamadaId = payload.chamadaId.trim();
  if (!treinoId || !chamadaId) return;

  const requestPayload = {
    treinoId,
    chamadaId,
    status: payload.status,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    TREINO_CHAMADA_STATUS_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "treinos", treinoId, "chamada", chamadaId), {
        status: requestPayload.status,
      });
      return { ok: true };
    }
  );

  treinoChamadaCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoChamadaCache.delete(key);
    }
  });
  clearTreinoParticipantsPageCaches(treinoId);
}

export async function deleteChamadaEntry(payload: {
  treinoId: string;
  chamadaId: string;
}): Promise<void> {
  const treinoId = payload.treinoId.trim();
  const chamadaId = payload.chamadaId.trim();
  if (!treinoId || !chamadaId) return;

  const requestPayload = { treinoId, chamadaId };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    TREINO_CHAMADA_DELETE_CALLABLE,
    requestPayload,
    async () => {
      await deleteDoc(doc(db, "treinos", treinoId, "chamada", chamadaId));
      return { ok: true };
    }
  );

  treinoChamadaCache.forEach((_, key) => {
    if (key.startsWith(`${treinoId}:`)) {
      treinoChamadaCache.delete(key);
    }
  });
  clearTreinoParticipantsPageCaches(treinoId);
}

export async function addUserToChamada(payload: {
  treinoId: string;
  user: TreinoUserDirectoryItem;
}): Promise<void> {
  await upsertChamadaPresence({
    treinoId: payload.treinoId,
    userId: payload.user.uid,
    nome: payload.user.nome,
    turma: payload.user.turma || "Geral",
    avatar: payload.user.foto || "",
    origem: "manual",
    status: "presente",
  });
}

export function clearTreinosServiceCaches(): void {
  clearTreinoReadCaches();
  userDirectoryCache.clear();
  modalidadesCache = null;
}



