import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;

const MAX_SOCIAL_LINKS = 20;
const MAX_REVIEWS = 30;

const MIN_STAT_VALUE = 0;
const MAX_STAT_VALUE = 9_999_999;

// Tabela/linha padrao para guardar JSON de configuracao no Supabase.
const SITE_CONFIG_TABLE = "site_config";
const LANDING_CONFIG_ROW_ID = "landing_page";
const LANDING_ROW_SELECT_COLUMNS = "id,data,updated_at";

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
  socialLinks: SocialLink[];
  reviews: ReviewConfig[];
}

export const DEFAULT_LANDING_CONFIG: LandingConfig = {
  tagline: "Gestao Esportiva 2.0",
  taglineColor: "#60a5fa",
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitaria. Carteirinha, Loja e Eventos.",
  heroHighlight: "CARDUME TUBARAO",
  titleColor: "#ffffff",
  gradientStart: "#93c5fd",
  gradientEnd: "#2563eb",
  statUsers: 120,
  statPosts: 12,
  statPartners: 12,
  address: "Campus Medicina - Bloco C",
  phone: "(12) 99999-9999",
  whatsapp: "5512999999999",
  email: "suporte@aaakn.com.br",
  socialLinks: [{ id: "1", platform: "instagram", url: "https://instagram.com/aaakn" }],
  reviews: [],
};

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
      name: trimField(obj.name, 100),
      role: trimField(obj.role, 100),
      text: trimField(obj.text, 500),
      profileUrl: trimField(obj.profileUrl, 400),
    });
  }

  return normalized;
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
    tagline: trimField(obj.tagline, 120, fallbackConfig.tagline),
    taglineColor: trimField(obj.taglineColor, 20, fallbackConfig.taglineColor),
    heroTitle: trimField(obj.heroTitle, 120, fallbackConfig.heroTitle),
    heroSubtitle: trimField(obj.heroSubtitle, 300, fallbackConfig.heroSubtitle),
    heroHighlight: trimField(obj.heroHighlight, 120, fallbackConfig.heroHighlight),
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
    address: trimField(obj.address, 160, fallbackConfig.address),
    phone: trimField(obj.phone, 40, fallbackConfig.phone),
    whatsapp: trimField(obj.whatsapp, 30, fallbackConfig.whatsapp),
    email: trimField(obj.email, 160, fallbackConfig.email),
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

async function fetchLandingConfigRow(tenantId?: string | null): Promise<unknown> {
  const supabase = getSupabaseClient();
  const rowIds = Array.from(
    new Set([buildLandingRowId(tenantId), LANDING_CONFIG_ROW_ID])
  );

  for (const rowId of rowIds) {
    const { data, error } = await supabase
      .from(SITE_CONFIG_TABLE)
      .select(LANDING_ROW_SELECT_COLUMNS)
      .eq("id", rowId)
      .maybeSingle();

    if (error) throw error;
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
  const { error } = await supabase.from(SITE_CONFIG_TABLE).upsert(
    {
      id: buildLandingRowId(tenantId),
      data: normalized,
      updated_at: nowIso,
    },
    { onConflict: "id" }
  );

  if (error) throw error;
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
}

export function clearAdminLandingCache(): void {
  landingConfigCache.clear();
}
