import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 30_000;

const MAX_ACTIVITY_LOG_RESULTS = 260;
const MAX_PERMISSION_USER_RESULTS = 500;

const FETCH_PERMISSION_MATRIX_CALLABLE = "permissionsAdminGetMatrix";
const FETCH_PERMISSION_USERS_CALLABLE = "permissionsAdminListUsers";
const SAVE_PERMISSION_MATRIX_CALLABLE = "permissionsAdminSaveMatrix";
const UPDATE_USER_ROLE_CALLABLE = "permissionsAdminUpdateUserRole";

const activityLogsCache = new Map<string, CacheEntry<AdminActivityLogRecord[]>>();
const permissionUsersCache = new Map<string, CacheEntry<PermissionUserRecord[]>>();
let permissionMatrixCache: CacheEntry<PermissionMatrix | null> | null = null;

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

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

const getMapCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setMapCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
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

const sanitizePermissionMatrix = (
  matrix: PermissionMatrix
): PermissionMatrix => {
  const sanitized: PermissionMatrix = {};

  Object.entries(matrix).forEach(([path, roles]) => {
    const cleanPath = path.trim();
    if (!cleanPath.startsWith("/")) return;
    const cleanRoles = asStringArray(roles).map((role) => role.trim()).filter(Boolean);
    sanitized[cleanPath] = Array.from(new Set(cleanRoles));
  });

  return sanitized;
};

const normalizePermissionMatrix = (raw: unknown): PermissionMatrix | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const matrix: PermissionMatrix = {};
  Object.entries(obj).forEach(([path, roles]) => {
    if (!path.startsWith("/")) return;
    const cleanRoles = asStringArray(roles).map((role) => role.trim()).filter(Boolean);
    matrix[path] = Array.from(new Set(cleanRoles));
  });

  return matrix;
};

const extractPermissionMatrix = (raw: unknown): PermissionMatrix | null => {
  const direct = normalizePermissionMatrix(raw);
  if (direct && Object.keys(direct).length > 0) {
    return direct;
  }

  const obj = asObject(raw);
  if (!obj) return null;

  const directFromKey = normalizePermissionMatrix(obj.permissionMatrix);
  if (directFromKey && Object.keys(directFromKey).length > 0) {
    return directFromKey;
  }

  const nestedData = asObject(obj.data);
  if (!nestedData) return null;

  const fromNestedKey = normalizePermissionMatrix(nestedData.permissionMatrix);
  if (fromNestedKey && Object.keys(fromNestedKey).length > 0) {
    return fromNestedKey;
  }

  const nestedDirect = normalizePermissionMatrix(nestedData);
  if (nestedDirect && Object.keys(nestedDirect).length > 0) {
    return nestedDirect;
  }

  return null;
};

const normalizePermissionUserRecord = (
  raw: unknown,
  fallbackId = ""
): PermissionUserRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const id = asString(obj.id, asString(obj.uid, fallbackId)).trim();
  if (!id) return null;

  const nome = asString(obj.nome, "Sem nome").trim() || "Sem nome";
  const email = asString(obj.email).trim();
  const foto = asString(obj.foto).trim();
  const role = asString(obj.role).trim();

  return {
    id,
    nome,
    email,
    ...(foto ? { foto } : {}),
    ...(role ? { role } : {}),
  };
};

const upsertSettingsPermissionsWithFallback = async (
  matrix: PermissionMatrix
): Promise<void> => {
  const supabase = getSupabaseClient();
  const mutablePayload: Record<string, unknown> = {
    id: "permissions",
    data: { permissionMatrix: matrix },
    permissionMatrix: matrix,
    updatedAt: new Date().toISOString(),
  };

  while (Object.keys(mutablePayload).length > 1) {
    const { error } = await supabase
      .from("settings")
      .upsert(mutablePayload, { onConflict: "id" });
    if (!error) return;

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);

    const removableKey = Object.keys(mutablePayload).find(
      (key) => key.toLowerCase() === missingColumn.toLowerCase()
    );
    if (typeof removableKey !== "string" || removableKey === "id") {
      throwSupabaseError(error);
    }
    delete mutablePayload[String(removableKey)];
  }
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  if (!shouldUseCallable()) {
    return fallbackFn();
  }

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

export interface AdminActivityLogRecord {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  details: string;
  timestamp: unknown;
}

export interface AdminActivityLogsPageResult {
  logs: AdminActivityLogRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PermissionUserRecord {
  id: string;
  nome: string;
  email: string;
  foto?: string;
  role?: string;
}

export type PermissionMatrix = Record<string, string[]>;

const normalizeActivityLogRow = (
  id: string,
  raw: unknown
): AdminActivityLogRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Sistema"),
    action: asString(data.action, "UNKNOWN"),
    resource: asString(data.resource, "Sistema"),
    details: asString(data.details),
    timestamp: data.timestamp,
  };
};

