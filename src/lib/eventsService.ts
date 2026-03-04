import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;

const FINANCEIRO_CACHE_TTL_MS = 90_000;
const FINANCEIRO_DOC_ID = "financeiro";
const EVENT_CHECKOUT_SELECT_COLUMNS = "id,titulo,imagem,lotes,status,data,hora,local";
const TICKET_REQUEST_INSERT_SELECT_COLUMNS = "id";

const financeiroCache = new Map<string, CacheEntry<Row | null>>();

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const nowIso = (): string => new Date().toISOString();

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const getFinanceiroCachedValue = (cacheKey: string): Row | null | undefined => {
  const cached = financeiroCache.get(cacheKey);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt > FINANCEIRO_CACHE_TTL_MS) {
    financeiroCache.delete(cacheKey);
    return undefined;
  }
  return cached.value;
};

const setFinanceiroCachedValue = (cacheKey: string, value: Row | null): void => {
  financeiroCache.set(cacheKey, { cachedAt: Date.now(), value });
};

export async function fetchFinanceiroConfig(options?: {
  forceRefresh?: boolean;
}): Promise<Row | null> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = FINANCEIRO_DOC_ID;

  if (!forceRefresh) {
    const cached = getFinanceiroCachedValue(cacheKey);
    if (cached !== undefined) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data,chave,banco,titular,whatsapp,updatedAt,createdAt")
    .eq("id", FINANCEIRO_DOC_ID)
    .maybeSingle();

  if (error) throwSupabaseError(error);

  const row = data ? (data as Row) : null;
  setFinanceiroCachedValue(cacheKey, row);
  return row;
}

export async function saveFinanceiroConfig(payload: {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const writePayload = {
    id: FINANCEIRO_DOC_ID,
    chave: payload.chave.trim(),
    banco: payload.banco.trim(),
    titular: payload.titular.trim(),
    whatsapp: payload.whatsapp?.trim() || "",
    updatedAt: nowIso(),
  };

  const { error } = await supabase.from("app_config").upsert(writePayload, {
    onConflict: "id",
  });
  if (error) throwSupabaseError(error);

  financeiroCache.clear();
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

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("eventos")
    .select(EVENT_CHECKOUT_SELECT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const evento = data ? (data as Row) : null;
  const lotes = Array.isArray(evento?.lotes) ? evento.lotes : [];
  const lote =
    (lotes.find((entry) => {
      const obj = asObject(entry);
      if (!obj) return false;
      return asString(obj.id).trim() === loteId;
    }) as Row | undefined) ?? null;

  const financeiro = await fetchFinanceiroConfig({
    forceRefresh: options.forceRefresh ?? false,
  });

  return { evento, lote, financeiro };
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
    status: "pendente",
    dataSolicitacao: nowIso(),
  };

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("solicitacoes_ingressos")
    .insert(requestPayload)
    .select(TICKET_REQUEST_INSERT_SELECT_COLUMNS)
    .single();
  if (error) throwSupabaseError(error);

  return { id: asString(data?.id) };
}
