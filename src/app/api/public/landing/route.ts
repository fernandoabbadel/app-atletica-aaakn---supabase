import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  DEFAULT_LANDING_CONFIG,
  DEFAULT_TENANT_LANDING_CONFIG,
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
import {
  fetchPublicTenantBySlugWithAdmin,
  type PublicTenantDirectoryEntry,
} from "@/lib/publicTenantDirectoryService";
import { fetchLandingPartnersWithAdmin } from "@/lib/publicLandingPartnersAdminService";
import { cleanupExpiredRateLimitBuckets, consumeRateLimit } from "@/lib/rateLimiter";
import { ServerCache } from "@/lib/serverCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
const LANDING_BRAND_CACHE_TTL_MS = 5 * 60 * 1000;
const LANDING_SERVER_CACHE_TTL_MS = 10 * 60 * 1000;
const LANDING_FALLBACK_SERVER_CACHE_TTL_MS = 60 * 1000;
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
  version: string;
};

type LandingConfigResolution = {
  config: LandingConfig;
  source: "official" | "fallback";
  version: string;
};

type RouteCacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const tenantBrandCache = new Map<string, RouteCacheEntry<TenantPublicBrand | null>>();
const LANDING_CONFIG_SELECT_CANDIDATES = ["id,data", "id,config", "id,payload", "*"] as const;

const fallbackPayload = (
  config: LandingConfig = DEFAULT_LANDING_CONFIG,
  brand: PublicLandingBrand = DEFAULT_PLATFORM_BRAND,
  source: "official" | "fallback" = "fallback"
): PublicLandingPayload => ({
  config,
  usersCount: 0,
  tenantsCount: 0,
  partnersCount: 0,
  partners: [],
  brand,
  source,
});

const resolveLandingFallbackConfig = (tenantScope: boolean): LandingConfig =>
  tenantScope ? DEFAULT_TENANT_LANDING_CONFIG : DEFAULT_LANDING_CONFIG;

const revalidateLandingPaths = (scope: string, tenantSlug: string): void => {
  try {
    if (scope === "platform" || !tenantSlug.trim()) {
      revalidatePath("/");
      return;
    }

    const cleanTenantSlug = tenantSlug.trim().toLowerCase();
    revalidatePath(`/${cleanTenantSlug}`);
    revalidatePath(`/${cleanTenantSlug}/landing`);
  } catch (error) {
    console.warn("Falha ao revalidar paths da landing publica.", error);
  }
};

const measurePayloadBytes = (payload: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return 0;
  }
};

const getRouteCacheValue = <T>(
  cache: Map<string, RouteCacheEntry<T>>,
  key: string,
  ttlMs: number
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > ttlMs) {
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

const resolveSupabaseHost = (): string => {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!rawUrl.trim()) return "missing";

  try {
    return new URL(rawUrl).host;
  } catch {
    return "invalid";
  }
};

const resolveRequestIp = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  if (firstForwardedIp) return firstForwardedIp;

  const realIp = request.headers.get("x-real-ip") || "";
  if (realIp.trim()) return realIp.trim();

  return "unknown";
};

