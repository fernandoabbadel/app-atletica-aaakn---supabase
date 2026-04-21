import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { compressImageFile } from "./imageCompression";
import { getSupabaseClient } from "./supabase";
import { getPublicObjectUrl, getStorage, parseStorageUrl, ref } from "./supa/storage";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import {
  appendAssetVersionQuery,
  buildFileMetadataVersionToken,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "./upload";

export interface CarteirinhaBackgroundAssetRef {
  bucket: string;
  path: string;
  versionToken?: string | null;
}

export interface CarteirinhaConfig {
  validade: string;
  backgrounds: Record<string, string>;
  backgroundAssets: Record<string, CarteirinhaBackgroundAssetRef>;
  backgroundOpacity: number;
}

const CONFIG_COLLECTION = "app_config";
const CONFIG_DOC_ID = "carteirinha";
const CACHE_KEY_PREFIX = "usc:carteirinha-config:v2";
export const CARTEIRINHA_CONFIG_SYNC_KEY = "usc:carteirinha-config:updated-at";
export const CARTEIRINHA_CONFIG_UPDATED_EVENT_NAME = "usc:carteirinha-config-updated";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 256 * 1024;

const DEFAULT_CONFIG: CarteirinhaConfig = {
  validade: "DEZ/2026",
  backgrounds: {},
  backgroundAssets: {},
  backgroundOpacity: 60,
};

const DEFAULT_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ||
  "uploads";

const createDefaultConfig = (): CarteirinhaConfig => ({
  validade: DEFAULT_CONFIG.validade,
  backgrounds: {},
  backgroundAssets: {},
  backgroundOpacity: DEFAULT_CONFIG.backgroundOpacity,
});

type CachedConfig = {
  cachedAt: number;
  value: CarteirinhaConfig;
};

const memoryCache = new Map<string, CachedConfig>();

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const normalizeTurmaCode = (value: unknown): string => {
  const input = asString(value).trim().toUpperCase();
  if (/^T\d{1,3}$/.test(input)) {
    return `T${String(Number(input.slice(1)))}`;
  }

  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  return `T${String(Number(digits))}`;
};

const isValidTurmaCode = (value: string): boolean => /^T\d{1,3}$/.test(value);

const resolveCarteirinhaTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveCarteirinhaCacheKey = (tenantId?: string | null): string => {
  const scopedTenantId = resolveCarteirinhaTenantId(tenantId);
  return scopedTenantId ? `${CACHE_KEY_PREFIX}:${scopedTenantId}` : CACHE_KEY_PREFIX;
};

export const resolveCarteirinhaConfigSyncKey = (tenantId?: string | null): string => {
  const scopedTenantId = resolveCarteirinhaTenantId(tenantId);
  return scopedTenantId
    ? `${CARTEIRINHA_CONFIG_SYNC_KEY}:${scopedTenantId}`
    : CARTEIRINHA_CONFIG_SYNC_KEY;
};

const resolveCarteirinhaDocIds = (tenantId?: string | null): string[] => {
  const scopedTenantId = resolveCarteirinhaTenantId(tenantId);
  if (!scopedTenantId) return [CONFIG_DOC_ID];
  return [buildTenantScopedRowId(scopedTenantId, CONFIG_DOC_ID)];
};

const resolveCarteirinhaDocId = (tenantId?: string | null): string => {
  const scopedTenantId = resolveCarteirinhaTenantId(tenantId);
  return buildTenantScopedRowId(scopedTenantId, CONFIG_DOC_ID) || CONFIG_DOC_ID;
};

const pickCarteirinhaRow = (
  rows: Array<Record<string, unknown>>,
  tenantId?: string | null
): Record<string, unknown> | null => {
  const candidates = resolveCarteirinhaDocIds(tenantId);
  for (const candidateId of candidates) {
    const match = rows.find((row) => asString(row.id).trim() === candidateId);
    if (match) return match;
  }
  return null;
};

const isBackgroundUrlAllowed = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith("data:")) return false;
  return value.startsWith("https://") || value.startsWith("http://") || value.startsWith("/");
};

const normalizeVersionToken = (value: unknown): string | null => {
  const token = asString(value).trim();
  return token || null;
};

const normalizeCarteirinhaBackgroundAssetRef = (
  value: unknown
): CarteirinhaBackgroundAssetRef | null => {
  if (typeof value === "string") {
    const parsed = parseStorageUrl(value);
    if (!parsed) return null;
    return {
      bucket: parsed.ref.bucket,
      path: parsed.ref.fullPath,
      versionToken: parsed.versionToken,
    };
  }

  const raw = asObject(value);
  if (!raw) return null;

  const bucket = asString(raw.bucket).trim();
  const path = asString(raw.path ?? raw.objectPath ?? raw.fullPath).trim();
  if (bucket && path) {
    return {
      bucket,
      path,
      versionToken: normalizeVersionToken(raw.versionToken),
    };
  }

  const parsedFromUrl = parseStorageUrl(asString(raw.url).trim());
  if (!parsedFromUrl) return null;
  return {
    bucket: parsedFromUrl.ref.bucket,
    path: parsedFromUrl.ref.fullPath,
    versionToken:
      normalizeVersionToken(raw.versionToken) ?? parsedFromUrl.versionToken,
  };
};

