import { httpsCallable } from "@/lib/supa/functions";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "@/lib/supabaseHelpers";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 20_000;
const DEFAULT_PREVIEW_RESULTS = 4;
const MAX_PREVIEW_RESULTS = 12;

const EVENT_LIKE_CALLABLE = "eventToggleLike";
const EVENT_RSVP_CALLABLE = "eventSetRsvp";

const eventCardStateCache = new Map<string, CacheEntry<EventCardState>>();

export type EventRsvpStatus = "going" | "maybe";

export interface EventCardState {
  userRsvp: EventRsvpStatus | null;
  previewAvatars: string[];
}

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const normalizeStatus = (value: unknown): EventRsvpStatus | null => {
  const raw = asString(value).toLowerCase();
  if (raw === "going") return "going";
  if (raw === "maybe") return "maybe";
  return null;
};

const boundedPreviewLimit = (requested: number): number => {
  if (!Number.isFinite(requested)) return DEFAULT_PREVIEW_RESULTS;
  if (requested < 1) return 1;
  if (requested > MAX_PREVIEW_RESULTS) return MAX_PREVIEW_RESULTS;
  return Math.floor(requested);
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

const toCacheKey = (
  eventId: string,
  userId: string | null,
  previewLimit: number
): string => `${eventId}:${userId || "anon"}:${previewLimit}`;

const getCacheValue = <T>(
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

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const invalidateEventCardCache = (eventId: string): void => {
  const cleanEventId = eventId.trim();
  if (!cleanEventId) {
    eventCardStateCache.clear();
    return;
  }

  eventCardStateCache.forEach((_, key) => {
    if (key.startsWith(`${cleanEventId}:`)) {
      eventCardStateCache.delete(key);
    }
  });
};

async function fetchUserRsvp(
  eventId: string,
  userId: string | null
): Promise<EventRsvpStatus | null> {
  if (!userId) return null;

  const userDoc = await getDoc(doc(db, "eventos", eventId, "rsvps", userId));
  if (!userDoc.exists()) return null;

  const data = asObject(userDoc.data());
  return normalizeStatus(data?.status);
}

async function fetchPreviewAvatars(
  eventId: string,
  previewLimit: number
): Promise<string[]> {
  const q = query(
    collection(db, "eventos", eventId, "rsvps"),
    where("status", "==", "going"),
    limit(previewLimit)
  );

  const snap = await getDocs(q);
  const avatars = snap.docs
    .map((entry) => {
      const data = asObject(entry.data());
      return asString(data?.userAvatar).trim();
    })
    .filter((value) => value.length > 0);

  return [...new Set(avatars)].slice(0, previewLimit);
}

export async function fetchEventCardState(options: {
  eventId: string;
  userId?: string | null;
  previewLimit?: number;
  forceRefresh?: boolean;
}): Promise<EventCardState> {
  const eventId = options.eventId.trim();
  if (!eventId) {
    return { userRsvp: null, previewAvatars: [] };
  }

  const userId = options.userId?.trim() || null;
  const previewLimit = boundedPreviewLimit(
    options.previewLimit ?? DEFAULT_PREVIEW_RESULTS
  );
  const cacheKey = toCacheKey(eventId, userId, previewLimit);
  const forceRefresh = options.forceRefresh ?? false;

  if (!forceRefresh) {
    const cached = getCacheValue(eventCardStateCache, cacheKey);
    if (cached) return cached;
  }

  const [userRsvp, previewAvatars] = await Promise.all([
    fetchUserRsvp(eventId, userId),
    fetchPreviewAvatars(eventId, previewLimit),
  ]);

  const state: EventCardState = { userRsvp, previewAvatars };
  setCacheValue(eventCardStateCache, cacheKey, state);
  return state;
}

export async function toggleEventLike(payload: {
  eventId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;

  const requestPayload = {
    eventId,
    userId,
    currentlyLiked: payload.currentlyLiked,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    EVENT_LIKE_CALLABLE,
    requestPayload,
    async () => {
      await updateDoc(doc(db, "eventos", eventId), {
        likesList: payload.currentlyLiked ? arrayRemove(userId) : arrayUnion(userId),
        "stats.likes": increment(payload.currentlyLiked ? -1 : 1),
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  invalidateEventCardCache(eventId);
}

export async function setEventRsvp(payload: {
  eventId: string;
  userId: string;
  status: EventRsvpStatus;
  userName: string;
  userAvatar: string;
  userTurma: string;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;

  const status = normalizeStatus(payload.status);
  if (!status) return;

  const requestPayload = {
    eventId,
    userId,
    status,
    userName: payload.userName.trim().slice(0, 120) || "Anonimo",
    userAvatar: payload.userAvatar.trim().slice(0, 2000),
    userTurma: payload.userTurma.trim().slice(0, 30) || "Geral",
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    EVENT_RSVP_CALLABLE,
    requestPayload,
    async () => {
      await runTransaction(db, async (tx) => {
        const eventRef = doc(db, "eventos", eventId);
        const rsvpRef = doc(db, "eventos", eventId, "rsvps", userId);

        const previousSnap = await tx.get(rsvpRef);
        const previousData = asObject(previousSnap.data());
        const oldStatus = normalizeStatus(previousData?.status);

        if (oldStatus === status) {
          tx.delete(rsvpRef);
          tx.update(eventRef, {
            [`stats.${status === "going" ? "confirmados" : "talvez"}`]: increment(-1),
            updatedAt: serverTimestamp(),
          });
          return;
        }

        if (oldStatus) {
          tx.update(eventRef, {
            [`stats.${oldStatus === "going" ? "confirmados" : "talvez"}`]:
              increment(-1),
          });
        }

        tx.set(rsvpRef, {
          userId,
          status,
          userName: requestPayload.userName,
          userAvatar: requestPayload.userAvatar,
          userTurma: requestPayload.userTurma,
          timestamp: serverTimestamp(),
        });

        tx.update(eventRef, {
          [`stats.${status === "going" ? "confirmados" : "talvez"}`]: increment(1),
          updatedAt: serverTimestamp(),
        });
      });

      return { ok: true };
    }
  );

  invalidateEventCardCache(eventId);
}

export function clearEventCardCaches(): void {
  eventCardStateCache.clear();
}


