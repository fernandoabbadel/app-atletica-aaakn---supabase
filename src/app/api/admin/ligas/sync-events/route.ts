import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { normalizePaymentConfig, type CommercePaymentConfig } from "@/lib/commerceCatalog";
import { clearEventsNativeCaches } from "@/lib/eventsNativeService";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  LeagueAdminApiError,
  asNumber,
  asObject,
  asString,
  extractMissingSchemaColumn,
  removeMissingColumnFromPayload,
  resolveLeagueTenantContext,
} from "../_auth";

export const runtime = "nodejs";

type NormalizedLote = {
  id: number;
  nome: string;
  preco: string;
  status: "ativo" | "em_breve" | "esgotado";
};

type NormalizedLeagueEvent = {
  id: string;
  globalEventId: string;
  linkEvento: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  destaque: string;
  mapsUrl: string;
  imagem: string;
  imagePositionY: number;
  lotes: NormalizedLote[];
  descricao: string;
  pollQuestion: string;
  saleStatus: "ativo" | "em_breve" | "esgotado";
  pixChave: string;
  pixBanco: string;
  pixTitular: string;
  contatoComprovante: string;
  recipientUserId: string;
  recipientUserName: string;
  recipientUserTurma: string;
  recipientUserAvatar: string;
  paymentConfig: CommercePaymentConfig | null;
};

const normalizeStatus = (value: unknown): "ativo" | "em_breve" | "esgotado" => {
  const raw = asString(value).trim().toLowerCase();
  if (raw === "em_breve" || raw === "agendado") return "em_breve";
  if (raw === "esgotado" || raw === "encerrado") return "esgotado";
  return "ativo";
};

const normalizeLotes = (value: unknown): NormalizedLote[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      const raw = asObject(entry);
      if (!raw) return null;

      return {
        id: Math.max(1, Math.floor(asNumber(raw.id, index + 1))),
        nome: asString(raw.nome).trim().slice(0, 80),
        preco: asString(raw.preco).trim().slice(0, 32),
        status: normalizeStatus(raw.status),
      } satisfies NormalizedLote;
    })
    .filter((entry): entry is NormalizedLote => Boolean(entry && entry.nome));
};

const normalizeLeaguePaymentConfig = (
  raw: Record<string, unknown>
): CommercePaymentConfig | null => {
  const source = normalizePaymentConfig(raw.paymentConfig ?? raw.payment_config);
  return normalizePaymentConfig({
    chave: asString(source?.chave).trim() || asString(raw.pixChave).trim(),
    banco: asString(source?.banco).trim() || asString(raw.pixBanco).trim(),
    titular: asString(source?.titular).trim() || asString(raw.pixTitular).trim(),
    whatsapp:
      asString(source?.whatsapp).trim() ||
      asString(raw.contatoComprovante).trim(),
  });
};

const normalizeEvents = (value: unknown, leagueLogoUrl: string): NormalizedLeagueEvent[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: NormalizedLeagueEvent[] = [];

  for (const entry of value) {
    const raw = asObject(entry);
    if (!raw) continue;

    const titulo = asString(raw.titulo).trim().slice(0, 120);
    if (!titulo) {
      throw new LeagueAdminApiError("Todos os eventos da liga precisam de título.", 400);
    }

    const globalEventId = asString(raw.globalEventId).trim() || randomUUID();
    if (seen.has(globalEventId)) continue;
    seen.add(globalEventId);

    const normalizedPaymentConfig = normalizeLeaguePaymentConfig(raw);
    const normalizedWhatsapp =
      asString(normalizedPaymentConfig?.whatsapp).trim().slice(0, 32) ||
      asString(raw.contatoComprovante).trim().slice(0, 32);

    normalized.push({
      id: asString(raw.id).trim() || globalEventId,
      globalEventId,
      linkEvento: `/eventos/${globalEventId}`,
      titulo,
      data: asString(raw.data).trim().slice(0, 20),
      hora: asString(raw.hora).trim().slice(0, 20),
      local: asString(raw.local).trim().slice(0, 140),
      destaque: asString(raw.destaque).trim().slice(0, 80),
      mapsUrl: asString(raw.mapsUrl).trim().slice(0, 400),
      imagem: asString(raw.imagem).trim() || leagueLogoUrl,
      imagePositionY: Math.max(0, Math.min(100, Math.floor(asNumber(raw.imagePositionY, 50)))),
      lotes: normalizeLotes(raw.lotes),
      descricao: asString(raw.descricao).trim().slice(0, 1200),
      pollQuestion: asString(raw.pollQuestion).trim().slice(0, 280),
      saleStatus: normalizeStatus(raw.saleStatus),
      pixChave:
        asString(normalizedPaymentConfig?.chave).trim().slice(0, 140) ||
        asString(raw.pixChave).trim().slice(0, 140),
      pixBanco:
        asString(normalizedPaymentConfig?.banco).trim().slice(0, 140) ||
        asString(raw.pixBanco).trim().slice(0, 140),
      pixTitular:
        asString(normalizedPaymentConfig?.titular).trim().slice(0, 140) ||
        asString(raw.pixTitular).trim().slice(0, 140),
      contatoComprovante: normalizedWhatsapp,
      recipientUserId: "",
      recipientUserName: "",
      recipientUserTurma: "",
      recipientUserAvatar: "",
      paymentConfig: normalizedPaymentConfig,
    });
  }

  return normalized;
};

