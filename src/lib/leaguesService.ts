import { httpsCallable } from "@/lib/supa/functions";
import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { clearDashboardCaches as clearAuthenticatedDashboardCaches } from "./dashboardService";
import { clearDashboardCaches as clearPublicDashboardCaches } from "./dashboardPublicService";
import { getSupabaseClient } from "./supabase";
import { incrementUserStats, type Row } from "./supabaseData";
import { uploadImage, VERSIONED_PUBLIC_ASSET_CACHE_CONTROL } from "./upload";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { hydrateEventPollRows, isMissingRelationError } from "./hotPathRelations";
import { resolveLeagueLogoSrc } from "./leagueMedia";
import {
  DEFAULT_LEAGUE_ROLE,
  resolveLeagueRoleLabel,
  sortLeagueMembersByRole,
} from "./leagueRoles";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;

const MAX_LEAGUE_RESULTS = 80;
const MAX_USER_RESULTS = 200;
const MAX_POLL_RESULTS = 60;

const LEAGUE_SAVE_CALLABLE = "leagueAdminSaveConfig";
const LEAGUE_DELETE_CALLABLE = "leagueAdminDeleteConfig";
const LEAGUE_VISIBILITY_CALLABLE = "leagueAdminToggleVisibility";
const LEAGUE_LIKE_CALLABLE = "leagueToggleLike";
const LEAGUE_POLL_CREATE_CALLABLE = "leaguePollCreate";
const LEAGUE_POLL_DELETE_CALLABLE = "leaguePollDelete";
const LEAGUE_POLL_UPDATE_CALLABLE = "leaguePollUpdateOptions";
const LEAGUE_QUIZ_CALLABLE = "leagueRegisterQuizResult";

const leaguesCache = new Map<string, CacheEntry<LeagueRecord[]>>();
const leagueSummariesCache = new Map<string, CacheEntry<LeagueRecord[]>>();
const usersCache = new Map<string, CacheEntry<LeagueUserRecord[]>>();
const leagueByIdCache = new Map<string, CacheEntry<LeagueRecord | null>>();
const pollsCache = new Map<string, CacheEntry<LeaguePollRecord[]>>();
const resolveLeagueTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(typeof tenantId === "string" ? tenantId.trim() : "");

const LEAGUES_SELECT_COLUMNS = [
  "id",
  "nome",
  "sigla",
  "presidente",
  "descricao",
  "visaoGeral",
  "senha",
  "foto",
  "logoUrl",
  "logo",
  "visivel",
  "ativa",
  "membros",
  "eventos",
  "perguntas",
  "bizu",
  "likes",
  "membersCount",
  "status",
  "createdAt",
  "updatedAt",
] as const;

const LEAGUE_SUMMARY_SELECT_COLUMNS = [
  "id",
  "nome",
  "sigla",
  "descricao",
  "visaoGeral",
  "foto",
  "logoUrl",
  "logo",
  "visivel",
  "ativa",
  "bizu",
  "likes",
  "membersCount",
  "status",
  "createdAt",
  "updatedAt",
] as const;

const LEAGUE_USERS_SELECT_COLUMNS = ["uid", "nome", "foto", "turma"] as const;

const EVENT_POLLS_SELECT_COLUMNS = [
  "id",
  "eventoId",
  "question",
  "options",
  "allowUserOptions",
  "creatorId",
  "isOfficial",
  "createdAt",
  "updatedAt",
] as const;

const LEAGUE_GLOBAL_EVENT_SELECT_COLUMNS = [
  "id",
  "titulo",
  "data",
  "hora",
  "local",
  "tipo",
  "destaque",
  "mapsUrl",
  "imagem",
  "imagePositionY",
  "lotes",
  "descricao",
  "sale_status",
  "pixChave",
  "pixBanco",
  "pixTitular",
  "contatoComprovante",
] as const;

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const rowIdFromUnknown = (row: unknown, fallback = ""): string => {
  const obj = asObject(row);
  if (!obj) return fallback;
  return asString(obj.id, asString(obj.uid, fallback));
};

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearLeagueCaches = (): void => {
  leaguesCache.clear();
  leagueSummariesCache.clear();
  leagueByIdCache.clear();
  pollsCache.clear();
};

const clearLeagueDependentCaches = (): void => {
  clearLeagueCaches();
  clearAuthenticatedDashboardCaches();
  clearPublicDashboardCaches();
};

const clearUsersCache = (): void => {
  usersCache.clear();
};

const extractLeagueMemberIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const member = asObject(entry);
      return asString(member?.id).trim();
    })
    .filter((entry) => entry.length > 0);
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const removeMissingColumnFromSelection = (
  columns: readonly string[] | string[],
  missingColumn: string
): string[] | null => {
  const next = [...columns].filter((column) => column.toLowerCase() !== missingColumn.toLowerCase());
  if (next.length === columns.length) return null;
  return next;
};

const removeMissingColumnFromPayload = (
  payload: Record<string, unknown>,
  missingColumn: string
): Record<string, unknown> | null => {
  const normalizedMissing = missingColumn.trim().toLowerCase();
  if (!normalizedMissing) return null;

  const nextEntries = Object.entries(payload).filter(
    ([key]) => key.toLowerCase() !== normalizedMissing
  );
  if (nextEntries.length === Object.keys(payload).length) return null;
  return Object.fromEntries(nextEntries);
};

const nowIso = (): string => new Date().toISOString();

const getCurrentSessionAccessToken = async (): Promise<string> => {
  if (typeof window === "undefined") return "";

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) return "";
    return asString(data.session?.access_token).trim();
  } catch {
    return "";
  }
};

