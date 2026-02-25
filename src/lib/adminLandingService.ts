import { httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { db, functions } from "./firebase";
import { getFirebaseErrorCode } from "./firebaseErrors";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;

const ADMIN_LANDING_FETCH_CALLABLE = "adminLandingGetConfig";
const ADMIN_LANDING_SAVE_CALLABLE = "adminLandingSaveConfig";

const MAX_SOCIAL_LINKS = 20;
const MAX_REVIEWS = 30;

const MIN_STAT_VALUE = 0;
const MAX_STAT_VALUE = 9_999_999;

let landingConfigCache: CacheEntry<LandingConfig> | null = null;

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
  taglineColor: "#10b981",
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitaria. Carteirinha, Loja e Eventos.",
  heroHighlight: "CARDUME TUBARAO",
  titleColor: "#ffffff",
  gradientStart: "#34d399",
  gradientEnd: "#10b981",
  statUsers: 120,
  statPosts: 340,
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

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  if (!shouldUseCallable()) {
    return fallbackFn();
  }

  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

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

const extractPayloadData = (raw: unknown): unknown => {
  const obj = asObject(raw);
  if (!obj) return raw;

  if ("config" in obj) return obj.config;
  if ("data" in obj) return obj.data;
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

export async function fetchLandingConfig(options?: {
  forceRefresh?: boolean;
  fallbackConfig?: LandingConfig;
}): Promise<LandingConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const fallbackConfig = options?.fallbackConfig ?? DEFAULT_LANDING_CONFIG;

  if (!forceRefresh && landingConfigCache) {
    if (Date.now() - landingConfigCache.cachedAt <= READ_CACHE_TTL_MS) {
      return landingConfigCache.value;
    }
  }

  const rawConfig = await callWithFallback<Record<string, never>, unknown>(
    ADMIN_LANDING_FETCH_CALLABLE,
    {},
    async () => {
      const snap = await getDoc(doc(db, "site_config", "landing_page"));
      return snap.exists() ? snap.data() : null;
    }
  );

  const normalized = sanitizeLandingConfig(
    extractPayloadData(rawConfig),
    fallbackConfig
  );

  landingConfigCache = {
    cachedAt: Date.now(),
    value: normalized,
  };

  return normalized;
}

export async function saveLandingConfig(config: LandingConfig): Promise<void> {
  const normalized = sanitizeLandingConfig(config, config);

  await callWithFallback<{ config: LandingConfig }, { ok: boolean }>(
    ADMIN_LANDING_SAVE_CALLABLE,
    { config: normalized },
    async () => {
      await setDoc(doc(db, "site_config", "landing_page"), normalized);
      return { ok: true };
    }
  );

  landingConfigCache = {
    cachedAt: Date.now(),
    value: normalized,
  };
}

export function clearAdminLandingCache(): void {
  landingConfigCache = null;
}
