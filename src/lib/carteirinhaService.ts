import { doc, getDoc, serverTimestamp, setDoc } from "@/lib/supa/firestore";
import { getDownloadURL, ref, uploadBytes } from "@/lib/supa/storage";

import { db, storage } from "./backend";
import { compressImageFile } from "./imageCompression";

export interface CarteirinhaConfig {
  validade: string;
  backgrounds: Record<string, string>;
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
};

const createDefaultConfig = (): CarteirinhaConfig => ({
  validade: DEFAULT_CONFIG.validade,
  backgrounds: {},
});

type CachedConfig = {
  cachedAt: number;
  value: CarteirinhaConfig;
};

let memoryCache: CachedConfig | null = null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const isBackgroundUrlAllowed = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith("data:")) return false;
  return value.startsWith("https://") || value.startsWith("http://") || value.startsWith("/");
};

const normalizeConfig = (raw: Record<string, unknown> | null): CarteirinhaConfig => {
  if (!raw) return createDefaultConfig();

  const rawValidade = asString(raw.validade, DEFAULT_CONFIG.validade).trim();
  const validade =
    rawValidade.length > 24
      ? rawValidade.slice(0, 24)
      : rawValidade || DEFAULT_CONFIG.validade;

  const normalizedBackgrounds: Record<string, string> = {};
  const rawBackgrounds = raw.backgrounds;

  if (typeof rawBackgrounds === "object" && rawBackgrounds !== null) {
    for (const [turma, value] of Object.entries(rawBackgrounds)) {
      if (!VALID_TURMAS.has(turma)) continue;
      const url = asString(value).trim();
      if (!isBackgroundUrlAllowed(url)) continue;
      normalizedBackgrounds[turma] = url;
    }
  }

  return {
    validade,
    backgrounds: normalizedBackgrounds,
  };
};

const setConfigCache = (config: CarteirinhaConfig): void => {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);
  const cache: CachedConfig = { value: normalized, cachedAt: Date.now() };
  memoryCache = cache;

  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Sem cache persistente: segue apenas com cache em memória.
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
      typeof parsed.cachedAt === "number" && Number.isFinite(parsed.cachedAt)
        ? parsed.cachedAt
        : 0;
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

export async function fetchCarteirinhaConfig(options?: {
  forceRefresh?: boolean;
}): Promise<CarteirinhaConfig> {
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh) {
    const memory = getMemoryCache();
    if (memory) return memory;

    const session = getSessionCache();
    if (session) return session;
  }

  const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID);
  const snap = await getDoc(configRef);
  const normalized = snap.exists()
    ? normalizeConfig(snap.data() as Record<string, unknown>)
    : createDefaultConfig();

  setConfigCache(normalized);
  return normalized;
}

export async function saveCarteirinhaConfig(config: CarteirinhaConfig): Promise<void> {
  const normalized = normalizeConfig(config as unknown as Record<string, unknown>);

  await setDoc(
    doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID),
    {
      ...normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  setConfigCache(normalized);
}

export async function uploadCarteirinhaBackground(
  turma: string,
  file: File
): Promise<string> {
  const turmaCode = turma.trim().toUpperCase();
  if (!VALID_TURMAS.has(turmaCode)) {
    throw new Error("Turma inválida para upload.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Apenas imagens são permitidas.");
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
    throw new Error("Formato de imagem não suportado.");
  }

  if (optimized.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("Imagem ainda muito pesada após otimização. Use um arquivo menor.");
  }

  const storageRef = ref(storage, `carteirinha/backgrounds/${turmaCode}`);

  await uploadBytes(storageRef, optimized, {
    contentType: optimized.type,
    cacheControl: "public,max-age=3600",
  });

  const url = await getDownloadURL(storageRef);
  const version = Date.now();
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

