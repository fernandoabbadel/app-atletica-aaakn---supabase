import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;

const MAX_SOCIAL_LINKS = 20;
const MAX_REVIEWS = 30;
export const MAX_LOADING_PHRASES = 10;
export const LOADING_PHRASE_MAX_LENGTH = 90;
export const LANDING_TAGLINE_MAX_LENGTH = 40;
export const LANDING_HERO_TITLE_MAX_LENGTH = 40;
export const LANDING_HERO_HIGHLIGHT_MAX_LENGTH = 48;
export const LANDING_HERO_SUBTITLE_MAX_LENGTH = 180;
export const LANDING_ADDRESS_MAX_LENGTH = 160;
export const LANDING_REVIEW_NAME_MAX_LENGTH = 80;
export const LANDING_REVIEW_ROLE_MAX_LENGTH = 80;
export const LANDING_REVIEW_TEXT_MAX_LENGTH = 320;
export const LANDING_REVIEW_PROFILE_URL_MAX_LENGTH = 400;

const MIN_STAT_VALUE = 0;
const MAX_STAT_VALUE = 9_999_999;

// Tabela/linha padrao para guardar JSON de configuracao no Supabase.
const SITE_CONFIG_TABLE = "site_config";
const LANDING_CONFIG_ROW_ID = "landing_page";
const LANDING_ROW_SELECT_CANDIDATES = ["id,data", "id,config", "id,payload", "*"] as const;
const LANDING_CONFIG_STORAGE_KEY_PREFIX = "usc:landing-config:";
export const LANDING_CONFIG_SNAPSHOT_UPDATED_EVENT = "usc:landing-config-snapshot-updated";

const landingConfigCache = new Map<string, CacheEntry<LandingConfig>>();

export type SocialPlatform =
  | "instagram"
  | "tiktok"
  | "twitter"
  | "youtube"
  | "linkedin"
  | "website";

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  url: string;
}

export interface ReviewConfig {
  id: string;
  name: string;
  role: string;
  text: string;
  profileUrl: string;
}

export interface LandingConfig {
  tagline: string;
  taglineColor: string;
  heroTitle: string;
  heroSubtitle: string;
  heroHighlight: string;
  titleColor: string;
  gradientStart: string;
  gradientEnd: string;
  statUsers: number;
  statPosts: number;
  statPartners: number;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  loadingPhrases: string[];
  socialLinks: SocialLink[];
  reviews: ReviewConfig[];
}

export const DEFAULT_LOADING_PHRASES = [
  "Preparando o ambiente para voce.",
  "Carregando dados da pagina.",
  "Conferindo seu acesso atual.",
  "Sincronizando informacoes da atletica.",
  "Montando a proxima tela.",
  "Buscando os dados mais recentes.",
  "Organizando os modulos do app.",
  "Quase tudo pronto por aqui.",
  "Aplicando a identidade visual.",
  "Abrindo seu painel com seguranca.",
] as const;

export const DEFAULT_TENANT_LANDING_CONFIG: LandingConfig = {
  tagline: "Gestao Esportiva 2.0",
  taglineColor: "#10b981",
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitaria. Carteirinha, Loja e Eventos.",
  heroHighlight: "SUA ATLETICA",
  titleColor: "#ffffff",
  gradientStart: "#34d399",
  gradientEnd: "#10b981",
  statUsers: 120,
  statPosts: 340,
  statPartners: 12,
  address: "Campus principal",
  phone: "",
  whatsapp: "",
  email: "",
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
  socialLinks: [],
  reviews: [],
};

export const DEFAULT_PLATFORM_LANDING_CONFIG: LandingConfig = {
  tagline: "Gestao Esportiva 2.0",
  taglineColor: "#60a5fa",
  heroTitle: "ENTRE PARA",
  heroSubtitle: "Plataforma oficial multi-atleticas.",
  heroHighlight: "SPOT CONNECT",
  titleColor: "#ffffff",
  gradientStart: "#93c5fd",
  gradientEnd: "#2563eb",
  statUsers: 120,
  statPosts: 12,
  statPartners: 12,
  address: "Campus principal",
  phone: "",
  whatsapp: "",
  email: "suporte@usc.app",
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
  socialLinks: [],
  reviews: [],
};

