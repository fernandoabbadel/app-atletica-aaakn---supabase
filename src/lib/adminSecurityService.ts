import { httpsCallable } from "@/lib/supa/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  type QueryConstraint,
} from "@/lib/supa/firestore";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

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

  const id = asString(obj.id, fallbackId).trim();
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

  if (forceRefresh) {
    activityLogsCache.clear();
  }

  const constraints: QueryConstraint[] = [
    orderBy("timestamp", "desc"),
    limit(pageSize + 1),
  ];

  if (cursorId) {
    const cursorSnap = await getDoc(doc(db, "activity_logs", cursorId));
    if (cursorSnap.exists()) {
      constraints.splice(1, 0, startAfter(cursorSnap));
    }
  }

  const snap = await getDocs(query(collection(db, "activity_logs"), ...constraints));

  const pageDocs = snap.docs.slice(0, pageSize);
  const logs = pageDocs
    .map((row) => normalizeActivityLogRow(row.id, row.data()))
    .filter((row): row is AdminActivityLogRecord => row !== null)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));

  const hasMore = snap.docs.length > pageSize;
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

  const q = query(
    collection(db, "activity_logs"),
    orderBy("timestamp", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);

  const rows = snap.docs
    .map((row) => normalizeActivityLogRow(row.id, row.data()))
    .filter((row): row is AdminActivityLogRecord => row !== null)
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp));

  setMapCacheValue(activityLogsCache, cacheKey, rows);
  return rows;
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
      const q = query(collection(db, "users"), limit(maxResults));
      const snap = await getDocs(q);
      return {
        users: snap.docs
          .map((row) => normalizePermissionUserRecord({ id: row.id, ...row.data() }))
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
      const snap = await getDoc(doc(db, "settings", "permissions"));
      if (!snap.exists()) {
        return { matrix: null };
      }

      return { matrix: extractPermissionMatrix(snap.data()) };
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
      await setDoc(
        doc(db, "settings", "permissions"),
        { data: { permissionMatrix: sanitized } },
        { merge: true }
      );
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
      await updateDoc(doc(db, "users", targetUserId), { role });
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

