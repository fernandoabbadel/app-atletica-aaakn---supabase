import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  LeagueAdminApiError,
  asBoolean,
  asNumber,
  asObject,
  asString,
  extractMissingSchemaColumn,
  removeMissingColumnFromPayload,
  resolveEventTenantContext,
} from "../_auth";

export const runtime = "nodejs";

type PollOptionInput = {
  text: string;
  votes: number;
  creator?: string;
  creatorName?: string;
  creatorAvatar?: string;
};

const normalizeOptions = (value: unknown): PollOptionInput[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const raw = asObject(entry);
      if (!raw) return null;

      const text = asString(raw.text).trim().slice(0, 120);
      if (!text) return null;

      const creator = asString(raw.creator).trim();
      const creatorName = asString(raw.creatorName).trim();
      const creatorAvatar = asString(raw.creatorAvatar).trim();

      return {
        text,
        votes: Math.max(0, Math.floor(asNumber(raw.votes, 0))),
        ...(creator ? { creator } : {}),
        ...(creatorName ? { creatorName } : {}),
        ...(creatorAvatar ? { creatorAvatar } : {}),
      } satisfies PollOptionInput;
    })
    .filter((entry): entry is PollOptionInput => entry !== null)
    .slice(0, 80);
};

const insertPollWithSchemaFallback = async (
  payload: Record<string, unknown>
): Promise<string> => {
  let mutablePayload = { ...payload };

  while (Object.keys(mutablePayload).length > 0) {
    const { data, error } = await supabaseAdmin
      .from("eventos_enquetes")
      .insert(mutablePayload)
      .select("id")
      .single();
    if (!error) {
      return asString((data as Record<string, unknown> | null)?.id).trim();
    }

    const missingColumn = extractMissingSchemaColumn(error);
    if (!missingColumn) {
      throw new LeagueAdminApiError(error.message, 400);
    }

    const nextPayload = removeMissingColumnFromPayload(mutablePayload, missingColumn);
    if (!nextPayload) {
      throw new LeagueAdminApiError(error.message, 400);
    }
    mutablePayload = nextPayload;
  }

  throw new LeagueAdminApiError("Nao foi possivel criar a enquete do evento.", 400);
};

const updatePollWithSchemaFallback = async (
  eventId: string,
  pollId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  let mutablePayload = { ...payload };

  while (Object.keys(mutablePayload).length > 0) {
    const { error } = await supabaseAdmin
      .from("eventos_enquetes")
      .update(mutablePayload)
      .eq("id", pollId)
      .eq("eventoId", eventId);
    if (!error) return;

    const missingColumn = extractMissingSchemaColumn(error);
    if (!missingColumn) {
      throw new LeagueAdminApiError(error.message, 400);
    }

    const nextPayload = removeMissingColumnFromPayload(mutablePayload, missingColumn);
    if (!nextPayload) {
      throw new LeagueAdminApiError(error.message, 400);
    }
    mutablePayload = nextPayload;
  }

  throw new LeagueAdminApiError("Nao foi possivel atualizar a enquete do evento.", 400);
};

const readBody = async (request: NextRequest): Promise<Record<string, unknown>> => {
  const body = asObject(await request.json());
  return body ?? {};
};

export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request);
    const eventId = asString(body.eventId).trim();
    const requestedTenantId = asString(body.tenantId).trim();
    const question = asString(body.question).trim().slice(0, 280);

    if (!question) {
      throw new LeagueAdminApiError("Pergunta da enquete obrigatoria.", 400);
    }

    const { effectiveTenantId } = await resolveEventTenantContext(request, {
      eventId,
      requestedTenantId,
      eventSelect: "id,tenant_id",
    });

    const pollId = await insertPollWithSchemaFallback({
      eventoId: eventId,
      question,
      allowUserOptions: asBoolean(body.allowUserOptions, true),
      options: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creatorId: asString(body.creatorId).trim() || null,
      isOfficial: true,
      tenant_id: effectiveTenantId,
    });

    return NextResponse.json({ id: pollId });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao criar enquete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await readBody(request);
    const eventId = asString(body.eventId).trim();
    const pollId = asString(body.pollId).trim();
    const requestedTenantId = asString(body.tenantId).trim();

    if (!eventId || !pollId) {
      throw new LeagueAdminApiError("Enquete invalida.", 400);
    }

    await resolveEventTenantContext(request, {
      eventId,
      requestedTenantId,
      eventSelect: "id,tenant_id",
    });

    const { error } = await supabaseAdmin
      .from("eventos_enquetes")
      .delete()
      .eq("id", pollId)
      .eq("eventoId", eventId);
    if (error) {
      throw new LeagueAdminApiError(error.message, 400);
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao remover enquete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readBody(request);
    const eventId = asString(body.eventId).trim();
    const pollId = asString(body.pollId).trim();
    const requestedTenantId = asString(body.tenantId).trim();

    if (!eventId || !pollId) {
      throw new LeagueAdminApiError("Enquete invalida.", 400);
    }

    await resolveEventTenantContext(request, {
      eventId,
      requestedTenantId,
      eventSelect: "id,tenant_id",
    });

    await updatePollWithSchemaFallback(eventId, pollId, {
      options: normalizeOptions(body.options),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao atualizar enquete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
