import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;

const MAX_LEAGUE_RESULTS = 80;
const MAX_USER_RESULTS = 200;
const MAX_POLL_RESULTS = 60;

const LEAGUE_SAVE_CALLABLE = "leagueAdminSaveConfig";
const LEAGUE_DELETE_CALLABLE = "leagueAdminDeleteConfig";
const LEAGUE_VISIBILITY_CALLABLE = "leagueAdminToggleVisibility";
const LEAGUE_LIKE_CALLABLE = "leagueToggleLike";
const LEAGUE_POLL_CREATE_CALLABLE = "leaguePollCreate";
const LEAGUE_POLL_DELETE_CALLABLE = "leaguePollDelete";
const LEAGUE_POLL_UPDATE_CALLABLE = "leaguePollUpdateOptions";
const LEAGUE_QUIZ_CALLABLE = "leagueRegisterQuizResult";

const leaguesCache = new Map<string, CacheEntry<LeagueRecord[]>>();
const usersCache = new Map<string, CacheEntry<LeagueUserRecord[]>>();
const leagueByIdCache = new Map<string, CacheEntry<LeagueRecord | null>>();
const pollsCache = new Map<string, CacheEntry<LeaguePollRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCacheValue = <T>(
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

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearLeagueCaches = (): void => {
  leaguesCache.clear();
  leagueByIdCache.clear();
  pollsCache.clear();
};

const clearUsersCache = (): void => {
  usersCache.clear();
};

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
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

export interface LeagueQuestionRecord {
  id: string;
  texto: string;
  imagemBase64?: string;
  alternativas: string[];
  correta: number;
}

export interface LeagueMemberRecord {
  id: string;
  nome: string;
  cargo: string;
  foto: string;
  linkPerfil?: string;
}

export interface LeagueLoteRecord {
  id: number;
  nome: string;
  preco: string;
  status: "ativo" | "encerrado" | "agendado";
}

export interface LeagueEventRecord {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  tipo: string;
  destaque: string;
  imagem: string;
  imagePositionY: number;
  lotes: LeagueLoteRecord[];
  descricao: string;
  linkEvento?: string;
  globalEventId?: string;
  pollQuestion?: string;
}

export interface LeagueRecord {
  id: string;
  nome: string;
  sigla: string;
  presidente: string;
  descricao: string;
  senha: string;
  foto: string;
  logoBase64?: string;
  visivel?: boolean;
  ativa?: boolean;
  membros: LeagueMemberRecord[];
  eventos: LeagueEventRecord[];
  perguntas: LeagueQuestionRecord[];
  bizu: string;
  likes: number;
  membrosIds?: string[];
}

export interface LeagueUserRecord {
  id: string;
  nome?: string;
  foto?: string;
  turma?: string;
}

export interface LeaguePollOptionRecord {
  text: string;
  votes: number;
  creator?: string;
  creatorName?: string;
  creatorAvatar?: string;
}

export interface LeaguePollRecord {
  id: string;
  question: string;
  options: LeaguePollOptionRecord[];
  allowUserOptions: boolean;
  voters: string[];
}

const normalizeLeague = (id: string, raw: unknown): LeagueRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const membros = Array.isArray(data.membros)
    ? data.membros
        .map((row) => {
          const member = asObject(row);
          if (!member) return null;
          const linkPerfil = asString(member.linkPerfil) || undefined;
          return {
            id: asString(member.id),
            nome: asString(member.nome, "Sem nome"),
            cargo: asString(member.cargo, "Membro"),
            foto: asString(member.foto),
            ...(linkPerfil ? { linkPerfil } : {}),
          } as LeagueMemberRecord;
        })
        .filter((row): row is LeagueMemberRecord => row !== null)
    : [];

  const perguntas = Array.isArray(data.perguntas)
    ? data.perguntas
        .map((row) => {
          const question = asObject(row);
          if (!question) return null;
          const alternatives = Array.isArray(question.alternativas)
            ? question.alternativas.filter(
                (item): item is string => typeof item === "string"
              )
            : [];
          const imagemBase64 = asString(question.imagemBase64) || undefined;
          return {
            id: asString(question.id),
            texto: asString(question.texto),
            ...(imagemBase64 ? { imagemBase64 } : {}),
            alternativas: alternatives.slice(0, 4),
            correta: Math.max(0, Math.min(3, asNumber(question.correta, 0))),
          } as LeagueQuestionRecord;
        })
        .filter((row): row is LeagueQuestionRecord => row !== null)
    : [];

  const eventos = Array.isArray(data.eventos)
    ? data.eventos
        .map((row) => {
          const event = asObject(row);
          if (!event) return null;
          const lotes = Array.isArray(event.lotes)
            ? event.lotes
                .map((entry) => {
                  const lote = asObject(entry);
                  if (!lote) return null;
                  const statusRaw = asString(lote.status, "ativo");
                  const status: "ativo" | "encerrado" | "agendado" =
                    statusRaw === "encerrado" || statusRaw === "agendado"
                      ? statusRaw
                      : "ativo";
                  return {
                    id: asNumber(lote.id, Date.now()),
                    nome: asString(lote.nome),
                    preco: asString(lote.preco),
                    status,
                  } satisfies LeagueLoteRecord;
                })
                .filter((entry): entry is LeagueLoteRecord => entry !== null)
            : [];

          const linkEvento = asString(event.linkEvento) || undefined;
          const globalEventId = asString(event.globalEventId) || undefined;
          const pollQuestion = asString(event.pollQuestion) || undefined;

          return {
            id: asString(event.id),
            titulo: asString(event.titulo),
            data: asString(event.data),
            hora: asString(event.hora),
            local: asString(event.local),
            tipo: asString(event.tipo),
            destaque: asString(event.destaque),
            imagem: asString(event.imagem),
            imagePositionY: asNumber(event.imagePositionY, 50),
            lotes,
            descricao: asString(event.descricao),
            ...(linkEvento ? { linkEvento } : {}),
            ...(globalEventId ? { globalEventId } : {}),
            ...(pollQuestion ? { pollQuestion } : {}),
          } as LeagueEventRecord;
        })
        .filter((row): row is LeagueEventRecord => row !== null)
    : [];

  const membrosIds = Array.isArray(data.membrosIds)
    ? data.membrosIds.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    presidente: asString(data.presidente),
    descricao: asString(data.descricao),
    senha: asString(data.senha),
    foto: asString(data.foto),
    logoBase64: asString(data.logoBase64) || undefined,
    visivel: asBoolean(data.visivel, false),
    ativa: asBoolean(data.ativa, false),
    membros,
    eventos,
    perguntas,
    bizu: asString(data.bizu),
    likes: Math.max(0, asNumber(data.likes, 0)),
    membrosIds,
  };
};

