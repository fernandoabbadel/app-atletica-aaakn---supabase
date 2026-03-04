import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const MAX_USERS_RESULTS = 520;
const MAX_POST_RESULTS = 24;
const MAX_ORDER_RESULTS = 48;
const MAX_ACHIEVEMENT_RESULTS = 80;
const MAX_MATCH_RESULTS = 24;
const MAX_GYM_RESULTS = 40;

const ADMIN_USERS_UPDATE_CALLABLE = "adminUsersUpdateProfile";
const ADMIN_USERS_STATUS_CALLABLE = "adminUsersSetStatus";
const ADMIN_USERS_DELETE_CALLABLE = "adminUsersDelete";

const usersListCache = new Map<string, CacheEntry<AdminUserListItem[]>>();
const userProfileCache = new Map<string, CacheEntry<AdminUserProfileRecord | null>>();
const userDossierCache = new Map<string, CacheEntry<AdminUserDossier | null>>();
const usersPageInflight = new Map<string, Promise<AdminUsersPageResult>>();
const userProfileInflight = new Map<string, Promise<AdminUserProfileRecord | null>>();
const userDossierInflight = new Map<string, Promise<AdminUserDossier | null>>();

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

const getCachedValue = <T>(
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

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

async function callCallable<TReq, TRes>(
  callableName: string,
  payload: TReq
): Promise<TRes> {
  const callable = httpsCallable<TReq, TRes>(functions, callableName);
  const response = await callable(payload);
  return response.data;
}

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

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const isMissingTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown };
  if (typeof raw.code === "string" && raw.code === "42P01") return true;
  const message = asString(raw.message).toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
};

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter((column) => column.toLowerCase() !== missingColumn.toLowerCase());
  if (next.length === columns.length) return null;
  return next;
};

const nowIso = (): string => new Date().toISOString();

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const obj = asObject(value);
  const toDate = obj?.toDate;
  if (typeof toDate === "function") {
    const result = toDate.call(value) as Date;
    if (result instanceof Date) return result.getTime();
  }
  return 0;
};

const sortRowsByFieldDesc = <T extends Record<string, unknown>>(
  rows: T[],
  field: string
): T[] =>
  [...rows].sort((left, right) => toMillis(right[field]) - toMillis(left[field]));

const rowIdFromUnknown = (row: unknown, fallback = ""): string => {
  const obj = asObject(row);
  if (!obj) return fallback;
  return asString(obj.uid, asString(obj.id, fallback));
};

