import { NextResponse } from "next/server";

import {
  DEFAULT_LANDING_CONFIG,
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
    logoUrl: "/logo.png",
  };
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
      logoUrl: logoUrl || "/logo.png",
    },
  };
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const scope = (requestUrl.searchParams.get("scope") || "").trim().toLowerCase();
  const queryTenantSlug = (requestUrl.searchParams.get("tenant") || "")
    .trim()
    .toLowerCase();

  try {
    const cookieStore = await cookies();
    const cookieTenantSlug = (cookieStore.get(TENANT_SLUG_COOKIE_NAME)?.value || "")
      .trim()
      .toLowerCase();
    const tenantSlug = scope === "platform" ? "" : queryTenantSlug || cookieTenantSlug;
    const tenant = tenantSlug ? await resolveTenantPublicBrand(tenantSlug) : null;
    const brand = tenant?.brand ??
      (tenantSlug ? buildTenantFallbackBrand(tenantSlug) : DEFAULT_PLATFORM_BRAND);

    const data = await fetchPublicLandingData({
      forceRefresh: true,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
      tenantId: tenant?.tenantId || "",
    });

    return NextResponse.json(
      {
        ...data,
        brand,
      } satisfies PublicLandingPayload,
      {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
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
      },
    });
  }
}