const callLeagueAdminRoute = async <TReq, TRes>(payload: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body: TReq;
  fallbackMessage: string;
}): Promise<TRes | null> => {
  if (typeof window === "undefined") return null;

  const accessToken = await getCurrentSessionAccessToken();
  if (!accessToken) return null;

  let response: Response;
  try {
    response = await fetch(payload.path, {
      method: payload.method ?? "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload.body),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return {} as TRes;
    }

    try {
      return (await response.json()) as TRes;
    } catch {
      return {} as TRes;
    }
  }

  if ([404, 405, 501].includes(response.status)) return null;

  let message = `${payload.fallbackMessage} (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: unknown };
    const apiMessage = asString(body?.error).trim();
    if (apiMessage) {
      message = apiMessage;
    }
  } catch {
    // Mantem a mensagem padrao quando o body nao vier em JSON.
  }

  throw new Error(message);
};

const syncLeagueMembersViaAdminRoute = async (payload: {
  leagueId: string;
  members: LeagueMemberRecord[];
  tenantId?: string | null;
}): Promise<boolean> => {
  const response = await callLeagueAdminRoute<
    { leagueId: string; members: LeagueMemberRecord[]; tenantId?: string | null },
    { ok: boolean }
  >({
    path: "/api/admin/ligas/sync-members",
    body: {
      leagueId: payload.leagueId,
      members: payload.members,
      tenantId: payload.tenantId || undefined,
    },
    fallbackMessage: "Falha ao sincronizar membros da liga",
  });

  return Boolean(response);
};

const syncLeagueEventsViaAdminRoute = async (payload: {
  leagueId: string;
  events: LeagueEventRecord[];
  leagueLogoUrl?: string;
  tenantId?: string | null;
}): Promise<LeagueEventRecord[] | null> => {
  const response = await callLeagueAdminRoute<
    {
      leagueId: string;
      events: LeagueEventRecord[];
      leagueLogoUrl?: string;
      tenantId?: string | null;
    },
    { events?: unknown }
  >({
    path: "/api/admin/ligas/sync-events",
    body: {
      leagueId: payload.leagueId,
      events: payload.events,
      leagueLogoUrl: payload.leagueLogoUrl || undefined,
      tenantId: payload.tenantId || undefined,
    },
    fallbackMessage: "Falha ao sincronizar eventos da liga",
  });

  if (!response) return null;
  if (!Array.isArray(response.events)) return [];

  return response.events
    .map((row) => normalizeLeague("temp", { eventos: [row] })?.eventos?.[0] ?? null)
    .filter((entry): entry is LeagueEventRecord => entry !== null);
};

const createEventPollViaAdminRoute = async (payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
  creatorId?: string;
  tenantId?: string | null;
}): Promise<{ id: string } | null> =>
  callLeagueAdminRoute<typeof payload, { id: string }>({
    path: "/api/admin/ligas/event-polls",
    body: payload,
    fallbackMessage: "Falha ao criar enquete do evento",
  });

const deleteEventPollViaAdminRoute = async (payload: {
  eventId: string;
  pollId: string;
  tenantId?: string | null;
}): Promise<boolean> => {
  const response = await callLeagueAdminRoute<typeof payload, { ok: boolean }>({
    path: "/api/admin/ligas/event-polls",
    method: "DELETE",
    body: payload,
    fallbackMessage: "Falha ao remover enquete do evento",
  });

  return Boolean(response);
};

const updateEventPollOptionsViaAdminRoute = async (payload: {
  eventId: string;
  pollId: string;
  options: LeaguePollOptionRecord[];
  tenantId?: string | null;
}): Promise<boolean> => {
  const response = await callLeagueAdminRoute<typeof payload, { ok: boolean }>({
    path: "/api/admin/ligas/event-polls",
    method: "PATCH",
    body: payload,
    fallbackMessage: "Falha ao atualizar enquete do evento",
  });

  return Boolean(response);
};

export async function syncLeagueMembers(payload: {
  leagueId: string;
  members: LeagueMemberRecord[];
  tenantId?: string | null;
}): Promise<void> {
  const leagueId = payload.leagueId.trim();
  if (!leagueId) return;

  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  const nextMembers = Array.isArray(payload.members) ? payload.members : [];
  const nextMemberIds = Array.from(
    new Set(
      nextMembers
        .map((member) => asString(member.id).trim())
        .filter((memberId) => memberId.length > 0)
    )
  );

  if (
    await syncLeagueMembersViaAdminRoute({
      leagueId,
      members: nextMembers,
      tenantId: scopedTenantId || undefined,
    })
  ) {
    return;
  }

  const supabase = getSupabaseClient();
  let existingQuery = supabase
    .from("ligas_membros")
    .select("id, userId, cargo")
    .eq("ligaId", leagueId);
  if (scopedTenantId) {
    existingQuery = existingQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) throw existingError;

  const existingByUserId = new Map(
    ((existingRows ?? []) as Record<string, unknown>[])
      .map((row) => {
        const userId = asString(row.userId).trim();
        if (!userId) return null;
        return [userId, row] as const;
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null)
  );

  const membersToInsert = nextMembers
    .filter((member) => {
      const memberId = asString(member.id).trim();
      return memberId.length > 0 && !existingByUserId.has(memberId);
    })
    .map((member) => ({
      ligaId: leagueId,
      userId: asString(member.id).trim(),
      cargo:
        resolveLeagueRoleLabel(asString(member.cargo, DEFAULT_LEAGUE_ROLE)).slice(0, 80) ||
        DEFAULT_LEAGUE_ROLE,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      joinedAt: nowIso(),
    }));

  if (membersToInsert.length > 0) {
    const { error: insertError } = await supabase.from("ligas_membros").insert(membersToInsert);
    if (insertError) throw insertError;
  }

  const membersToUpdate = nextMembers
    .map((member) => {
      const memberId = asString(member.id).trim();
      const existingRow = memberId ? existingByUserId.get(memberId) : null;
      if (!memberId || !existingRow) return null;

      const nextCargo =
        resolveLeagueRoleLabel(asString(member.cargo, DEFAULT_LEAGUE_ROLE)).slice(0, 80) ||
        DEFAULT_LEAGUE_ROLE;
      const currentCargo =
        resolveLeagueRoleLabel(asString(existingRow.cargo, DEFAULT_LEAGUE_ROLE)).slice(0, 80) ||
        DEFAULT_LEAGUE_ROLE;
      if (nextCargo === currentCargo) return null;

      return { userId: memberId, cargo: nextCargo };
    })
    .filter((entry): entry is { userId: string; cargo: string } => entry !== null);

  for (const member of membersToUpdate) {
    let updateMemberQuery = supabase
      .from("ligas_membros")
      .update({
        cargo: member.cargo,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      })
      .eq("ligaId", leagueId)
      .eq("userId", member.userId);
    if (scopedTenantId) {
      updateMemberQuery = updateMemberQuery.eq("tenant_id", scopedTenantId);
    }
    const { error: updateMemberError } = await updateMemberQuery;
    if (updateMemberError) throw updateMemberError;
  }

  const removedMemberIds = Array.from(existingByUserId.keys()).filter(
    (memberId) => !nextMemberIds.includes(memberId)
  );
  if (removedMemberIds.length > 0) {
    let deleteQuery = supabase
      .from("ligas_membros")
      .delete()
      .eq("ligaId", leagueId)
      .in("userId", removedMemberIds);
    if (scopedTenantId) {
      deleteQuery = deleteQuery.eq("tenant_id", scopedTenantId);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;
  }

  let updateQuery = supabase
    .from("ligas_config")
    .update({
      membersCount: nextMemberIds.length,
      updatedAt: nowIso(),
    })
    .eq("id", leagueId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;
  if (updateError) throw updateError;
}

export async function syncLeagueEvents(payload: {
  leagueId: string;
  events: LeagueEventRecord[];
  leagueLogoUrl?: string;
  leagueSigla?: string;
  tenantId?: string | null;
}): Promise<LeagueEventRecord[]> {
  const leagueId = payload.leagueId.trim();
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  const nextEvents = Array.isArray(payload.events) ? payload.events : [];

  if (!leagueId) {
    return nextEvents;
  }

  const syncedViaRoute = await syncLeagueEventsViaAdminRoute({
    leagueId,
    events: nextEvents,
    leagueLogoUrl: payload.leagueLogoUrl,
    tenantId: scopedTenantId || undefined,
  });
  if (syncedViaRoute) {
    return syncedViaRoute;
  }

  const supabase = getSupabaseClient();
  const timestamp = nowIso();
  const leagueLogoUrl = asString(payload.leagueLogoUrl).trim();
  const leagueSigla = asString(payload.leagueSigla).trim();
  const syncedEvents: LeagueEventRecord[] = [];
  const normalizeQuestion = (value: string): string => value.trim().toLowerCase();

  for (const event of nextEvents) {
    const alreadyLinkedToGlobal = Boolean(asString(event.globalEventId).trim());
    const eventId = asString(event.globalEventId).trim() || crypto.randomUUID();
    const nextEvent: LeagueEventRecord = {
      ...event,
      globalEventId: eventId,
      linkEvento: `/eventos/${eventId}`,
      imagem: asString(event.imagem).trim() || leagueLogoUrl,
      imagePositionY: Math.max(0, Math.min(100, asNumber(event.imagePositionY, 50))),
      lotes: Array.isArray(event.lotes) ? event.lotes : [],
      pollQuestion: asString(event.pollQuestion).trim(),
    };

    let eventPayload: Record<string, unknown> = {
      id: eventId,
      titulo: leagueSigla ? `[${leagueSigla}] ${nextEvent.titulo}` : nextEvent.titulo,
      data: nextEvent.data,
      hora: nextEvent.hora,
      local: nextEvent.local,
      tipo: "Liga",
      destaque: nextEvent.destaque,
      mapsUrl: asString(nextEvent.mapsUrl).trim(),
      imagem: nextEvent.imagem || leagueLogoUrl || "",
      imagePositionY: nextEvent.imagePositionY,
      lotes: nextEvent.lotes,
      descricao: nextEvent.descricao,
      pixChave: asString(nextEvent.pixChave).trim(),
      pixBanco: asString(nextEvent.pixBanco).trim(),
      pixTitular: asString(nextEvent.pixTitular).trim(),
      contatoComprovante: asString(nextEvent.contatoComprovante).trim(),
      categoria: "Liga",
      status: "ativo",
      sale_status: asString(nextEvent.saleStatus, "ativo").trim() || "ativo",
      updatedAt: timestamp,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    };
    if (!alreadyLinkedToGlobal) {
      eventPayload.createdAt = timestamp;
    }

    while (Object.keys(eventPayload).length > 0) {
      const { error: eventUpsertError } = await supabase
        .from("eventos")
        .upsert(eventPayload, { onConflict: "id" });
      if (!eventUpsertError) break;

      const missingColumn = extractMissingSchemaColumn(eventUpsertError);
      if (!missingColumn) throwSupabaseError(eventUpsertError);
      const safeMissingColumn = missingColumn as string;
      const nextPayload = removeMissingColumnFromPayload(eventPayload, safeMissingColumn);
      if (!nextPayload) throwSupabaseError(eventUpsertError);
      eventPayload = nextPayload as Record<string, unknown>;
    }

    if (nextEvent.pollQuestion) {
      let existingPollsQuery = supabase
        .from("eventos_enquetes")
        .select("id,question")
        .eq("eventoId", eventId)
        .limit(40);
      if (scopedTenantId) {
        existingPollsQuery = existingPollsQuery.eq("tenant_id", scopedTenantId);
      }
      const { data: existingPolls, error: existingPollsError } = await existingPollsQuery;
      if (existingPollsError) throwSupabaseError(existingPollsError);

      const hasSameQuestion = (existingPolls ?? []).some((row) => {
        const raw = asObject(row);
        return (
          raw &&
          normalizeQuestion(asString(raw.question)) === normalizeQuestion(nextEvent.pollQuestion || "")
        );
      });

      if (!hasSameQuestion) {
        let pollInsertPayload: Record<string, unknown> = {
          eventoId: eventId,
          question: nextEvent.pollQuestion,
          options: [],
          allowUserOptions: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          creatorId: leagueId,
          isOfficial: true,
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        };

        while (Object.keys(pollInsertPayload).length > 0) {
          const { error: pollInsertError } = await supabase
            .from("eventos_enquetes")
            .insert(pollInsertPayload);
          if (!pollInsertError) {
            break;
          }

          const missingColumn = extractMissingSchemaColumn(pollInsertError);
          if (!missingColumn) throwSupabaseError(pollInsertError);
          const safeMissingColumn = missingColumn as string;
          const nextPayload = removeMissingColumnFromPayload(
            pollInsertPayload,
            safeMissingColumn
          );
          if (!nextPayload) throwSupabaseError(pollInsertError);
          pollInsertPayload = nextPayload as Record<string, unknown>;
        }
      }

      nextEvent.pollQuestion = "";
    }

    syncedEvents.push(nextEvent);
  }

  return syncedEvents;
}

const shouldFallbackToClientWrites = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClientWrites(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

export interface LeagueQuestionRecord {
  id: string;
  texto: string;
  imageUrl?: string;
  alternativas: string[];
  correta: number;
}

export interface LeagueMemberRecord {
  id: string;
  nome: string;
  cargo: string;
  foto: string;
  linkPerfil?: string;
}

export interface LeagueLoteRecord {
  id: number;
  nome: string;
  preco: string;
  status: "ativo" | "em_breve" | "esgotado";
}

export interface LeagueEventRecord {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  tipo: string;
  destaque: string;
  mapsUrl?: string;
  imagem: string;
  imagePositionY: number;
  lotes: LeagueLoteRecord[];
  descricao: string;
  linkEvento?: string;
  globalEventId?: string;
  pollQuestion?: string;
  saleStatus?: "ativo" | "em_breve" | "esgotado";
  pixChave?: string;
  pixBanco?: string;
  pixTitular?: string;
  contatoComprovante?: string;
}

export interface LeagueRecord {
  id: string;
  nome: string;
  sigla: string;
  presidente: string;
  descricao: string;
  visaoGeral?: string;
  senha: string;
  foto: string;
  logoUrl?: string;
  visivel?: boolean;
  ativa?: boolean;
  membros: LeagueMemberRecord[];
  eventos: LeagueEventRecord[];
  perguntas: LeagueQuestionRecord[];
  bizu: string;
  likes: number;
  membrosIds?: string[];
  membersCount?: number;
  updatedAt?: string;
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripLeagueEventTitlePrefix = (
  title: string,
  leagueSigla: string,
  fallbackTitle: string
): string => {
  const cleanTitle = title.trim();
  if (!cleanTitle) return fallbackTitle;

  const prefixPattern = leagueSigla.trim()
    ? new RegExp(`^\\[${escapeRegExp(leagueSigla.trim())}\\]\\s*`, "i")
    : /^\[[^\]]+\]\s*/;
  const strippedTitle = cleanTitle.replace(prefixPattern, "").trim();
  return strippedTitle || cleanTitle || fallbackTitle;
};

const normalizeLeagueLotesFromGlobalEvent = (
  value: unknown,
  fallback: LeagueLoteRecord[]
): LeagueLoteRecord[] => {
  if (!Array.isArray(value)) return fallback;

  return value
    .map((entry, index) => {
      const lote = asObject(entry);
      if (!lote) return null;

      const parsedId = Number(lote.id);
      const statusRaw = asString(lote.status, "ativo").trim().toLowerCase();
      const status: LeagueLoteRecord["status"] =
        statusRaw === "esgotado" || statusRaw === "encerrado"
          ? "esgotado"
          : statusRaw === "em_breve" || statusRaw === "agendado"
          ? "em_breve"
          : "ativo";

      return {
        id:
          Number.isFinite(parsedId) && parsedId > 0
            ? Math.floor(parsedId)
            : index + 1,
        nome: asString(lote.nome),
        preco: asString(lote.preco),
        status,
      } satisfies LeagueLoteRecord;
    })
    .filter((entry): entry is LeagueLoteRecord => entry !== null);
};

const fetchLeagueGlobalEventsById = async (
  eventIds: string[],
  tenantId?: string | null
): Promise<Map<string, Record<string, unknown>>> => {
  const uniqueEventIds = Array.from(
    new Set(
      eventIds
        .map((eventId) => eventId.trim())
        .filter((eventId) => eventId.length > 0)
    )
  );
  if (uniqueEventIds.length === 0) return new Map();

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveLeagueTenantId(tenantId);

  const selectGlobalEvents = async (
    ids: string[],
    scopeTenantId?: string
  ): Promise<Record<string, unknown>[]> => {
    if (ids.length === 0) return [];

    let selectColumns: string[] = [...LEAGUE_GLOBAL_EVENT_SELECT_COLUMNS];

    while (selectColumns.length > 0) {
      let query = supabase
        .from("eventos")
        .select(selectColumns.join(","))
        .in("id", ids);
      if (scopeTenantId) {
        query = query.eq("tenant_id", scopeTenantId);
      }

      const { data, error } = await query;
      if (!error) {
        return (Array.isArray(data) ? data : [])
          .map((row) => asObject(row))
          .filter((row): row is Record<string, unknown> => row !== null);
      }

      const missingColumn = asString(extractMissingSchemaColumn(error));
      if (!missingColumn) throwSupabaseError(error);

      const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
      if (!nextColumns.length) throwSupabaseError(error);
      selectColumns = nextColumns;
    }

    return [];
  };

  const rowsById = new Map<string, Record<string, unknown>>();

  const primaryRows = await selectGlobalEvents(
    uniqueEventIds,
    scopedTenantId || undefined
  );
  primaryRows.forEach((row) => {
    const rowId = asString(row.id).trim();
    if (rowId) rowsById.set(rowId, row);
  });

  if (scopedTenantId && rowsById.size < uniqueEventIds.length) {
    const missingIds = uniqueEventIds.filter((eventId) => !rowsById.has(eventId));
    const fallbackRows = await selectGlobalEvents(missingIds);
    fallbackRows.forEach((row) => {
      const rowId = asString(row.id).trim();
      if (rowId && !rowsById.has(rowId)) rowsById.set(rowId, row);
    });
  }

  return rowsById;
};

const hydrateLeagueEventsFromGlobalCatalog = async (
  league: LeagueRecord,
  tenantId?: string | null
): Promise<LeagueRecord> => {
  const globalEventIds = (league.eventos || [])
    .map((event) => asString(event.globalEventId).trim())
    .filter((eventId) => eventId.length > 0);
  if (globalEventIds.length === 0) return league;

  const rowsById = await fetchLeagueGlobalEventsById(globalEventIds, tenantId);
  if (rowsById.size === 0) return league;

  return {
    ...league,
    eventos: (league.eventos || []).map((event) => {
      const globalEventId = asString(event.globalEventId).trim();
      if (!globalEventId) return event;

      const globalRow = rowsById.get(globalEventId);
      if (!globalRow) return event;

      return {
        ...event,
        titulo: stripLeagueEventTitlePrefix(
          asString(globalRow.titulo, event.titulo),
          league.sigla,
          event.titulo
        ),
        data: asString(globalRow.data, event.data),
        hora: asString(globalRow.hora, event.hora),
        local: asString(globalRow.local, event.local),
        tipo: asString(globalRow.tipo, event.tipo),
        destaque: asString(globalRow.destaque, event.destaque),
        mapsUrl: asString(globalRow.mapsUrl, event.mapsUrl || ""),
        imagem: asString(globalRow.imagem, event.imagem),
        imagePositionY: asNumber(globalRow.imagePositionY, event.imagePositionY),
        lotes: normalizeLeagueLotesFromGlobalEvent(globalRow.lotes, event.lotes),
        descricao: asString(globalRow.descricao, event.descricao),
        saleStatus: (
          asString(globalRow.sale_status, event.saleStatus || "ativo").trim().toLowerCase() === "esgotado"
            ? "esgotado"
            : asString(globalRow.sale_status, event.saleStatus || "ativo").trim().toLowerCase() === "em_breve"
            ? "em_breve"
            : "ativo"
        ),
        pixChave: asString(globalRow.pixChave, event.pixChave || ""),
        pixBanco: asString(globalRow.pixBanco, event.pixBanco || ""),
        pixTitular: asString(globalRow.pixTitular, event.pixTitular || ""),
        contatoComprovante: asString(globalRow.contatoComprovante, event.contatoComprovante || ""),
        linkEvento: event.linkEvento || `/eventos/${globalEventId}`,
      } satisfies LeagueEventRecord;
    }),
  };
};

export const LEAGUE_NAME_MAX_LENGTH = 42;
export const LEAGUE_SIGLA_MAX_LENGTH = 10;
export const LEAGUE_DESCRIPTION_MAX_LENGTH = 180;
export const LEAGUE_OVERVIEW_MAX_LENGTH = 500;

export interface LeagueUserRecord {
  id: string;
  nome?: string;
  foto?: string;
  turma?: string;
}

const normalizeLeagueInteractionIds = (value: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );

export const resolveFollowedLeagueIdsFromUserExtra = (
  extra: unknown,
  tenantId?: string | null
): string[] => {
  const extraData = asObject(extra) ?? {};
  const scopedTenantId = resolveLeagueTenantId(tenantId);
  const byTenant = asObject(extraData.followedLeagueIdsByTenant);

  if (scopedTenantId && byTenant) {
    return normalizeLeagueInteractionIds(byTenant[scopedTenantId]);
  }

  return normalizeLeagueInteractionIds(extraData.followedLeagueIds);
};

export const resolveLikedLeagueIdsFromUserExtra = (
  extra: unknown,
  tenantId?: string | null
): string[] => {
  const extraData = asObject(extra) ?? {};
  const scopedTenantId = resolveLeagueTenantId(tenantId);
  const byTenant = asObject(extraData.likedLeagueIdsByTenant);

  if (scopedTenantId && byTenant) {
    return normalizeLeagueInteractionIds(byTenant[scopedTenantId]);
  }

  return normalizeLeagueInteractionIds(extraData.likedLeagueIds);
};

export async function fetchUserLeagueInteractionState(payload: {
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ likedIds: string[]; followedIds: string[] }> {
  const userId = payload.userId?.trim() || "";
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  if (!userId) {
    return { likedIds: [], followedIds: [] };
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const extra = asObject(asObject(data)?.extra) ?? {};
  return {
    likedIds: resolveLikedLeagueIdsFromUserExtra(extra, scopedTenantId),
    followedIds: resolveFollowedLeagueIdsFromUserExtra(extra, scopedTenantId),
  };
}

export interface LeaguePollOptionRecord {
  text: string;
  votes: number;
  creator?: string;
  creatorName?: string;
  creatorAvatar?: string;
}

export interface LeaguePollRecord {
  id: string;
  question: string;
  options: LeaguePollOptionRecord[];
  allowUserOptions: boolean;
  voters: string[];
}

export type LeagueStorageImageKind = "logo" | "member" | "event" | "question";

const normalizeLeague = (id: string, raw: unknown): LeagueRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const membros = Array.isArray(data.membros)
    ? sortLeagueMembersByRole(
        data.membros
        .map((row) => {
          const member = asObject(row);
          if (!member) return null;
          const linkPerfil = asString(member.linkPerfil) || undefined;
          return {
            id: asString(member.id),
            nome: asString(member.nome, "Sem nome"),
            cargo: resolveLeagueRoleLabel(asString(member.cargo, DEFAULT_LEAGUE_ROLE)),
            foto: asString(member.foto),
            ...(linkPerfil ? { linkPerfil } : {}),
          } as LeagueMemberRecord;
        })
        .filter((row): row is LeagueMemberRecord => row !== null)
      )
    : [];

  const perguntas = Array.isArray(data.perguntas)
    ? data.perguntas
        .map((row) => {
          const question = asObject(row);
          if (!question) return null;
          const alternatives = Array.isArray(question.alternativas)
            ? question.alternativas.filter(
                (item): item is string => typeof item === "string"
              )
            : [];
          const imageUrl = asString(question.imageUrl) || undefined;
          return {
            id: asString(question.id),
            texto: asString(question.texto),
            ...(imageUrl ? { imageUrl } : {}),
            alternativas: alternatives.slice(0, 4),
            correta: Math.max(0, Math.min(3, asNumber(question.correta, 0))),
          } as LeagueQuestionRecord;
        })
        .filter((row): row is LeagueQuestionRecord => row !== null)
    : [];

  const eventos = Array.isArray(data.eventos)
    ? data.eventos
        .map((row) => {
          const event = asObject(row);
          if (!event) return null;
          const lotes = Array.isArray(event.lotes)
            ? event.lotes
                .map((entry) => {
                  const lote = asObject(entry);
                  if (!lote) return null;
                  const statusRaw = asString(lote.status, "ativo");
                  const status: LeagueLoteRecord["status"] =
                    statusRaw === "esgotado" || statusRaw === "encerrado"
                      ? "esgotado"
                      : statusRaw === "em_breve" || statusRaw === "agendado"
                      ? "em_breve"
                      : "ativo";
                  return {
                    id: asNumber(lote.id, Date.now()),
                    nome: asString(lote.nome),
                    preco: asString(lote.preco),
                    status,
                  } satisfies LeagueLoteRecord;
                })
                .filter((entry): entry is LeagueLoteRecord => entry !== null)
            : [];

          const linkEvento = asString(event.linkEvento) || undefined;
          const globalEventId = asString(event.globalEventId) || undefined;
          const pollQuestion = asString(event.pollQuestion) || undefined;
          const mapsUrl = asString(event.mapsUrl) || undefined;
          const saleStatusRaw = asString(event.saleStatus || event.sale_status, "ativo").trim().toLowerCase();
          const saleStatus: LeagueEventRecord["saleStatus"] =
            saleStatusRaw === "esgotado" || saleStatusRaw === "encerrado"
              ? "esgotado"
              : saleStatusRaw === "em_breve" || saleStatusRaw === "agendado"
              ? "em_breve"
              : "ativo";
          const pixChave = asString(event.pixChave) || undefined;
          const pixBanco = asString(event.pixBanco) || undefined;
          const pixTitular = asString(event.pixTitular) || undefined;
          const contatoComprovante = asString(event.contatoComprovante) || undefined;

          return {
            id: asString(event.id),
            titulo: asString(event.titulo),
            data: asString(event.data),
            hora: asString(event.hora),
            local: asString(event.local),
            tipo: asString(event.tipo),
            destaque: asString(event.destaque),
            ...(mapsUrl ? { mapsUrl } : {}),
            imagem: asString(event.imagem),
            imagePositionY: asNumber(event.imagePositionY, 50),
            lotes,
            descricao: asString(event.descricao),
            ...(linkEvento ? { linkEvento } : {}),
            ...(globalEventId ? { globalEventId } : {}),
            ...(pollQuestion ? { pollQuestion } : {}),
            ...(saleStatus ? { saleStatus } : {}),
            ...(pixChave ? { pixChave } : {}),
            ...(pixBanco ? { pixBanco } : {}),
            ...(pixTitular ? { pixTitular } : {}),
            ...(contatoComprovante ? { contatoComprovante } : {}),
          } as LeagueEventRecord;
        })
        .filter((row): row is LeagueEventRecord => row !== null)
    : [];

  const logoUrl = resolveLeagueLogoSrc(data) || undefined;
  const foto = asString(data.foto) || logoUrl || "";

  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    presidente: asString(data.presidente),
    descricao: asString(data.descricao),
    visaoGeral: asString(data.visaoGeral) || undefined,
    senha: asString(data.senha),
    foto,
    ...(logoUrl ? { logoUrl } : {}),
    visivel: asBoolean(data.visivel, false),
    ativa: asBoolean(data.ativa, false),
    membros,
    eventos,
    perguntas,
    bizu: asString(data.bizu),
    likes: Math.max(0, asNumber(data.likes, 0)),
    membersCount: Math.max(0, asNumber(data.membersCount, membros.length)),
    updatedAt: asString(data.updatedAt) || undefined,
  };
};

const normalizeLeagueUser = (id: string, raw: unknown): LeagueUserRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    id,
    nome: asString(data.nome) || undefined,
    foto: asString(data.foto) || undefined,
    turma: asString(data.turma) || undefined,
  };
};

const normalizePoll = (id: string, raw: unknown): LeaguePollRecord | null => {
  const data = asObject(raw);
  if (!data) return null;
  const options = Array.isArray(data.options)
    ? data.options
        .map((row) => {
          const option = asObject(row);
          if (!option) return null;
          const creator = asString(option.creator) || undefined;
          const creatorName = asString(option.creatorName) || undefined;
          const creatorAvatar = asString(option.creatorAvatar) || undefined;
          return {
            text: asString(option.text, "Opcao"),
            votes: Math.max(0, asNumber(option.votes, 0)),
            ...(creator ? { creator } : {}),
            ...(creatorName ? { creatorName } : {}),
            ...(creatorAvatar ? { creatorAvatar } : {}),
          } as LeaguePollOptionRecord;
        })
        .filter((row): row is LeaguePollOptionRecord => row !== null)
    : [];

  return {
    id,
    question: asString(data.question, "Enquete"),
    options,
    allowUserOptions: asBoolean(data.allowUserOptions, true),
    voters: Array.isArray(data.voters)
      ? data.voters.filter((item): item is string => typeof item === "string")
      : [],
  };
};

const normalizeLeaguePayload = (
  payload: Partial<LeagueRecord>
): Record<string, unknown> => {
  const logoUrl = resolveLeagueLogoSrc(payload) || undefined;
  const foto = asString(payload.foto) || logoUrl || "";
  const membros = Array.isArray(payload.membros)
    ? sortLeagueMembersByRole(
        payload.membros
          .map((member) => {
            const memberId = asString(member?.id).trim();
            if (!memberId) return null;

            const linkPerfil = asString(member?.linkPerfil) || undefined;
            return {
              id: memberId,
              nome: asString(member?.nome, "Sem nome").trim().slice(0, 160) || "Sem nome",
              cargo: resolveLeagueRoleLabel(asString(member?.cargo, DEFAULT_LEAGUE_ROLE)).slice(
                0,
                80
              ),
              foto: asString(member?.foto).trim().slice(0, 400),
              ...(linkPerfil ? { linkPerfil } : {}),
            } satisfies LeagueMemberRecord;
          })
          .filter((member): member is LeagueMemberRecord => member !== null)
      )
    : [];
  const perguntas = Array.isArray(payload.perguntas)
    ? payload.perguntas.map((question) => {
        const imageUrl = asString(question.imageUrl) || undefined;
        return {
          id: asString(question.id),
          texto: asString(question.texto),
          ...(imageUrl ? { imageUrl } : {}),
          alternativas: Array.isArray(question.alternativas)
            ? question.alternativas
                .filter((item): item is string => typeof item === "string")
                .slice(0, 4)
            : [],
          correta: Math.max(0, Math.min(3, asNumber(question.correta, 0))),
        };
      })
    : [];

  return {
    nome: asString(payload.nome, "Liga").trim().slice(0, LEAGUE_NAME_MAX_LENGTH),
    sigla: asString(payload.sigla).trim().toUpperCase().slice(0, LEAGUE_SIGLA_MAX_LENGTH),
    presidente: asString(payload.presidente).trim().slice(0, 120),
    descricao: asString(payload.descricao).slice(0, LEAGUE_DESCRIPTION_MAX_LENGTH),
    visaoGeral: asString(payload.visaoGeral).slice(0, LEAGUE_OVERVIEW_MAX_LENGTH),
    senha: asString(payload.senha).slice(0, 120),
    foto,
    ...(logoUrl ? { logoUrl, logo: logoUrl } : { logoUrl: undefined, logo: undefined }),
    visivel: Boolean(payload.visivel),
    ativa: Boolean(payload.ativa),
    membros,
    eventos: Array.isArray(payload.eventos) ? payload.eventos : [],
    perguntas,
    bizu: asString(payload.bizu).slice(0, 500),
    likes: Math.max(0, asNumber(payload.likes, 0)),
    membersCount: Math.max(
      0,
      asNumber(
        payload.membersCount,
        membros.length
      )
    ),
  };
};

const sanitizeStorageSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";

const leagueImageFolderByKind: Record<LeagueStorageImageKind, string> = {
  logo: "logos",
  member: "membros",
  event: "eventos",
  question: "perguntas",
};

export async function uploadLeagueImageToStorage(options: {
  file: File;
  kind: LeagueStorageImageKind;
  leagueId?: string;
  entityId?: string;
}): Promise<string> {
  const leagueSegment = sanitizeStorageSegment(options.leagueId || "temp");
  const entitySegment = options.entityId
    ? `/${sanitizeStorageSegment(options.entityId)}`
    : "";
  const folder = leagueImageFolderByKind[options.kind];
  const objectDir = `ligas/${leagueSegment}/${folder}${entitySegment}`;
  const isEventImage = options.kind === "event";
  const isLogoImage = options.kind === "logo";
  const isMemberImage = options.kind === "member";
  const sourceMaxBytes = isEventImage ? 3 * 1024 * 1024 : 2 * 1024 * 1024;
  const sourceMaxWidth = isEventImage ? 4200 : isLogoImage ? 4000 : isMemberImage ? 3200 : 3600;
  const sourceMaxHeight = isEventImage ? 3200 : isLogoImage ? 4000 : isMemberImage ? 3200 : 3600;
  const sourceMaxPixels = isEventImage ? 12_000_000 : isLogoImage ? 16_000_000 : 9_000_000;
  const compressedMaxBytes = isEventImage
    ? 700 * 1024
    : isLogoImage
      ? 1500 * 1024
      : isMemberImage
        ? 450 * 1024
        : 500 * 1024;
  const compressionMaxWidth = isEventImage ? 1800 : isLogoImage ? 900 : 1400;
  const compressionMaxHeight = isEventImage ? 1200 : isLogoImage ? 900 : 1400;
  const fileName =
    options.kind === "logo"
      ? "logo"
      : options.kind === "event"
        ? "evento"
        : options.kind === "member"
          ? "membro"
          : "pergunta";

  const { url, error } = await uploadImage(options.file, objectDir, {
    scopeKey: `ligas:${leagueSegment}:${options.kind}:${options.entityId || "root"}`,
    fileName,
    upsert: true,
    versionStrategy: "file-metadata",
    maxBytes: sourceMaxBytes,
    maxWidth: sourceMaxWidth,
    maxHeight: sourceMaxHeight,
    maxPixels: sourceMaxPixels,
    compressionMaxWidth,
    compressionMaxHeight,
    compressionMaxBytes: compressedMaxBytes,
    allowOriginalOnCompressionFail: true,
    quality: 0.82,
    cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
  });
  if (!url || error) {
    throw new Error(error || "Falha ao subir imagem da liga.");
  }

  return url;
}

export async function fetchLeagues(options?: {
  orderByField?: "nome" | "likes";
  orderDirection?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueRecord[]> {
  const orderByField = options?.orderByField ?? "nome";
  const orderDirection = options?.orderDirection ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${orderByField}:${orderDirection}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(leaguesCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUES_SELECT_COLUMNS];
  let leagues: LeagueRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .order(orderByField, { ascending: orderDirection === "asc" })
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      leagues = (data ?? [])
        .map((row) => normalizeLeague(rowIdFromUnknown(row), row))
        .filter((row): row is LeagueRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(leaguesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchLeagueSummaries(options?: {
  orderByField?: "nome" | "likes";
  orderDirection?: "asc" | "desc";
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueRecord[]> {
  const orderByField = options?.orderByField ?? "nome";
  const orderDirection = options?.orderDirection ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? 40, MAX_LEAGUE_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${orderByField}:${orderDirection}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(leagueSummariesCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUE_SUMMARY_SELECT_COLUMNS];
  let leagues: LeagueRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .order(orderByField, { ascending: orderDirection === "asc" })
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }

    const { data, error } = await query;
    if (!error) {
      leagues = (data ?? [])
        .map((row) => normalizeLeague(rowIdFromUnknown(row), row))
        .filter((row): row is LeagueRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(leagueSummariesCache, cacheKey, leagues);
  return leagues;
}

export async function fetchLeagueById(
  leagueId: string | null | undefined,
  options?: { forceRefresh?: boolean; tenantId?: string | null }
): Promise<LeagueRecord | null> {
  const cleanId = typeof leagueId === "string" ? leagueId.trim() : "";
  if (!cleanId) return null;

  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanId}`;
  if (!forceRefresh) {
    const cached = getCacheValue(leagueByIdCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUES_SELECT_COLUMNS];
  let league: LeagueRecord | null = null;

  while (selectColumns.length > 0) {
    let query = supabase
      .from("ligas_config")
      .select(selectColumns.join(","))
      .eq("id", cleanId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (!error) {
      if (!data) {
        setCacheValue(leagueByIdCache, cacheKey, null);
        return null;
      }
      league = normalizeLeague(rowIdFromUnknown(data), data);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  if (league) {
    try {
      league = await hydrateLeagueEventsFromGlobalCatalog(
        league,
        scopedTenantId || undefined
      );
    } catch (error: unknown) {
      console.warn("Leagues: falha ao hidratar eventos globais da liga.", error);
    }
  }

  setCacheValue(leagueByIdCache, cacheKey, league);
  return league;
}

export async function fetchLeagueUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<LeagueUserRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 120, MAX_USER_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(usersCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...LEAGUE_USERS_SELECT_COLUMNS];
  let users: LeagueUserRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("users")
      .select(selectColumns.join(","))
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      users = (data ?? [])
        .map((row) =>
          normalizeLeagueUser(
            rowIdFromUnknown(row),
            row
          )
        )
        .filter((row): row is LeagueUserRecord => row !== null)
        .sort((left, right) =>
          (left.nome || "").localeCompare(right.nome || "", "pt-BR")
        );
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(usersCache, cacheKey, users);
  return users;
}

export async function saveLeagueConfig(payload: {
  id?: string;
  data: Partial<LeagueRecord>;
  actorUserId?: string;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const normalizedData = normalizeLeaguePayload(payload.data);
  const id = payload.id?.trim() || "";
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  const actorUserId = payload.actorUserId?.trim() || "";
  const nextMemberIds = Array.from(
    new Set([
      ...extractLeagueMemberIds(normalizedData.membros),
      ...(Array.isArray(payload.data.membrosIds)
        ? payload.data.membrosIds
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : []),
    ])
  );

  let previousMemberIds = new Set<string>();
  if (id) {
    const supabase = getSupabaseClient();
    let previousQuery = supabase
      .from("ligas_config")
      .select("membros,membrosIds")
      .eq("id", id);
    if (scopedTenantId) {
      previousQuery = previousQuery.eq("tenant_id", scopedTenantId);
    }
    const { data: previousRow, error: previousError } = await previousQuery.maybeSingle();
    if (previousError) throwSupabaseError(previousError);
    const previous = asObject(previousRow) ?? {};
    previousMemberIds = new Set([
      ...extractLeagueMemberIds(previous.membros),
      ...(
        Array.isArray(previous.membrosIds)
          ? previous.membrosIds
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : []
      ),
    ]);
  }
  const requestPayload = {
    id,
    data: normalizedData,
    tenantId: scopedTenantId || undefined,
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_SAVE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      if (id) {
        let query = supabase
          .from("ligas_config")
          .update({
            ...normalizedData,
            updatedAt: nowIso(),
          })
          .eq("id", id);
        if (scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }
        const { error } = await query;
        if (error) throwSupabaseError(error);

        return { id };
      }

      const { data, error } = await supabase
        .from("ligas_config")
        .insert({
          ...normalizedData,
          ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .select("id")
        .single();
      if (error) throwSupabaseError(error);
      return { id: asString((data as Record<string, unknown> | null)?.id) };
    }
  );

  const savedLeagueId = result.id || id;
  const membersForSync = Array.isArray(payload.data.membros)
    ? payload.data.membros.filter((member): member is LeagueMemberRecord => {
        const memberId = asString(member?.id).trim();
        return memberId.length > 0;
      })
    : [];

  if (savedLeagueId) {
    try {
      await syncLeagueMembers({
        leagueId: savedLeagueId,
        members: membersForSync,
        tenantId: scopedTenantId,
      });
    } catch (error: unknown) {
      if (!isMissingRelationError(error)) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }

      const supabase = getSupabaseClient();
      let legacyQuery = supabase
        .from("ligas_config")
        .update({
          membrosIds: nextMemberIds,
          membersCount: nextMemberIds.length,
          updatedAt: nowIso(),
        })
        .eq("id", savedLeagueId);
      if (scopedTenantId) {
        legacyQuery = legacyQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: legacyUpdateError } = await legacyQuery;
      if (legacyUpdateError) throwSupabaseError(legacyUpdateError);
    }
  }

  const membershipPromises = nextMemberIds
    .filter((memberId) => !previousMemberIds.has(memberId))
    .map((memberId) =>
      incrementUserStats(
        memberId,
        { leagueMemberships: 1 },
        { tenantId: scopedTenantId || undefined }
      )
    );
  if (!id && actorUserId) {
    membershipPromises.push(
      incrementUserStats(
        actorUserId,
        { leaguesCreated: 1 },
        { tenantId: scopedTenantId || undefined }
      )
    );
  }
  if (membershipPromises.length > 0) {
    const membershipResults = await Promise.allSettled(membershipPromises);
    if (membershipResults.some((result) => result.status === "rejected")) {
      console.warn("Ligas: falha parcial ao sincronizar conquistas de membros.", membershipResults);
    }
  }

  clearLeagueDependentCaches();
  return result;
}

export async function deleteLeagueConfig(
  id: string,
  options?: { tenantId?: string | null }
): Promise<void> {
  const cleanId = id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);

  await callWithFallback<{ id: string; tenantId?: string }, { ok: boolean }>(
    LEAGUE_DELETE_CALLABLE,
    { id: cleanId, tenantId: scopedTenantId || undefined },
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase.from("ligas_config").delete().eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearLeagueDependentCaches();
}

export async function setLeagueVisibility(payload: {
  id: string;
  visivel: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const requestPayload = {
    id: cleanId,
    visivel: payload.visivel,
    tenantId: scopedTenantId || undefined,
  };
  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_VISIBILITY_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("ligas_config")
        .update({
          visivel: payload.visivel,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  clearLeagueDependentCaches();
}

export async function changeLeagueLikeCount(payload: {
  id: string;
  delta: 1 | -1;
  actorUserId?: string;
  tenantId?: string | null;
}): Promise<void> {
  const cleanId = payload.id.trim();
  if (!cleanId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_LIKE_CALLABLE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      let selectQuery = supabase
        .from("ligas_config")
        .select("likes")
        .eq("id", cleanId);
      if (scopedTenantId) {
        selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
      }
      const { data: leagueRow, error: selectError } = await selectQuery.maybeSingle();
      if (selectError) throwSupabaseError(selectError);
      const currentLikes = Math.max(0, asNumber(asObject(leagueRow)?.likes, 0));
      const nextLikes = Math.max(0, currentLikes + payload.delta);

      let updateQuery = supabase
        .from("ligas_config")
        .update({
          likes: nextLikes,
          updatedAt: nowIso(),
        })
        .eq("id", cleanId);
      if (scopedTenantId) {
        updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
      }
      const { error: updateError } = await updateQuery;
      if (updateError) throwSupabaseError(updateError);
      return { ok: true };
    }
  );

  const actorUserId = payload.actorUserId?.trim() || "";
  if (actorUserId) {
    try {
      await incrementUserStats(actorUserId, {
        leagueLikesGiven: payload.delta,
        likesGiven: payload.delta,
      });
    } catch (error: unknown) {
      console.warn("Liga: falha ao atualizar stats de curtidas de liga.", error);
    }
  }

  clearLeagueDependentCaches();
}

const updateUserLeagueInteractionIds = async (payload: {
  leagueId: string;
  userId: string;
  tenantId?: string | null;
  key: "followedLeagueIds" | "likedLeagueIds";
  byTenantKey: "followedLeagueIdsByTenant" | "likedLeagueIdsByTenant";
}): Promise<{
  currentExtra: Record<string, unknown>;
  nextExtra: Record<string, unknown>;
  nextIds: string[];
  wasActive: boolean;
  changed: boolean;
}> => {
  const leagueId = payload.leagueId.trim();
  const userId = payload.userId.trim();
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  if (!leagueId || !userId) {
    return {
      currentExtra: {},
      nextExtra: {},
      nextIds: [],
      wasActive: false,
      changed: false,
    };
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const currentExtra = asObject(asObject(data)?.extra) ?? {};
  const currentByTenant = asObject(currentExtra[payload.byTenantKey]) ?? {};
  const currentIds = scopedTenantId
    ? normalizeLeagueInteractionIds(currentByTenant[scopedTenantId])
    : normalizeLeagueInteractionIds(currentExtra[payload.key]);
  const wasActive = currentIds.includes(leagueId);
  const nextIds = wasActive
    ? currentIds.filter((entry) => entry !== leagueId)
    : Array.from(new Set([...currentIds, leagueId]));

  const nextExtra: Record<string, unknown> = {
    ...currentExtra,
    ...(scopedTenantId
      ? {
          [payload.byTenantKey]: {
            ...currentByTenant,
            [scopedTenantId]: nextIds,
          },
        }
      : {
          [payload.key]: nextIds,
        }),
  };

  const changed =
    nextIds.length !== currentIds.length ||
    nextIds.some((entry, index) => entry !== currentIds[index]);

  if (changed) {
    const { error: updateError } = await supabase
      .from("users")
      .update({
        extra: nextExtra,
        updatedAt: nowIso(),
      })
      .eq("uid", userId);
    if (updateError) throwSupabaseError(updateError);
  }

  return {
    currentExtra,
    nextExtra,
    nextIds,
    wasActive,
    changed,
  };
};

export async function toggleUserLeagueLike(payload: {
  leagueId: string;
  userId: string;
  tenantId?: string | null;
}): Promise<{ likedIds: string[]; isLiked: boolean }> {
  const leagueId = payload.leagueId.trim();
  const userId = payload.userId.trim();
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  if (!leagueId || !userId) {
    return { likedIds: [], isLiked: false };
  }

  const { nextIds, wasActive, changed } = await updateUserLeagueInteractionIds({
    leagueId,
    userId,
    tenantId: scopedTenantId,
    key: "likedLeagueIds",
    byTenantKey: "likedLeagueIdsByTenant",
  });

  const isLiked = !wasActive;
  if (changed) {
    await changeLeagueLikeCount({
      id: leagueId,
      delta: isLiked ? 1 : -1,
      actorUserId: userId,
      tenantId: scopedTenantId,
    });
  }

  clearLeagueDependentCaches();
  return { likedIds: nextIds, isLiked };
}

export async function toggleUserLeagueFollow(payload: {
  leagueId: string;
  userId: string;
  currentlyFollowing: boolean;
  tenantId?: string | null;
}): Promise<string[]> {
  const leagueId = payload.leagueId.trim();
  const userId = payload.userId.trim();
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);
  if (!leagueId || !userId) return [];

  const { nextIds } = await updateUserLeagueInteractionIds({
    leagueId,
    userId,
    tenantId: scopedTenantId,
    key: "followedLeagueIds",
    byTenantKey: "followedLeagueIdsByTenant",
  });

  clearLeagueDependentCaches();
  return nextIds;
}

export async function fetchEventPolls(
  eventId: string,
  options?: { maxResults?: number; forceRefresh?: boolean; tenantId?: string | null }
): Promise<LeaguePollRecord[]> {
  const cleanEventId = eventId.trim();
  if (!cleanEventId) return [];

  const maxResults = boundedLimit(options?.maxResults ?? 80, MAX_POLL_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveLeagueTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${cleanEventId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCacheValue(pollsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let selectColumns: string[] = [...EVENT_POLLS_SELECT_COLUMNS];
  let polls: LeaguePollRecord[] = [];

  while (selectColumns.length > 0) {
    let query = supabase
      .from("eventos_enquetes")
      .select(selectColumns.join(","))
      .eq("eventoId", cleanEventId)
      .limit(maxResults);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query;
    if (!error) {
      const hydratedRows = await hydrateEventPollRows((data ?? []) as unknown as Row[], {
        tenantId: scopedTenantId,
      });
      polls = hydratedRows
        .map((row) => normalizePoll(rowIdFromUnknown(row), row))
        .filter((row): row is LeaguePollRecord => row !== null);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error));
    if (!missingColumn) throwSupabaseError(error);
    const nextColumns = removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (!nextColumns.length) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  setCacheValue(pollsCache, cacheKey, polls);
  return polls;
}

export async function createEventPoll(payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
  options?: unknown[];
  creatorId?: string;
  tenantId?: string | null;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) throw new Error("Evento inválido.");

  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const requestPayload = {
    eventId,
    question: payload.question.trim().slice(0, 280),
    allowUserOptions: payload.allowUserOptions,
    options: Array.isArray(payload.options) ? payload.options : [],
    creatorId: payload.creatorId?.trim() || "",
    tenantId: scopedTenantId || undefined,
  };

  const routeResult = await createEventPollViaAdminRoute(requestPayload);
  if (routeResult?.id) {
    pollsCache.clear();
    return routeResult;
  }

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    LEAGUE_POLL_CREATE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let insertPayload: Record<string, unknown> = {
        eventoId: eventId,
        question: requestPayload.question,
        allowUserOptions: requestPayload.allowUserOptions,
        options: requestPayload.options,
        creatorId: requestPayload.creatorId || null,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
        isOfficial: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      while (Object.keys(insertPayload).length > 0) {
        const { data, error } = await supabase
          .from("eventos_enquetes")
          .insert(insertPayload)
          .select("id")
          .single();
        if (!error) {
          return { id: asString((data as Record<string, unknown> | null)?.id) };
        }

        const missingColumn = asString(extractMissingSchemaColumn(error));
        if (!missingColumn) throwSupabaseError(error);

        const nextPayload = removeMissingColumnFromPayload(insertPayload, missingColumn);
        if (!nextPayload) throwSupabaseError(error);
        insertPayload = nextPayload as Record<string, unknown>;
      }

      throw new Error("Nao foi possivel criar enquete para o evento.");
    }
  );

  pollsCache.clear();
  return result;
}

export async function deleteEventPoll(payload: {
  eventId: string;
  pollId: string;
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  if (
    await deleteEventPollViaAdminRoute({
      eventId,
      pollId,
      tenantId: scopedTenantId || undefined,
    })
  ) {
    pollsCache.clear();
    return;
  }

  await callWithFallback<typeof payload, { ok: boolean }>(
    LEAGUE_POLL_DELETE_CALLABLE,
    payload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("eventos_enquetes")
        .delete()
        .eq("id", pollId)
        .eq("eventoId", eventId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function updateEventPollOptions(payload: {
  eventId: string;
  pollId: string;
  options: LeaguePollOptionRecord[];
  tenantId?: string | null;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;
  const scopedTenantId = resolveLeagueTenantId(payload.tenantId);

  const normalizedOptions = payload.options.slice(0, 80).map((option) => ({
    text: option.text.slice(0, 120),
    votes: Math.max(0, option.votes),
    creator: option.creator || undefined,
    creatorName: option.creatorName || undefined,
    creatorAvatar: option.creatorAvatar || undefined,
  }));

  const requestPayload = { ...payload, options: normalizedOptions };
  if (
    await updateEventPollOptionsViaAdminRoute({
      eventId,
      pollId,
      options: normalizedOptions,
      tenantId: scopedTenantId || undefined,
    })
  ) {
    pollsCache.clear();
    return;
  }

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_POLL_UPDATE_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("eventos_enquetes")
        .update({
          options: normalizedOptions,
          updatedAt: nowIso(),
        })
        .eq("id", pollId)
        .eq("eventoId", eventId);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { error } = await query;
      if (error) throwSupabaseError(error);
      return { ok: true };
    }
  );

  pollsCache.clear();
}

export async function addLeagueQuizHistory(payload: {
  userId: string;
  topMatch: string;
  keywords: string[];
}): Promise<void> {
  const userId = payload.userId.trim();
  if (!userId) return;

  const requestPayload = {
    userId,
    topMatch: payload.topMatch.trim().slice(0, 120),
    keywords: payload.keywords
      .filter((item): item is string => typeof item === "string")
      .slice(0, 60),
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    LEAGUE_QUIZ_CALLABLE,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("quiz_history").insert({
        userId,
        date: nowIso(),
        topMatch: requestPayload.topMatch,
        keywords: requestPayload.keywords,
      });
      if (error) {
        if (asString(getBackendErrorCode(error)).toLowerCase() !== "42p01") {
          throwSupabaseError(error);
        }
      }
      return { ok: true };
    }
  );

  try {
    await incrementUserStats(userId, { leagueQuizRuns: 1 });
  } catch (error: unknown) {
    console.warn("Ligas: falha ao atualizar stats de quiz.", error);
  }

  clearUsersCache();
}


