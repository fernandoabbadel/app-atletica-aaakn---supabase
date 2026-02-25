import { getSupabaseClient } from "./supabase";

export interface AlbumUiConfig {
  capa: string;
  titulo: string;
  subtitulo: string;
}

type CacheEntry<T> = { cachedAt: number; value: T };
const READ_CACHE_TTL_MS = 45_000;
const ALBUM_UI_DOC_COLLECTION = "app_config";
const ALBUM_UI_DOC_ID = "album_ui";
let albumUiCache: CacheEntry<AlbumUiConfig | null> | null = null;

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

export async function fetchAlbumUiConfig(): Promise<AlbumUiConfig | null> {
  const supabase = getSupabaseClient();
  if (albumUiCache && Date.now() - albumUiCache.cachedAt <= READ_CACHE_TTL_MS) {
    return albumUiCache.value;
  }

  const { data, error } = await supabase
    .from(ALBUM_UI_DOC_COLLECTION)
    .select("capa,titulo,subtitulo,data")
    .eq("id", ALBUM_UI_DOC_ID)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  if (!data) {
    albumUiCache = { cachedAt: Date.now(), value: null };
    return null;
  }

  const row = asObject(data) ?? {};
  const dataField = asObject(row.data) ?? {};
  const config = toAlbumUiConfig({
    capa: row.capa ?? dataField.capa,
    titulo: row.titulo ?? dataField.titulo,
    subtitulo: row.subtitulo ?? dataField.subtitulo,
  });

  albumUiCache = { cachedAt: Date.now(), value: config };
  return config;
}

export async function saveAlbumUiConfig(config: AlbumUiConfig): Promise<void> {
  const supabase = getSupabaseClient();
  const normalized = toAlbumUiConfig(config as unknown as Record<string, unknown>);

  const { error } = await supabase.from(ALBUM_UI_DOC_COLLECTION).upsert(
    {
      id: ALBUM_UI_DOC_ID,
      capa: normalized.capa,
      titulo: normalized.titulo,
      subtitulo: normalized.subtitulo,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throwSupabaseError(error);
  albumUiCache = { cachedAt: Date.now(), value: normalized };
}
