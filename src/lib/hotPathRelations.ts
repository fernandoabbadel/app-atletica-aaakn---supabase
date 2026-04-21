import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  asObject,
  asString,
  asStringArray,
  type Row,
} from "./supabaseData";
import { getSupabaseClient } from "./supabase";

const POLL_VOTES_SELECT_COLUMNS = "enqueteId,userId,optionIndex,userTurma";

const normalizeTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const toUniqueIds = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

export const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = typeof raw.code === "string" ? raw.code.toUpperCase() : "";
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry.toLowerCase() : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");

  return code === "42P01" || message.includes("relation") && message.includes("does not exist");
};

async function fetchViewerEventIdsFromTable(options: {
  table: "eventos_likes" | "eventos_rsvps";
  eventIds: string[];
  userId?: string | null;
  tenantId?: string | null;
}): Promise<Set<string>> {
  const scopedTenantId = normalizeTenantId(options.tenantId);
  const cleanUserId = asString(options.userId).trim();
  const cleanEventIds = toUniqueIds(options.eventIds);
  if (!cleanUserId || cleanEventIds.length === 0) {
    return new Set<string>();
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from(options.table)
    .select("eventoId")
    .eq("userId", cleanUserId)
    .in("eventoId", cleanEventIds);

  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }

  try {
    const { data, error } = await query;
    if (error) throw error;
    return new Set(
      ((data ?? []) as Row[])
        .map((row) => asString(row.eventoId).trim())
        .filter((value) => value.length > 0)
    );
  } catch (error: unknown) {
    if (isMissingRelationError(error)) {
      return new Set<string>();
    }
    throw error instanceof Error
      ? error
      : new Error("Falha ao consultar relação de interações do evento.");
  }
}

export async function hydrateEventViewerState(
  rows: Row[],
  options?: { userId?: string | null; tenantId?: string | null }
): Promise<Row[]> {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const cleanUserId = asString(options?.userId).trim();
  const eventIds = toUniqueIds(cleanRows.map((row) => asString(row.id).trim()));

  if (!cleanUserId || eventIds.length === 0) {
    return cleanRows.map((row) => ({
      ...row,
      viewerHasLiked: Boolean(row.viewerHasLiked),
      viewerIsInterested: Boolean(row.viewerIsInterested),
    }));
  }

  const [likedIds, interestedIds] = await Promise.all([
    fetchViewerEventIdsFromTable({
      table: "eventos_likes",
      eventIds,
      userId: cleanUserId,
      tenantId: options?.tenantId,
    }),
    fetchViewerEventIdsFromTable({
      table: "eventos_rsvps",
      eventIds,
      userId: cleanUserId,
      tenantId: options?.tenantId,
    }),
  ]);

  return cleanRows.map((row) => {
    const eventId = asString(row.id).trim();
    return {
      ...row,
      viewerHasLiked: likedIds.has(eventId),
      viewerIsInterested: interestedIds.has(eventId),
    };
  });
}

export async function hydrateEventPollRows(
  rows: Row[],
  options?: { viewerUserId?: string | null; tenantId?: string | null }
): Promise<Row[]> {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const pollIds = toUniqueIds(cleanRows.map((row) => asString(row.id).trim()));
  if (pollIds.length === 0) return cleanRows;

  const supabase = getSupabaseClient();
  const scopedTenantId = normalizeTenantId(options?.tenantId);

  try {
    let query = supabase
      .from("eventos_enquete_votos")
      .select(POLL_VOTES_SELECT_COLUMNS)
      .in("enqueteId", pollIds);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const votesByPoll = new Map<string, Row[]>();
    ((data ?? []) as Row[]).forEach((row) => {
      const pollId = asString(row.enqueteId).trim();
      if (!pollId) return;
      const current = votesByPoll.get(pollId) ?? [];
      current.push(row);
      votesByPoll.set(pollId, current);
    });

    const viewerUserId = asString(options?.viewerUserId).trim();

    return cleanRows.map((row) => {
      const pollId = asString(row.id).trim();
      const voteRows = votesByPoll.get(pollId) ?? [];
      if (voteRows.length === 0) {
        return {
          ...row,
          voters: asStringArray(row.voters),
          userVotes:
            viewerUserId && typeof row.userVotes === "object" && row.userVotes !== null
              ? row.userVotes
              : viewerUserId
                ? { [viewerUserId]: [] }
                : {},
        };
      }

      const voters = Array.from(
        new Set(
          voteRows
            .map((entry) => asString(entry.userId).trim())
            .filter((value) => value.length > 0)
        )
      );
      const viewerVotes = voteRows
        .filter((entry) => asString(entry.userId).trim() === viewerUserId)
        .map((entry) => {
          const parsed = Number(entry.optionIndex);
          return Number.isFinite(parsed) ? Math.floor(parsed) : -1;
        })
        .filter((value) => value >= 0);

      const optionStats = new Map<number, { votes: number; votesByTurma: Record<string, number> }>();
      voteRows.forEach((entry) => {
        const optionIndex = Number(entry.optionIndex);
        if (!Number.isFinite(optionIndex) || optionIndex < 0) return;
        const turma = asString(entry.userTurma, "Geral").trim() || "Geral";
        const current = optionStats.get(optionIndex) ?? { votes: 0, votesByTurma: {} };
        current.votes += 1;
        current.votesByTurma[turma] = (current.votesByTurma[turma] ?? 0) + 1;
        optionStats.set(Math.floor(optionIndex), current);
      });

      const optionsRaw = Array.isArray(row.options) ? row.options : [];
      const nextOptions = optionsRaw.map((entry, index) => {
        const option = asObject(entry) ?? {};
        const stats = optionStats.get(index);
        if (!stats) {
          return {
            ...option,
            votes: 0,
            votesByTurma: {},
          };
        }
        return {
          ...option,
          votes: stats.votes,
          votesByTurma: stats.votesByTurma,
        };
      });

      return {
        ...row,
        options: nextOptions,
        voters,
        userVotes: viewerUserId ? { [viewerUserId]: Array.from(new Set(viewerVotes)) } : {},
      };
    });
  } catch (error: unknown) {
    if (isMissingRelationError(error)) {
      return cleanRows;
    }
    throw error instanceof Error
      ? error
      : new Error("Falha ao hidratar votos relacionais da enquete.");
  }
}
