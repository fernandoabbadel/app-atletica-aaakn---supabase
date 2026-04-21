import { httpsCallable } from "@/lib/supa/functions";
import { getDownloadURL, ref, uploadBytes } from "@/lib/supa/storage";

import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { compressImageFile } from "./imageCompression";
import { functions, storage } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { incrementUserStats } from "./supabaseData";
import { getSupabaseClient } from "./supabase";
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

const POSTS_SELECT_COLUMNS =
  "id,usuarioId,usuarioNome,usuarioAvatar,titulo,modalidade,legenda,data,tempo,foto,isChallenge,validado,likes,likedBy,comentarios,createdAt";

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

const resolveGymTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(tenantId);

const isMissingColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown };
  if (typeof raw.code === "string" && raw.code === "42703") return true;
  const message = typeof raw.message === "string" ? raw.message.toLowerCase() : "";
  return message.includes("column") && message.includes("does not exist");
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

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
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

async function queryPostsWithFallback(maxResults: number, tenantId?: string | null): Promise<RawRow[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveGymTenantId(tenantId);
  const attempts: Array<"createdAt" | "data" | null> = ["createdAt", "data", null];

  for (const orderField of attempts) {
    let request = supabase.from("posts").select(POSTS_SELECT_COLUMNS).limit(maxResults);
    if (scopedTenantId) {
      request = request.eq("tenant_id", scopedTenantId);
    }
    if (orderField) {
      request = request.order(orderField, { ascending: false });
    }

    const { data, error } = await request;
    if (!error) return (data ?? []) as RawRow[];
    if (orderField && isMissingColumnError(error)) {
      continue;
    }
    throwSupabaseError(error);
  }

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
  tenantId?: string | null;
}): Promise<GymPostRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_FEED_POSTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = resolveGymTenantId(options?.tenantId);
  const cacheKey = `${tenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(feedCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryPostsWithFallback(maxResults, tenantId);
  const posts = rows.map((entry) => normalizePost(entry));
  setCache(feedCache, cacheKey, posts);
  return posts;
}

export async function toggleGymPostLike(payload: {
  postId: string;
  userId: string;
  currentlyLiked: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const postId = payload.postId.trim();
  const userId = payload.userId.trim();
  const scopedTenantId = resolveGymTenantId(payload.tenantId);
  if (!postId || !userId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_GYM_TOGGLE_LIKE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      let postQuery = supabase
        .from("posts")
        .select("likedBy,likes")
        .eq("id", postId);
      if (scopedTenantId) {
        postQuery = postQuery.eq("tenant_id", scopedTenantId);
      }
      const { data: postData, error: postError } = await postQuery.maybeSingle();
      if (postError) throwSupabaseError(postError);

      const currentLikedBy = asStringList(postData?.likedBy);
      const likedBySet = new Set(currentLikedBy);
      if (payload.currentlyLiked) {
        likedBySet.delete(userId);
      } else {
        likedBySet.add(userId);
      }
      const nextLikedBy = Array.from(likedBySet);
      const nextLikes = Math.max(0, asNumber(postData?.likes, currentLikedBy.length) + (payload.currentlyLiked ? -1 : 1));

      let updateQuery = supabase
        .from("posts")
        .update({
          likes: nextLikes,
          likedBy: nextLikedBy,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", postId);
      if (scopedTenantId) {
        updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throwSupabaseError(updateError);

      try {
        await incrementUserStats(
          userId,
          {
            trainingLikesGiven: payload.currentlyLiked ? -1 : 1,
            likesGiven: payload.currentlyLiked ? -1 : 1,
          },
          { tenantId: scopedTenantId || undefined }
        );
      } catch (statsError: unknown) {
        console.warn("Gym: falha ao sincronizar curtida do check-in.", statsError);
      }

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
  tenantId?: string | null;
}): Promise<{ postId: string; photoUrl: string }> {
  const userId = payload.userId.trim();
  const scopedTenantId = resolveGymTenantId(payload.tenantId);
  if (!userId) throw new Error("Usuário inválido.");

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
    userName: payload.userName.trim() || "Atleta",
    userAvatar: payload.userAvatar?.trim() || "https://github.com/shadcn.png",
    selectedType: payload.selectedType.trim() || "Treino",
    title: payload.title.trim().slice(0, 80),
    photoUrl,
  };

  const response = await callWithFallback<typeof requestPayload, { postId: string }>(
    CALLABLE_GYM_CREATE_CHECKIN,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const now = new Date();
      const nowIso = now.toISOString();

      const { data: postRow, error: postError } = await supabase
        .from("posts")
        .insert({
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
          createdAt: nowIso,
          updatedAt: nowIso,
          data: "Hoje",
          tempo: now.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        })
        .select("id")
        .single();
      if (postError) throwSupabaseError(postError);

      try {
        await incrementUserStats(
          requestPayload.userId,
          { gymCheckins: 1 },
          {
            tenantId: scopedTenantId || undefined,
            xpDelta: CHECKIN_XP_REWARD,
          }
        );
      } catch (statsError: unknown) {
        console.warn("Gym: falha ao sincronizar XP do check-in.", statsError);
      }

      return { postId: asString((postRow as RawRow | null)?.id) };
    }
  );

  feedCache.clear();
  return { postId: response.postId, photoUrl };
}

export function clearGymCaches(): void {
  feedCache.clear();
}
