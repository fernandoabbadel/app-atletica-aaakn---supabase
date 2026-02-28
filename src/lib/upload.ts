import { getSupabaseClient } from "./supabase";
import { compressImageFile } from "./imageCompression";

export interface UploadResult {
  url: string | null;
  error: string | null;
}

export interface UploadImageOptions {
  scopeKey?: string;
  maxBytes?: number;
  allowedTypes?: readonly string[];
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  compressionMaxWidth?: number;
  compressionMaxHeight?: number;
  compressionMaxBytes?: number;
  compressionMinQuality?: number;
  quality?: number;
  upsert?: boolean;
  cacheControl?: string;
  fileName?: string;
  appendVersionQuery?: boolean;
  minIntervalMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  dedupeWindowMs?: number;
}

export const MAX_UPLOAD_IMAGE_MB = 2;
export const MAX_UPLOAD_IMAGE_BYTES = MAX_UPLOAD_IMAGE_MB * 1024 * 1024;
export const ALLOWED_UPLOAD_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MAX_UPLOAD_IMAGE_WIDTH = 2400;
export const MAX_UPLOAD_IMAGE_HEIGHT = 2400;
export const MAX_UPLOAD_IMAGE_PIXELS = MAX_UPLOAD_IMAGE_WIDTH * MAX_UPLOAD_IMAGE_HEIGHT;

const DEFAULT_MIN_UPLOAD_INTERVAL_MS = 1200;
const DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_UPLOAD_RATE_LIMIT_MAX = 6;
const DEFAULT_UPLOAD_DEDUPE_WINDOW_MS = 45_000;
const DEFAULT_COMPRESSED_UPLOAD_MAX_BYTES = 200 * 1024;

const uploadHistoryByScope = new Map<string, number[]>();
const recentFingerprintByScope = new Map<string, Map<string, number>>();
const inFlightScopes = new Set<string>();

export const validateImageFile = (
  file: File,
  options?: {
    maxBytes?: number;
    allowedTypes?: readonly string[];
  }
): string | null => {
  const maxBytes = options?.maxBytes ?? MAX_UPLOAD_IMAGE_BYTES;
  const allowedTypes = options?.allowedTypes ?? ALLOWED_UPLOAD_IMAGE_TYPES;

  if (!file) return "Nenhum arquivo selecionado.";
  if (!allowedTypes.includes(file.type)) {
    return "Formato invalido. Use JPG, PNG ou WEBP.";
  }
  if (file.size > maxBytes) {
    if (maxBytes < 1024 * 1024) {
      const kbLimit = Math.max(50, Math.round(maxBytes / 1024));
      return `A imagem excede ${kbLimit}KB.`;
    }
    const mbLimit = Math.max(1, Math.round((maxBytes / (1024 * 1024)) * 10) / 10);
    return `A imagem excede ${mbLimit}MB.`;
  }

  return null;
};

const sanitizeStorageSegment = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "file";

const normalizeStoragePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => sanitizeStorageSegment(segment))
    .filter(Boolean)
    .join("/");

const detectExtension = (file: File): string => {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
};

const resolveOutputFileName = (file: File, options?: UploadImageOptions): string => {
  const hint = options?.fileName?.trim();
  if (hint) {
    const safeHint = sanitizeStorageSegment(hint);
    const hasExtension = /\.[a-z0-9]{2,5}$/i.test(safeHint);
    if (hasExtension) return safeHint;
    return `${safeHint}.${detectExtension(file)}`;
  }

  const cleanName = sanitizeStorageSegment(file.name);
  return `${Date.now()}-${cleanName}`;
};

const readImageDimensions = async (
  file: File
): Promise<{ width: number; height: number } | null> => {
  if (!file.type.startsWith("image/")) return null;

  if (typeof window === "undefined") return null;

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      return { width, height };
    } catch {
      // Fallback para decodificacao via <img> em navegadores com suporte parcial.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao ler dimensoes da imagem."));
    };
    image.src = objectUrl;
  });
};

const validateImageDimensions = async (
  file: File,
  options?: UploadImageOptions
): Promise<string | null> => {
  const maxWidth = options?.maxWidth ?? MAX_UPLOAD_IMAGE_WIDTH;
  const maxHeight = options?.maxHeight ?? MAX_UPLOAD_IMAGE_HEIGHT;
  const maxPixels = options?.maxPixels ?? MAX_UPLOAD_IMAGE_PIXELS;

  if (!file.type.startsWith("image/")) {
    return "Formato invalido. Use JPG, PNG ou WEBP.";
  }

  try {
    const dimensions = await readImageDimensions(file);
    if (!dimensions) return null;
    if (dimensions.width > maxWidth || dimensions.height > maxHeight) {
      return `Resolucao maxima: ${maxWidth}x${maxHeight}.`;
    }
    if (dimensions.width * dimensions.height > maxPixels) {
      return "Imagem muito grande. Reduza a resolucao.";
    }
    return null;
  } catch {
    return "Nao foi possivel processar a imagem.";
  }
};