const getSupabaseErrorText = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message.toLowerCase() : "";
  }

  const raw = error as Record<string, unknown>;
  return [
    error instanceof Error ? error.message : "",
    typeof raw.message === "string" ? raw.message : "",
    typeof raw.details === "string" ? raw.details : "",
    typeof raw.hint === "string" ? raw.hint : "",
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

const mapTenantEntryToBrand = (
  tenant: PublicTenantDirectoryEntry
): TenantPublicBrand => ({
  tenantId: tenant.id.trim(),
  brand: {
    sigla: tenant.sigla || tenant.slug.toUpperCase() || "TENANT",
    nome: tenant.nome || tenant.sigla || tenant.slug.toUpperCase() || "TENANT",
    subtitle: tenant.curso || tenant.faculdade || "Landing oficial da atletica.",
    logoUrl: tenant.logoUrl || PLATFORM_LOGO_URL,
  },
  version:
    tenant.updatedAt.trim() ||
    tenant.createdAt.trim() ||
    tenant.id.trim() ||
    tenant.slug.trim().toLowerCase(),
});

const resolveTenantPublicBrand = async (
  tenantSlug: string,
  forceRefresh = false
): Promise<TenantPublicBrand | null> => {
  const cleanTenantSlug = tenantSlug.trim().toLowerCase();
  if (!cleanTenantSlug) return null;

  if (forceRefresh) {
    tenantBrandCache.delete(cleanTenantSlug);
  }

  const cached = getRouteCacheValue(
    tenantBrandCache,
    cleanTenantSlug,
    LANDING_BRAND_CACHE_TTL_MS
  );
  if (cached !== null || tenantBrandCache.has(cleanTenantSlug)) {
    return cached;
  }

  const tenant = await fetchPublicTenantBySlugWithAdmin(cleanTenantSlug);
  if (!tenant) {
    return setRouteCacheValue(tenantBrandCache, cleanTenantSlug, null);
  }

  return setRouteCacheValue(
    tenantBrandCache,
    cleanTenantSlug,
    mapTenantEntryToBrand(tenant)
  );
};

const extractConfigPayload = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return record.data;
  if (record.config && typeof record.config === "object") return record.config;
  if (record.payload && typeof record.payload === "object") return record.payload;
  return raw;
};

const hashPayloadVersion = (payload: unknown): string => {
  try {
    return createHash("sha1")
      .update(JSON.stringify(payload) || "null")
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "unknown";
  }
};

const resolveLandingConfigVersion = (rowId: string, raw: unknown): string => {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.updated_at === "string" && record.updated_at.trim()) {
      return `${rowId}:${record.updated_at.trim()}`;
    }
  }

  return `${rowId}:${hashPayloadVersion(extractConfigPayload(raw))}`;
};

