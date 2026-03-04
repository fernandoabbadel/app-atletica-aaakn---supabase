import {
  setEventRsvpDetailed as setEventRsvpNative,
  toggleEventLike as toggleEventLikeNative,
} from "./eventsNativeService";
import { throwSupabaseError } from "./supabaseData";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 20_000;
const DEFAULT_PREVIEW_RESULTS = 4;
const MAX_PREVIEW_RESULTS = 12;

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

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("eventos_rsvps")
    .select("status")
    .eq("eventoId", eventId)
    .eq("userId", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);
  return normalizeStatus(asObject(data)?.status ?? data?.status);
}

async function fetchPreviewAvatars(
  eventId: string,
  previewLimit: number
): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("eventos_rsvps")
    .select("userAvatar")
    .eq("eventoId", eventId)
    .eq("status", "going")
    .limit(previewLimit);
  if (error) throwSupabaseError(error);

  const avatars = (data ?? [])
    .map((entry) => asString(asObject(entry)?.userAvatar).trim())
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

  await toggleEventLikeNative({
    eventId,
    userId,
    currentlyLiked: payload.currentlyLiked,
  });

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

  await setEventRsvpNative({
    eventId,
    userId,
    status,
    userName: requestPayload.userName,
    userAvatar: requestPayload.userAvatar,
    userTurma: requestPayload.userTurma,
  });

  invalidateEventCardCache(eventId);
}

export function clearEventCardCaches(): void {
  eventCardStateCache.clear();
}


