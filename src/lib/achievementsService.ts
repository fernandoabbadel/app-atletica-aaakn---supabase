import { getSupabaseClient } from "./supabase";

import {
  buildTenantScopedRowId,
  isTenantScopedRowForTenant,
  parseTenantScopedRowId,
} from "./tenantScopedCatalog";
import {
  fetchTenantMembershipDirectory,
  resolveTenantScopedStats,
  resolveTenantScopedXp,
} from "./tenantMembershipDirectory";
import {
  calculateAchievementSummary,
  mergeAchievementCatalogWithDefaults,
  mergePatentesWithDefaults,
  normalizeAchievementStats,
  resolveEffectiveXp,
  resolvePatenteForXp,
  type RuntimeAchievementConfig,
  type RuntimePatenteConfig,
} from "./achievementRuntime";
import { calculateLevel } from "./games";

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

type ScopedAchievementConfigRow = AchievementConfigRecord & {
  storageId: string;
};

type ScopedPatenteConfigRow = PatenteConfigRecord & {
  storageId: string;
};

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

const normalizeScopedAchievementConfig = (
  storageId: string,
  raw: unknown
): ScopedAchievementConfigRow | null => {
  const normalized = normalizeAchievementConfig(
    parseTenantScopedRowId(storageId).baseId,
    raw
  );
  if (!normalized) return null;

  return {
    ...normalized,
    storageId: asString(storageId).trim(),
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

const normalizeScopedPatenteConfig = (
  storageId: string,
  raw: unknown
): ScopedPatenteConfigRow | null => {
  const normalized = normalizePatenteConfig(
    parseTenantScopedRowId(storageId).baseId,
    raw
  );
  if (!normalized) return null;

  return {
    ...normalized,
    storageId: asString(storageId).trim(),
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

const selectScopedRowsForTenant = <
  T extends {
    storageId: string;
  },
>(
  rows: T[],
  tenantId?: string | null
): T[] => {
  const cleanTenantId = asString(tenantId).trim();
  if (!cleanTenantId) {
    return rows.filter((row) => !parseTenantScopedRowId(row.storageId).scoped);
  }

  const tenantRows = rows.filter((row) =>
    isTenantScopedRowForTenant(row.storageId, cleanTenantId)
  );
  if (tenantRows.length > 0) {
    return tenantRows;
  }

  return rows.filter((row) => !parseTenantScopedRowId(row.storageId).scoped);
};

const withoutStorageId = <
  T extends {
    storageId: string;
  },
>(
  row: T
): Omit<T, "storageId"> =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "storageId")
  ) as Omit<T, "storageId">;

const resolveCatalogStorageId = async (
  tableName: "achievements_config" | "patentes_config",
  baseId: string,
  tenantId?: string | null
): Promise<string> => {
  const cleanId = baseId.trim();
  if (!cleanId) return "";

  const scopedId = buildTenantScopedRowId(tenantId, cleanId);
  if (scopedId === cleanId) return cleanId;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(tableName)
    .select("id")
    .in("id", [scopedId, cleanId])
    .limit(2);
  if (error) throwSupabaseError(error);

  const ids = new Set(
    (data ?? [])
      .map((row) => asString((row as Record<string, unknown>).id).trim())
      .filter((id) => id.length > 0)
  );

  if (ids.has(scopedId)) return scopedId;
  if (ids.has(cleanId)) return cleanId;
  return scopedId;
};

export async function fetchAchievementsConfig(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<AchievementConfigRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 220, MAX_ACHIEVEMENT_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = options?.tenantId?.trim() || "";
  const cacheKey = `${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementsConfigCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("achievements_config")
    .select("id,titulo,desc,xp,target,statKey,cat,iconName,active,repeatable")
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = selectScopedRowsForTenant(
    (data ?? [])
      .map((row) =>
        normalizeScopedAchievementConfig(asString((row as { id?: unknown }).id), row)
      )
      .filter((row): row is ScopedAchievementConfigRow => row !== null),
    tenantId
  )
    .map((row) => withoutStorageId(row))
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
  tenantId?: string | null;
}): Promise<PatenteConfigRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_PATENTE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = options?.tenantId?.trim() || "";
  const cacheKey = `${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCachedValue(patentesConfigCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("patentes_config")
    .select("id,titulo,minXp,cor,iconName,bg,border,text")
    .order("minXp", { ascending: true })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const rows = selectScopedRowsForTenant(
    (data ?? [])
      .map((row) =>
        normalizeScopedPatenteConfig(asString((row as { id?: unknown }).id), row)
      )
      .filter((row): row is ScopedPatenteConfigRow => row !== null),
    tenantId
  )
    .map((row) => withoutStorageId(row))
    .sort((left, right) => left.minXp - right.minXp);

  setCachedValue(patentesConfigCache, cacheKey, rows);
  return rows;
}

export async function fetchAchievementsLogs(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<AchievementLogRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 50, MAX_LOG_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = options?.tenantId?.trim() || "";
  const cacheKey = `${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCachedValue(achievementLogsCache, cacheKey);
    if (cached) return cached;
  }

  let request = supabase
    .from("achievements_logs")
    .select("id,userId,userName,achievementTitle,timestamp,data")
    .order("timestamp", { ascending: false })
    .limit(tenantId ? Math.min(MAX_LOG_RESULTS, maxResults * 8) : maxResults);

  let primaryTenantByUserId = new Map<string, string>();
  if (tenantId) {
    const directory = await fetchTenantMembershipDirectory({
      tenantId,
      statuses: ["approved", "pending"],
    });
    const tenantUserIds = directory.map((entry) => entry.userId);
    if (tenantUserIds.length === 0) {
      setCachedValue(achievementLogsCache, cacheKey, []);
      return [];
    }
    primaryTenantByUserId = new Map(
      directory.map((entry) => [entry.userId, entry.globalTenantId])
    );
    request = request.in("userId", tenantUserIds);
  }

  const { data, error } = await request;
  if (error) throwSupabaseError(error);

  const rows = (data ?? [])
    .map((row) => {
      const raw = row as Record<string, unknown>;
      const userId = asString(raw.userId).trim();
      const dataPayload = asObject(raw.data);
      const logTenantId = asString(dataPayload?.tenantId).trim();

      if (tenantId) {
        const primaryTenantId = primaryTenantByUserId.get(userId) ?? "";
        const belongsToCurrentTenant =
          logTenantId === tenantId || (!logTenantId && primaryTenantId === tenantId);
        if (!belongsToCurrentTenant) {
          return null;
        }
      }

      return {
        id: asString(raw.id),
        userName: asString(raw.userName, "Usuario"),
        achievementTitle: asString(raw.achievementTitle, "Conquista"),
        timestamp: raw.timestamp,
      } satisfies AchievementLogRecord;
    })
    .filter((row): row is AchievementLogRecord => row !== null)
    .filter((row) => row.id)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp))
    .slice(0, maxResults);

  setCachedValue(achievementLogsCache, cacheKey, rows);
  return rows;
}

export interface UserAchievementSnapshot {
  stats: Record<string, number>;
  catalog: RuntimeAchievementConfig[];
  patentes: RuntimePatenteConfig[];
  unlockedCount: number;
  totalUnlockedXp: number;
  logXpTotal: number;
  displayXp: number;
  missingKeys: string[];
  patente: RuntimePatenteConfig | null;
}

const fetchUserAchievementLogRows = async (options: {
  userId: string;
  tenantId?: string | null;
}): Promise<Array<Record<string, unknown>>> => {
  const userId = options.userId.trim();
  if (!userId) return [];

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("achievements_logs")
    .select("achievementId,achievementTitle,xp,data,timestamp")
    .eq("userId", userId)
    .order("timestamp", { ascending: false })
    .limit(600);
  if (error) throwSupabaseError(error);

  const tenantId = options.tenantId?.trim() || "";
  return ((data as Array<Record<string, unknown>> | null) ?? []).filter((row) => {
    if (!tenantId) return true;
    const dataPayload = asObject(row.data);
    const logTenantId = asString(dataPayload?.tenantId).trim();
    return !logTenantId || logTenantId === tenantId;
  });
};

const sumAchievementLogsXp = (
  logs: Array<Record<string, unknown>>,
  catalog: RuntimeAchievementConfig[]
): number => {
  if (!logs.length) return 0;

  const catalogById = new Map(catalog.map((item) => [item.id, item] as const));
  const catalogByTitle = new Map(
    catalog.map((item) => [item.titulo.trim().toLowerCase(), item] as const)
  );
  const seenKeys = new Set<string>();
  let total = 0;

  logs.forEach((row) => {
    const achievementId = asString(row.achievementId).trim();
    const achievementTitle = asString(row.achievementTitle).trim();
    const matchedCatalog =
      catalogById.get(achievementId) ||
      catalogByTitle.get(achievementTitle.toLowerCase()) ||
      null;
    const dedupeKey = achievementId || achievementTitle.toLowerCase();
    if (!dedupeKey || seenKeys.has(dedupeKey)) return;

    seenKeys.add(dedupeKey);
    total += Math.max(0, asNumber(row.xp, matchedCatalog?.xp ?? 0));
  });

  return total;
};

export async function fetchUserAchievementSnapshot(options: {
  userId: string;
  tenantId?: string | null;
  fallbackStats?: Record<string, unknown> | null;
  fallbackXp?: number | null;
}): Promise<UserAchievementSnapshot> {
  const userId = options.userId.trim();
  const tenantId = options.tenantId?.trim() || "";

  const [catalogRows, patentesRows, logRows, membershipRows] = await Promise.all([
    fetchAchievementsConfig({ maxResults: 220, tenantId: tenantId || undefined }),
    fetchPatentesConfig({ maxResults: 40, tenantId: tenantId || undefined }),
    userId
      ? fetchUserAchievementLogRows({ userId, tenantId: tenantId || undefined })
      : Promise.resolve([]),
    tenantId && userId
      ? fetchTenantMembershipDirectory({
          tenantId,
          userIds: [userId],
          statuses: ["approved", "pending", "disabled"],
          limit: 1,
        })
      : Promise.resolve([]),
  ]);

  const catalog = mergeAchievementCatalogWithDefaults(
    (catalogRows as RuntimeAchievementConfig[]) ?? []
  );
  const patentes = mergePatentesWithDefaults(
    (patentesRows as RuntimePatenteConfig[]) ?? []
  );
  const membership = membershipRows[0];
  const stats = normalizeAchievementStats(
    membership ? resolveTenantScopedStats(membership) : options.fallbackStats
  );
  const summary = calculateAchievementSummary(catalog, stats);
  const logXpTotal = sumAchievementLogsXp(logRows, catalog);
  const displayXp = resolveEffectiveXp([
    membership ? resolveTenantScopedXp(membership) : options.fallbackXp,
    summary.totalUnlockedXp,
    logXpTotal,
  ]);

  return {
    stats,
    catalog,
    patentes,
    unlockedCount: summary.unlockedCount,
    totalUnlockedXp: summary.totalUnlockedXp,
    logXpTotal,
    displayXp,
    missingKeys: summary.missingKeys,
    patente: resolvePatenteForXp(patentes, displayXp),
  };
}

export async function syncUserAchievementState(payload: {
  userId: string;
  tenantId?: string | null;
  deltas?: Record<string, number>;
  nextStats?: Record<string, unknown>;
  userName?: string;
  xpDelta?: number;
  userRow?: Record<string, unknown> | null;
}): Promise<{
  stats: Record<string, number>;
  xp: number;
  patente: RuntimePatenteConfig | null;
}> {
  const userId = payload.userId.trim();
  if (!userId) {
    return {
      stats: normalizeAchievementStats(payload.nextStats),
      xp: Math.max(0, asNumber(payload.xpDelta, 0)),
      patente: null,
    };
  }

  const supabase = getSupabaseClient();
  const existingUserRow =
    payload.userRow && typeof payload.userRow === "object"
      ? payload.userRow
      : null;

  let userRow = existingUserRow;
  if (!userRow) {
    const { data, error } = await supabase
      .from("users")
      .select("uid,nome,tenant_id,stats,xp,patente,patente_icon,patente_cor")
      .eq("uid", userId)
      .maybeSingle();
    if (error) throwSupabaseError(error);
    userRow = (data as Record<string, unknown> | null) ?? null;
  }

  if (!userRow) {
    return {
      stats: normalizeAchievementStats(payload.nextStats),
      xp: Math.max(0, asNumber(payload.xpDelta, 0)),
      patente: null,
    };
  }

  const effectiveTenantId =
    payload.tenantId?.trim() || asString(userRow.tenant_id).trim() || "";
  const currentStats = normalizeAchievementStats(asObject(userRow.stats));
  const nextStats = payload.nextStats
    ? normalizeAchievementStats(payload.nextStats)
    : (() => {
        const mutable = { ...currentStats };
        Object.entries(payload.deltas ?? {}).forEach(([key, delta]) => {
          if (!Number.isFinite(delta) || !delta) return;
          mutable[key] = Math.max(0, asNumber(mutable[key], 0) + delta);
        });
        return mutable;
      })();

  const [catalogRows, patentesRows] = await Promise.all([
    fetchAchievementsConfig({ maxResults: 220, tenantId: effectiveTenantId || undefined }),
    fetchPatentesConfig({ maxResults: 40, tenantId: effectiveTenantId || undefined }),
  ]);
  const catalog = mergeAchievementCatalogWithDefaults(
    (catalogRows as RuntimeAchievementConfig[]) ?? []
  );
  const patentes = mergePatentesWithDefaults(
    (patentesRows as RuntimePatenteConfig[]) ?? []
  );
  const previousSummary = calculateAchievementSummary(catalog, currentStats);
  const nextSummary = calculateAchievementSummary(catalog, nextStats);
  const logRows = await fetchUserAchievementLogRows({
    userId,
    tenantId: effectiveTenantId || undefined,
  });
  const logXpTotal = sumAchievementLogsXp(logRows, catalog);
  const nextXp = resolveEffectiveXp([
    asNumber(userRow.xp, 0) + asNumber(payload.xpDelta, 0),
    nextSummary.totalUnlockedXp,
    logXpTotal,
  ]);
  const patente = resolvePatenteForXp(patentes, nextXp);
  const nextLevel = calculateLevel(nextXp);

  const { error: updateError } = await supabase
    .from("users")
    .update({
      stats: nextStats,
      xp: nextXp,
      level: nextLevel,
      patente: patente?.titulo || null,
      patente_icon: patente?.iconName || null,
      patente_cor: patente?.cor || null,
      updatedAt: new Date().toISOString(),
    })
    .eq("uid", userId);
  if (updateError) throwSupabaseError(updateError);

  const previousUnlockIds = new Set(
    previousSummary.list.filter((item) => item.isUnlocked).map((item) => item.id)
  );
  const unlockedNow = nextSummary.list.filter(
    (item) => item.isUnlocked && !previousUnlockIds.has(item.id)
  );

  if (unlockedNow.length > 0) {
    const achievementIds = unlockedNow.map((item) => item.id);
    const { data: existingLogs, error: logsError } = await supabase
      .from("achievements_logs")
      .select("achievementId")
      .eq("userId", userId)
      .in("achievementId", achievementIds);
    if (logsError) throwSupabaseError(logsError);

    const existingAchievementIds = new Set(
      ((existingLogs as Array<Record<string, unknown>> | null) ?? []).map((row) =>
        asString(row.achievementId).trim()
      )
    );

    const insertRows = unlockedNow
      .filter((item) => !existingAchievementIds.has(item.id))
      .map((item) => ({
        userId,
        userName: asString(userRow.nome, payload.userName || "Usuario"),
        achievementId: item.id,
        achievementTitle: item.titulo,
        xp: item.xp,
        timestamp: new Date().toISOString(),
        data: {
          tenantId: effectiveTenantId || undefined,
          statKey: item.statKey,
          progress: item.progress,
          target: item.target,
        },
      }));

    if (insertRows.length > 0) {
      const { error: insertError } = await supabase
        .from("achievements_logs")
        .insert(insertRows);
      if (insertError) throwSupabaseError(insertError);
    }
  }

  clearReadCaches();
  return {
    stats: nextStats,
    xp: nextXp,
    patente,
  };
}

export async function fetchXpRanking(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<UserRankingRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 10, MAX_RANKING_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = options?.tenantId?.trim() || "";
  const cacheKey = `${maxResults}:${tenantId || "global"}`;

  if (!forceRefresh) {
    const cached = getCachedValue(rankingCache, cacheKey);
    if (cached) return cached;
  }

  if (tenantId) {
    const catalog = mergeAchievementCatalogWithDefaults(
      (await fetchAchievementsConfig({
        maxResults: 220,
        forceRefresh,
        tenantId,
      })) as RuntimeAchievementConfig[]
    );
    const directory = await fetchTenantMembershipDirectory({
      tenantId,
      statuses: ["approved", "pending"],
    });
    const rows = directory
      .map((entry) => ({
        id: entry.userId,
        nome: entry.nome,
        turma: entry.turma,
        xp: resolveEffectiveXp([
          resolveTenantScopedXp(entry),
          calculateAchievementSummary(catalog, entry.stats).totalUnlockedXp,
        ]),
        foto: entry.foto,
      }))
      .filter((row) => row.id)
      .sort(
        (left, right) =>
          right.xp - left.xp ||
          left.nome.localeCompare(right.nome, "pt-BR")
      )
      .slice(0, maxResults);

    setCachedValue(rankingCache, cacheKey, rows);
    return rows;
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

export async function saveAchievementConfig(
  payload: AchievementConfigRecord,
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const safePayload = normalizeAchievementPayload(payload);
  if (!safePayload.id) return;
  const storageId = buildTenantScopedRowId(options?.tenantId, safePayload.id);

  const { error } = await supabase.from("achievements_config").upsert(
    {
      ...safePayload,
      id: storageId,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function deleteAchievementConfig(
  id: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = id.trim();
  if (!cleanId) return;

  const storageId = await resolveCatalogStorageId(
    "achievements_config",
    cleanId,
    options?.tenantId
  );
  const { error } = await supabase.from("achievements_config").delete().eq("id", storageId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function toggleAchievementActive(
  payload: { id: string; active: boolean },
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = payload.id.trim();
  if (!cleanId) return;
  const storageId = await resolveCatalogStorageId(
    "achievements_config",
    cleanId,
    options?.tenantId
  );

  const { error } = await supabase
    .from("achievements_config")
    .update({ active: payload.active, updatedAt: new Date().toISOString() })
    .eq("id", storageId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function savePatenteConfig(
  payload: PatenteConfigRecord,
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const safePayload = normalizePatentePayload(payload);
  if (!safePayload.id) return;
  const storageId = buildTenantScopedRowId(options?.tenantId, safePayload.id);

  const { error } = await supabase.from("patentes_config").upsert(
    {
      ...safePayload,
      id: storageId,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function deletePatenteConfig(
  id: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const cleanId = id.trim();
  if (!cleanId) return;

  const storageId = await resolveCatalogStorageId(
    "patentes_config",
    cleanId,
    options?.tenantId
  );
  const { error } = await supabase.from("patentes_config").delete().eq("id", storageId);
  if (error) throwSupabaseError(error);

  clearReadCaches();
}

export async function seedPatentesConfig(
  entries: PatenteConfigRecord[],
  options?: { tenantId?: string | null }
): Promise<void> {
  const supabase = getSupabaseClient();
  const tenantId = options?.tenantId?.trim() || "";
  const safeEntries = entries
    .slice(0, MAX_PATENTE_RESULTS)
    .map((entry) => normalizePatentePayload(entry))
    .filter((entry) => entry.id.length > 0)
    .map((entry) => ({
      ...entry,
      id: buildTenantScopedRowId(tenantId, entry.id),
      updatedAt: new Date().toISOString(),
    }));

  if (!safeEntries.length) return;

  const { error } = await supabase.from("patentes_config").upsert(safeEntries, { onConflict: "id" });
  if (error) throwSupabaseError(error);

  clearReadCaches();
}