const fetchLandingConfigWithAdmin = async (
  tenantId?: string,
  tenantScopedFallback = false
): Promise<LandingConfigResolution> => {
  const cleanTenantId = (tenantId || "").trim();
  const fallbackConfig = resolveLandingFallbackConfig(
    cleanTenantId.length > 0 || tenantScopedFallback
  );

  const fetchRowAttempt = async (
    rowId: string,
    scope: "tenant" | "global" | "any"
  ): Promise<unknown> => {
    let lastSchemaError: unknown = null;

    for (const selectColumns of LANDING_CONFIG_SELECT_CANDIDATES) {
      let query = supabaseAdmin
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

    if (lastSchemaError) {
      console.warn("Landing publica: fallback de schema ao ler config.", lastSchemaError);
    }
    return null;
  };

  const attempts: Array<{ rowId: string; load: () => Promise<unknown> }> = cleanTenantId
    ? [
        {
          rowId: `${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`,
          load: () => fetchRowAttempt(`${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`, "tenant"),
        },
        {
          rowId: `${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`,
          load: () => fetchRowAttempt(`${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`, "any"),
        },
        {
          rowId: LANDING_CONFIG_ROW_ID,
          load: () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "tenant"),
        },
        {
          rowId: LANDING_CONFIG_ROW_ID,
          load: () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "global"),
        },
        {
          rowId: LANDING_CONFIG_ROW_ID,
          load: () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "any"),
        },
      ]
    : [
        {
          rowId: LANDING_CONFIG_ROW_ID,
          load: () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "global"),
        },
        {
          rowId: LANDING_CONFIG_ROW_ID,
          load: () => fetchRowAttempt(LANDING_CONFIG_ROW_ID, "any"),
        },
      ];

  for (const attempt of attempts) {
    const data = await attempt.load();
    if (data) {
      return {
        config: sanitizeLandingConfig(extractConfigPayload(data), fallbackConfig),
        source: "official",
        version: resolveLandingConfigVersion(attempt.rowId, data),
      };
    }
  }

  return {
    config: fallbackConfig,
    source: "fallback",
    version: `fallback:${cleanTenantId || (tenantScopedFallback ? "tenant-default" : "default")}`,
  };
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
    const cacheScope = tenantSlug ? "tenant" : "platform";
    const cacheKeyBase = `public:landing:${cacheScope}:${tenantSlug || "platform"}`;
    if (shouldRefresh) {
      revalidateLandingPaths(scope, tenantSlug);
      ServerCache.invalidatePattern(`${cacheKeyBase}:*`);
      if (tenantSlug) {
        tenantBrandCache.delete(tenantSlug);
      }
    }
    let tenant: TenantPublicBrand | null = null;
    if (tenantSlug) {
      try {
        tenant = await resolveTenantPublicBrand(tenantSlug, shouldRefresh);
      } catch (tenantError: unknown) {
        console.warn("Landing publica: falha ao resolver marca do tenant.", tenantError);
      }
    }

    if (tenantSlug && !tenant) {
      console.error(
        "[public landing] tenant slug nao encontrado no lookup server-side",
        JSON.stringify({
          tenantSlug,
          supabaseHost: resolveSupabaseHost(),
          scope: cacheScope,
        })
      );
    }

    const brand =
      tenant?.brand ??
      (tenantSlug ? buildTenantFallbackBrand(tenantSlug) : DEFAULT_PLATFORM_BRAND);
    const fallbackConfig = resolveLandingFallbackConfig(Boolean(tenant?.tenantId || tenantSlug));

    let configResolution: LandingConfigResolution = {
      config: fallbackConfig,
      source: "fallback",
      version: `fallback:${tenant?.tenantId || tenantSlug || "platform"}`,
    };
    try {
      configResolution = await fetchLandingConfigWithAdmin(
        tenant?.tenantId || "",
        Boolean(tenantSlug)
      );
    } catch (configError: unknown) {
      console.warn("Landing publica: falha ao carregar config da landing.", configError);
    }

    const cacheKey = `${cacheKeyBase}:${tenant?.version || "platform"}:${configResolution.version}`;
    const cachedPayload = shouldRefresh ? null : ServerCache.get<PublicLandingPayload>(cacheKey);
    const cacheHit = cachedPayload !== null;
    const payload =
      cachedPayload ??
      (await (async (): Promise<PublicLandingPayload> => {
        const config = configResolution.config;

        let data = fallbackPayload(config, brand, configResolution.source);
        try {
          const hiddenPartnerIds = new Set(config.hiddenPartnerIds || []);
          const partners = tenant?.tenantId
            ? (await fetchLandingPartnersWithAdmin(tenant.tenantId)).filter(
                (partner) => !hiddenPartnerIds.has(partner.id)
              )
            : [];

          data = {
            ...(await fetchPublicLandingData({
              forceRefresh: shouldRefresh,
              fallbackConfig,
              prefetchedConfig: config,
              tenantId: tenant?.tenantId || "",
              includePartners: false,
            })),
            partners,
            brand,
            source: configResolution.source,
          };
        } catch (dataError: unknown) {
          console.warn("Landing publica: falha ao montar dados publicos da landing.", dataError);
        }

        const nextPayload = {
          ...data,
          tenantId: tenant?.tenantId || "",
          config,
          brand,
          source: configResolution.source,
        } satisfies PublicLandingPayload;
        ServerCache.set(
          cacheKey,
          nextPayload,
          configResolution.source === "official"
            ? LANDING_SERVER_CACHE_TTL_MS
            : LANDING_FALLBACK_SERVER_CACHE_TTL_MS
        );
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
    const payload = fallbackPayload(
      resolveLandingFallbackConfig(queryTenantSlug.length > 0),
      fallbackBrand,
      "fallback"
    );
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
