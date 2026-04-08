import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";

export interface PlanRecord {
  id: string;
  nome: string;
  preco: string;
  precoVal: number;
  parcelamento: string;
  descricao: string;
  cor: string;
  icon: string;
  destaque: boolean;
  beneficios: string[];
  xpMultiplier: number;
  nivelPrioridade: number;
  descontoLoja: number;
  displayOrder: number;
}

type CacheEntry<T> = { cachedAt: number; value: T };

const TTL_MS = 35_000;
const MAX_PLAN_RESULTS = 60;
const PLANOS_SELECT_COLUMNS =
  "id,tenant_id,nome,preco,precoVal,parcelamento,descricao,cor,icon,destaque,beneficios,xpMultiplier,nivelPrioridade,descontoLoja,displayOrder";
const PLANOS_LEGACY_SELECT_COLUMNS =
  "id,tenant_id,nome,preco,precoVal,parcelamento,descricao,cor,icon,destaque,beneficios,xpMultiplier,nivelPrioridade,descontoLoja";

const plansCache = new Map<string, CacheEntry<PlanRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const boundedLimit = (requested: number, maxAllowed: number) => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const resolvePlanTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(typeof tenantId === "string" ? tenantId.trim() : "");

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const message = [
    typeof raw.message === "string" ? raw.message : "",
    typeof raw.details === "string" ? raw.details : "",
  ]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+["']?([a-z0-9_]+)["']?\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
};

const normalizePlan = (raw: unknown): PlanRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const id = asString(data.id);
  if (!id) return null;

  return {
    id,
    nome: asString(data.nome, "Plano"),
    preco: asString(data.preco, "0,00"),
    precoVal: Math.max(0, asNumber(data.precoVal, 0)),
    parcelamento: asString(data.parcelamento),
    descricao: asString(data.descricao),
    cor: asString(data.cor, "zinc"),
    icon: asString(data.icon, "star"),
    destaque: asBoolean(data.destaque, false),
    beneficios: asStringArray(data.beneficios).slice(0, 40),
    xpMultiplier: Math.max(0, asNumber(data.xpMultiplier, 1)),
    nivelPrioridade: Math.max(1, asNumber(data.nivelPrioridade, 1)),
    descontoLoja: Math.max(0, asNumber(data.descontoLoja, 0)),
    displayOrder: Math.max(0, Math.floor(asNumber(data.displayOrder, Number.MAX_SAFE_INTEGER))),
  };
};

export async function fetchPlanCatalog(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PlanRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 30, MAX_PLAN_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePlanTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "global"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(plansCache, cacheKey);
    if (cached) return cached;
  }

  const runQuery = async (withDisplayOrder: boolean) => {
    let query = supabase
      .from("planos")
      .select(withDisplayOrder ? PLANOS_SELECT_COLUMNS : PLANOS_LEGACY_SELECT_COLUMNS);

    if (withDisplayOrder) {
      query = query.order("displayOrder", { ascending: true }).order("precoVal", { ascending: true });
    } else {
      query = query.order("precoVal", { ascending: true });
    }

    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }

    const { data, error } = await query.limit(maxResults);
    if (error) {
      const missingColumn = extractMissingSchemaColumn(error);
      if (withDisplayOrder && missingColumn?.toLowerCase() === "displayorder") {
        return null;
      }
      throw Object.assign(new Error(error.message), {
        code: error.code ?? `db/${error.name ?? "query-failed"}`,
        cause: error,
      });
    }

    return data ?? [];
  };

  const data = (await runQuery(true)) ?? (await runQuery(false)) ?? [];
  const rows = data
    .map(normalizePlan)
    .filter((item): item is PlanRecord => item !== null)
    .sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder;
      }
      if (left.precoVal !== right.precoVal) {
        return left.precoVal - right.precoVal;
      }
      return left.nome.localeCompare(right.nome, "pt-BR");
    })
    .map((plan, index) => ({
      ...plan,
      displayOrder:
        Number.isFinite(plan.displayOrder) && plan.displayOrder !== Number.MAX_SAFE_INTEGER
          ? plan.displayOrder
          : index,
    }));

  setCache(plansCache, cacheKey, rows);
  return rows;
}
