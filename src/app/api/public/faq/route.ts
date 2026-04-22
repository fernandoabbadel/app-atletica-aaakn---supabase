import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_PLATFORM_FAQ_CONFIG,
  sanitizePlatformFaqConfig,
  type PlatformFaqConfig,
} from "@/lib/platformFaqConfig";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SITE_CONFIG_TABLE = "site_config";
const FAQ_CONFIG_ROW_ID = "faq_page";
const FAQ_ROW_SELECT_CANDIDATES = ["id,data", "id,config", "id,payload", "*"] as const;

type FaqSource = "official" | "fallback";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const jsonError = (message: string, status: number) =>
  NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );

const getSupabaseErrorText = (error: unknown): string => {
  const raw = asObject(error);
  return [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
    asString(raw?.hint),
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

const extractPayloadData = (raw: unknown): unknown => {
  const obj = asObject(raw);
  if (!obj) return raw;
  if ("config" in obj) return obj.config;
  if ("data" in obj) return obj.data;
  if ("payload" in obj) return obj.payload;
  return raw;
};

const fetchFaqRow = async (): Promise<unknown> => {
  const fetchAttempt = async (scope: "global" | "any"): Promise<unknown> => {
    let lastSchemaError: unknown = null;

    for (const selectColumns of FAQ_ROW_SELECT_CANDIDATES) {
      let query = supabaseAdmin
        .from(SITE_CONFIG_TABLE)
        .select(selectColumns)
        .eq("id", FAQ_CONFIG_ROW_ID);

      if (scope === "global") {
        query = query.is("tenant_id", null);
      }

      const { data, error } = await query.maybeSingle();
      if (!error) return data;

      if (scope === "global" && shouldFallbackMissingColumns(error, ["tenant_id"])) {
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

    if (lastSchemaError) return null;
    return null;
  };

  return (await fetchAttempt("global")) || (await fetchAttempt("any"));
};

const saveFaqRow = async (config: PlatformFaqConfig): Promise<void> => {
  const nowIso = new Date().toISOString();
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      data: config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      data: config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      payload: config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      payload: config,
      updated_at: nowIso,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      data: config,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      data: config,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      config,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      config,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      tenant_id: null,
      payload: config,
    },
    {
      id: FAQ_CONFIG_ROW_ID,
      payload: config,
    },
  ];

  let lastSchemaError: unknown = null;
  for (const payload of payloadCandidates) {
    const { error } = await supabaseAdmin.from(SITE_CONFIG_TABLE).upsert(payload, {
      onConflict: "id",
    });

    if (!error) return;

    if (
      shouldFallbackMissingColumns(error, [
        "tenant_id",
        "data",
        "config",
        "payload",
        "updated_at",
      ])
    ) {
      lastSchemaError = error;
      continue;
    }

    throw error;
  }

  if (lastSchemaError) throw lastSchemaError;
};

const resolveFaqConfig = async (): Promise<{
  config: PlatformFaqConfig;
  source: FaqSource;
}> => {
  const row = await fetchFaqRow();
  if (!row) {
    return {
      config: DEFAULT_PLATFORM_FAQ_CONFIG,
      source: "fallback",
    };
  }

  return {
    config: sanitizePlatformFaqConfig(extractPayloadData(row), DEFAULT_PLATFORM_FAQ_CONFIG),
    source: "official",
  };
};

const requirePlatformMaster = async (request: NextRequest): Promise<string> => {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Não autenticado.");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authData.user) {
    throw new Error("Sessão inválida.");
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("uid,role,status")
    .eq("uid", authData.user.id)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message || "Falha ao carregar perfil.");
  }

  const raw = asObject(userRow);
  const userId = asString(raw?.uid).trim();
  const role = asString(raw?.role).trim().toLowerCase();
  const status = asString(raw?.status, "ativo").trim().toLowerCase();
  if (!userId || role !== "master" || status === "banned" || status === "bloqueado") {
    throw new Error("Area exclusiva do master da plataforma.");
  }

  return userId;
};

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("refresh") === "1") {
      revalidatePath("/faq");
    }

    const payload = await resolveFaqConfig();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.warn("Falha ao carregar FAQ público:", error);
    return NextResponse.json(
      {
        config: DEFAULT_PLATFORM_FAQ_CONFIG,
        source: "fallback",
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePlatformMaster(request);

    const body = asObject(await request.json().catch(() => null));
    const normalized = sanitizePlatformFaqConfig(body?.config, DEFAULT_PLATFORM_FAQ_CONFIG);
    await saveFaqRow(normalized);
    revalidatePath("/faq");

    return NextResponse.json(
      {
        config: normalized,
        source: "official",
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Falha ao salvar FAQ.";
    const lowerMessage = message.toLowerCase();
    const status =
      lowerMessage.includes("autentic") ||
      lowerMessage.includes("sessão") ||
      lowerMessage.includes("sessao")
        ? 401
        : lowerMessage.includes("master")
          ? 403
          : 400;
    return jsonError(message, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = asObject(await request.json().catch(() => null));
    const questionId = asString(body?.questionId).trim();
    const reaction = asString(body?.reaction).trim().toLowerCase();

    if (!questionId || (reaction !== "like" && reaction !== "dislike")) {
      return jsonError("Reação inválida.", 400);
    }

    const payload = await resolveFaqConfig();
    let found = false;
    const nextConfig: PlatformFaqConfig = {
      ...payload.config,
      sections: payload.config.sections.map((section) => ({
        ...section,
        questions: section.questions.map((question) => {
          if (question.id !== questionId) return question;
          found = true;
          return {
            ...question,
            likes: reaction === "like" ? (question.likes || 0) + 1 : question.likes || 0,
            dislikes:
              reaction === "dislike" ? (question.dislikes || 0) + 1 : question.dislikes || 0,
          };
        }),
      })),
    };

    if (!found) {
      return jsonError("Pergunta não encontrada.", 404);
    }

    const normalized = sanitizePlatformFaqConfig(nextConfig, payload.config);
    await saveFaqRow(normalized);
    revalidatePath("/faq");

    return NextResponse.json(
      {
        config: normalized,
        source: "official",
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Falha ao registrar avaliação.";
    return jsonError(message, 400);
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}
