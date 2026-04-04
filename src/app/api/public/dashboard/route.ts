import { NextResponse } from "next/server";

import { fetchPublicDashboardViewWithAdmin } from "@/lib/publicDashboardViewAdminService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId")?.trim() || "";
    const tenantSlug = searchParams.get("tenant")?.trim().toLowerCase() || "";
    const refresh = searchParams.get("refresh") === "1";

    const payload = await fetchPublicDashboardViewWithAdmin({
      forceRefresh: refresh,
      tenantId,
      tenantSlug,
    });

    if (!payload.tenantId) {
      return NextResponse.json(
        { error: "tenant_not_found" },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Falha ao gerar dashboard publico:", error);
    return NextResponse.json(
      { error: "public_dashboard_failed" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