export const DEFAULT_LANDING_CONFIG = DEFAULT_PLATFORM_LANDING_CONFIG;

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const trimField = (value: unknown, maxLength: number, fallback = ""): string =>
  asString(value, fallback).trim().slice(0, maxLength);

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Math.floor(asNumber(value, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
};

const isPlatform = (value: unknown): value is SocialPlatform =>
  value === "instagram" ||
  value === "tiktok" ||
  value === "twitter" ||
  value === "youtube" ||
  value === "linkedin" ||
  value === "website";

const normalizeSocialLinks = (
  raw: unknown,
  fallback: SocialLink[]
): SocialLink[] => {
  if (!Array.isArray(raw)) return fallback;

  const normalized: SocialLink[] = [];
  for (const entry of raw.slice(0, MAX_SOCIAL_LINKS)) {
    const obj = asObject(entry);
    if (!obj) continue;

    const platformRaw = obj.platform;
    const platform: SocialPlatform = isPlatform(platformRaw)
      ? platformRaw
      : "instagram";

    normalized.push({
      id: trimField(obj.id, 60) || crypto.randomUUID(),
      platform,
      url: trimField(obj.url, 400),
    });
  }

  return normalized;
};

const normalizeReviews = (raw: unknown, fallback: ReviewConfig[]): ReviewConfig[] => {
  if (!Array.isArray(raw)) return fallback;

  const normalized: ReviewConfig[] = [];
  for (const entry of raw.slice(0, MAX_REVIEWS)) {
    const obj = asObject(entry);
    if (!obj) continue;

    normalized.push({
      id: trimField(obj.id, 60) || crypto.randomUUID(),
      name: trimField(obj.name, LANDING_REVIEW_NAME_MAX_LENGTH),
      role: trimField(obj.role, LANDING_REVIEW_ROLE_MAX_LENGTH),
      text: trimField(obj.text, LANDING_REVIEW_TEXT_MAX_LENGTH),
      profileUrl: trimField(obj.profileUrl, LANDING_REVIEW_PROFILE_URL_MAX_LENGTH),
    });
  }

  return normalized;
};

const normalizeLoadingPhrases = (
  raw: unknown,
  fallback: string[]
): string[] => {
  const source = Array.isArray(raw) ? raw : fallback;
  const normalized = source
    .map((entry) => trimField(entry, LOADING_PHRASE_MAX_LENGTH))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_LOADING_PHRASES);

  return normalized.length > 0 ? normalized : [...fallback];
};

const getSupabaseErrorText = (error: unknown): string => {
  const raw = asObject(error);
  return [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
    asString(raw?.hint),
  ]
    .filter((entry) => entry.length > 0)
    .join(" ")
    .toLowerCase();
};

const shouldFallbackMissingColumns = (
  error: unknown,
  columns: readonly string[]
): boolean => {
  const message = getSupabaseErrorText(error);
  if (!message.includes("column") || !message.includes("does not exist")) return false;
  return columns.some((column) => message.includes(column.toLowerCase()));
};

// Aceita tanto linha flat quanto JSON em colunas data/config/payload.
const extractPayloadData = (raw: unknown): unknown => {
  const obj = asObject(raw);
  if (!obj) return raw;

  if ("config" in obj) return obj.config;
  if ("data" in obj) return obj.data;
  if ("payload" in obj) return obj.payload;
  return raw;
};

