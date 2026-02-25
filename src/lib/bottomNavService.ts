import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 20_000;
const DEFAULT_NOTIFICATION_RESULTS = 20;
const MAX_NOTIFICATION_RESULTS = 40;
const BANNED_APPEALS_FALLBACK_LIMIT = 500;

const NOTIFICATION_READ_CALLABLE = "notificationsMarkRead";

const notificationsCache = new Map<string, CacheEntry<NotificationFeed>>();
let bannedAppealsCountCache: CacheEntry<number> | null = null;

export interface BottomNavNotification {
  id: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: unknown;
}

export interface NotificationFeed {
  notifications: BottomNavNotification[];
  unreadCount: number;
}

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const boundedLimit = (requested: number): number => {
  if (!Number.isFinite(requested)) return DEFAULT_NOTIFICATION_RESULTS;
  if (requested < 1) return 1;
  if (requested > MAX_NOTIFICATION_RESULTS) return MAX_NOTIFICATION_RESULTS;
  return Math.floor(requested);
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
    const parsed = toDate.call(value) as Date;
    if (parsed instanceof Date) return parsed.getTime();
  }

  return 0;
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

const getCacheValue = <T>(cache: CacheEntry<T> | null): T | null => {
  if (!cache) return null;
  if (Date.now() - cache.cachedAt > READ_CACHE_TTL_MS) return null;
  return cache.value;
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

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
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

async function fetchRowsWithFallback(
  constraintsAttempts: QueryConstraint[][]
): Promise<Record<string, unknown>[]> {
  const attempts = constraintsAttempts.filter((row) => row.length > 0);
  if (!attempts.length) return [];

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const snap = await getDocs(query(collection(db, "notifications"), ...attempts[index]));
      return snap.docs.map((row) => ({
        id: row.id,
        ...(row.data() as Record<string, unknown>),
      }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = index === attempts.length - 1;
      if (!isIndexRequiredError(error) || isLast) {
        throw error;
      }
    }
  }

  if (lastError) throw lastError;
  return [];
}

const normalizeNotification = (
  id: string,
  raw: unknown
): BottomNavNotification | null => {
  const data = asObject(raw);
  if (!data) return null;

  const title = asString(data.title).trim();
  const message = asString(data.message).trim();
  if (!title && !message) return null;

  const link = asString(data.link).trim();

  return {
    id,
    title: title || "Atualizacao",
    message,
    ...(link ? { link } : {}),
    read: asBoolean(data.read, false),
    createdAt: data.createdAt ?? null,
  };
};

export async function fetchBottomNavNotifications(options: {
  userId: string;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<NotificationFeed> {
  const userId = options.userId.trim();
  if (!userId) return { notifications: [], unreadCount: 0 };

  const maxResults = boundedLimit(options.maxResults ?? DEFAULT_NOTIFICATION_RESULTS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${userId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getMapCacheValue(notificationsCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await fetchRowsWithFallback([
    [where("userId", "==", userId), orderBy("createdAt", "desc"), limit(maxResults)],
    [where("userId", "==", userId), limit(maxResults)],
  ]);

  const notifications = rows
    .map((row) => normalizeNotification(asString(row.id), row))
    .filter((row): row is BottomNavNotification => row !== null)
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .slice(0, maxResults);

  const feed: NotificationFeed = {
    unreadCount: notifications.reduce(
      (count, row) => (row.read ? count : count + 1),
      0
    ),
    notifications,
  };

  setMapCacheValue(notificationsCache, cacheKey, feed);
  return feed;
}

export async function fetchBottomNavBannedAppealsCount(options?: {
  forceRefresh?: boolean;
}): Promise<number> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cached = getCacheValue(bannedAppealsCountCache);
    if (cached !== null) return cached;
  }

  let count = 0;
  try {
    const snap = await getCountFromServer(
      query(collection(db, "banned_appeals"), where("readByAdmin", "==", false))
    );
    count = snap.data().count;
  } catch {
    const fallbackSnap = await getDocs(
      query(
        collection(db, "banned_appeals"),
        where("readByAdmin", "==", false),
        limit(BANNED_APPEALS_FALLBACK_LIMIT)
      )
    );
    count = fallbackSnap.size;
  }

  bannedAppealsCountCache = { cachedAt: Date.now(), value: count };
  return count;
}

export async function markBottomNavNotificationRead(
  notificationId: string
): Promise<void> {
  const notificationIdClean = notificationId.trim();
  if (!notificationIdClean) return;

  await callWithFallback<{ notificationId: string }, { ok: boolean }>(
    NOTIFICATION_READ_CALLABLE,
    { notificationId: notificationIdClean },
    async () => {
      await updateDoc(doc(db, "notifications", notificationIdClean), { read: true });
      return { ok: true };
    }
  );

  notificationsCache.clear();
}

export function clearBottomNavCaches(): void {
  notificationsCache.clear();
  bannedAppealsCountCache = null;
}