async function callCallableWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  if (!shouldUseCallable()) {
    return fallbackFn();
  }

  try {
    return await callCallable<TReq, TRes>(callableName, payload);
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

const clearAdminUsersCache = (): void => {
  usersListCache.clear();
  userProfileCache.clear();
  userDossierCache.clear();
  usersPageInflight.clear();
  userProfileInflight.clear();
  userDossierInflight.clear();
};

const USER_RELATED_TABLE_SELECT_COLUMNS: Record<string, string[]> = {
  posts: ["id", "userId", "texto", "likes", "comentarios", "createdAt"],
  store_orders: ["id", "userId", "itens", "total", "status", "createdAt"],
  orders: ["id", "userId", "itens", "total", "status", "createdAt"],
  achievements_logs: ["id", "userId", "achievementTitle", "timestamp"],
  arena_matches: ["id", "userId", "game", "result", "date"],
  gym_logs: ["id", "userId", "local", "date"],
};

const getUserRelatedSelectColumns = (tableName: string): string[] =>
  [...(USER_RELATED_TABLE_SELECT_COLUMNS[tableName] ?? ["id", "userId"])];

const updateUserWithColumnFallback = async (
  userId: string,
  patch: Record<string, unknown>
): Promise<void> => {
  const supabase = getSupabaseClient();
  const mutablePatch = { ...patch };

  while (Object.keys(mutablePatch).length > 0) {
    const { error } = await supabase
      .from("users")
      .update(mutablePatch)
      .eq("uid", userId);
    if (!error) return;

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const removableKey = Object.keys(mutablePatch).find(
      (key) => key.toLowerCase() === missingColumn.toLowerCase()
    );
    if (!removableKey) throwSupabaseError(error);
    delete mutablePatch[String(removableKey)];
  }
};

const fetchTableRowsForUser = async (
  tableName: string,
  userId: string,
  options: { limit: number; orderField?: string; ignoreMissingTable?: boolean }
): Promise<Record<string, unknown>[]> => {
  const supabase = getSupabaseClient();
  let selectColumns = getUserRelatedSelectColumns(tableName);
  let canOrder = Boolean(options.orderField);

  while (selectColumns.length > 0) {
    let request = supabase
      .from(tableName)
      .select(selectColumns.join(","))
      .eq("userId", userId)
      .limit(options.limit);

    if (canOrder && options.orderField) {
      request = request.order(options.orderField, { ascending: false });
    }

    const { data, error } = await request;
    if (!error) {
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      return rows.map((row) => ({ ...row }));
    }

    if (options.ignoreMissingTable && isMissingTableError(error)) {
      return [];
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (missingColumn) {
      if (
        canOrder &&
        options.orderField &&
        missingColumn.toLowerCase() === options.orderField.toLowerCase()
      ) {
        canOrder = false;
        continue;
      }

      const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn);
      if (nextColumns && nextColumns.length > 0) {
        selectColumns = nextColumns;
        continue;
      }
    }

    if (canOrder && options.orderField) {
      canOrder = false;
      continue;
    }

    throwSupabaseError(error);
  }

  return [];
};

export interface AdminUserListItem {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  turma: string;
  matricula: string;
  status: "ativo" | "inadimplente" | "pendente" | "bloqueado";
  plano: "lenda" | "atleta" | "cardume" | "bicho";
  foto: string;
  xp: number;
  role: string;
}

export interface AdminUsersPageResult {
  users: AdminUserListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AdminUserProfileRecord {
  id: string;
  nome: string;
  email: string;
  foto?: string;
  matricula?: string;
  turma?: string;
  telefone?: string;
  status: "ativo" | "inadimplente" | "pendente" | "bloqueado";
  level?: number;
  xp?: number;
  sharkCoins?: number;
  plano_badge?: string;
  tier?: string;
  patente?: string;
  createdAt?: unknown;
  role?: string;
  [key: string]: unknown;
}

export interface AdminUserPostRecord {
  id: string;
  texto: string;
  likes: string[];
  comentarios: number;
  createdAt?: unknown;
}

export interface AdminUserOrderRecord {
  id: string;
  itens: number;
  total: number;
  status: string;
  createdAt?: unknown;
}

export interface AdminUserAchievementRecord {
  id: string;
  achievementTitle: string;
  timestamp?: unknown;
}

export interface AdminUserMatchRecord {
  id: string;
  game: string;
  result: "win" | "lose";
}

export interface AdminUserGymRecord {
  id: string;
  local: string;
  date: string;
}

export interface AdminUserDossier {
  user: AdminUserProfileRecord | null;
  posts: AdminUserPostRecord[];
  orders: AdminUserOrderRecord[];
  achievements: AdminUserAchievementRecord[];
  matches: AdminUserMatchRecord[];
  gymLogs: AdminUserGymRecord[];
}

const normalizeAdminUserListItem = (
  id: string,
  raw: unknown
): AdminUserListItem | null => {
  const data = asObject(raw);
  if (!data) return null;

  const statusRaw = asString(data.status, "pendente");
  const status: AdminUserListItem["status"] =
    statusRaw === "ativo" ||
    statusRaw === "inadimplente" ||
    statusRaw === "bloqueado"
      ? statusRaw
      : "pendente";

  const planoRaw = asString(data.tier, "bicho");
  const plano: AdminUserListItem["plano"] =
    planoRaw === "lenda" || planoRaw === "atleta" || planoRaw === "cardume"
      ? planoRaw
      : "bicho";

  return {
    id,
    nome: asString(data.nome, "Sem Nome"),
    email: asString(data.email, "---"),
    telefone: asString(data.telefone),
    turma: asString(data.turma, "---"),
    matricula: asString(data.matricula, "---"),
    status,
    plano,
    foto: asString(data.foto, "https://github.com/shadcn.png"),
    xp: asNumber(data.xp, 0),
    role: asString(data.role, "user"),
  };
};

const normalizeAdminUserProfile = (
  id: string,
  raw: unknown
): AdminUserProfileRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const statusRaw = asString(data.status, "ativo");
  const status: AdminUserProfileRecord["status"] =
    statusRaw === "inadimplente" ||
    statusRaw === "pendente" ||
    statusRaw === "bloqueado"
      ? statusRaw
      : "ativo";

  const role = asString(data.role) || undefined;
  const foto = asString(data.foto) || undefined;

  return {
    id,
    nome: asString(data.nome, "Sem Nome"),
    email: asString(data.email),
    ...(foto ? { foto } : {}),
    matricula: asString(data.matricula) || undefined,
    turma: asString(data.turma) || undefined,
    telefone: asString(data.telefone) || undefined,
    status,
    level: asNumber(data.level, 0) || undefined,
    xp: asNumber(data.xp, 0) || undefined,
    sharkCoins: asNumber(data.sharkCoins, 0) || undefined,
    plano_badge: asString(data.plano_badge) || undefined,
    tier: asString(data.tier) || undefined,
    patente: asString(data.patente) || undefined,
    createdAt: data.createdAt,
    ...(role ? { role } : {}),
  };
};

const normalizePost = (id: string, raw: unknown): AdminUserPostRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    texto: asString(data.texto),
    likes: asStringArray(data.likes),
    comentarios: asNumber(data.comentarios, 0),
    createdAt: data.createdAt,
  };
};