const findExistingPollByQuestion = async (
  eventId: string,
  question: string
): Promise<boolean> => {
  const { data, error } = await supabaseAdmin
    .from("eventos_enquetes")
    .select("id,question")
    .eq("eventoId", eventId);

  if (error) {
    throw new LeagueAdminApiError(error.message, 400);
  }

  const normalizedQuestion = question.trim().toLowerCase();
  return (Array.isArray(data) ? data : []).some((row) => {
    const raw = asObject(row);
    if (!raw) return false;
    return asString(raw.question).trim().toLowerCase() === normalizedQuestion;
  });
};

const insertPollWithSchemaFallback = async (
  payload: Record<string, unknown>
): Promise<void> => {
  let mutablePayload = { ...payload };

  while (Object.keys(mutablePayload).length > 0) {
    const { error } = await supabaseAdmin.from("eventos_enquetes").insert(mutablePayload);
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

  throw new LeagueAdminApiError("Não foi possível criar a enquete do evento.", 400);
};

const writeEventWithSchemaFallback = async (payload: {
  eventId: string;
  eventPayload: Record<string, unknown>;
  exists: boolean;
}): Promise<void> => {
  let mutablePayload = { ...payload.eventPayload };

  while (Object.keys(mutablePayload).length > 0) {
    const query = payload.exists
      ? supabaseAdmin.from("eventos").update(mutablePayload).eq("id", payload.eventId)
      : supabaseAdmin.from("eventos").insert(mutablePayload);

    const { error } = await query;
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

  throw new LeagueAdminApiError("Não foi possível sincronizar o evento da liga.", 400);
};

export async function POST(request: NextRequest) {
  try {
    const body = asObject(await request.json());
    const leagueId = asString(body?.leagueId).trim();
    const requestedTenantId = asString(body?.tenantId).trim();
    const timestamp = new Date().toISOString();

    const { effectiveTenantId, leagueTenantId, leagueRow } =
      await resolveLeagueTenantContext<Record<string, unknown>>(request, {
        leagueId,
        requestedTenantId,
        leagueSelect: "id,tenant_id,sigla,foto",
      });

    const leagueSigla = asString(leagueRow.sigla).trim().slice(0, 20);
    const leagueLogoUrl = asString(body?.leagueLogoUrl).trim() || asString(leagueRow.foto).trim();

    const nextEvents = normalizeEvents(body?.events, leagueLogoUrl);
    const eventIds = nextEvents.map((event) => event.globalEventId);

    const { data: existingEventRows, error: existingEventsError } =
      eventIds.length > 0
        ? await supabaseAdmin
            .from("eventos")
            .select("id,tenant_id")
            .in("id", eventIds)
        : { data: [], error: null };

    if (existingEventsError) {
      throw new LeagueAdminApiError(existingEventsError.message, 400);
    }

    const existingEventIds = new Map(
      (Array.isArray(existingEventRows) ? existingEventRows : [])
        .map((row) => {
          const raw = asObject(row);
          const id = asString(raw?.id).trim();
          return id ? [id, raw ?? {}] : null;
        })
        .filter(
          (entry): entry is [string, Record<string, unknown>] =>
            Array.isArray(entry) && entry.length === 2
        )
    );

    const syncedEvents: Record<string, unknown>[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let pollsCreated = 0;

    for (const event of nextEvents) {
      const eventId = event.globalEventId;
      const existingEvent = existingEventIds.get(eventId);
      const existingTenantId = asString(existingEvent?.tenant_id).trim();

      if (existingTenantId && existingTenantId !== effectiveTenantId) {
        throw new LeagueAdminApiError(
          "Um dos eventos vinculados pertence a outro tenant.",
          403
        );
      }

      const eventPayload: Record<string, unknown> = {
        id: eventId,
        titulo: leagueSigla ? `[${leagueSigla}] ${event.titulo}` : event.titulo,
        data: event.data,
        hora: event.hora,
        local: event.local,
        tipo: "Liga",
        categoria: "Liga",
        destaque: event.destaque,
        mapsUrl: event.mapsUrl,
        imagem: event.imagem || leagueLogoUrl || "",
        imagePositionY: event.imagePositionY,
        lotes: event.lotes,
        descricao: event.descricao,
        pixChave: event.pixChave,
        pixBanco: event.pixBanco,
        pixTitular: event.pixTitular,
        contatoComprovante: event.contatoComprovante,
        ...(event.paymentConfig ? { payment_config: event.paymentConfig } : {}),
        status: "ativo",
        sale_status: event.saleStatus,
        tenant_id: effectiveTenantId,
        updatedAt: timestamp,
      };

      if (!existingEvent) {
        eventPayload.createdAt = timestamp;
      }

      await writeEventWithSchemaFallback({
        eventId,
        eventPayload,
        exists: Boolean(existingEvent),
      });

      if (existingEvent) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      const nextEvent: Record<string, unknown> = {
        id: event.id,
        globalEventId: eventId,
        linkEvento: event.linkEvento,
        titulo: event.titulo,
        data: event.data,
        hora: event.hora,
        local: event.local,
        tipo: "Liga",
        destaque: event.destaque,
        mapsUrl: event.mapsUrl,
        imagem: event.imagem || leagueLogoUrl || "",
        imagePositionY: event.imagePositionY,
        lotes: event.lotes,
        descricao: event.descricao,
        saleStatus: event.saleStatus,
        pixChave: event.pixChave,
        pixBanco: event.pixBanco,
        pixTitular: event.pixTitular,
        contatoComprovante: event.contatoComprovante,
        recipientUserId: event.recipientUserId,
        recipientUserName: event.recipientUserName,
        recipientUserTurma: event.recipientUserTurma,
        recipientUserAvatar: event.recipientUserAvatar,
        paymentConfig: event.paymentConfig,
      };

      if (event.pollQuestion) {
        const alreadyExists = await findExistingPollByQuestion(
          eventId,
          event.pollQuestion
        );

        if (!alreadyExists) {
          await insertPollWithSchemaFallback({
            eventoId: eventId,
            question: event.pollQuestion,
            options: [],
            allowUserOptions: true,
            createdAt: timestamp,
            updatedAt: timestamp,
            creatorId: leagueId,
            isOfficial: true,
            tenant_id: effectiveTenantId,
          });
          pollsCreated += 1;
        }
      }

      nextEvent.pollQuestion = "";
      syncedEvents.push(nextEvent);
    }

    if (!leagueTenantId) {
      const { error: leaguePatchError } = await supabaseAdmin
        .from("ligas_config")
        .update({
          tenant_id: effectiveTenantId,
          updatedAt: timestamp,
        })
        .eq("id", leagueId);

      if (leaguePatchError) {
        throw new LeagueAdminApiError(leaguePatchError.message, 400);
      }
    }

    clearEventsNativeCaches();

    return NextResponse.json({
      ok: true,
      events: syncedEvents,
      created: createdCount,
      updated: updatedCount,
      pollsCreated,
    });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json(
        { error: error.message, ...(error.details ? error.details : {}) },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao sincronizar eventos da liga.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