const normalizeLeagueUser = (id: string, raw: unknown): LeagueUserRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome) || undefined,
    foto: asString(data.foto) || undefined,
    turma: asString(data.turma) || undefined,
  };
};

const normalizePoll = (id: string, raw: unknown): LeaguePollRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const options = Array.isArray(data.options)
    ? data.options
        .map((row) => {
          const option = asObject(row);
          if (!option) return null;
          const creator = asString(option.creator) || undefined;
          const creatorName = asString(option.creatorName) || undefined;
          const creatorAvatar = asString(option.creatorAvatar) || undefined;
          return {
            text: asString(option.text, "Opcao"),
            votes: Math.max(0, asNumber(option.votes, 0)),
            ...(creator ? { creator } : {}),
            ...(creatorName ? { creatorName } : {}),
            ...(creatorAvatar ? { creatorAvatar } : {}),
          } as LeaguePollOptionRecord;
        })
        .filter((row): row is LeaguePollOptionRecord => row !== null)
    : [];

  return {
    id,
    question: asString(data.question, "Enquete"),
    options,
    allowUserOptions: asBoolean(data.allowUserOptions, true),
    voters: Array.isArray(data.voters)
      ? data.voters.filter((item): item is string => typeof item === "string")
      : [],
  };
};

const normalizeLeaguePayload = (
  payload: Partial<LeagueRecord>
): Record<string, unknown> => ({
  nome: asString(payload.nome, "Liga").trim().slice(0, 120),
  sigla: asString(payload.sigla).trim().slice(0, 20),
  presidente: asString(payload.presidente).trim().slice(0, 120),
  descricao: asString(payload.descricao).slice(0, 4_000),
  senha: asString(payload.senha).slice(0, 120),
  foto: asString(payload.foto),
  logoBase64: asString(payload.logoBase64) || undefined,
  visivel: Boolean(payload.visivel),
  ativa: Boolean(payload.ativa),
  membros: Array.isArray(payload.membros) ? payload.membros : [],
  eventos: Array.isArray(payload.eventos) ? payload.eventos : [],
  perguntas: Array.isArray(payload.perguntas) ? payload.perguntas : [],
  bizu: asString(payload.bizu).slice(0, 500),
  likes: Math.max(0, asNumber(payload.likes, 0)),
  membrosIds: Array.isArray(payload.membrosIds)
    ? payload.membrosIds.filter((item): item is string => typeof item === "string")
    : undefined,
});