export function sanitizeLandingConfig(
  raw: unknown,
  fallbackConfig: LandingConfig = DEFAULT_LANDING_CONFIG
): LandingConfig {
  const obj = asObject(raw) ?? {};

  return {
    tagline: trimField(obj.tagline, LANDING_TAGLINE_MAX_LENGTH, fallbackConfig.tagline),
    taglineColor: trimField(obj.taglineColor, 20, fallbackConfig.taglineColor),
    heroTitle: trimField(
      obj.heroTitle,
      LANDING_HERO_TITLE_MAX_LENGTH,
      fallbackConfig.heroTitle
    ),
    heroSubtitle: trimField(
      obj.heroSubtitle,
      LANDING_HERO_SUBTITLE_MAX_LENGTH,
      fallbackConfig.heroSubtitle
    ),
    heroHighlight: trimField(
      obj.heroHighlight,
      LANDING_HERO_HIGHLIGHT_MAX_LENGTH,
      fallbackConfig.heroHighlight
    ),
    titleColor: trimField(obj.titleColor, 20, fallbackConfig.titleColor),
    gradientStart: trimField(obj.gradientStart, 20, fallbackConfig.gradientStart),
    gradientEnd: trimField(obj.gradientEnd, 20, fallbackConfig.gradientEnd),
    statUsers: clampInt(
      obj.statUsers,
      MIN_STAT_VALUE,
      MAX_STAT_VALUE,
      fallbackConfig.statUsers
    ),
    statPosts: clampInt(
      obj.statPosts,
      MIN_STAT_VALUE,
      MAX_STAT_VALUE,
      fallbackConfig.statPosts
    ),
    statPartners: clampInt(
      obj.statPartners,
      MIN_STAT_VALUE,
      MAX_STAT_VALUE,
      fallbackConfig.statPartners
    ),
    address: trimField(obj.address, LANDING_ADDRESS_MAX_LENGTH, fallbackConfig.address),
    phone: trimField(obj.phone, 40, fallbackConfig.phone),
    whatsapp: trimField(obj.whatsapp, 30, fallbackConfig.whatsapp),
    email: trimField(obj.email, 160, fallbackConfig.email),
    loadingPhrases: normalizeLoadingPhrases(
      obj.loadingPhrases,
      fallbackConfig.loadingPhrases
    ),
    socialLinks: normalizeSocialLinks(obj.socialLinks, fallbackConfig.socialLinks),
    reviews: normalizeReviews(obj.reviews, fallbackConfig.reviews),
  };
}

const getLandingCacheKey = (tenantId?: string | null): string => {
  const cleanTenantId = tenantId?.trim() || "";
  return cleanTenantId || "global";
};

const buildLandingRowId = (tenantId?: string | null): string => {
  const cleanTenantId = tenantId?.trim() || "";
  return cleanTenantId ? `${LANDING_CONFIG_ROW_ID}__${cleanTenantId}` : LANDING_CONFIG_ROW_ID;
};

const getLandingStorageKey = (tenantId?: string | null): string =>
  `${LANDING_CONFIG_STORAGE_KEY_PREFIX}${getLandingCacheKey(tenantId)}`;

export function storeLandingConfigSnapshot(
  config: LandingConfig,
  tenantId?: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getLandingStorageKey(tenantId),
      JSON.stringify(config)
    );
    window.dispatchEvent(
      new CustomEvent(LANDING_CONFIG_SNAPSHOT_UPDATED_EVENT, {
        detail: {
          tenantId: tenantId?.trim() || "",
          config,
        },
      })
    );
  } catch {
    // ignora falha de storage
  }
}

export function getStoredLandingConfigSnapshot(options?: {
  tenantId?: string | null;
  fallbackConfig?: LandingConfig;
}): LandingConfig | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getLandingStorageKey(options?.tenantId));
    if (!raw) return null;
    return sanitizeLandingConfig(
      JSON.parse(raw) as unknown,
      options?.fallbackConfig ?? DEFAULT_LANDING_CONFIG
    );
  } catch {
    return null;
  }
}

