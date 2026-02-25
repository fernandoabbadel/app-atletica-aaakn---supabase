import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;

const MAX_ACHIEVEMENT_RESULTS = 260;
const MAX_PATENTE_RESULTS = 60;
const MAX_LOG_RESULTS = 150;
const MAX_RANKING_RESULTS = 60;

const achievementsConfigCache = new Map<string, CacheEntry<AchievementConfigRecord[]>>();
const patentesConfigCache = new Map<string, CacheEntry<PatenteConfigRecord[]>>();
const achievementLogsCache = new Map<string, CacheEntry<AchievementLogRecord[]>>();
const rankingCache = new Map<string, CacheEntry<UserRankingRecord[]>>();

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

const getCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearReadCaches = (): void => {
  achievementsConfigCache.clear();
  patentesConfigCache.clear();
  achievementLogsCache.clear();
  rankingCache.clear();
};

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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

export interface AchievementConfigRecord {
  id: string;
  titulo: string;
  desc: string;
  xp: number;
  target: number;
  statKey: string;
  cat: string;
  iconName: string;
  active: boolean;
  repeatable: boolean;
}

export interface AchievementLogRecord {
  id: string;
  userName: string;
  achievementTitle: string;
  timestamp: unknown;
}

export interface UserRankingRecord {
  id: string;
  nome: string;
  turma: string;
  xp: number;
  foto: string;
}

export interface PatenteConfigRecord {
  id: string;
  titulo: string;
  minXp: number;
  cor: string;
  iconName: string;
  bg?: string;
  border?: string;
  text?: string;
}

const normalizeAchievementConfig = (id: string, raw: unknown): AchievementConfigRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    id,
    titulo: asString(obj.titulo, "Conquista").trim().slice(0, 90),
    desc: asString(obj.desc).slice(0, 240),
    xp: asNumber(obj.xp, 0),
    target: Math.max(1, asNumber(obj.target, 1)),
    statKey: asString(obj.statKey, "loginCount").trim().slice(0, 80),
    cat: asString(obj.cat, "Social").trim().slice(0, 30),
    iconName: asString(obj.iconName, "Star").trim().slice(0, 40),
    active: asBoolean(obj.active, true),
    repeatable: asBoolean(obj.repeatable, false),
  };
};

const normalizePatenteConfig = (id: string, raw: unknown): PatenteConfigRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    id,
    titulo: asString(obj.titulo, "Patente").trim().slice(0, 60),
    minXp: Math.max(0, asNumber(obj.minXp, 0)),
    cor: asString(obj.cor, "text-zinc-400").trim().slice(0, 40),
    iconName: asString(obj.iconName, "Fish").trim().slice(0, 40),
    bg: asString(obj.bg).trim().slice(0, 60) || undefined,
    border: asString(obj.border).trim().slice(0, 60) || undefined,
    text: asString(obj.text).trim().slice(0, 60) || undefined,
  };
};

const normalizeAchievementPayload = (payload: AchievementConfigRecord): AchievementConfigRecord => ({
  id: payload.id.trim(),
  titulo: payload.titulo.trim().slice(0, 90) || "Conquista",
  desc: payload.desc.slice(0, 240),
  xp: Number.isFinite(payload.xp) ? payload.xp : 0,
  target: Number.isFinite(payload.target) ? Math.max(1, payload.target) : 1,
  statKey: payload.statKey.trim().slice(0, 80) || "loginCount",
  cat: payload.cat.trim().slice(0, 30) || "Social",
  iconName: payload.iconName.trim().slice(0, 40) || "Star",
  active: Boolean(payload.active),
  repeatable: Boolean(payload.repeatable),
});

const normalizePatentePayload = (payload: PatenteConfigRecord): PatenteConfigRecord => ({
  id: payload.id.trim(),
  titulo: payload.titulo.trim().slice(0, 60) || "Patente",
  minXp: Number.isFinite(payload.minXp) ? Math.max(0, payload.minXp) : 0,
  cor: payload.cor.trim().slice(0, 40) || "text-zinc-400",
  iconName: payload.iconName.trim().slice(0, 40) || "Fish",
  bg: payload.bg?.trim().slice(0, 60) || undefined,
  border: payload.border?.trim().slice(0, 60) || undefined,
  text: payload.text?.trim().slice(0, 60) || undefined,
});

