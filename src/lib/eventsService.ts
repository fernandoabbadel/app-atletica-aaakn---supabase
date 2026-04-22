import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  normalizeAvailabilityStatus,
  normalizePaymentConfig,
  normalizePlanPriceEntries,
  resolvePlanScopedPrice,
} from "./commerceCatalog";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = { cachedAt: number; value: T };
type Row = Record<string, unknown>;

const FINANCEIRO_CACHE_TTL_MS = 90_000;
const FINANCEIRO_DOC_ID = "financeiro";
const EVENT_CHECKOUT_SELECT_COLUMNS =
  "id,titulo,imagem,lotes,status,sale_status,payment_config,pixChave,pixBanco,pixTitular,contatoComprovante,data,hora,local,tipo,categoria,stats";
const TICKET_REQUEST_INSERT_SELECT_COLUMNS = "id";

const financeiroCache = new Map<string, CacheEntry<Row | null>>();

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asTrimmedId = (value: unknown): string => String(value ?? "").trim();

const nowIso = (): string => new Date().toISOString();

const getLeagueEventMetadata = (eventRow: Row | null): {
  leagueId: string;
  visibility: "public" | "internal";
} => {
  const stats = asObject(eventRow?.stats) ?? {};
  const visibilityRaw = asString(stats.leagueEventVisibility || stats.eventVisibility)
    .trim()
    .toLowerCase();
  return {
    leagueId: asString(stats.leagueId).trim(),
    visibility: visibilityRaw === "internal" || visibilityRaw === "interno" ? "internal" : "public",
  };
};

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

const resolveFinanceiroTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveFinanceiroDocIds = (tenantId?: string | null): string[] => {
  const scopedTenantId = resolveFinanceiroTenantId(tenantId);
  if (!scopedTenantId) return [FINANCEIRO_DOC_ID];
  return [buildTenantScopedRowId(scopedTenantId, FINANCEIRO_DOC_ID)];
};

const pickFinanceiroRow = (
  rows: Array<Record<string, unknown>>,
  tenantId?: string | null
): Row | null => {
  const candidates = resolveFinanceiroDocIds(tenantId);
  for (const candidateId of candidates) {
    const match = rows.find((row) => asString(row.id).trim() === candidateId);
    if (match) return match;
  }
  return null;
};

const resolveEventPaymentConfig = (
  evento: Row | null,
  tenantFinanceiro: Row | null
): Row | null => {
  const eventPaymentConfig = normalizePaymentConfig(evento?.payment_config);
  if (eventPaymentConfig) {
    return { ...eventPaymentConfig };
  }

  const legacyEventPayment = normalizePaymentConfig({
    chave: evento?.pixChave,
    banco: evento?.pixBanco,
    titular: evento?.pixTitular,
    whatsapp: evento?.contatoComprovante,
  });
  if (legacyEventPayment) {
    return { ...legacyEventPayment };
  }

  const tenantPayment = normalizePaymentConfig(tenantFinanceiro);
  if (tenantPayment) {
    return { ...tenantPayment };
  }

  return tenantFinanceiro ? { ...tenantFinanceiro } : null;
};

export async function fetchFinanceiroConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<Row | null> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveFinanceiroTenantId(options?.tenantId);
  const cacheKey = scopedTenantId || FINANCEIRO_DOC_ID;

  if (!forceRefresh) {
    const cached = getFinanceiroCachedValue(cacheKey);
    if (cached !== undefined) return cached;
  }

  const supabase = getSupabaseClient();
  const docIds = resolveFinanceiroDocIds(scopedTenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data,chave,banco,titular,whatsapp,updatedAt,createdAt")
    .in("id", docIds);

  if (error) throwSupabaseError(error);

  const row = pickFinanceiroRow(
    ((data as Array<Record<string, unknown>> | null) ?? []).map((entry) => ({ ...entry })),
    scopedTenantId
  );
  setFinanceiroCachedValue(cacheKey, row);
  return row;
}

