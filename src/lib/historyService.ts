import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, functions, storage } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";
import { validateImageFile } from "./upload";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;
const MAX_HISTORY_EVENTS = 260;

const HISTORY_CREATE_EVENT_CALLABLE = "historyCreateEvent";
const HISTORY_UPDATE_EVENT_CALLABLE = "historyUpdateEvent";
const HISTORY_DELETE_EVENT_CALLABLE = "historyDeleteEvent";
const HISTORY_SAVE_CONFIG_CALLABLE = "historySavePageConfig";
const HISTORY_SEED_CALLABLE = "historySeedEvents";

const eventsCache = new Map<string, CacheEntry<HistoricEventRecord[]>>();
let configCache: CacheEntry<HistoryPageConfig | null> | null = null;

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

const getCacheValue = <T>(
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

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearReadCaches = (): void => {
  eventsCache.clear();
  configCache = null;
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

export interface HistoricEventRecord {
  id: string;
  titulo: string;
  data: string;
  ano: string;
  descricao: string;
  local: string;
  foto: string;
}

export interface HistoryPageConfig {
  tituloPagina: string;
  subtituloPagina: string;
  fotoCapa: string;
}

const normalizeHistoricEvent = (
  id: string,
  raw: unknown
): HistoricEventRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const eventDate = asString(data.data).trim().slice(0, 10);
  return {
    id,
    titulo: asString(data.titulo, "Evento").trim().slice(0, 120),
    data: eventDate,
    ano: asString(data.ano, eventDate.slice(0, 4)).trim().slice(0, 4) || eventDate.slice(0, 4),
    descricao: asString(data.descricao).trim().slice(0, 2_000),
    local: asString(data.local).trim().slice(0, 120),
    foto: asString(data.foto).trim().slice(0, 600),
  };
};

const normalizePageConfig = (raw: unknown): HistoryPageConfig => {
  const data = asObject(raw) ?? {};
  return {
    tituloPagina: asString(data.tituloPagina, "Nossa História").trim().slice(0, 120),
    subtituloPagina: asString(data.subtituloPagina, "Carregando legado...").trim().slice(0, 240),
    fotoCapa: asString(data.fotoCapa).trim().slice(0, 600),
  };
};

export async function fetchHistoricEvents(options?: {
  order?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<HistoricEventRecord[]> {
  const order = options?.order ?? "desc";
  const maxResults = boundedLimit(options?.maxResults ?? 180, MAX_HISTORY_EVENTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${order}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(eventsCache, cacheKey);
    if (cached) return cached;
  }

  const q = query(
    collection(db, "historic_events"),
    orderBy("data", order),
    limit(maxResults)
  );
  const snap = await getDocs(q);

  const events = snap.docs
    .map((row) => normalizeHistoricEvent(row.id, row.data()))
    .filter((row): row is HistoricEventRecord => row !== null);

  setCacheValue(eventsCache, cacheKey, events);
  return events;
}

export async function fetchHistoryPageConfig(options?: {
  forceRefresh?: boolean;
}): Promise<HistoryPageConfig | null> {
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh && configCache && Date.now() - configCache.cachedAt <= READ_CACHE_TTL_MS) {
    return configCache.value;
  }

  const snap = await getDoc(doc(db, "app_config", "historico"));
  if (!snap.exists()) {
    configCache = { cachedAt: Date.now(), value: null };
    return null;
  }

  const config = normalizePageConfig(snap.data());
  configCache = { cachedAt: Date.now(), value: config };
  return config;
}

export async function uploadHistoryImage(
  file: File,
  pathPrefix: string
): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const safePathPrefix = pathPrefix.trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  const fileName = `${Date.now()}_${safeName}`;
  const storageRef = ref(storage, `${safePathPrefix}/${fileName}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function createHistoricEvent(
  payload: Omit<HistoricEventRecord, "id">
): Promise<{ id: string }> {
  const safePayload = normalizeHistoricEvent("temp", payload);
  if (!safePayload) throw new Error("Evento inválido.");

  const { id: _discardedId, ...requestPayload } = safePayload;
  void _discardedId;

  const result = await callWithFallback<
    typeof requestPayload,
    { id: string }
  >(HISTORY_CREATE_EVENT_CALLABLE, requestPayload, async () => {
    const ref = await addDoc(collection(db, "historic_events"), {
      ...requestPayload,
      updatedAt: serverTimestamp(),
    });
    return { id: ref.id };
  });

  clearReadCaches();
  return result;
}

export async function updateHistoricEvent(
  id: string,
  payload: Omit<HistoricEventRecord, "id">
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  const safePayload = normalizeHistoricEvent(cleanId, payload);
  if (!safePayload) throw new Error("Evento inválido.");

  const requestPayload = safePayload;
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    HISTORY_UPDATE_EVENT_CALLABLE,
    requestPayload,
    async () => {
      const { id: payloadId, ...docPayload } = requestPayload;
      void payloadId;
      await updateDoc(doc(db, "historic_events", cleanId), {
        ...docPayload,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function deleteHistoricEvent(id: string): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;

  await callWithFallback<{ id: string }, { ok: boolean }>(
    HISTORY_DELETE_EVENT_CALLABLE,
    { id: cleanId },
    async () => {
      await deleteDoc(doc(db, "historic_events", cleanId));
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function saveHistoryPageConfig(
  config: HistoryPageConfig
): Promise<void> {
  const payload = normalizePageConfig(config);
  await callWithFallback<typeof payload, { ok: boolean }>(
    HISTORY_SAVE_CONFIG_CALLABLE,
    payload,
    async () => {
      await setDoc(
        doc(db, "app_config", "historico"),
        { ...payload, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { ok: true };
    }
  );

  clearReadCaches();
}

export async function seedHistoricEvents(
  events: Omit<HistoricEventRecord, "id">[]
): Promise<void> {
  const safeEvents = events
    .slice(0, MAX_HISTORY_EVENTS)
    .map((row) => normalizeHistoricEvent(String(Date.now()), row))
    .filter((row): row is HistoricEventRecord => row !== null)
    .map((row) => ({
      titulo: row.titulo,
      data: row.data,
      ano: row.ano,
      descricao: row.descricao,
      local: row.local,
      foto: row.foto,
    }));

  if (!safeEvents.length) return;

  await callWithFallback<{ events: Omit<HistoricEventRecord, "id">[] }, { ok: boolean }>(
    HISTORY_SEED_CALLABLE,
    { events: safeEvents },
    async () => {
      const batch = writeBatch(db);
      safeEvents.forEach((eventData) => {
        const ref = doc(collection(db, "historic_events"));
        batch.set(ref, { ...eventData, updatedAt: serverTimestamp() });
      });
      await batch.commit();
      return { ok: true };
    }
  );

  clearReadCaches();
}
