import { httpsCallable } from "@/lib/supa/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
} from "@/lib/supa/firestore";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

type CacheEntry<T> = { cachedAt: number; value: T };

type Row = Record<string, unknown>;

const TTL_MS = 90_000;
const MAX_EVENTS = 80;
const MAX_RSVPS = 2000;
const MAX_POLLS = 200;
const MAX_COMMENTS = 300;
const MAX_TICKETS = 2000;

const CALLABLE_CREATE_TICKET = "eventsCreateTicketRequest";
const CALLABLE_CANCEL_TICKET = "eventsCancelTicketRequest";
const CALLABLE_UPSERT_EVENT = "eventsAdminUpsert";
const CALLABLE_DELETE_EVENT = "eventsAdminDelete";
const CALLABLE_SET_EVENT_STATUS = "eventsAdminSetStatus";
const CALLABLE_SET_EVENT_LOW_STOCK = "eventsAdminSetLowStock";
const CALLABLE_SET_TICKET_PAYMENT = "eventsAdminSetTicketPayment";
const CALLABLE_CREATE_POLL = "eventsAdminCreatePoll";
const CALLABLE_DELETE_POLL = "eventsAdminDeletePoll";
const CALLABLE_UPDATE_POLL = "eventsAdminUpdatePoll";

const feedCache = new Map<string, CacheEntry<Row[]>>();
const detailsCache = new Map<string, CacheEntry<EventDetailsBundle>>();
const adminParticipantsCache = new Map<string, CacheEntry<{ rsvps: Row[]; vendas: Row[] }>>();
const adminRsvpsPageCache = new Map<string, CacheEntry<AdminEventParticipantsPage>>();
const adminSalesPageCache = new Map<string, CacheEntry<AdminEventParticipantsPage>>();
const adminPollsCache = new Map<string, CacheEntry<Row[]>>();
const financeiroCache = new Map<string, CacheEntry<Row | null>>();

const asObj = (value: unknown): Row | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Row;
};

const asStr = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const asTimestamp = asObj(value);
  const maybeToDate = asTimestamp?.toDate;
  if (typeof maybeToDate === "function") {
    const parsed = maybeToDate.call(value) as Date;
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }
  return 0;
};

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isIndexRequired = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