export async function fetchLeagues(options?: {
  orderByField?: "nome" | "likes";
  orderDirection?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<LeagueRecord[]> {
  const orderByField = options?.orderByField ?? "nome";
  const orderDirection = options?.orderDirection ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${orderByField}:${orderDirection}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(leaguesCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "ligas_config"),
    orderBy(orderByField, orderDirection),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const leagues = snap.docs
    .map((row) => normalizeLeague(row.id, row.data()))
    .filter((row): row is LeagueRecord => row !== null);

  setCacheValue(leaguesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchLeagueById(
  leagueId: string,
  options?: { forceRefresh?: boolean }
): Promise<LeagueRecord | null> {
  const cleanId = leagueId.trim();
  if (!cleanId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cached = getCacheValue(leagueByIdCache, cleanId);
    if (cached !== null) return cached;
  }

  const snap = await getDoc(doc(db, "ligas_config", cleanId));
  if (!snap.exists()) {
    setCacheValue(leagueByIdCache, cleanId, null);
    return null;
  }

  const league = normalizeLeague(snap.id, snap.data());
  setCacheValue(leagueByIdCache, cleanId, league);
  return league;
}

export async function fetchLeagueUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<LeagueUserRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 120, MAX_USER_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(usersCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "users"), limit(maxResults));
  const snap = await getDocs(q);
  const users = snap.docs
    .map((row) => normalizeLeagueUser(row.id, row.data()))
    .filter((row): row is LeagueUserRecord => row !== null)
    .sort((left, right) =>
      (left.nome || "").localeCompare(right.nome || "", "pt-BR")
    );

  setCacheValue(usersCache, cacheKey, users);
  return users;
}

export async function saveLeagueConfig(payload: {
  id?: string;
  data: Partial<LeagueRecord>;
}): Promise<{ id: string }> {
  const normalizedData = normalizeLeaguePayload(payload.data);
  const id = payload.id?.trim() || "";
  const requestPayload = { id, data: normalizedData };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_SAVE_CALLABLE,
    requestPayload,
    async () => {
      if (id) {
        await updateDoc(doc(db, "ligas_config", id), {
          ...normalizedData,
          updatedAt: serverTimestamp(),
        });
        return { id };
      }

      const ref = await addDoc(collection(db, "ligas_config"), {
        ...normalizedData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { id: ref.id };
    }
  );

  clearLeagueCaches();
  return result;
}

export async function deleteLeagueConfig(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    LEAGUE_DELETE_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "ligas_config", cleanId));
      return { ok: true };
    }
  );

  clearLeagueCaches();
}

export async function setLeagueVisibility(payload: {
  id: string;
  visivel: boolean;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;

  const requestPayload = { id: cleanId, visivel: payload.visivel };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_VISIBILITY_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "ligas_config", cleanId), {
        visivel: payload.visivel,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  clearLeagueCaches();
}

export async function changeLeagueLikeCount(payload: {
  id: string;
  delta: 1 | -1;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_LIKE_CALLABLE,
    payload,
    async () => {
      await updateDoc(doc(db, "ligas_config", cleanId), {
        likes: increment(payload.delta),
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  clearLeagueCaches();
}

export async function fetchEventPolls(
  eventId: string,
  options?: { maxResults?: number; forceRefresh?: boolean }
): Promise<LeaguePollRecord[]> {
  const cleanEventId = eventId.trim();
  if (!cleanEventId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_POLL_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${cleanEventId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(pollsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(collection(db, "eventos", cleanEventId, "enquetes"), limit(maxResults));
  const snap = await getDocs(q);
  const polls = snap.docs
    .map((row) => normalizePoll(row.id, row.data()))
    .filter((row): row is LeaguePollRecord => row !== null);

  setCacheValue(pollsCache, cacheKey, polls);
  return polls;
}

export async function createEventPoll(payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
  creatorId?: string;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) throw new Error("Evento inválido.");

  const requestPayload = {
    eventId,
    question: payload.question.trim().slice(0, 280),
    allowUserOptions: payload.allowUserOptions,
    creatorId: payload.creatorId?.trim() || "",
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_POLL_CREATE_CALLABLE,
    requestPayload,
    async () => {
      const ref = await addDoc(collection(db, "eventos", eventId, "enquetes"), {
        question: requestPayload.question,
        allowUserOptions: requestPayload.allowUserOptions,
        options: [],
        voters: [],
        createdAt: serverTimestamp(),
        creatorId: requestPayload.creatorId || null,
        isOfficial: true,
      });
      return { id: ref.id };
    }
  );

  pollsCache.clear();
  return result;
}

export async function deleteEventPoll(payload: {
  eventId: string;
  pollId: string;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_POLL_DELETE_CALLABLE,
    payload,
    async () => {
      await deleteDoc(doc(db, "eventos", eventId, "enquetes", pollId));
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function updateEventPollOptions(payload: {
  eventId: string;
  pollId: string;
  options: LeaguePollOptionRecord[];
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;

  const normalizedOptions = payload.options.slice(0, 80).map((option) => ({
    text: option.text.slice(0, 120),
    votes: Math.max(0, option.votes),
    creator: option.creator || undefined,
    creatorName: option.creatorName || undefined,
    creatorAvatar: option.creatorAvatar || undefined,
  }));

  const requestPayload = { ...payload, options: normalizedOptions };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_POLL_UPDATE_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "eventos", eventId, "enquetes", pollId), {
        options: normalizedOptions,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function addLeagueQuizHistory(payload: {
  userId: string;
  topMatch: string;
  keywords: string[];
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const requestPayload = {
    userId,
    topMatch: payload.topMatch.trim().slice(0, 120),
    keywords: payload.keywords
      .filter((item): item is string => typeof item === "string")
      .slice(0, 60),
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_QUIZ_CALLABLE,
    requestPayload,
    async () => {
      await addDoc(collection(db, "users", userId, "quiz_history"), {
        date: serverTimestamp(),
        topMatch: requestPayload.topMatch,
        keywords: requestPayload.keywords,
      });
      return { ok: true };
    }
  );

  clearUsersCache();
}
