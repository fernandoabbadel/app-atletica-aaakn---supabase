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
import { cleanupExpiredRateLimitBuckets, consumeRateLimit } from "@/lib/rateLimiter";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";
import { cookies } from "next/headers";

export const revalidate = 43200; // 12h
export const dynamic = "force-dynamic";

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
    return null;
  }

  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  const sigla = typeof data.sigla === "string" ? data.sigla.trim() : "";
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const curso = typeof data.curso === "string" ? data.curso.trim() : "";
  const faculdade = typeof data.faculdade === "string" ? data.faculdade.trim() : "";
  const logoUrl = typeof data.logo_url === "string" ? data.logo_url.trim() : "";

  return {
    tenantId: data.id.trim(),
    brand: {
      sigla: sigla || slug.toUpperCase() || "TENANT",
      nome: nome || sigla || slug.toUpperCase() || "TENANT",
      subtitle: curso || faculdade || "Landing oficial da atletica.",
      logoUrl: logoUrl || PLATFORM_LOGO_URL,
    },
  };
};

const buildLandingRowIds = (tenantId?: string): string[] => {
  const cleanTenantId = (tenantId || "").trim();
  if (!cleanTenantId) return [LANDING_CONFIG_ROW_ID];
  return [`${LANDING_CONFIG_ROW_ID}__${cleanTenantId}`, LANDING_CONFIG_ROW_ID];
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
  tenantId?: string
): Promise<LandingConfig> => {
  for (const rowId of buildLandingRowIds(tenantId)) {
    const { data, error } = await supabaseAdmin
      .from(SITE_CONFIG_TABLE)
      .select("id,data,updated_at")
      .eq("id", rowId)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      return sanitizeLandingConfig(extractConfigPayload(data), DEFAULT_LANDING_CONFIG);
    }
  }

  return DEFAULT_LANDING_CONFIG;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const scope = (requestUrl.searchParams.get("scope") || "").trim().toLowerCase();
  const queryTenantSlug = (requestUrl.searchParams.get("tenant") || "")
    .trim()
    .toLowerCase();
  const rateLimit = consumeRateLimit(resolveRequestIp(request), "/api/public/landing");

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in 1 minute." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(
            Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
          ),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
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
    const tenant = tenantSlug ? await resolveTenantPublicBrand(tenantSlug) : null;
    const brand = tenant?.brand ??
      (tenantSlug ? buildTenantFallbackBrand(tenantSlug) : DEFAULT_PLATFORM_BRAND);
    const config = await fetchLandingConfigWithAdmin(tenant?.tenantId || "");

    const data = await fetchPublicLandingData({
      forceRefresh: true,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
      tenantId: tenant?.tenantId || "",
    });

    return NextResponse.json(
      {
        ...data,
        tenantId: tenant?.tenantId || "",
        config,
        brand,
      } satisfies PublicLandingPayload,
      {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
      }
    );
  } catch (error: unknown) {
    console.error("Falha ao gerar payload publico da landing:", error);
    const fallbackBrand = queryTenantSlug
      ? buildTenantFallbackBrand(queryTenantSlug)
      : DEFAULT_PLATFORM_BRAND;
    return NextResponse.json(fallbackPayload(DEFAULT_LANDING_CONFIG, fallbackBrand), {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  }
}
