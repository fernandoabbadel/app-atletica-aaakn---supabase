import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

export interface AlbumUiConfig {
  capa: string;
  titulo: string;
  subtitulo: string;
}

type CacheEntry<T> = { cachedAt: number; value: T };

const READ_CACHE_TTL_MS = 45_000;
const ALBUM_UI_DOC_COLLECTION = "app_config";
const ALBUM_UI_DOC_ID = "album_ui";

const albumUiCache = new Map<string, CacheEntry<AlbumUiConfig | null>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const toAlbumUiConfig = (raw: Record<string, unknown>): AlbumUiConfig => ({
  capa: asString(raw.capa),
  titulo: asString(raw.titulo),
  subtitulo: asString(raw.subtitulo),
});

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const resolveAlbumUiCacheKey = (tenantId?: string): string => {
  const cleanTenantId = asString(tenantId).trim();
  return cleanTenantId || "default";
};

const resolveAlbumUiDocIds = (tenantId?: string): string[] => {
  const cleanTenantId = asString(tenantId).trim();
  if (!cleanTenantId) return [ALBUM_UI_DOC_ID];
  return [buildTenantScopedRowId(cleanTenantId, ALBUM_UI_DOC_ID), ALBUM_UI_DOC_ID];
};

export async function fetchAlbumUiConfig(options?: {
  tenantId?: string;
}): Promise<AlbumUiConfig | null> {
  const supabase = getSupabaseClient();
  const cacheKey = resolveAlbumUiCacheKey(options?.tenantId);
  const cached = albumUiCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const docIds = resolveAlbumUiDocIds(options?.tenantId);
  const { data, error } = await supabase
    .from(ALBUM_UI_DOC_COLLECTION)
    .select("id,capa,titulo,subtitulo,data")
    .in("id", docIds);

  if (error) throwSupabaseError(error);
  const rows = Array.isArray(data)
    ? data
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const rowMatch = docIds
    .map((docId) => rows.find((row) => asString(row.id) === docId))
    .find((entry) => Boolean(entry));
  if (!rowMatch) {
    albumUiCache.set(cacheKey, { cachedAt: Date.now(), value: null });
    return null;
  }

  const row = asObject(rowMatch) ?? {};
  const dataField = asObject(row.data) ?? {};
  const config = toAlbumUiConfig({
    capa: row.capa ?? dataField.capa,
    titulo: row.titulo ?? dataField.titulo,
    subtitulo: row.subtitulo ?? dataField.subtitulo,
  });

  albumUiCache.set(cacheKey, { cachedAt: Date.now(), value: config });
  return config;
}

export async function saveAlbumUiConfig(
  config: AlbumUiConfig,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const normalized = toAlbumUiConfig(config as unknown as Record<string, unknown>);
  const docId = buildTenantScopedRowId(options?.tenantId, ALBUM_UI_DOC_ID) || ALBUM_UI_DOC_ID;

  const { error } = await supabase.from(ALBUM_UI_DOC_COLLECTION).upsert(
    {
      id: docId,
      capa: normalized.capa,
      titulo: normalized.titulo,
      subtitulo: normalized.subtitulo,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throwSupabaseError(error);
  albumUiCache.set(resolveAlbumUiCacheKey(options?.tenantId), {
    cachedAt: Date.now(),
    value: normalized,
  });
}
