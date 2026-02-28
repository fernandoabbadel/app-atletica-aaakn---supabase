import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

type Row = Record<string, unknown>;

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

const sortRowsByDateCandidatesDesc = (rows: Row[], fields: string[]): Row[] =>
  [...rows].sort((left, right) => {
    const rightValue = fields.map((field) => toMillis(right[field])).find((v) => v > 0) ?? 0;
    const leftValue = fields.map((field) => toMillis(left[field])).find((v) => v > 0) ?? 0;
    return rightValue - leftValue;
  });

async function safeCount(
  tableName: string,
  countColumn: string
): Promise<{ count: number; fallbackUsed: boolean }> {
  const supabase = getSupabaseClient();

  // Preferimos counts por metadata para reduzir custo de leitura no plano free.
  for (const mode of ["planned", "estimated", "exact"] as const) {
    const { count, error } = await supabase
      .from(tableName)
      .select(countColumn, { count: mode, head: true });

    if (!error && typeof count === "number") {
      return { count, fallbackUsed: false };
    }
  }

  return { count: 0, fallbackUsed: true };
}

async function fetchRowsWithOrderFallback(options: {
  tableName: string;
  selectColumns: string;
  maxResults: number;
  orderFields: string[];
}): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  // Tentamos diferentes campos de ordenacao para tolerar schema antigo/novo.
  for (const field of options.orderFields) {
    const { data, error } = await supabase
      .from(options.tableName)
      .select(options.selectColumns)
      .order(field, { ascending: false })
      .limit(options.maxResults);

    if (!error && Array.isArray(data)) {
      return data as unknown as Row[];
    }

    lastError = error;
  }

  // Fallback final sem order para nao quebrar se a coluna ainda nao existir.
  const { data, error } = await supabase
    .from(options.tableName)
    .select(options.selectColumns)
    .limit(options.maxResults);

  if (error) {
    throw error ?? lastError;
  }

  return Array.isArray(data) ? (data as unknown as Row[]) : [];
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
      safeCount("users", "uid"),
      safeCount("eventos", "id"),
      safeCount("store_orders", "id"),
      fetchRowsWithOrderFallback({
        tableName: "users",
        selectColumns:
          "id,uid,nome,email,foto,turma,role,data_adesao,createdAt,created_at",
        maxResults: usersLimit,
        orderFields: ["data_adesao", "createdAt", "created_at"],
      }),
      fetchRowsWithOrderFallback({
        tableName: "activity_logs",
        selectColumns: "id,userName,action,resource,timestamp,createdAt,created_at",
        maxResults: logsLimit,
        orderFields: ["timestamp", "createdAt", "created_at"],
      }),
    ]);

  const recentUsers = sortRowsByDateCandidatesDesc(usersRows, ["data_adesao", "createdAt", "created_at"])
    .map((row) => normalizeRecentUser(asString(row.id) || asString(row.uid), row))
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
