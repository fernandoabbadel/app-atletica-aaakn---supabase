import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  dedupeCadastroSportOptions,
  getDefaultCadastroFieldConfig,
  getDefaultCadastroSportOptions,
  type CadastroFieldConfig,
  type CadastroFieldConfigMap,
  type CadastroSportOption,
} from "./cadastroOptions";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

export type CadastroConfig = {
  fields: CadastroFieldConfigMap;
  sportOptions: CadastroSportOption[];
};

const CADASTRO_CONFIG_DOC_ID = "cadastro_config";
const CADASTRO_CONFIG_SELECT_COLUMNS = "id,data,updatedAt,createdAt";
const READ_CACHE_TTL_MS = 120_000;

const cadastroConfigCache = new Map<string, CacheEntry<CadastroConfig>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const nowIso = (): string => new Date().toISOString();

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

const getCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const resolveCadastroConfigTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveCadastroConfigDocId = (tenantId?: string | null): string =>
  buildTenantScopedRowId(resolveCadastroConfigTenantId(tenantId), CADASTRO_CONFIG_DOC_ID) ||
  CADASTRO_CONFIG_DOC_ID;

const sanitizeFieldConfig = (
  raw: unknown,
  fallback: CadastroFieldConfig
): CadastroFieldConfig => {
  const data = asObject(raw);
  if (!data) return fallback;

  return {
    enabled: asBoolean(data.enabled, fallback.enabled),
    required: asBoolean(data.required, fallback.required),
  };
};

const sanitizeCadastroFieldConfigMap = (value: unknown): CadastroFieldConfigMap => {
  const defaults = getDefaultCadastroFieldConfig();
  const data = asObject(value);

  return {
    instagram: sanitizeFieldConfig(data?.instagram, defaults.instagram),
    bio: sanitizeFieldConfig(data?.bio, defaults.bio),
    statusRelacionamento: sanitizeFieldConfig(
      data?.statusRelacionamento,
      defaults.statusRelacionamento
    ),
    pets: sanitizeFieldConfig(data?.pets, defaults.pets),
    esportes: sanitizeFieldConfig(data?.esportes, defaults.esportes),
  };
};

const sanitizeCadastroConfig = (value: unknown): CadastroConfig => {
  const data = asObject(value);
  const defaults = getDefaultCadastroSportOptions();
  const configuredSports = dedupeCadastroSportOptions(
    Array.isArray(data?.sportOptions) ? (data?.sportOptions as Partial<CadastroSportOption>[]) : []
  );
  const mergedSports = new Map<string, CadastroSportOption>();

  defaults.forEach((entry) => mergedSports.set(entry.id, entry));
  configuredSports.forEach((entry) => mergedSports.set(entry.id, entry));

  return {
    fields: sanitizeCadastroFieldConfigMap(data?.fields),
    sportOptions: Array.from(mergedSports.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "pt-BR")
    ),
  };
};

export const getDefaultCadastroConfig = (): CadastroConfig => ({
  fields: getDefaultCadastroFieldConfig(),
  sportOptions: getDefaultCadastroSportOptions(),
});

export async function fetchCadastroConfig(options?: {
  tenantId?: string | null;
  forceRefresh?: boolean;
}): Promise<CadastroConfig> {
  const scopedTenantId = resolveCadastroConfigTenantId(options?.tenantId);
  const docId = resolveCadastroConfigDocId(scopedTenantId);
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh) {
    const cached = getCachedValue(cadastroConfigCache, docId);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select(CADASTRO_CONFIG_SELECT_COLUMNS)
    .eq("id", docId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const normalized = sanitizeCadastroConfig(asObject(data)?.data);
  setCachedValue(cadastroConfigCache, docId, normalized);
  return normalized;
}

export async function saveCadastroConfig(
  config: CadastroConfig,
  options?: { tenantId?: string | null }
): Promise<CadastroConfig> {
  const scopedTenantId = resolveCadastroConfigTenantId(options?.tenantId);
  const docId = resolveCadastroConfigDocId(scopedTenantId);
  const normalized = sanitizeCadastroConfig(config);

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: docId,
      data: normalized,
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCachedValue(cadastroConfigCache, docId, normalized);
  return normalized;
}

export function clearCadastroConfigCache(): void {
  cadastroConfigCache.clear();
}