const shouldFallbackToClient = (error: unknown): boolean => {
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

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  if (!shouldUseCallable()) {
    return fallbackFn();
  }

  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClient(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

async function queryRows(path: string, attempts: QueryConstraint[][]): Promise<Row[]> {
  const safeAttempts = attempts.filter((entry) => entry.length > 0);
  if (!safeAttempts.length) return [];

  let lastError: unknown = null;
  for (let i = 0; i < safeAttempts.length; i += 1) {
    try {
      const snap = await getDocs(query(collection(db, path), ...safeAttempts[i]));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Row) }));
    } catch (error: unknown) {
      lastError = error;
      const isLast = i === safeAttempts.length - 1;
      if (!isIndexRequired(error) || isLast) throw error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

const invalidateEventCaches = (eventId?: string): void => {
  const cleanId = eventId?.trim() || "";
  feedCache.clear();
  if (!cleanId) {
    detailsCache.clear();
    adminParticipantsCache.clear();
    adminRsvpsPageCache.clear();
    adminSalesPageCache.clear();
    adminPollsCache.clear();
    return;
  }

  detailsCache.forEach((_, key) => {
    if (key.startsWith(`${cleanId}:`)) detailsCache.delete(key);
  });
  adminParticipantsCache.forEach((_, key) => {
    if (key.startsWith(`${cleanId}:`)) adminParticipantsCache.delete(key);
  });
  adminRsvpsPageCache.forEach((_, key) => {
    if (key.startsWith(`${cleanId}:`)) adminRsvpsPageCache.delete(key);
  });
  adminSalesPageCache.forEach((_, key) => {
    if (key.startsWith(`${cleanId}:`)) adminSalesPageCache.delete(key);
  });
  adminPollsCache.forEach((_, key) => {
    if (key.startsWith(`${cleanId}:`)) adminPollsCache.delete(key);
  });
};

export async function fetchEventsFeed(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<Row[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 60, MAX_EVENTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(feedCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows("eventos", [
    [orderBy("createdAt", "desc"), limit(maxResults)],
    [orderBy("data", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);

  setCache(feedCache, cacheKey, rows);
  return rows;
}

export async function fetchFinanceiroConfig(options?: {
  forceRefresh?: boolean;
}): Promise<Row | null> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = "financeiro";

  if (!forceRefresh) {
    const cached = getCache(financeiroCache, cacheKey);
    if (cached !== null) return cached;
  }

  const snap = await getDoc(doc(db, "app_config", "financeiro"));
  if (!snap.exists()) {
    setCache(financeiroCache, cacheKey, null);
    return null;
  }

  const data = asObj(snap.data());
  setCache(financeiroCache, cacheKey, data);
  return data;
}

export async function fetchEventCheckoutData(options: {
  eventId: string;
  loteId: string;
  forceRefresh?: boolean;
}): Promise<{ evento: Row | null; lote: Row | null; financeiro: Row | null }> {
  const eventId = options.eventId.trim();
  const loteId = options.loteId.trim();
  if (!eventId || !loteId) {
    return { evento: null, lote: null, financeiro: null };
  }

  const eventSnap = await getDoc(doc(db, "eventos", eventId));
  const evento = eventSnap.exists()
    ? ({ id: eventSnap.id, ...(eventSnap.data() as Row) } as Row)
    : null;

  const lotes = Array.isArray(evento?.lotes) ? (evento?.lotes as unknown[]) : [];
  const lote =
    (lotes.find((entry) => {
      const loteObj = asObj(entry);
      if (!loteObj) return false;
      return String(loteObj.id ?? "") === loteId;
    }) as Row | undefined) || null;
  const financeiro = await fetchFinanceiroConfig({
    forceRefresh: options.forceRefresh ?? false,
  });

  return { evento, lote, financeiro };
}

export async function fetchAdminEventParticipants(options: {
  eventId: string;
  rsvpsLimit?: number;
  vendasLimit?: number;
  forceRefresh?: boolean;
}): Promise<{ rsvps: Row[]; vendas: Row[] }> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rsvps: [], vendas: [] };

  const rsvpsLimit = boundedLimit(options.rsvpsLimit ?? 300, MAX_RSVPS);
  const vendasLimit = boundedLimit(options.vendasLimit ?? 300, MAX_TICKETS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${rsvpsLimit}:${vendasLimit}`;

  if (!forceRefresh) {
    const cached = getCache(adminParticipantsCache, cacheKey);
    if (cached) return cached;
  }

  const [rsvps, vendas] = await Promise.all([
    queryRows(`eventos/${eventId}/rsvps`, [[limit(rsvpsLimit)]]),
    queryRows("solicitacoes_ingressos", [
      [where("eventoId", "==", eventId), orderBy("dataSolicitacao", "desc"), limit(vendasLimit)],
      [where("eventoId", "==", eventId), limit(vendasLimit)],
    ]),
  ]);

  const result = { rsvps, vendas };
  setCache(adminParticipantsCache, cacheKey, result);
  return result;
}

export interface AdminEventParticipantsPage {
  rows: Row[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchAdminEventRsvpsPage(options: {
  eventId: string;
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminEventParticipantsPage> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options.pageSize ?? 10, MAX_RSVPS);
  const cursorId = options.cursorId?.trim() || "";
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${pageSize}:${cursorId || "first"}`;

  if (!forceRefresh) {
    const cached = getCache(adminRsvpsPageCache, cacheKey);
    if (cached) return cached;
  }

  const constraints: QueryConstraint[] = [limit(pageSize + 1)];
  if (cursorId) {
    const cursorSnap = await getDoc(doc(db, "eventos", eventId, "rsvps", cursorId));
    if (cursorSnap.exists()) {
      constraints.splice(0, 0, startAfter(cursorSnap));
    }
  }

  const snap = await getDocs(query(collection(db, "eventos", eventId, "rsvps"), ...constraints));
  const docs = snap.docs.slice(0, pageSize);
  const rows = docs.map((entry) => ({ id: entry.id, ...(entry.data() as Row) }));
  const result: AdminEventParticipantsPage = {
    rows,
    hasMore: snap.docs.length > pageSize,
    nextCursor: rows.length ? asStr(rows[rows.length - 1].id) : null,
  };
  setCache(adminRsvpsPageCache, cacheKey, result);
  return result;
}

export async function fetchAdminEventSalesPage(options: {
  eventId: string;
  pageSize?: number;
  cursorId?: string | null;
  forceRefresh?: boolean;
}): Promise<AdminEventParticipantsPage> {
  const eventId = options.eventId.trim();
  if (!eventId) return { rows: [], nextCursor: null, hasMore: false };

  const pageSize = boundedLimit(options.pageSize ?? 10, MAX_TICKETS);
  const cursorId = options.cursorId?.trim() || "";
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${pageSize}:${cursorId || "first"}`;

  if (!forceRefresh) {
    const cached = getCache(adminSalesPageCache, cacheKey);
    if (cached) return cached;
  }

  const cursorSnap = cursorId
    ? await getDoc(doc(db, "solicitacoes_ingressos", cursorId))
    : null;

  const buildConstraints = (ordered: boolean): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [where("eventoId", "==", eventId)];
    if (ordered) constraints.push(orderBy("dataSolicitacao", "desc"));
    if (cursorSnap?.exists()) constraints.push(startAfter(cursorSnap));
    constraints.push(limit(pageSize + 1));
    return constraints;
  };

  let rows: Row[] = [];
  try {
    const snap = await getDocs(query(collection(db, "solicitacoes_ingressos"), ...buildConstraints(true)));
    rows = snap.docs.map((entry): Row => ({ id: entry.id, ...(entry.data() as Row) }));
  } catch (error: unknown) {
    if (!isIndexRequired(error)) throw error;
    const snap = await getDocs(query(collection(db, "solicitacoes_ingressos"), ...buildConstraints(false)));
    rows = snap.docs
      .map((entry): Row => ({ id: entry.id, ...(entry.data() as Row) }))
      .sort(
        (left, right) =>
          toMillis(right["dataSolicitacao"]) - toMillis(left["dataSolicitacao"])
      );
  }

  const pageRows = rows.slice(0, pageSize);
  const result: AdminEventParticipantsPage = {
    rows: pageRows,
    hasMore: rows.length > pageSize,
    nextCursor: pageRows.length ? asStr(pageRows[pageRows.length - 1].id) : null,
  };
  setCache(adminSalesPageCache, cacheKey, result);
  return result;
}

export async function fetchAdminEventPolls(options: {
  eventId: string;
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<Row[]> {
  const eventId = options.eventId.trim();
  if (!eventId) return [];

  const maxResults = boundedLimit(options.maxResults ?? 40, MAX_POLLS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(adminPollsCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows(`eventos/${eventId}/enquetes`, [
    [orderBy("createdAt", "desc"), limit(maxResults)],
    [limit(maxResults)],
  ]);

  setCache(adminPollsCache, cacheKey, rows);
  return rows;
}

export interface EventDetailsBundle {
  evento: Row | null;
  rsvps: Row[];
  comentarios: Row[];
  enquetes: Row[];
  patentes: Row[];
  financeiro: Row | null;
  meusPedidos: Row[];
}

export async function fetchEventDetailsBundle(options: {
  eventId: string;
  userId?: string | null;
  rsvpsLimit?: number;
  commentsLimit?: number;
  pollsLimit?: number;
  pedidosLimit?: number;
  forceRefresh?: boolean;
}): Promise<EventDetailsBundle> {
  const eventId = options.eventId.trim();
  if (!eventId) {
    return {
      evento: null,
      rsvps: [],
      comentarios: [],
      enquetes: [],
      patentes: [],
      financeiro: null,
      meusPedidos: [],
    };
  }

  const userId = options.userId?.trim() || "";
  const rsvpsLimit = boundedLimit(options.rsvpsLimit ?? 450, MAX_RSVPS);
  const commentsLimit = boundedLimit(options.commentsLimit ?? 120, MAX_COMMENTS);
  const pollsLimit = boundedLimit(options.pollsLimit ?? 40, MAX_POLLS);
  const pedidosLimit = boundedLimit(options.pedidosLimit ?? 50, MAX_TICKETS);
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = `${eventId}:${userId}:${rsvpsLimit}:${commentsLimit}:${pollsLimit}:${pedidosLimit}`;

  if (!forceRefresh) {
    const cached = getCache(detailsCache, cacheKey);
    if (cached) return cached;
  }

  const pedidosPromise = userId
    ? queryRows("solicitacoes_ingressos", [
        [
          where("userId", "==", userId),
          where("eventoId", "==", eventId),
          orderBy("dataSolicitacao", "desc"),
          limit(pedidosLimit),
        ],
        [where("userId", "==", userId), where("eventoId", "==", eventId), limit(pedidosLimit)],
      ])
    : Promise.resolve([]);

  const [eventoSnap, rsvps, comentarios, enquetes, patentes, financeiro, meusPedidos] =
    await Promise.all([
      getDoc(doc(db, "eventos", eventId)),
      queryRows(`eventos/${eventId}/rsvps`, [[limit(rsvpsLimit)]]),
      queryRows(`eventos/${eventId}/comentarios`, [
        [orderBy("createdAt", "desc"), limit(commentsLimit)],
        [limit(commentsLimit)],
      ]),
      queryRows(`eventos/${eventId}/enquetes`, [
        [orderBy("createdAt", "desc"), limit(pollsLimit)],
        [limit(pollsLimit)],
      ]),
      queryRows("patentes_config", [[orderBy("minXp", "asc"), limit(25)], [limit(25)]]),
      fetchFinanceiroConfig({ forceRefresh }),
      pedidosPromise,
    ]);

  const bundle: EventDetailsBundle = {
    evento: eventoSnap.exists() ? ({ id: eventoSnap.id, ...(eventoSnap.data() as Row) } as Row) : null,
    rsvps,
    comentarios,
    enquetes,
    patentes,
    financeiro,
    meusPedidos,
  };

  setCache(detailsCache, cacheKey, bundle);
  return bundle;
}

export async function createEventTicketRequest(payload: {
  userId: string;
  userName: string;
  userTurma: string;
  userPhone?: string;
  eventoId: string;
  eventoNome: string;
  loteNome: string;
  loteId: string | number;
  quantidade: number;
  valorUnitario: string;
  valorTotal: string;
  metodo?: string;
}): Promise<{ id: string }> {
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    userTurma: payload.userTurma.trim() || "Geral",
    userPhone: payload.userPhone?.trim() || "",
    eventoId: payload.eventoId.trim(),
    eventoNome: payload.eventoNome.trim() || "Evento",
    loteNome: payload.loteNome.trim() || "Lote",
    loteId: String(payload.loteId).trim(),
    quantidade: Math.max(1, Math.floor(payload.quantidade)),
    valorUnitario: payload.valorUnitario.trim(),
    valorTotal: payload.valorTotal.trim(),
    metodo: payload.metodo?.trim() || "whatsapp",
  };

  const result = await callWithFallback<typeof requestPayload, { id: string }>(
    CALLABLE_CREATE_TICKET,
    requestPayload,
    async () => {
      const docRef = await addDoc(collection(db, "solicitacoes_ingressos"), {
        ...requestPayload,
        status: "pendente",
        dataSolicitacao: serverTimestamp(),
      });
      return { id: docRef.id };
    }
  );

  detailsCache.clear();
  adminParticipantsCache.clear();
  return result;
}

export async function cancelEventTicketRequest(requestId: string): Promise<void> {
  const cleanId = requestId.trim();
  if (!cleanId) return;

  await callWithFallback<{ requestId: string }, { ok: boolean }>(
    CALLABLE_CANCEL_TICKET,
    { requestId: cleanId },
    async () => {
      await deleteDoc(doc(db, "solicitacoes_ingressos", cleanId));
      return { ok: true };
    }
  );

  detailsCache.clear();
  adminParticipantsCache.clear();
}

export async function upsertAdminEvent(payload: {
  eventId?: string;
  data: Row;
}): Promise<Row | null> {
  const eventId = payload.eventId?.trim() || "";
  const requestPayload = {
    ...(eventId ? { eventId } : {}),
    data: payload.data,
  };

  const response = await callWithFallback<typeof requestPayload, unknown>(
    CALLABLE_UPSERT_EVENT,
    requestPayload,
    async () => {
      if (eventId) {
        await updateDoc(doc(db, "eventos", eventId), payload.data);
        const snap = await getDoc(doc(db, "eventos", eventId));
        if (!snap.exists()) return null;
        return { id: snap.id, ...(snap.data() as Row) };
      }

      const created = await addDoc(collection(db, "eventos"), {
        ...payload.data,
        createdAt: serverTimestamp(),
      });
      const snap = await getDoc(created);
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as Row) };
    }
  );

  const eventData = asObj(response);
  invalidateEventCaches(eventId || asStr(eventData?.id));
  return eventData;
}

export async function deleteAdminEventById(eventId: string): Promise<void> {
  const cleanId = eventId.trim();
  if (!cleanId) return;

  await callWithFallback<{ eventId: string }, { ok: boolean }>(
    CALLABLE_DELETE_EVENT,
    { eventId: cleanId },
    async () => {
      await deleteDoc(doc(db, "eventos", cleanId));
      return { ok: true };
    }
  );

  invalidateEventCaches(cleanId);
}

export async function setAdminEventStatus(payload: {
  eventId: string;
  status: string;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  if (!eventId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_SET_EVENT_STATUS,
    payload,
    async () => {
      await updateDoc(doc(db, "eventos", eventId), {
        status: payload.status,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  invalidateEventCaches(eventId);
}

export async function setAdminEventLowStock(payload: {
  eventId: string;
  isLowStock: boolean;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  if (!eventId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_SET_EVENT_LOW_STOCK,
    payload,
    async () => {
      await updateDoc(doc(db, "eventos", eventId), {
        isLowStock: payload.isLowStock,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    }
  );

  invalidateEventCaches(eventId);
}

export async function setAdminTicketPayment(payload: {
  ticketRequestId: string;
  isApproving: boolean;
  approvedBy: string;
}): Promise<void> {
  const ticketRequestId = payload.ticketRequestId.trim();
  if (!ticketRequestId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_SET_TICKET_PAYMENT,
    payload,
    async () => {
      await updateDoc(doc(db, "solicitacoes_ingressos", ticketRequestId), {
        status: payload.isApproving ? "aprovado" : "pendente",
        dataAprovacao: payload.isApproving ? serverTimestamp() : null,
        aprovadoPor: payload.isApproving ? payload.approvedBy : null,
      });
      return { ok: true };
    }
  );

  adminParticipantsCache.clear();
  detailsCache.clear();
}

export async function createAdminEventPoll(payload: {
  eventId: string;
  question: string;
  allowUserOptions: boolean;
}): Promise<{ id: string }> {
  const eventId = payload.eventId.trim();
  if (!eventId) return { id: "" };

  const requestPayload = {
    eventId,
    question: payload.question.trim(),
    allowUserOptions: payload.allowUserOptions,
  };

  const response = await callWithFallback<typeof requestPayload, { id: string }>(
    CALLABLE_CREATE_POLL,
    requestPayload,
    async () => {
      const docRef = await addDoc(collection(db, "eventos", eventId, "enquetes"), {
        question: requestPayload.question,
        allowUserOptions: requestPayload.allowUserOptions,
        options: [],
        voters: [],
        createdAt: serverTimestamp(),
      });
      return { id: docRef.id };
    }
  );

  invalidateEventCaches(eventId);
  return response;
}

export async function deleteAdminEventPoll(payload: {
  eventId: string;
  pollId: string;
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_DELETE_POLL,
    payload,
    async () => {
      await deleteDoc(doc(db, "eventos", eventId, "enquetes", pollId));
      return { ok: true };
    }
  );

  invalidateEventCaches(eventId);
}

export async function updateAdminEventPollOptions(payload: {
  eventId: string;
  pollId: string;
  options: unknown[];
}): Promise<void> {
  const eventId = payload.eventId.trim();
  const pollId = payload.pollId.trim();
  if (!eventId || !pollId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_UPDATE_POLL,
    payload,
    async () => {
      await updateDoc(doc(db, "eventos", eventId, "enquetes", pollId), {
        options: payload.options,
      });
      return { ok: true };
    }
  );

  invalidateEventCaches(eventId);
}

export function clearEventsCaches(): void {
  feedCache.clear();
  detailsCache.clear();
  adminParticipantsCache.clear();
  adminRsvpsPageCache.clear();
  adminSalesPageCache.clear();
  adminPollsCache.clear();
  financeiroCache.clear();
}

