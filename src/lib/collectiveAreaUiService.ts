import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

export type CollectiveAreaKey = "comissoes" | "diretorio";

export interface CollectiveAreaUiConfig {
  titulo: string;
  subtitulo: string;
  rotuloCard: string;
  sidebarLabel: string;
  customCss: string;
  managerUserIds: string[];
}

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;
const APP_CONFIG_COLLECTION = "app_config";
const uiCache = new Map<string, CacheEntry<CollectiveAreaUiConfig>>();

const DEFAULT_CONFIG_BY_AREA: Record<CollectiveAreaKey, CollectiveAreaUiConfig> = {
  comissoes: {
    titulo: "COMISSÕES",
    subtitulo: "Representação por turma",
    rotuloCard: "Comissão",
    sidebarLabel: "Comissões",
    customCss: "",
    managerUserIds: [],
  },
  diretorio: {
    titulo: "DIRETÓRIO",
    subtitulo: "Organização acadêmica",
    rotuloCard: "Diretório",
    sidebarLabel: "Diretório",
    customCss: "",
    managerUserIds: [],
  },
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const normalizeText = (value: unknown, fallback: string): string => {
  const clean = asString(value).trim();
  return clean || fallback;
};

const normalizeUserIds = (value: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );

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

const resolveDocId = (area: CollectiveAreaKey, tenantId?: string): string => {
  const cleanTenantId = resolveStoredTenantScopeId(asString(tenantId).trim());
  const baseId = `${area}_ui`;
  return buildTenantScopedRowId(cleanTenantId, baseId) || baseId;
};

const resolveCacheKey = (area: CollectiveAreaKey, tenantId?: string): string => {
  const cleanTenantId = resolveStoredTenantScopeId(asString(tenantId).trim());
  return `${area}:${cleanTenantId || "default"}`;
};

const normalizeConfig = (
  area: CollectiveAreaKey,
  raw: Record<string, unknown>
): CollectiveAreaUiConfig => {
  const fallback = DEFAULT_CONFIG_BY_AREA[area];
  return {
    titulo: normalizeText(raw.titulo, fallback.titulo),
    subtitulo: normalizeText(raw.subtitulo, fallback.subtitulo),
    rotuloCard: normalizeText(raw.rotuloCard, fallback.rotuloCard),
    sidebarLabel: normalizeText(raw.sidebarLabel, fallback.sidebarLabel),
    customCss: asString(raw.customCss, fallback.customCss),
    managerUserIds: normalizeUserIds(raw.managerUserIds),
  };
};

export const getDefaultCollectiveAreaUiConfig = (
  area: CollectiveAreaKey
): CollectiveAreaUiConfig => ({
  ...DEFAULT_CONFIG_BY_AREA[area],
  managerUserIds: [...DEFAULT_CONFIG_BY_AREA[area].managerUserIds],
});

export async function fetchCollectiveAreaUiConfig(payload: {
  area: CollectiveAreaKey;
  tenantId?: string;
}): Promise<CollectiveAreaUiConfig> {
  const supabase = getSupabaseClient();
  const cacheKey = resolveCacheKey(payload.area, payload.tenantId);
  const cached = uiCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const docId = resolveDocId(payload.area, payload.tenantId);
  const { data, error } = await supabase
    .from(APP_CONFIG_COLLECTION)
    .select("id,titulo,subtitulo,data")
    .eq("id", docId)
    .maybeSingle();

  if (error) throwSupabaseError(error);

  const row = asObject(data) ?? {};
  const dataField = asObject(row.data) ?? {};
  const config = normalizeConfig(payload.area, {
    titulo: row.titulo ?? dataField.titulo,
    subtitulo: row.subtitulo ?? dataField.subtitulo,
    rotuloCard: dataField.rotuloCard,
    sidebarLabel: dataField.sidebarLabel,
    customCss: dataField.customCss,
    managerUserIds: dataField.managerUserIds,
  });

  uiCache.set(cacheKey, { cachedAt: Date.now(), value: config });
  return config;
}

export async function saveCollectiveAreaUiConfig(payload: {
  area: CollectiveAreaKey;
  config: CollectiveAreaUiConfig;
  tenantId?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const normalized = normalizeConfig(payload.area, payload.config as unknown as Record<string, unknown>);
  const scopedTenantId = resolveStoredTenantScopeId(asString(payload.tenantId).trim());
  const docId = resolveDocId(payload.area, scopedTenantId);

  const { error } = await supabase.from(APP_CONFIG_COLLECTION).upsert(
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

  uiCache.set(resolveCacheKey(payload.area, payload.tenantId), {
    cachedAt: Date.now(),
    value: normalized,
  });
}