export async function saveFinanceiroConfig(payload: {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
}, options?: { tenantId?: string | null }): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveFinanceiroTenantId(options?.tenantId);
  const writePayload = {
    id: buildTenantScopedRowId(scopedTenantId, FINANCEIRO_DOC_ID) || FINANCEIRO_DOC_ID,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
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
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<{ evento: Row | null; lote: Row | null; financeiro: Row | null }> {
  const eventId = options.eventId.trim();
  const loteId = options.loteId.trim();
  if (!eventId || !loteId) {
    return { evento: null, lote: null, financeiro: null };
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("eventos")
    .select(EVENT_CHECKOUT_SELECT_COLUMNS)
    .eq("id", eventId);
  const scopedTenantId = resolveFinanceiroTenantId(options.tenantId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwSupabaseError(error);

  const evento = data ? (data as Row) : null;
  const lotes = Array.isArray(evento?.lotes) ? evento.lotes : [];
  const lote =
    (lotes.find((entry) => {
      const obj = asObject(entry);
      if (!obj) return false;
      return asTrimmedId(obj.id) === loteId;
    }) as Row | undefined) ?? null;

  const tenantFinanceiro = await fetchFinanceiroConfig({
    forceRefresh: options.forceRefresh ?? false,
    tenantId: options.tenantId,
  });
  const userPlanIds = (options.userPlanIds ?? []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  const userPlanNames = (options.userPlanNames ?? []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  const resolvedLote = lote
    ? {
        ...lote,
        preco: String(
          resolvePlanScopedPrice({
            basePrice:
              Number.parseFloat(asString(lote.preco).replace(",", ".")) || 0,
            entries: normalizePlanPriceEntries(lote.planPrices ?? lote.plan_prices),
            userPlanIds,
            userPlanNames,
          })
        ).replace(".", ","),
        status: normalizeAvailabilityStatus(lote.status, "ativo"),
      }
    : null;
  const financeiro = resolveEventPaymentConfig(evento, tenantFinanceiro);

  return { evento, lote: resolvedLote, financeiro };
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
  tenantId?: string | null;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
  paymentConfig?: Record<string, unknown> | null;
}): Promise<{ id: string }> {
  const scopedTenantId = resolveFinanceiroTenantId(payload.tenantId);
  const paymentConfig = normalizePaymentConfig(payload.paymentConfig);
  const supabase = getSupabaseClient();
  const userPlanIds = (payload.userPlanIds ?? []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  const userPlanNames = (payload.userPlanNames ?? []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  const fallbackUnitPrice =
    Number.parseFloat(asString(payload.valorUnitario).replace(",", ".")) || 0;
  let resolvedUnitPrice = fallbackUnitPrice;

  let eventLookup = supabase
    .from("eventos")
    .select("id,lotes,stats")
    .eq("id", payload.eventoId.trim());
  if (scopedTenantId) {
    eventLookup = eventLookup.eq("tenant_id", scopedTenantId);
  }
  const { data: eventRow, error: eventError } = await eventLookup.maybeSingle();
  if (eventError) throwSupabaseError(eventError);
  if (eventRow) {
    const eventMetadata = getLeagueEventMetadata(eventRow as Row);
    if (eventMetadata.visibility === "internal" && eventMetadata.leagueId) {
      let memberQuery = supabase
        .from("ligas_membros")
        .select("id")
        .eq("ligaId", eventMetadata.leagueId)
        .eq("userId", payload.userId.trim())
        .limit(1);
      if (scopedTenantId) {
        memberQuery = memberQuery.eq("tenant_id", scopedTenantId);
      }
      const { data: memberRow, error: memberError } = await memberQuery.maybeSingle();
      if (memberError) throwSupabaseError(memberError);
      if (!memberRow) {
        throw new Error("Este evento interno aceita pedidos apenas de membros da liga.");
      }
    }
    const lotes = Array.isArray(eventRow.lotes) ? eventRow.lotes : [];
    const lote = lotes.find((entry) => {
      const row = asObject(entry);
      return row && asTrimmedId(row.id) === String(payload.loteId).trim();
    });
    if (lote) {
      const loteRow = asObject(lote);
      resolvedUnitPrice = resolvePlanScopedPrice({
        basePrice:
          Number.parseFloat(asString(loteRow?.preco).replace(",", ".")) ||
          fallbackUnitPrice,
        entries: normalizePlanPriceEntries(
          loteRow?.planPrices ?? loteRow?.plan_prices
        ),
        userPlanIds,
        userPlanNames,
      });
    }
  }

  const quantidade = Math.max(1, Math.floor(payload.quantidade));
  const formatCurrency = (value: number): string =>
    value.toFixed(2).replace(".", ",");
  const valorUnitario = formatCurrency(resolvedUnitPrice);
  const valorTotal = formatCurrency(resolvedUnitPrice * quantidade);
  const requestPayload = {
    userId: payload.userId.trim(),
    userName: payload.userName.trim() || "Aluno",
    userTurma: payload.userTurma.trim() || "Geral",
    userPhone: payload.userPhone?.trim() || "",
    eventoId: payload.eventoId.trim(),
    eventoNome: payload.eventoNome.trim() || "Evento",
    loteNome: payload.loteNome.trim() || "Lote",
    loteId: String(payload.loteId).trim(),
    quantidade,
    valorUnitario,
    valorTotal,
    metodo: payload.metodo?.trim() || "whatsapp",
    status: "pendente",
    dataSolicitacao: nowIso(),
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    ...(paymentConfig ? { payment_config: paymentConfig } : {}),
  };

  const { data, error } = await supabase
    .from("solicitacoes_ingressos")
    .insert(requestPayload)
    .select(TICKET_REQUEST_INSERT_SELECT_COLUMNS)
    .single();
  if (error) throwSupabaseError(error);

  return { id: asString(data?.id) };
}