export const resolveCarteirinhaBackgroundUrl = (
  value: CarteirinhaBackgroundAssetRef | string | null | undefined
): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return isBackgroundUrlAllowed(normalized) ? normalized : null;
  }

  if (!value) return null;

  const baseUrl = getPublicObjectUrl(ref(getStorage(), `${value.bucket}:${value.path}`));
  return appendAssetVersionQuery(baseUrl, value.versionToken) || baseUrl;
};

const setNormalizedBackgroundEntry = (
  turma: string,
  rawValue: unknown,
  targetUrls: Record<string, string>,
  targetAssets: Record<string, CarteirinhaBackgroundAssetRef>
): void => {
  const turmaCode = normalizeTurmaCode(turma);
  if (!isValidTurmaCode(turmaCode)) return;

  const assetRef = normalizeCarteirinhaBackgroundAssetRef(rawValue);
  const resolvedUrl =
    resolveCarteirinhaBackgroundUrl(assetRef) ??
    resolveCarteirinhaBackgroundUrl(asString(rawValue).trim());

  if (assetRef) {
    targetAssets[turmaCode] = assetRef;
  }

  if (resolvedUrl) {
    targetUrls[turmaCode] = resolvedUrl;
  }
};

const serializeBackgroundAssets = (
  backgrounds: Record<string, CarteirinhaBackgroundAssetRef>
): Record<string, CarteirinhaBackgroundAssetRef> =>
  Object.fromEntries(
    Object.entries(backgrounds)
      .map(([turma, asset]) => {
        const turmaCode = normalizeTurmaCode(turma);
        if (!isValidTurmaCode(turmaCode)) return null;
        const normalizedAsset = normalizeCarteirinhaBackgroundAssetRef(asset);
        if (!normalizedAsset) return null;
        return [turmaCode, normalizedAsset];
      })
      .filter(
        (
          entry
        ): entry is [string, CarteirinhaBackgroundAssetRef] => entry !== null
      )
  );

const normalizeConfig = (raw: Record<string, unknown> | null): CarteirinhaConfig => {
  if (!raw) return createDefaultConfig();

  const rawValidade = asString(raw.validade, DEFAULT_CONFIG.validade).trim();
  const validade =
    rawValidade.length > 24 ? rawValidade.slice(0, 24) : rawValidade || DEFAULT_CONFIG.validade;

  const normalizedBackgrounds: Record<string, string> = {};
  const normalizedBackgroundAssets: Record<string, CarteirinhaBackgroundAssetRef> = {};
  const rawBackgrounds = asObject(raw.backgrounds);
  const rawData = asObject(raw.data);
  const rawDataBackgrounds = asObject(rawData?.backgrounds);
  const rawBackgroundAssets = asObject(rawData?.backgroundAssets);

  if (rawBackgrounds) {
    for (const [turma, value] of Object.entries(rawBackgrounds)) {
      setNormalizedBackgroundEntry(
        turma,
        value,
        normalizedBackgrounds,
        normalizedBackgroundAssets
      );
    }
  }

  if (rawDataBackgrounds) {
    for (const [turma, value] of Object.entries(rawDataBackgrounds)) {
      setNormalizedBackgroundEntry(
        turma,
        value,
        normalizedBackgrounds,
        normalizedBackgroundAssets
      );
    }
  }

  if (rawBackgroundAssets) {
    for (const [turma, value] of Object.entries(rawBackgroundAssets)) {
      setNormalizedBackgroundEntry(
        turma,
        value,
        normalizedBackgrounds,
        normalizedBackgroundAssets
      );
    }
  }

  const opacitySource =
    raw.backgroundOpacity ??
    rawData?.backgroundOpacity ??
    DEFAULT_CONFIG.backgroundOpacity;
  const parsedOpacity = Number(opacitySource);
  const backgroundOpacity = Number.isFinite(parsedOpacity)
    ? Math.max(0, Math.min(100, Math.round(parsedOpacity)))
    : DEFAULT_CONFIG.backgroundOpacity;

  return {
    validade,
    backgrounds: normalizedBackgrounds,
    backgroundAssets: normalizedBackgroundAssets,
    backgroundOpacity,
  };
};

const broadcastConfigUpdate = (tenantId?: string | null): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      resolveCarteirinhaConfigSyncKey(tenantId),
      String(Date.now())
    );
  } catch {
    // ignora erro de storage
  }
  window.dispatchEvent(new CustomEvent(CARTEIRINHA_CONFIG_UPDATED_EVENT_NAME));
};

