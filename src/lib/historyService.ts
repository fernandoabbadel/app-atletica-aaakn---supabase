import { httpsCallable } from "@/lib/supa/functions";
import { getDownloadURL, ref, uploadBytes } from "@/lib/supa/storage";

import { functions, storage } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { throwSupabaseError } from "./supabaseData";
import { getSupabaseClient } from "./supabase";
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
const nowIso = (): string => new Date().toISOString();

const eventsCache = new Map<string, CacheEntry<HistoricEventRecord[]>>();
let configCache: CacheEntry<HistoryPageConfig | null> | null = null;

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

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

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter(
    (column) => column.toLowerCase() !== missingColumn.toLowerCase()
  );
  if (next.length === columns.length) return null;
  return next;
};

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
    tituloPagina: asString(data.tituloPagina, "Nossa Historia").trim().slice(0, 120),
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

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("historic_events")
    .select("id,titulo,data,ano,descricao,local,foto")
    .order("data", { ascending: order === "asc" })
    .limit(maxResults);
  if (error) throwSupabaseError(error);

  const events = (data ?? [])
    .map((row) => normalizeHistoricEvent(asString((row as Record<string, unknown>).id), row))
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

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "tituloPagina", "subtituloPagina", "fotoCapa", "data"];
  let data: Record<string, unknown> | null = null;

  while (selectColumns.length > 0) {
    const response = await supabase
      .from("app_config")
      .select(selectColumns.join(","))
      .eq("id", "historico")
      .maybeSingle();

    if (!response.error) {
      data = asObject(response.data);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(response.error));
    const nextColumns =
      removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (nextColumns.length === 0) throwSupabaseError(response.error);
    selectColumns = nextColumns;
  }

  if (!data) {
    configCache = { cachedAt: Date.now(), value: null };
    return null;
  }

  const nestedData = asObject(data.data);
  const config = normalizePageConfig(nestedData ?? data);
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
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("historic_events")
      .insert({
        ...requestPayload,
        updatedAt: nowIso(),
      })
      .select("id")
      .single();
    if (error) throwSupabaseError(error);

    const id = asString((data as Record<string, unknown> | null)?.id);
    if (!id) throw new Error("Falha ao criar evento historico.");
    return { id };
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
      const supabase = getSupabaseClient();
      const { id: payloadId, ...docPayload } = requestPayload;
      void payloadId;
      const { error } = await supabase
        .from("historic_events")
        .update({
          ...docPayload,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (error) throwSupabaseError(error);
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
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("historic_events").delete().eq("id", cleanId);
      if (error) throwSupabaseError(error);
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
      const supabase = getSupabaseClient();
      const mutablePayload: Record<string, unknown> = {
        id: "historico",
        ...payload,
        data: payload,
        updatedAt: nowIso(),
      };

      while (true) {
        const { error } = await supabase.from("app_config").upsert(mutablePayload, {
          onConflict: "id",
        });
        if (!error) break;

        const missingColumn = asString(extractMissingSchemaColumn(error)).toLowerCase();
        if (!missingColumn) throwSupabaseError(error);

        const removableKey = Object.keys(mutablePayload).find(
          (key) => key !== "id" && key.toLowerCase() === missingColumn
        );
        if (!removableKey) throwSupabaseError(error);

        delete mutablePayload[String(removableKey)];
      }

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
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("historic_events")
        .insert(safeEvents.map((eventData) => ({ ...eventData, updatedAt: nowIso() })));
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearReadCaches();
}