async function fetchLandingConfigRow(tenantId?: string | null): Promise<unknown> {
  const supabase = getSupabaseClient();
  const cleanTenantId = tenantId?.trim() || "";

  const fetchRowAttempt = async (
    rowId: string,
    scope: "tenant" | "global" | "any"
  ): Promise<unknown> => {
    let lastSchemaError: unknown = null;

    for (const selectColumns of LANDING_ROW_SELECT_CANDIDATES) {
      let query = supabase
        .from(SITE_CONFIG_TABLE)
        .select(selectColumns)
        .eq("id", rowId);

      if (scope === "tenant" && cleanTenantId) {
        query = query.eq("tenant_id", cleanTenantId);
      } else if (scope === "global") {
        query = query.is("tenant_id", null);
      }

      const { data, error } = await query.maybeSingle();
      if (!error) return data;

      if (
        (scope === "tenant" || scope === "global") &&
        shouldFallbackMissingColumns(error, ["tenant_id"])
      ) {
        return null;
      }

      if (
        shouldFallbackMissingColumns(error, ["data", "config", "payload"]) ||
        shouldFallbackMissingColumns(error, ["updated_at"])
      ) {
        lastSchemaError = error;
        continue;
      }

      throw error;
    }

    if (lastSchemaError) return null;
    return null;
  };

  const attempts: Array<() => Promise<unknown>> = cleanTenantId
    ? [
        () => fetchRowAttempt(buildLandingRowId(cleanTenantId), "tenant"),
        () => fetchRowAttempt(buildLandingRowId(cleanTenantId), "any"),
        () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "tenant"),
        () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "global"),
        () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "any"),
      ]
    : [
        () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "global"),
        () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "any"),
      ];

  for (const attempt of attempts) {
    const data = await attempt();
    if (data) return data;
  }

  return null;
}

async function saveLandingConfigRow(
  normalized: LandingConfig,
  tenantId?: string | null
): Promise<void> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const cleanTenantId = tenantId?.trim() || "";
  const rowId = buildLandingRowId(cleanTenantId);
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      data: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      data: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      config: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      config: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      payload: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      payload: normalized,
      updated_at: nowIso,
    },
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      data: normalized,
    },
    {
      id: rowId,
      data: normalized,
    },
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      config: normalized,
    },
    {
      id: rowId,
      config: normalized,
    },
    {
      id: rowId,
      tenant_id: cleanTenantId || null,
      payload: normalized,
    },
    {
      id: rowId,
      payload: normalized,
    },
  ];

  let lastSchemaError: unknown = null;
  for (const payload of payloadCandidates) {
    const { error } = await supabase.from(SITE_CONFIG_TABLE).upsert(payload, {
      onConflict: "id",
    });
    if (!error) return;

    if (
      shouldFallbackMissingColumns(error, [
        "tenant_id",
        "data",
        "config",
        "payload",
        "updated_at",
      ])
    ) {
      lastSchemaError = error;
      continue;
    }

    throw error;
  }

  if (lastSchemaError) throw lastSchemaError;
}

export async function fetchLandingConfig(options?: {
  forceRefresh?: boolean;
  fallbackConfig?: LandingConfig;
  tenantId?: string | null;
}): Promise<LandingConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const fallbackConfig = options?.fallbackConfig ?? DEFAULT_LANDING_CONFIG;
  const cacheKey = getLandingCacheKey(options?.tenantId);

  const cached = landingConfigCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const rawConfig = await fetchLandingConfigRow(options?.tenantId);
  const normalized = sanitizeLandingConfig(extractPayloadData(rawConfig), fallbackConfig);

  landingConfigCache.set(cacheKey, {
    cachedAt: Date.now(),
    value: normalized,
  });
  storeLandingConfigSnapshot(normalized, options?.tenantId);

  return normalized;
}

export async function saveLandingConfig(
  config: LandingConfig,
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = sanitizeLandingConfig(config, config);
  const cacheKey = getLandingCacheKey(options?.tenantId);

  await saveLandingConfigRow(normalized, options?.tenantId);

  landingConfigCache.set(cacheKey, {
    cachedAt: Date.now(),
    value: normalized,
  });
  storeLandingConfigSnapshot(normalized, options?.tenantId);
}

export function clearAdminLandingCache(): void {
  landingConfigCache.clear();
}
