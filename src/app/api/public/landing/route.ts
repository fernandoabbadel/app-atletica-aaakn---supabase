import { NextResponse } from "next/server";

import {
  DEFAULT_LANDING_CONFIG,
  sanitizeLandingConfig,
  type LandingConfig,
} from "@/lib/adminLandingService";
import {
  fetchPublicLandingData,
  type PublicLandingBrand,
  type PublicLandingPayload,
} from "@/lib/publicLandingService";
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_BRAND_SIGLA,
  PLATFORM_BRAND_SUBTITLE,
  PLATFORM_LOGO_URL,
} from "@/constants/platformBrand";
import { QueryMonitor } from "@/lib/queryMonitor";
import { cleanupExpiredRateLimitBuckets, consumeRateLimit } from "@/lib/rateLimiter";
import { ServerCache } from "@/lib/serverCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
const LANDING_ROUTE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LANDING_SERVER_CACHE_TTL_MS = 10 * 60 * 1000;
const LANDING_ENDPOINT = "/api/public/landing";

const DEFAULT_PLATFORM_BRAND: PublicLandingBrand = {
  sigla: PLATFORM_BRAND_SIGLA,
  nome: PLATFORM_BRAND_NAME,
  subtitle: PLATFORM_BRAND_SUBTITLE,
  logoUrl: PLATFORM_LOGO_URL,
};
const LANDING_CONFIG_ROW_ID = "landing_page";
const SITE_CONFIG_TABLE = "site_config";

type TenantPublicBrand = {
  tenantId: string;
  brand: PublicLandingBrand;
};

type RouteCacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const tenantBrandCache = new Map<string, RouteCacheEntry<TenantPublicBrand | null>>();
const landingConfigCache = new Map<string, RouteCacheEntry<LandingConfig>>();

const fallbackPayload = (
  config: LandingConfig = DEFAULT_LANDING_CONFIG,
  brand: PublicLandingBrand = DEFAULT_PLATFORM_BRAND
): PublicLandingPayload => ({
  config,
  usersCount: 0,
  tenantsCount: 0,
  partnersCount: 0,
  brand,
});

const measurePayloadBytes = (payload: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return 0;
  }
};

const getRouteCacheValue = <T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > LANDING_ROUTE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setRouteCacheValue = <T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string,
  value: T
): T => {
  cache.set(key, { cachedAt: Date.now(), value });
  return value;
};

const buildTenantFallbackBrand = (tenantSlug: string): PublicLandingBrand => {
  const normalizedSlug = tenantSlug.trim().toUpperCase();
  return {
    sigla: normalizedSlug || "TENANT",
    nome: normalizedSlug || "TENANT",
    subtitle: "Landing oficial da atletica.",
    logoUrl: PLATFORM_LOGO_URL,
  };
};

const resolveRequestIp = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  if (firstForwardedIp) return firstForwardedIp;

  const realIp = request.headers.get("x-real-ip") || "";
  if (realIp.trim()) return realIp.trim();

  return "unknown";
};

const resolveTenantPublicBrand = async (
  tenantSlug: string
): Promise<TenantPublicBrand | null> => {
  const cleanTenantSlug = tenantSlug.trim().toLowerCase();
  if (!cleanTenantSlug) return null;

  const cached = getRouteCacheValue(tenantBrandCache, cleanTenantSlug);
  if (cached !== null || tenantBrandCache.has(cleanTenantSlug)) {
    return cached;
  }

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id,nome,sigla,slug,faculdade,curso,logo_url,status")
    .eq("status", "active")
    .ilike("slug", cleanTenantSlug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || typeof data.id !== "string" || !data.id.trim()) {
    return setRouteCacheValue(tenantBrandCache, cleanTenantSlug, null);
  }

  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  const sigla = typeof data.sigla === "string" ? data.sigla.trim() : "";
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const curso = typeof data.curso === "string" ? data.curso.trim() : "";
  const faculdade = typeof data.faculdade === "string" ? data.faculdade.trim() : "";
  const logoUrl = typeof data.logo_url === "string" ? data.logo_url.trim() : "";

  return setRouteCacheValue(tenantBrandCache, cleanTenantSlug, {
    tenantId: data.id.trim(),
    brand: {
      sigla: sigla || slug.toUpperCase() || "TENANT",
      nome: nome || sigla || slug.toUpperCase() || "TENANT",
      subtitle: curso || faculdade || "Landing oficial da atletica.",
      logoUrl: logoUrl || PLATFORM_LOGO_URL,
    },
  });
};

const extractConfigPayload = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return record.data;
  if (record.config && typeof record.config === "object") return record.config;
  if (record.payload && typeof record.payload === "object") return record.payload;
  return raw;
};

