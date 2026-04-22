import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  LeagueAdminApiError,
  asObject,
  asString,
  extractMissingSchemaColumn,
  removeMissingColumnFromPayload,
  resolveLeagueTenantContext,
} from "../_auth";

export const runtime = "nodejs";

type ManualFrequencyStatus = "presenca" | "falta" | "justificada";

type ManualFrequencyEntry = {
  id: string;
  eventKey: string;
  eventTitle: string;
  userId: string;
  userName: string;
  status: ManualFrequencyStatus;
  justification?: string;
  updatedAt: string;
  updatedBy?: string;
};

const DATA_KEY = "frequencyManualEntries";
const MAX_EVENT_KEY_LENGTH = 180;
const MAX_EVENT_TITLE_LENGTH = 140;
const MAX_USER_NAME_LENGTH = 140;
const MAX_JUSTIFICATION_LENGTH = 1000;

const normalizeStatus = (value: unknown): ManualFrequencyStatus | null => {
  const raw = asString(value).trim().toLowerCase();
  if (raw === "presenca" || raw === "presença" || raw === "presente") return "presenca";
  if (raw === "falta" || raw === "ausente") return "falta";
  if (raw === "justificada" || raw === "justificativa" || raw === "justificado") {
    return "justificada";
  }
  return null;
};

const buildEntryId = (eventKey: string, userId: string): string => `${eventKey}::${userId}`;

const normalizeManualFrequencyEntries = (value: unknown): ManualFrequencyEntry[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const entries: ManualFrequencyEntry[] = [];

  for (const item of value) {
    const raw = asObject(item);
    if (!raw) continue;

    const eventKey = asString(raw.eventKey).trim().slice(0, MAX_EVENT_KEY_LENGTH);
    const userId = asString(raw.userId).trim();
    const status = normalizeStatus(raw.status);
    if (!eventKey || !userId || !status) continue;

    const id = buildEntryId(eventKey, userId);
    if (seen.has(id)) continue;
    seen.add(id);

    const justification = asString(raw.justification).trim().slice(0, MAX_JUSTIFICATION_LENGTH);
    entries.push({
      id,
      eventKey,
      eventTitle: asString(raw.eventTitle).trim().slice(0, MAX_EVENT_TITLE_LENGTH),
      userId,
      userName: asString(raw.userName).trim().slice(0, MAX_USER_NAME_LENGTH),
      status,
      ...(justification ? { justification } : {}),
      updatedAt: asString(raw.updatedAt).trim() || new Date().toISOString(),
      updatedBy: asString(raw.updatedBy).trim() || undefined,
    });
  }

  return entries.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.eventTitle.localeCompare(right.eventTitle, "pt-BR") ||
      left.userName.localeCompare(right.userName, "pt-BR")
  );
};

const normalizeEntryFromBody = (
  body: Record<string, unknown>,
  updatedBy: string
): ManualFrequencyEntry => {
  const eventKey = asString(body.eventKey).trim().slice(0, MAX_EVENT_KEY_LENGTH);
  const userId = asString(body.userId).trim();
  const status = normalizeStatus(body.status);

  if (!eventKey || !userId || !status) {
    throw new LeagueAdminApiError("Informe evento, membro e status da frequência.", 400);
  }

  const eventTitle = asString(body.eventTitle).trim().slice(0, MAX_EVENT_TITLE_LENGTH);
  const userName = asString(body.userName).trim().slice(0, MAX_USER_NAME_LENGTH);
  const justification = asString(body.justification).trim().slice(0, MAX_JUSTIFICATION_LENGTH);

  return {
    id: buildEntryId(eventKey, userId),
    eventKey,
    eventTitle,
    userId,
    userName,
    status,
    ...(justification ? { justification } : {}),
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };
};

const updateLeagueData = async (payload: {
  leagueId: string;
  tenantId: string;
  data: Record<string, unknown>;
}): Promise<void> => {
  let updatePayload: Record<string, unknown> = {
    data: payload.data,
    updatedAt: new Date().toISOString(),
  };

  while (Object.keys(updatePayload).length > 0) {
    let query = supabaseAdmin
      .from("ligas_config")
      .update(updatePayload)
      .eq("id", payload.leagueId);
    if (payload.tenantId) {
      query = query.eq("tenant_id", payload.tenantId);
    }

    const { error } = await query;
    if (!error) return;

    const missingColumn = extractMissingSchemaColumn(error);
    if (!missingColumn || missingColumn === "data") {
      throw new LeagueAdminApiError(error.message, 400);
    }

    const nextPayload = removeMissingColumnFromPayload(updatePayload, missingColumn);
    if (!nextPayload) {
      throw new LeagueAdminApiError(error.message, 400);
    }
    updatePayload = nextPayload;
  }
};

const readBody = async (request: NextRequest): Promise<Record<string, unknown>> =>
  asObject(await request.json()) ?? {};

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const leagueId = asString(params.get("leagueId")).trim();
    const requestedTenantId = asString(params.get("tenantId")).trim();

    const { leagueRow } = await resolveLeagueTenantContext<Record<string, unknown>>(request, {
      leagueId,
      requestedTenantId,
      leagueSelect: "id,tenant_id,data",
    });

    const leagueData = asObject(leagueRow.data) ?? {};
    return NextResponse.json({
      entries: normalizeManualFrequencyEntries(leagueData[DATA_KEY]),
    });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao carregar frequência.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readBody(request);
    const leagueId = asString(body.leagueId).trim();
    const requestedTenantId = asString(body.tenantId).trim();

    const { effectiveTenantId, leagueRow, scope } =
      await resolveLeagueTenantContext<Record<string, unknown>>(request, {
        leagueId,
        requestedTenantId,
        leagueSelect: "id,tenant_id,data",
      });

    const entry = normalizeEntryFromBody(body, scope.userId);
    const leagueData = asObject(leagueRow.data) ?? {};
    const currentEntries = normalizeManualFrequencyEntries(leagueData[DATA_KEY]);
    const nextEntries = [
      entry,
      ...currentEntries.filter(
        (item) => item.eventKey !== entry.eventKey || item.userId !== entry.userId
      ),
    ];

    await updateLeagueData({
      leagueId,
      tenantId: effectiveTenantId,
      data: {
        ...leagueData,
        [DATA_KEY]: nextEntries,
      },
    });

    return NextResponse.json({ entries: nextEntries, entry });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao salvar frequência.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await readBody(request);
    const leagueId = asString(body.leagueId).trim();
    const requestedTenantId = asString(body.tenantId).trim();
    const eventKey = asString(body.eventKey).trim();
    const userId = asString(body.userId).trim();

    if (!eventKey || !userId) {
      throw new LeagueAdminApiError("Informe evento e membro para remover o ajuste.", 400);
    }

    const { effectiveTenantId, leagueRow } =
      await resolveLeagueTenantContext<Record<string, unknown>>(request, {
        leagueId,
        requestedTenantId,
        leagueSelect: "id,tenant_id,data",
      });

    const leagueData = asObject(leagueRow.data) ?? {};
    const nextEntries = normalizeManualFrequencyEntries(leagueData[DATA_KEY]).filter(
      (item) => item.eventKey !== eventKey || item.userId !== userId
    );

    await updateLeagueData({
      leagueId,
      tenantId: effectiveTenantId,
      data: {
        ...leagueData,
        [DATA_KEY]: nextEntries,
      },
    });

    return NextResponse.json({ entries: nextEntries });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao remover ajuste de frequência.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
