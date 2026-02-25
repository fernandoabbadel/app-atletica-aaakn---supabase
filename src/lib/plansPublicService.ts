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
}

type CacheEntry<T> = { cachedAt: number; value: T };
const TTL_MS = 35_000;
const MAX_PLAN_RESULTS = 60;
const plansCache = new Map<string, CacheEntry<PlanRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false) => (typeof value === "boolean" ? value : fallback);
const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const boundedLimit = (requested: number, maxAllowed: number) => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

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
  };
};

export async function fetchPlanCatalog(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<PlanRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 30, MAX_PLAN_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(plansCache, cacheKey);
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from("planos")
    .select("*")
    .order("precoVal", { ascending: true })
    .limit(maxResults);

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? `db/${error.name ?? "query-failed"}`,
      cause: error,
    });
  }

  const rows = (data ?? [])
    .map(normalizePlan)
    .filter((item): item is PlanRecord => item !== null);

  setCache(plansCache, cacheKey, rows);
  return rows;
}