const setConfigCache = (
  config: CarteirinhaConfig,
  tenantId?: string | null,
  options?: { broadcast?: boolean }
): void => {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  const cache: CachedConfig = { value: normalized, cachedAt: Date.now() };
  const cacheKey = resolveCarteirinhaCacheKey(tenantId);
  memoryCache.set(cacheKey, cache);

  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(cache));
  } catch {
    // Sem cache persistente: segue apenas com cache em memoria.
  }
  if (options?.broadcast) broadcastConfigUpdate(tenantId);
};

const getMemoryCache = (tenantId?: string | null): CarteirinhaConfig | null => {
  const cacheKey = resolveCarteirinhaCacheKey(tenantId);
  const cached = memoryCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    memoryCache.delete(cacheKey);
    return null;
  }
  return cached.value;
};

const getPersistentCache = (tenantId?: string | null): CarteirinhaConfig | null => {
  if (typeof window === "undefined") return null;

  try {
    const cacheKey = resolveCarteirinhaCacheKey(tenantId);
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      cachedAt?: unknown;
      value?: Record<string, unknown>;
    };

    const cachedAt =
      typeof parsed.cachedAt === "number" && Number.isFinite(parsed.cachedAt) ? parsed.cachedAt : 0;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey);
      return null;
    }

    const normalized = normalizeConfig((parsed.value as Record<string, unknown>) ?? null);
    memoryCache.set(cacheKey, { cachedAt, value: normalized });
    return normalized;
  } catch {
    return null;
  }
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

export async function fetchCarteirinhaConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<CarteirinhaConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCarteirinhaTenantId(options?.tenantId);

  if (!forceRefresh) {
    const memory = getMemoryCache(scopedTenantId);
    if (memory) return memory;

    const persistent = getPersistentCache(scopedTenantId);
    if (persistent) return persistent;
  }

  const { data, error } = await supabase
    .from(CONFIG_COLLECTION)
    .select("id,validade,backgrounds,data")
    .in("id", resolveCarteirinhaDocIds(scopedTenantId));

  if (error) throwSupabaseError(error);

  const raw = pickCarteirinhaRow(
    (Array.isArray(data) ? data : [])
      .map((entry) => asObject(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null),
    scopedTenantId
  );
  const normalized = raw
    ? normalizeConfig({
        validade: raw.validade,
        backgrounds:
          raw.backgrounds ??
          (asObject(raw.data)?.backgrounds as Record<string, unknown> | undefined),
        data: raw.data,
      })
    : createDefaultConfig();

  setConfigCache(normalized, scopedTenantId);
  return normalized;
}

export async function saveCarteirinhaConfig(
  config: CarteirinhaConfig,
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  const backgroundAssets = serializeBackgroundAssets(normalized.backgroundAssets);
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCarteirinhaTenantId(options?.tenantId);

  const { error } = await supabase.from(CONFIG_COLLECTION).upsert(
    {
      id: resolveCarteirinhaDocId(scopedTenantId),
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      validade: normalized.validade,
      backgrounds: normalized.backgrounds,
      data: {
        backgroundAssets,
        backgroundOpacity: normalized.backgroundOpacity,
      },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throwSupabaseError(error);
  setConfigCache(normalized, scopedTenantId, { broadcast: true });
}

export async function uploadCarteirinhaBackground(
  turma: string,
  file: File,
  options?: { tenantId?: string | null }
): Promise<CarteirinhaBackgroundAssetRef> {
  const turmaCode = normalizeTurmaCode(turma);
  if (!isValidTurmaCode(turmaCode)) {
    throw new Error("Turma invalida para upload.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Apenas imagens sao permitidas.");
  }

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error("Imagem muito grande. Limite: 12MB.");
  }

  const optimized = await compressImageFile(file, {
    maxWidth: 1600,
    maxHeight: 1000,
    maxBytes: MAX_UPLOAD_FILE_BYTES,
    quality: 0.82,
  });

  if (!optimized.type.startsWith("image/")) {
    throw new Error("Formato de imagem não suportado.");
  }

  if (optimized.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("Imagem ainda muito pesada apos otimizacao. Use um arquivo menor.");
  }

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCarteirinhaTenantId(options?.tenantId);
  const versionToken = buildFileMetadataVersionToken(optimized);
  const path = scopedTenantId
    ? `carteirinha/${scopedTenantId}/backgrounds/${turmaCode}`
    : `carteirinha/backgrounds/${turmaCode}`;

  const { error: uploadError } = await supabase.storage.from(DEFAULT_BUCKET).upload(path, optimized, {
    upsert: true,
    contentType: optimized.type,
    cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
  });

  if (uploadError) {
    throw Object.assign(new Error(uploadError.message), {
      code: `storage/${uploadError.name ?? "upload-failed"}`,
      cause: uploadError,
    });
  }

  return {
    bucket: DEFAULT_BUCKET,
    path,
    versionToken,
  };
}
