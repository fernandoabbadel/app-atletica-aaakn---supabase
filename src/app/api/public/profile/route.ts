import { NextResponse } from "next/server";

import { enrichPublicProfileBundleWithAchievements } from "@/lib/publicProfileBundleAdminService";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const cleanParam = (value: string | null): string => (typeof value === "string" ? value.trim() : "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = cleanParam(searchParams.get("userId") || searchParams.get("uid"));
  const viewerUid = cleanParam(searchParams.get("viewerUid"));
  const tenantId = cleanParam(searchParams.get("tenantId"));

  if (!userId) {
    return NextResponse.json(
      { error: "Parametro userId obrigatorio." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("profile_public_bundle", {
      p_tenant_id: tenantId || null,
      p_target_user_id: userId,
      p_viewer_user_id: viewerUid || null,
      p_posts_limit: 8,
      p_events_limit: 8,
      p_treinos_limit: 8,
      p_ligas_limit: 8,
    });

    if (error) {
      throw error;
    }

    if (!data) {
      return NextResponse.json(null, {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    const rawPayload =
      typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
    if (!rawPayload) {
      return NextResponse.json(null, {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    const enriched = await enrichPublicProfileBundleWithAchievements(
      rawPayload,
      tenantId || undefined
    );

    return NextResponse.json(enriched, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Erro ao montar profile bundle publico:", error);
    return NextResponse.json(
      { error: "Falha ao carregar perfil publico." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
