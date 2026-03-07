import { NextResponse } from "next/server";

import {
  DEFAULT_LANDING_CONFIG,
  type LandingConfig,
} from "@/lib/adminLandingService";
import {
  fetchPublicLandingData,
  type PublicLandingData,
} from "@/lib/publicLandingService";
import { fetchTenantBySlug } from "@/lib/tenantService";
import { TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";
import { cookies } from "next/headers";

export const revalidate = 43200; // 12h
export const dynamic = "force-dynamic";

const fallbackPayload = (
  config: LandingConfig = DEFAULT_LANDING_CONFIG
): PublicLandingData => ({
  config,
  usersCount: 0,
  tenantsCount: 0,
  partnersCount: 0,
});

export async function GET() {
  try {
    const cookieStore = await cookies();
    const tenantSlug = (cookieStore.get(TENANT_SLUG_COOKIE_NAME)?.value || "")
      .trim()
      .toLowerCase();
    const tenant = tenantSlug ? await fetchTenantBySlug(tenantSlug) : null;

    const data = await fetchPublicLandingData({
      forceRefresh: true,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
      tenantId: tenant?.id || "",
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
      },
    });
  } catch (error: unknown) {
    console.error("Falha ao gerar payload publico da landing:", error);
    return NextResponse.json(fallbackPayload(), {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
      },
    });
  }
}
