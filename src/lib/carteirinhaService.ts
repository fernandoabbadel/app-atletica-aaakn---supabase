import { getSupabaseClient } from "./supabase";
import { compressImageFile } from "./imageCompression";

export interface CarteirinhaConfig {
  validade: string;
  backgrounds: Record<string, string>;
  backgroundOpacity: number;
}

const CONFIG_COLLECTION = "app_config";
const CONFIG_DOC_ID = "carteirinha";
const CACHE_KEY = "aaakn:carteirinha-config:v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 2.5 * 1024 * 1024;
const VALID_TURMAS = new Set(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);

const DEFAULT_CONFIG: CarteirinhaConfig = {
  validade: "DEZ/2026",
  backgrounds: {},
  backgroundOpacity: 60,
};

const DEFAULT_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ||
  "uploads";

const createDefaultConfig = (): CarteirinhaConfig => ({
  validade: DEFAULT_CONFIG.validade,
  backgrounds: {},
  backgroundOpacity: DEFAULT_CONFIG.backgroundOpacity,
});

type CachedConfig = {
  cachedAt: number;
  value: CarteirinhaConfig;
};

let memoryCache: CachedConfig | null = null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const isBackgroundUrlAllowed = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith("data:")) return false;
  return value.startsWith("https://") || value.startsWith("http://") || value.startsWith("/");
};

const normalizeConfig = (raw: Record<string, unknown> | null): CarteirinhaConfig => {
  if (!raw) return createDefaultConfig();

  const rawValidade = asString(raw.validade, DEFAULT_CONFIG.validade).trim();
  const validade =
    rawValidade.length > 24 ? rawValidade.slice(0, 24) : rawValidade || DEFAULT_CONFIG.validade;

  const normalizedBackgrounds: Record<string, string> = {};
  const rawBackgrounds = asObject(raw.backgrounds);
  const rawData = asObject(raw.data);

  if (rawBackgrounds) {
    for (const [turma, value] of Object.entries(rawBackgrounds)) {
      if (!VALID_TURMAS.has(turma)) continue;
      const url = asString(value).trim();
      if (!isBackgroundUrlAllowed(url)) continue;
      normalizedBackgrounds[turma] = url;
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

  return { validade, backgrounds: normalizedBackgrounds, backgroundOpacity };
};

const setConfigCache = (config: CarteirinhaConfig): void => {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  const cache: CachedConfig = { value: normalized, cachedAt: Date.now() };
  memoryCache = cache;

  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Sem cache persistente: segue apenas com cache em memoria.
  }
};

const getMemoryCache = (): CarteirinhaConfig | null => {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.cachedAt > CACHE_TTL_MS) {
    memoryCache = null;
    return null;
  }
  return memoryCache.value;
};

const getSessionCache = (): CarteirinhaConfig | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      cachedAt?: unknown;
      value?: Record<string, unknown>;
    };

    const cachedAt =
      typeof parsed.cachedAt === "number" && Number.isFinite(parsed.cachedAt) ? parsed.cachedAt : 0;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(CACHE_KEY);
      return null;
    }

    const normalized = normalizeConfig((parsed.value as Record<string, unknown>) ?? null);
    memoryCache = { cachedAt, value: normalized };
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
}): Promise<CarteirinhaConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const supabase = getSupabaseClient();

  if (!forceRefresh) {
    const memory = getMemoryCache();
    if (memory) return memory;

    const session = getSessionCache();
    if (session) return session;
  }

  const { data, error } = await supabase
    .from(CONFIG_COLLECTION)
    .select("validade,backgrounds,data")
    .eq("id", CONFIG_DOC_ID)
    .maybeSingle();

  if (error) throwSupabaseError(error);

  const raw = asObject(data) ?? null;
  const normalized = raw
    ? normalizeConfig({
        validade: raw.validade,
        backgrounds:
          raw.backgrounds ??
          (asObject(raw.data)?.backgrounds as Record<string, unknown> | undefined),
        data: raw.data,
      })
    : createDefaultConfig();

  setConfigCache(normalized);
  return normalized;
}

export async function saveCarteirinhaConfig(config: CarteirinhaConfig): Promise<void> {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  const supabase = getSupabaseClient();

  const { error } = await supabase.from(CONFIG_COLLECTION).upsert(
    {
      id: CONFIG_DOC_ID,
      validade: normalized.validade,
      backgrounds: normalized.backgrounds,
      data: {
        backgroundOpacity: normalized.backgroundOpacity,
      },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throwSupabaseError(error);
  setConfigCache(normalized);
}

export async function uploadCarteirinhaBackground(turma: string, file: File): Promise<string> {
  const turmaCode = turma.trim().toUpperCase();
  if (!VALID_TURMAS.has(turmaCode)) {
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
    quality: 0.82,
  });

  if (!optimized.type.startsWith("image/")) {
    throw new Error("Formato de imagem nao suportado.");
  }

  if (optimized.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("Imagem ainda muito pesada apos otimizacao. Use um arquivo menor.");
  }

  const supabase = getSupabaseClient();
  const path = `carteirinha/backgrounds/${turmaCode}`;

  const { error: uploadError } = await supabase.storage.from(DEFAULT_BUCKET).upload(path, optimized, {
    upsert: true,
    contentType: optimized.type,
    cacheControl: "3600",
  });

  if (uploadError) {
    throw Object.assign(new Error(uploadError.message), {
      code: `storage/${uploadError.name ?? "upload-failed"}`,
      cause: uploadError,
    });
  }

  const { data: publicData } = supabase.storage.from(DEFAULT_BUCKET).getPublicUrl(path);
  const baseUrl = publicData?.publicUrl;

  if (!baseUrl) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(DEFAULT_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (signedError || !signed?.signedUrl) {
      throw Object.assign(new Error(signedError?.message || "Falha ao gerar URL do upload."), {
        code: `storage/${signedError?.name ?? "signed-url-failed"}`,
        cause: signedError,
      });
    }
    return `${signed.signedUrl}${signed.signedUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
  }

  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
}
