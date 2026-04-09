import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

export interface LigasUscUiConfig {
  titulo: string;
  subtitulo: string;
  rotuloCard: string;
}

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;
const LIGAS_USC_UI_DOC_COLLECTION = "app_config";
const LIGAS_USC_UI_DOC_ID = "ligas_usc_ui";

export const DEFAULT_LIGAS_USC_UI_CONFIG: LigasUscUiConfig = {
  titulo: "LIGAS USC",
  subtitulo: "Ecossistema Acad\u00eamico",
  rotuloCard: "Liga USC",
};

const ligasUscUiCache = new Map<string, CacheEntry<LigasUscUiConfig>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const normalizeText = (value: unknown, fallback: string): string => {
  const cleanValue = asString(value).trim();
  return cleanValue || fallback;
};

const toLigasUscUiConfig = (
  raw: Record<string, unknown>,
  fallback: LigasUscUiConfig = DEFAULT_LIGAS_USC_UI_CONFIG
): LigasUscUiConfig => ({
  titulo: normalizeText(raw.titulo, fallback.titulo),
  subtitulo: normalizeText(raw.subtitulo, fallback.subtitulo),
  rotuloCard: normalizeText(raw.rotuloCard, fallback.rotuloCard),
});

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const resolveLigasUscUiCacheKey = (tenantId?: string): string => {
  const cleanTenantId = resolveStoredTenantScopeId(asString(tenantId).trim());
  return cleanTenantId || "default";
};

const resolveLigasUscUiDocIds = (tenantId?: string): string[] => {
  const cleanTenantId = resolveStoredTenantScopeId(asString(tenantId).trim());
  if (!cleanTenantId) return [LIGAS_USC_UI_DOC_ID];
  return [buildTenantScopedRowId(cleanTenantId, LIGAS_USC_UI_DOC_ID)];
};

export async function fetchLigasUscUiConfig(options?: {
  tenantId?: string;
}): Promise<LigasUscUiConfig> {
  const supabase = getSupabaseClient();
  const cacheKey = resolveLigasUscUiCacheKey(options?.tenantId);
  const cached = ligasUscUiCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const docIds = resolveLigasUscUiDocIds(options?.tenantId);
  const { data, error } = await supabase
    .from(LIGAS_USC_UI_DOC_COLLECTION)
    .select("id,titulo,subtitulo,data")
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
    ligasUscUiCache.set(cacheKey, {
      cachedAt: Date.now(),
      value: DEFAULT_LIGAS_USC_UI_CONFIG,
    });
    return DEFAULT_LIGAS_USC_UI_CONFIG;
  }

  const row = asObject(rowMatch) ?? {};
  const dataField = asObject(row.data) ?? {};
  const config = toLigasUscUiConfig({
    titulo: row.titulo ?? dataField.titulo,
    subtitulo: row.subtitulo ?? dataField.subtitulo,
    rotuloCard: dataField.rotuloCard,
  });

  ligasUscUiCache.set(cacheKey, {
    cachedAt: Date.now(),
    value: config,
  });

  return config;
}

export async function saveLigasUscUiConfig(
  config: LigasUscUiConfig,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const normalized = toLigasUscUiConfig(config as unknown as Record<string, unknown>);
  const scopedTenantId = resolveStoredTenantScopeId(asString(options?.tenantId).trim());
  const docId =
    buildTenantScopedRowId(scopedTenantId, LIGAS_USC_UI_DOC_ID) || LIGAS_USC_UI_DOC_ID;

  const { error } = await supabase.from(LIGAS_USC_UI_DOC_COLLECTION).upsert(
    {
      id: docId,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      titulo: normalized.titulo,
      subtitulo: normalized.subtitulo,
      data: normalized,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throwSupabaseError(error);

  ligasUscUiCache.set(resolveLigasUscUiCacheKey(options?.tenantId), {
    cachedAt: Date.now(),
    value: normalized,
  });
}