export async function fetchAdminActivityLogsPage(options?: {
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminActivityLogsPageResult> {
  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_ACTIVITY_LOG_RESULTS);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;

  const allLogs = await fetchAdminActivityLogs({
    maxResults: MAX_ACTIVITY_LOG_RESULTS,
    forceRefresh,
  });

  let startIndex = 0;
  if (cursorId) {
    const cursorIndex = allLogs.findIndex((row) => row.id === cursorId);
    if (cursorIndex >= 0) {
      startIndex = cursorIndex + 1;
    }
  }

  const logs = allLogs.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < allLogs.length;
  const nextCursor = logs.length > 0 ? logs[logs.length - 1].id : null;

  return { logs, nextCursor, hasMore };
}

export async function fetchAdminActivityLogs(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<AdminActivityLogRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 120,
    MAX_ACTIVITY_LOG_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(activityLogsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let rowsResult: AdminActivityLogRecord[] = [];

  const primary = await supabase
    .from("activity_logs")
    .select("id,userId,userName,action,resource,details,timestamp")
    .order("timestamp", { ascending: false })
    .limit(maxResults);

  if (!primary.error) {
    rowsResult = (primary.data ?? [])
      .map((row) => normalizeActivityLogRow(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is AdminActivityLogRecord => row !== null);
  } else if (asString(extractMissingSchemaColumn(primary.error))) {
    const fallback = await supabase
      .from("activity_logs")
      .select("id,userId,userName,action,resource,details,timestamp")
      .limit(maxResults);
    if (fallback.error) throwSupabaseError(fallback.error);
    rowsResult = (fallback.data ?? [])
      .map((row) => normalizeActivityLogRow(asString((row as Record<string, unknown>).id), row))
      .filter((row): row is AdminActivityLogRecord => row !== null)
      .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));
  } else {
    throwSupabaseError(primary.error);
  }

  setMapCacheValue(activityLogsCache, cacheKey, rowsResult);
  return rowsResult;
}

export async function fetchPermissionUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PermissionUserRecord[]> {
  const maxResults = boundedLimit(
    options?.maxResults ?? 320,
    MAX_PERMISSION_USER_RESULTS
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(permissionUsersCache, cacheKey);
    if (cached) return cached;
  }

  const response = await callWithFallback<
    { maxResults: number },
    { users: PermissionUserRecord[] }
  >(
    FETCH_PERMISSION_USERS_CALLABLE,
    { maxResults },
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("users")
        .select("uid,nome,email,foto,role")
        .limit(maxResults);
      if (error) throwSupabaseError(error);
      return {
        users: (data ?? [])
          .map((row) => normalizePermissionUserRecord(row))
          .filter((row): row is PermissionUserRecord => row !== null),
      };
    }
  );

  const users = (Array.isArray(response.users) ? response.users : [])
    .map((row) => normalizePermissionUserRecord(row))
    .filter((row): row is PermissionUserRecord => row !== null)
    .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));

  setMapCacheValue(permissionUsersCache, cacheKey, users);
  return users;
}

export async function fetchPermissionMatrix(options?: {
  forceRefresh?: boolean;
}): Promise<PermissionMatrix | null> {
  const forceRefresh = options?.forceRefresh ?? false;

  if (
    !forceRefresh &&
    permissionMatrixCache &&
    Date.now() - permissionMatrixCache.cachedAt <= READ_CACHE_TTL_MS
  ) {
    return permissionMatrixCache.value;
  }

  const response = await callWithFallback<
    { forceRefresh?: boolean },
    { matrix: unknown | null }
  >(
    FETCH_PERMISSION_MATRIX_CALLABLE,
    { forceRefresh },
    async () => {
      const supabase = getSupabaseClient();
      let selectColumns = ["id", "data", "permissionMatrix"];

      while (selectColumns.length > 0) {
        const { data, error } = await supabase
          .from("settings")
          .select(selectColumns.join(","))
          .eq("id", "permissions")
          .maybeSingle();

        if (!error) {
          if (!data) return { matrix: null };
          return { matrix: extractPermissionMatrix(data) };
        }

        const missingColumn = asString(extractMissingSchemaColumn(error));
        if (!missingColumn) throwSupabaseError(error);
        selectColumns = selectColumns.filter(
          (column) => column.toLowerCase() !== missingColumn.toLowerCase()
        );
      }

      return { matrix: null };
    }
  );

  const normalized = extractPermissionMatrix(response.matrix);
  permissionMatrixCache = { cachedAt: Date.now(), value: normalized };
  return normalized;
}

export async function savePermissionMatrix(
  matrix: PermissionMatrix
): Promise<void> {
  const sanitized = sanitizePermissionMatrix(matrix);

  await callWithFallback<{ matrix: PermissionMatrix }, { ok: boolean }>(
    SAVE_PERMISSION_MATRIX_CALLABLE,
    { matrix: sanitized },
    async () => {
      await upsertSettingsPermissionsWithFallback(sanitized);
      return { ok: true };
    }
  );

  permissionMatrixCache = { cachedAt: Date.now(), value: sanitized };
}

export async function updatePermissionUserRole(payload: {
  targetUserId: string;
  role: string;
}): Promise<void> {
  const targetUserId = payload.targetUserId.trim();
  const role = payload.role.trim();
  if (!targetUserId || !role) return;

  const requestPayload = { targetUserId, role };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    UPDATE_USER_ROLE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("users")
        .update({ role, updatedAt: new Date().toISOString() })
        .eq("uid", targetUserId);
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  permissionUsersCache.clear();
}

export function clearAdminSecurityCaches(): void {
  activityLogsCache.clear();
  permissionUsersCache.clear();
  permissionMatrixCache = null;
}
