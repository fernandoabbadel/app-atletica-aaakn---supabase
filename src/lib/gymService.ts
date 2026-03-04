import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type QueryConstraint,
} from "@/lib/supabaseHelpers";
import { getDownloadURL, ref, uploadBytes } from "@/lib/supa/storage";

import { compressImageFile } from "./imageCompression";
import { db, functions, storage } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { validateImageFile } from "./upload";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

type RawRow = Record<string, unknown>;

const TTL_MS = 20_000;
const MAX_FEED_POSTS = 160;
const CHECKIN_XP_REWARD = 50;

const CALLABLE_GYM_TOGGLE_LIKE = "gymTogglePostLike";
const CALLABLE_GYM_CREATE_CHECKIN = "gymCreateCheckin";

const feedCache = new Map<string, CacheEntry<GymPostRecord[]>>();

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isIndexRequired = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

const shouldFallbackToClient = (error: unknown): boolean => {
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
    if (shouldFallbackToClient(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

async function queryRows(path: string, attempts: QueryConstraint[][]): Promise<RawRow[]> {
  const safeAttempts = attempts.filter((entry) => entry.length > 0);
  if (!safeAttempts.length) return [];

  let lastError: unknown = null;
  for (let i = 0; i < safeAttempts.length; i += 1) {
    try {
      const snap = await getDocs(query(collection(db, path), ...safeAttempts[i]));
      return snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as RawRow) }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = i === safeAttempts.length - 1;
      if (!isIndexRequired(error) || isLast) throw error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

export interface GymPostRecord {
  id: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioAvatar: string;
  titulo: string;
  modalidade: string;
  legenda: string;
  data: string;
  tempo: string;
  foto: string;
  isChallenge: boolean;
  validado: boolean;
  likes: number;
  likedBy: string[];
  comentarios: unknown[];
}

const normalizePost = (raw: RawRow): GymPostRecord => ({
  id: asString(raw.id),
  usuarioId: asString(raw.usuarioId),
  usuarioNome: asString(raw.usuarioNome, "Atleta"),
  usuarioAvatar: asString(raw.usuarioAvatar, "https://github.com/shadcn.png"),
  titulo: asString(raw.titulo, "Treino"),
  modalidade: asString(raw.modalidade, "Treino"),
  legenda: asString(raw.legenda),
  data: asString(raw.data, "Hoje"),
  tempo: asString(raw.tempo),
  foto: asString(raw.foto),
  isChallenge: Boolean(raw.isChallenge),
  validado: Boolean(raw.validado),
  likes: Math.max(0, asNumber(raw.likes, 0)),
  likedBy: asStringList(raw.likedBy),
  comentarios: Array.isArray(raw.comentarios) ? raw.comentarios : [],
});

export async function fetchGymFeed(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<GymPostRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_FEED_POSTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(feedCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("posts", [
    [orderBy("createdAt", "desc"), limit(maxResults)],
    [orderBy("data", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);

  const posts = rows.map((entry) => normalizePost(entry));
  setCache(feedCache, cacheKey, posts);
  return posts;
}

export async function toggleGymPostLike(payload: {
  postId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const postId = payload.postId.trim();
  const userId = payload.userId.trim();
  if (!postId || !userId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_GYM_TOGGLE_LIKE,
    payload,
    async () => {
      await updateDoc(doc(db, "posts", postId), {
        likes: increment(payload.currentlyLiked ? -1 : 1),
        likedBy: payload.currentlyLiked ? arrayRemove(userId) : arrayUnion(userId),
      });
      return { ok: true };
    }
  );

  feedCache.clear();
}

const convertDataUrlToFile = async (dataUrl: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return new File([blob], `checkin_${Date.now()}.${extension}`, {
    type: blob.type || "image/jpeg",
    lastModified: Date.now(),
  });
};

export async function submitGymCheckin(payload: {
  userId: string;
  userName: string;
  userAvatar?: string;
  selectedType: string;
  title: string;
  photoDataUrl: string;
}): Promise<{ postId: string; photoUrl: string }> {
  const userId = payload.userId.trim();
  if (!userId) throw new Error("Usuario invalido.");

  const originalFile = await convertDataUrlToFile(payload.photoDataUrl);
  const sourceValidationError = validateImageFile(originalFile);
  if (sourceValidationError) {
    throw new Error(sourceValidationError);
  }

  const compressedFile = await compressImageFile(originalFile, {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8,
  });

  const compressedValidationError = validateImageFile(compressedFile);
  if (compressedValidationError) {
    throw new Error(compressedValidationError);
  }

  const timestamp = Date.now();
  const storageRef = ref(storage, `posts/${userId}/${timestamp}_${compressedFile.name}`);
  await uploadBytes(storageRef, compressedFile);
  const photoUrl = await getDownloadURL(storageRef);

  const requestPayload = {
    userId,
    userName: payload.userName.trim() || "Atleta AAAKN",
    userAvatar: payload.userAvatar?.trim() || "https://github.com/shadcn.png",
    selectedType: payload.selectedType.trim() || "Treino",
    title: payload.title.trim().slice(0, 80),
    photoUrl,
  };

  const response = await callWithFallback<typeof requestPayload, { postId: string }>(
    CALLABLE_GYM_CREATE_CHECKIN,
    requestPayload,
    async () => {
      const postRef = await addDoc(collection(db, "posts"), {
        usuarioId: requestPayload.userId,
        usuarioNome: requestPayload.userName,
        usuarioAvatar: requestPayload.userAvatar,
        titulo: requestPayload.title,
        modalidade: requestPayload.selectedType,
        legenda: `Treino de ${requestPayload.selectedType} pago!`,
        foto: requestPayload.photoUrl,
        isChallenge: false,
        validado: true,
        likes: 0,
        likedBy: [],
        comentarios: [],
        createdAt: serverTimestamp(),
        data: "Hoje",
        tempo: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      await updateDoc(doc(db, "users", requestPayload.userId), {
        xp: increment(CHECKIN_XP_REWARD),
      });

      return { postId: postRef.id };
    }
  );

  feedCache.clear();
  return { postId: response.postId, photoUrl };
}

export function clearGymCaches(): void {
  feedCache.clear();
}