const normalizeOrder = (id: string, raw: unknown): AdminUserOrderRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    itens: asNumber(data.itens, 0),
    total: asNumber(data.total, 0),
    status: asString(data.status, "pendente"),
    createdAt: data.createdAt,
  };
};

const normalizeAchievement = (
  id: string,
  raw: unknown
): AdminUserAchievementRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    achievementTitle: asString(data.achievementTitle, "Conquista"),
    timestamp: data.timestamp,
  };
};

const normalizeMatch = (id: string, raw: unknown): AdminUserMatchRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const resultRaw = asString(data.result, "lose");
  const result: AdminUserMatchRecord["result"] =
    resultRaw === "win" ? "win" : "lose";
  return {
    id,
    game: asString(data.game, "Arena"),
    result,
  };
};

const normalizeGymLog = (id: string, raw: unknown): AdminUserGymRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    local: asString(data.local, "Academia"),
    date: asString(data.date),
  };
};

export async function fetchAdminUsersList(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AdminUserListItem[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 320, MAX_USERS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(usersListCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns = [
    "uid",
    "nome",
    "email",
    "telefone",
    "turma",
    "matricula",
    "status",
    "tier",
    "foto",
    "xp",
    "role",
  ];
  let rows: AdminUserListItem[] = [];

  while (selectColumns.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .select(selectColumns.join(","))
      .order("nome", { ascending: true })
      .limit(maxResults);
    if (!error) {
      rows = (data ?? [])
        .map((row) =>
          normalizeAdminUserListItem(
            rowIdFromUnknown(row),
            row
          )
        )
        .filter((row): row is AdminUserListItem => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCachedValue(usersListCache, cacheKey, rows);
  return rows;
}

export async function fetchAdminUsersPage(options?: {
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminUsersPageResult> {
  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_USERS_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const inflightKey = `${pageSize}:${cursorId || "first"}`;

  if (forceRefresh) {
    clearAdminUsersCache();
  } else {
    const cachedPromise = usersPageInflight.get(inflightKey);
    if (cachedPromise) return cachedPromise;
  }

  const requestPromise = (async () => {
    const allUsers = await fetchAdminUsersList({
      maxResults: MAX_USERS_RESULTS,
      forceRefresh,
    });

    let startIndex = 0;
    if (cursorId) {
      const cursorIndex = allUsers.findIndex((row) => row.id === cursorId);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const users = allUsers.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < allUsers.length;
    const nextCursor = users.length > 0 ? users[users.length - 1].id : null;
    return { users, nextCursor, hasMore };
  })();

  usersPageInflight.set(inflightKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    usersPageInflight.delete(inflightKey);
  }
}

export async function updateAdminUser(payload: {
  userId: string;
  nome: string;
  telefone: string;
  matricula: string;
  turma: string;
  status: "ativo" | "inadimplente" | "pendente" | "bloqueado";
  plano: "lenda" | "atleta" | "cardume" | "bicho";
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const requestPayload = {
    userId,
    nome: payload.nome.trim().slice(0, 120),
    telefone: payload.telefone.trim().slice(0, 30),
    matricula: payload.matricula.trim().slice(0, 40),
    turma: payload.turma.trim().slice(0, 30),
    status: payload.status,
    tier: payload.plano,
  };

  await callCallableWithFallback<typeof requestPayload, { ok: boolean }>(
    ADMIN_USERS_UPDATE_CALLABLE,
    requestPayload,
    async () => {
      await updateUserWithColumnFallback(userId, {
        nome: requestPayload.nome,
        telefone: requestPayload.telefone,
        matricula: requestPayload.matricula,
        turma: requestPayload.turma,
        status: requestPayload.status,
        tier: requestPayload.tier,
        updatedAt: nowIso(),
      });
      return { ok: true };
    }
  );

  clearAdminUsersCache();
}

export async function setAdminUserStatus(payload: {
  userId: string;
  status: "ativo" | "inadimplente" | "pendente" | "bloqueado";
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const requestPayload = { userId, status: payload.status };
  await callCallableWithFallback<typeof requestPayload, { ok: boolean }>(
    ADMIN_USERS_STATUS_CALLABLE,
    requestPayload,
    async () => {
      await updateUserWithColumnFallback(userId, {
        status: requestPayload.status,
        updatedAt: nowIso(),
      });
      return { ok: true };
    }
  );

  clearAdminUsersCache();
}

export async function deleteAdminUser(userIdRaw: string): Promise<void> {
  const userId = userIdRaw.trim();
  if (!userId) return;

  await callCallableWithFallback<{ userId: string }, { ok: boolean }>(
    ADMIN_USERS_DELETE_CALLABLE,
    { userId },
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("users").delete().eq("uid", userId);
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearAdminUsersCache();
}

export async function fetchAdminUserProfile(
  userIdRaw: string,
  options?: { forceRefresh?: boolean }
): Promise<AdminUserProfileRecord | null> {
  const userId = userIdRaw.trim();
  if (!userId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cacheEntry = userProfileCache.get(userId);
    if (cacheEntry) {
      if (Date.now() - cacheEntry.cachedAt <= READ_CACHE_TTL_MS) {
        return cacheEntry.value;
      }
      userProfileCache.delete(userId);
    }

    const pending = userProfileInflight.get(userId);
    if (pending) return pending;
  }

  const requestPromise = (async () => {
    const supabase = getSupabaseClient();
    let selectColumns = [
      "uid",
      "nome",
      "email",
      "foto",
      "matricula",
      "turma",
      "telefone",
      "status",
      "level",
      "xp",
      "sharkCoins",
      "plano_badge",
      "tier",
      "patente",
      "createdAt",
      "role",
    ];

    while (selectColumns.length > 0) {
      const { data, error } = await supabase
        .from("users")
        .select(selectColumns.join(","))
        .eq("uid", userId)
        .maybeSingle();
      if (!error) {
        const profile = data
          ? normalizeAdminUserProfile(
              rowIdFromUnknown(data),
              data
            )
          : null;
        setCachedValue(userProfileCache, userId, profile);
        return profile;
      }

      const missingColumn = asString(extractMissingSchemaColumn(error));
      if (!missingColumn) throwSupabaseError(error);
      const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
      if (!nextColumns.length) throwSupabaseError(error);
      selectColumns = nextColumns;
    }

    setCachedValue(userProfileCache, userId, null);
    return null;
  })();

  userProfileInflight.set(userId, requestPromise);
  try {
    return await requestPromise;
  } finally {
    userProfileInflight.delete(userId);
  }
}

export async function fetchAdminUserDossier(
  userIdRaw: string,
  options?: { forceRefresh?: boolean }
): Promise<AdminUserDossier | null> {
  const userId = userIdRaw.trim();
  if (!userId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cacheEntry = userDossierCache.get(userId);
    if (cacheEntry) {
      if (Date.now() - cacheEntry.cachedAt <= READ_CACHE_TTL_MS) {
        return cacheEntry.value;
      }
      userDossierCache.delete(userId);
    }

    const pending = userDossierInflight.get(userId);
    if (pending) return pending;
  }

  const requestPromise = (async () => {
    const userData = await fetchAdminUserProfile(userId, { forceRefresh });
    if (!userData) {
      setCachedValue(userDossierCache, userId, null);
      return null;
    }

    const [postsRows, storeOrdersRows, ordersRows, achievementsRows, matchesRows, gymRows] =
      await Promise.all([
        fetchTableRowsForUser("posts", userId, {
          orderField: "createdAt",
          limit: MAX_POST_RESULTS,
          ignoreMissingTable: true,
        }),
        fetchTableRowsForUser("store_orders", userId, {
          orderField: "createdAt",
          limit: MAX_ORDER_RESULTS,
          ignoreMissingTable: true,
        }),
        fetchTableRowsForUser("orders", userId, {
          orderField: "createdAt",
          limit: MAX_ORDER_RESULTS,
          ignoreMissingTable: true,
        }),
        fetchTableRowsForUser("achievements_logs", userId, {
          orderField: "timestamp",
          limit: MAX_ACHIEVEMENT_RESULTS,
          ignoreMissingTable: true,
        }),
        fetchTableRowsForUser("arena_matches", userId, {
          orderField: "date",
          limit: MAX_MATCH_RESULTS,
          ignoreMissingTable: true,
        }),
        fetchTableRowsForUser("gym_logs", userId, {
          orderField: "date",
          limit: MAX_GYM_RESULTS,
          ignoreMissingTable: true,
        }),
      ]);

    const posts = postsRows
      .map((row) => normalizePost(asString(row.id), row))
      .filter((row): row is AdminUserPostRecord => row !== null);

    const mergedOrders = [...storeOrdersRows, ...ordersRows];
    const orders = sortRowsByFieldDesc(mergedOrders, "createdAt")
      .map((row) => normalizeOrder(asString(row.id), row))
      .filter((row): row is AdminUserOrderRecord => row !== null)
      .slice(0, MAX_ORDER_RESULTS);

    const achievements = sortRowsByFieldDesc(achievementsRows, "timestamp")
      .map((row) => normalizeAchievement(asString(row.id), row))
      .filter((row): row is AdminUserAchievementRecord => row !== null);

    const matches = sortRowsByFieldDesc(matchesRows, "date")
      .map((row) => normalizeMatch(asString(row.id), row))
      .filter((row): row is AdminUserMatchRecord => row !== null);

    const gymLogs = sortRowsByFieldDesc(gymRows, "date")
      .map((row) => normalizeGymLog(asString(row.id), row))
      .filter((row): row is AdminUserGymRecord => row !== null);

    const dossier: AdminUserDossier = {
      user: userData,
      posts,
      orders,
      achievements,
      matches,
      gymLogs,
    };

    setCachedValue(userDossierCache, userId, dossier);
    return dossier;
  })();

  userDossierInflight.set(userId, requestPromise);
  try {
    return await requestPromise;
  } finally {
    userDossierInflight.delete(userId);
  }
}

export function clearAdminUsersCaches(): void {
  clearAdminUsersCache();
}
