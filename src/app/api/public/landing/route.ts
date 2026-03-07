import { NextResponse } from "next/server";

import {
  DEFAULT_LANDING_CONFIG,
  type LandingConfig,
} from "@/lib/adminLandingService";
import {
  fetchPublicLandingData,
  type PublicLandingData,
} from "@/lib/publicLandingService";

export const revalidate = 43200; // 12h

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
    const data = await fetchPublicLandingData({
      forceRefresh: true,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
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