const cleanupScopeCaches = (scope: string, now: number, options: UploadImageOptions): void => {
  const windowMs = options.rateLimitWindowMs ?? DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_UPLOAD_DEDUPE_WINDOW_MS;

  const history = uploadHistoryByScope.get(scope) ?? [];
  uploadHistoryByScope.set(
    scope,
    history.filter((timestamp) => now - timestamp <= windowMs)
  );

  const fingerprints = recentFingerprintByScope.get(scope);
  if (!fingerprints) return;
  const cleaned = new Map<string, number>();
  fingerprints.forEach((timestamp, fingerprint) => {
    if (now - timestamp <= dedupeWindowMs) {
      cleaned.set(fingerprint, timestamp);
    }
  });
  recentFingerprintByScope.set(scope, cleaned);
};

const reserveUploadSlot = (
  scope: string,
  file: File,
  options: UploadImageOptions
): string | null => {
  const now = Date.now();
  cleanupScopeCaches(scope, now, options);

  if (inFlightScopes.has(scope)) {
    return "Upload ja em andamento. Aguarde terminar.";
  }

  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_UPLOAD_INTERVAL_MS;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_UPLOAD_RATE_LIMIT_WINDOW_MS;
  const rateLimitMax = options.rateLimitMax ?? DEFAULT_UPLOAD_RATE_LIMIT_MAX;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_UPLOAD_DEDUPE_WINDOW_MS;

  const history = uploadHistoryByScope.get(scope) ?? [];
  const lastTimestamp = history[history.length - 1] ?? 0;
  if (now - lastTimestamp < minIntervalMs) {
    return "Aguarde alguns segundos antes de novo upload.";
  }

  const recent = history.filter((timestamp) => now - timestamp <= rateLimitWindowMs);
  if (recent.length >= rateLimitMax) {
    return "Limite de uploads por minuto atingido.";
  }

  const fingerprint = `${file.name.toLowerCase()}::${file.type}::${file.size}::${file.lastModified}`;
  const fingerprintCache = recentFingerprintByScope.get(scope) ?? new Map<string, number>();
  const previousFingerprintAt = fingerprintCache.get(fingerprint);
  if (typeof previousFingerprintAt === "number" && now - previousFingerprintAt <= dedupeWindowMs) {
    return "Arquivo repetido detectado. Evite uploads duplicados.";
  }

  uploadHistoryByScope.set(scope, [...recent, now]);
  fingerprintCache.set(fingerprint, now);
  recentFingerprintByScope.set(scope, fingerprintCache);
  inFlightScopes.add(scope);
  return null;
};

const releaseUploadSlot = (scope: string): void => {
  inFlightScopes.delete(scope);
};

export async function uploadImage(
  file: File,
  path: string,
  options?: UploadImageOptions
): Promise<UploadResult> {
  const safePath = normalizeStoragePath(path) || "misc";
  const scope = (options?.scopeKey || safePath || "uploads").trim().toLowerCase();
  const compressedMaxBytes = options?.compressionMaxBytes ?? DEFAULT_COMPRESSED_UPLOAD_MAX_BYTES;

  const fileError = validateImageFile(file, {
    maxBytes: options?.maxBytes,
    allowedTypes: options?.allowedTypes,
  });
  if (fileError) {
    return { url: null, error: fileError };
  }

  const guardError = reserveUploadSlot(scope, file, options ?? {});
  if (guardError) {
    return { url: null, error: guardError };
  }

  try {
    const sourceDimensionsError = await validateImageDimensions(file, options);
    if (sourceDimensionsError) {
      return { url: null, error: sourceDimensionsError };
    }

    // Canvas compression reduces Storage usage and egress while keeping quality acceptable.
    const optimizedFile = await compressImageFile(file, {
      maxWidth: options?.compressionMaxWidth ?? 1600,
      maxHeight: options?.compressionMaxHeight ?? 1600,
      maxBytes: compressedMaxBytes,
      minQuality: options?.compressionMinQuality,
      quality: options?.quality ?? 0.82,
    });

    const optimizedError = validateImageFile(optimizedFile, {
      maxBytes: compressedMaxBytes,
      allowedTypes: options?.allowedTypes,
    });
    if (optimizedError) {
      return { url: null, error: optimizedError };
    }

    const optimizedDimensionsError = await validateImageDimensions(optimizedFile, options);
    if (optimizedDimensionsError) {
      return { url: null, error: optimizedDimensionsError };
    }

    const supabase = getSupabaseClient();
    const bucket = (process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "uploads").trim() || "uploads";
    const filename = resolveOutputFileName(optimizedFile, options);
    const objectPath = `${safePath}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, optimizedFile, {
        upsert: options?.upsert ?? false,
        cacheControl: options?.cacheControl ?? "3600",
        contentType: optimizedFile.type || undefined,
      });

    if (uploadError) {
      throw uploadError;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const urlBase = publicUrl || null;
    const url = options?.appendVersionQuery && urlBase
      ? `${urlBase}${urlBase.includes("?") ? "&" : "?"}v=${Date.now()}`
      : urlBase;

    return { url, error: null };
  } catch (error: unknown) {
    console.error("Erro critico no upload:", error);
    return { url: null, error: "Falha ao subir imagem. Tente novamente." };
  } finally {
    releaseUploadSlot(scope);
  }
}