const fetchLandingConfigWithAdmin = async (
  tenantId?: string,
  forceRefresh = false
): Promise<LandingConfig> => {
  const cacheKey = (tenantId || "").trim() || "default";
  const cleanTenantId = (tenantId || "").trim();
  if (forceRefresh) {
    landingConfigCache.delete(cacheKey);
  }
  const cached = getRouteCacheValue(landingConfigCache, cacheKey);
  if (cached) return cached;

  const fetchRowAttempt = async (
    rowId: string,
    scope: "tenant" | "global" | "any"
  ): Promise<unknown> => {
    let query = supabaseAdmin
      .from(SITE_CONFIG_TABLE)
      .select("id,data,updated_at")
      .eq("id", rowId);

    if (scope === "tenant" && cleanTenantId) {
      query = query.eq("tenant_id", cleanTenantId);
    } else if (scope === "global") {
      query = query.is("tenant_id", null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  };

  const attempts: Array<() => Promise<unknown>> = cleanTenantId
    ? [
        () => fetchRowAttempt(`${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`, "tenant"),
        () => fetchRowAttempt(`${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`, "any"),
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
    if (data) {
      return setRouteCacheValue(
        landingConfigCache,
        cacheKey,
        sanitizeLandingConfig(extractConfigPayload(data), DEFAULT_LANDING_CONFIG)
      );
    }
  }

  return setRouteCacheValue(landingConfigCache, cacheKey, DEFAULT_LANDING_CONFIG);
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestUrl = new URL(request.url);
  const scope = (requestUrl.searchParams.get("scope") || "").trim().toLowerCase();
  const queryTenantSlug = (requestUrl.searchParams.get("tenant") || "")
    .trim()
    .toLowerCase();
  const shouldRefresh = requestUrl.searchParams.get("refresh") === "1";
  const rateLimit = consumeRateLimit(resolveRequestIp(request), "/api/public/landing");

  if (!rateLimit.allowed) {
    const payload = { error: "Rate limit exceeded. Try again in 1 minute." };
    QueryMonitor.recordQuery({
      endpoint: LANDING_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(payload),
      cacheHit: false,
      statusCode: 429,
      tenantId: queryTenantSlug || "platform",
      error: payload.error,
    });
    return NextResponse.json(payload, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(
          Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
        ),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  if (Math.random() < 0.02) {
    cleanupExpiredRateLimitBuckets();
  }

  try {
    const cookieStore = await cookies();
    const cookieTenantSlug = (cookieStore.get(TENANT_SLUG_COOKIE_NAME)?.value || "")
      .trim()
      .toLowerCase();
    const tenantSlug = scope === "platform" ? "" : queryTenantSlug || cookieTenantSlug;
    const cacheKey = `public:landing:${scope || "default"}:${tenantSlug || "platform"}`;
    if (shouldRefresh) {
      ServerCache.delete(cacheKey);
    }
    const cachedPayload = shouldRefresh ? null : ServerCache.get<PublicLandingPayload>(cacheKey);
    const cacheHit = cachedPayload !== null;
    const payload =
      cachedPayload ??
      (await (async (): Promise<PublicLandingPayload> => {
        const tenant = tenantSlug ? await resolveTenantPublicBrand(tenantSlug) : null;
        const brand =
          tenant?.brand ??
          (tenantSlug ? buildTenantFallbackBrand(tenantSlug) : DEFAULT_PLATFORM_BRAND);
        const config = await fetchLandingConfigWithAdmin(tenant?.tenantId || "", shouldRefresh);

        const data = await fetchPublicLandingData({
          forceRefresh: shouldRefresh,
          fallbackConfig: DEFAULT_LANDING_CONFIG,
          prefetchedConfig: config,
          tenantId: tenant?.tenantId || "",
        });

        const nextPayload = {
          ...data,
          tenantId: tenant?.tenantId || "",
          config,
          brand,
        } satisfies PublicLandingPayload;
        ServerCache.set(cacheKey, nextPayload, LANDING_SERVER_CACHE_TTL_MS);
        return nextPayload;
      })());

    QueryMonitor.recordQuery({
      endpoint: LANDING_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(payload),
      cacheHit,
      statusCode: 200,
      tenantId: payload.tenantId || tenantSlug || "platform",
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  } catch (error: unknown) {
    console.error("Falha ao gerar payload publico da landing:", error);
    const fallbackBrand = queryTenantSlug
      ? buildTenantFallbackBrand(queryTenantSlug)
      : DEFAULT_PLATFORM_BRAND;
    const payload = fallbackPayload(DEFAULT_LANDING_CONFIG, fallbackBrand);
    QueryMonitor.recordQuery({
      endpoint: LANDING_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(payload),
      cacheHit: false,
      statusCode: 200,
      tenantId: queryTenantSlug || "platform",
      error: error instanceof Error ? error.message : "landing_fallback",
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  }
}