export async function fetchAchievementsConfig(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AchievementConfigRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 220, MAX_ACHIEVEMENT_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementsConfigCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase.from("achievements_config").select("*").limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) => normalizeAchievementConfig(asString((row as { id?: unknown }).id), row))
    .filter((row): row is AchievementConfigRecord => row !== null)
    .sort(
      (left, right) =>
        left.cat.localeCompare(right.cat, "pt-BR") ||
        left.titulo.localeCompare(right.titulo, "pt-BR")
    );

  setCachedValue(achievementsConfigCache, cacheKey, rows);
  return rows;
}

export async function fetchPatentesConfig(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PatenteConfigRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_PATENTE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(patentesConfigCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("patentes_config")
    .select("*")
    .order("minXp", { ascending: true })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) => normalizePatenteConfig(asString((row as { id?: unknown }).id), row))
    .filter((row): row is PatenteConfigRecord => row !== null)
    .sort((left, right) => left.minXp - right.minXp);

  setCachedValue(patentesConfigCache, cacheKey, rows);
  return rows;
}

export async function fetchAchievementsLogs(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AchievementLogRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 50, MAX_LOG_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementLogsCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("achievements_logs")
    .select("id,userName,achievementTitle,timestamp")
    .order("timestamp", { ascending: false })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) => ({
      id: asString((row as Record<string, unknown>).id),
      userName: asString((row as Record<string, unknown>).userName, "Usuario"),
      achievementTitle: asString((row as Record<string, unknown>).achievementTitle, "Conquista"),
      timestamp: (row as Record<string, unknown>).timestamp,
    }))
    .filter((row) => row.id)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));

  setCachedValue(achievementLogsCache, cacheKey, rows);
  return rows;
}

export async function fetchXpRanking(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<UserRankingRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 10, MAX_RANKING_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCachedValue(rankingCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("users")
    .select("uid,nome,turma,xp,foto")
    .order("xp", { ascending: false })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) => ({
      id: asString((row as Record<string, unknown>).uid),
      nome: asString((row as Record<string, unknown>).nome, "Sem nome"),
      turma: asString((row as Record<string, unknown>).turma),
      xp: asNumber((row as Record<string, unknown>).xp, 0),
      foto: asString((row as Record<string, unknown>).foto),
    }))
    .filter((row) => row.id);

  setCachedValue(rankingCache, cacheKey, rows);
  return rows;
}

export async function saveAchievementConfig(payload: AchievementConfigRecord): Promise<void> {
  const supabase = getSupabaseClient();
  const safePayload = normalizeAchievementPayload(payload);
  if (!safePayload.id) return;

  const { error } = await supabase.from("achievements_config").upsert(
    {
      ...safePayload,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function deleteAchievementConfig(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = id.trim();
  if (!cleanId) return;

  const { error } = await supabase.from("achievements_config").delete().eq("id", cleanId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function toggleAchievementActive(payload: { id: string; active: boolean }): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = payload.id.trim();
  if (!cleanId) return;

  const { error } = await supabase
    .from("achievements_config")
    .update({ active: payload.active, updatedAt: new Date().toISOString() })
    .eq("id", cleanId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function savePatenteConfig(payload: PatenteConfigRecord): Promise<void> {
  const supabase = getSupabaseClient();
  const safePayload = normalizePatentePayload(payload);
  if (!safePayload.id) return;

  const { error } = await supabase.from("patentes_config").upsert(
    {
      ...safePayload,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function deletePatenteConfig(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = id.trim();
  if (!cleanId) return;

  const { error } = await supabase.from("patentes_config").delete().eq("id", cleanId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function seedPatentesConfig(entries: PatenteConfigRecord[]): Promise<void> {
  const supabase = getSupabaseClient();
  const safeEntries = entries
    .slice(0, MAX_PATENTE_RESULTS)
    .map((entry) => normalizePatentePayload(entry))
    .filter((entry) => entry.id.length > 0)
    .map((entry) => ({ ...entry, updatedAt: new Date().toISOString() }));

  if (!safeEntries.length) return;

  const { error } = await supabase.from("patentes_config").upsert(safeEntries, { onConflict: "id" });
  if (error) throwSupabaseError(error);

  clearReadCaches();
}
