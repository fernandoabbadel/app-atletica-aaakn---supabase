import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
} from "firebase/firestore";

import { db } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;
const MAX_RECENT_USERS_RESULTS = 20;
const MAX_RECENT_LOGS_RESULTS = 20;

const DEFAULT_TOTAL_SALES = 1250;
const DEFAULT_ACTIVE_CHAMPS = 2;

const dashboardCache = new Map<string, CacheEntry<AdminDashboardBundle>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

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

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

async function fetchCollectionRowsWithFallback(
  collectionName: string,
  attempts: QueryConstraint[][]
): Promise<Record<string, unknown>[]> {
  const normalizedAttempts = attempts.filter((entry) => entry.length > 0);
  if (!normalizedAttempts.length) return [];

  let lastError: unknown = null;
  for (let index = 0; index < normalizedAttempts.length; index += 1) {
    try {
      const constraints = normalizedAttempts[index];
      const snap = await getDocs(query(collection(db, collectionName), ...constraints));
      return snap.docs.map((row) => ({
        id: row.id,
        ...(row.data() as Record<string, unknown>),
      }));
    } catch (error: unknown) {
      lastError = error;
      const isLastAttempt = index === normalizedAttempts.length - 1;
      if (!isIndexRequiredError(error) || isLastAttempt) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

async function safeCount(
  collectionName: string
): Promise<{ count: number; fallbackUsed: boolean }> {
  try {
    const snap = await getCountFromServer(collection(db, collectionName));
    return { count: snap.data().count, fallbackUsed: false };
  } catch {
    return { count: 0, fallbackUsed: true };
  }
}

export interface AdminDashboardStats {
  totalUsers: number;
  totalEvents: number;
  totalSales: number;
  activeChamps: number;
}

export interface AdminDashboardRecentUser {
  id: string;
  nome: string;
  email: string;
  foto: string;
  turma: string;
  role: string;
  createdAt?: unknown;
}

export interface AdminDashboardActivityLog {
  id: string;
  userName: string;
  action: string;
  resource: string;
  timestamp?: unknown;
}

export interface AdminDashboardBundle {
  stats: AdminDashboardStats;
  recentUsers: AdminDashboardRecentUser[];
  recentActivity: AdminDashboardActivityLog[];
}

const normalizeRecentUser = (
  id: string,
  raw: unknown
): AdminDashboardRecentUser | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome, "Sem Nome"),
    email: asString(data.email, "---"),
    foto: asString(data.foto, "https://github.com/shadcn.png"),
    turma: asString(data.turma, "---"),
    role: asString(data.role, "atleta"),
    createdAt: data.data_adesao ?? data.createdAt ?? null,
  };
};

const normalizeActivityLog = (
  id: string,
  raw: unknown
): AdminDashboardActivityLog | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    userName: asString(data.userName, "Sistema"),
    action: asString(data.action, "UPDATE"),
    resource: asString(data.resource, "app"),
    timestamp: data.timestamp ?? data.createdAt ?? null,
  };
};

export async function fetchAdminDashboardBundle(options?: {
  usersLimit?: number;
  logsLimit?: number;
  forceRefresh?: boolean;
}): Promise<AdminDashboardBundle> {
  const usersLimit = boundedLimit(
    options?.usersLimit ?? 5,
    MAX_RECENT_USERS_RESULTS
  );
  const logsLimit = boundedLimit(options?.logsLimit ?? 5, MAX_RECENT_LOGS_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${usersLimit}:${logsLimit}`;

  if (!forceRefresh) {
    const cached = getCachedValue(dashboardCache, cacheKey);
    if (cached) return cached;
  }

  const [usersCountResult, eventsCountResult, salesCountResult, usersRows, logsRows] =
    await Promise.all([
      safeCount("users"),
      safeCount("eventos"),
      safeCount("store_orders"),
      fetchCollectionRowsWithFallback("users", [
        [orderBy("data_adesao", "desc"), limit(usersLimit)],
        [orderBy("createdAt", "desc"), limit(usersLimit)],
        [limit(usersLimit)],
      ]),
      fetchCollectionRowsWithFallback("activity_logs", [
        [orderBy("timestamp", "desc"), limit(logsLimit)],
        [orderBy("createdAt", "desc"), limit(logsLimit)],
        [limit(logsLimit)],
      ]),
    ]);

  const recentUsers = usersRows
    .map((row) => normalizeRecentUser(asString(row.id), row))
    .filter((row): row is AdminDashboardRecentUser => row !== null);

  const recentActivity = sortRowsByFieldDesc(logsRows, "timestamp")
    .map((row) => normalizeActivityLog(asString(row.id), row))
    .filter((row): row is AdminDashboardActivityLog => row !== null);

  const bundle: AdminDashboardBundle = {
    stats: {
      totalUsers: usersCountResult.count,
      totalEvents: eventsCountResult.count,
      totalSales: salesCountResult.fallbackUsed
        ? DEFAULT_TOTAL_SALES
        : salesCountResult.count,
      activeChamps: DEFAULT_ACTIVE_CHAMPS,
    },
    recentUsers,
    recentActivity,
  };

  setCachedValue(dashboardCache, cacheKey, bundle);
  return bundle;
}

export function clearAdminDashboardCaches(): void {
  dashboardCache.clear();
}
