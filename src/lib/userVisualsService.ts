import { getSupabaseClient } from "./supabase";
import {
  asNumber,
  asString,
  throwSupabaseError,
  type Row,
} from "./supabaseData";

type CacheEntry<T> = { cachedAt: number; value: T };

const USER_CACHE_TTL_MS = 90_000;
const PLAN_CACHE_TTL_MS = 120_000;
const PATENTE_CACHE_TTL_MS = 120_000;
const VISUAL_CATALOG_SESSION_TTL_MS = 300_000;
const VISUAL_CATALOG_SESSION_KEY = "userVisualsService:visualCatalog:v1";
const MAX_IN_CLAUSE = 120;
const MAX_PLAN_RESULTS = 120;
const MAX_PATENTE_RESULTS = 80;

export type UserVisualPlanConfig = {
  nome: string;
  cor: string;
  icon: string;
  descontoLoja: number;
  xpMultiplier: number;
  nivelPrioridade: number;
};

export type UserVisualPatenteConfig = {
  titulo: string;
  minXp: number;
  cor: string;
  iconName: string;
};

type RawUserVisualRow = {
  uid: string;
  nome: string;
  apelido: string;
  foto: string;
  turma: string;
  role: string;
  tenant_role: string;
  plano: string;
  plano_cor: string;
  plano_icon: string;
  patente: string;
  patente_icon: string;
  patente_cor: string;
  xp: number;
};

export type CanonicalUserVisual = {
  uid: string;
  nome: string;
  apelido: string;
  foto: string;
  turma: string;
  role: string;
  tenant_role: string;
  plano: string;
  plano_cor: string;
  plano_icon: string;
  patente: string;
  patente_icon: string;
  patente_cor: string;
  xp: number;
};

type VisualCatalogSessionEnvelope = {
  cachedAt: number;
  plans: UserVisualPlanConfig[];
  patentes: UserVisualPatenteConfig[];
};

const userCache = new Map<string, CacheEntry<RawUserVisualRow | null>>();
let planCache: CacheEntry<UserVisualPlanConfig[]> | null = null;
let patenteCache: CacheEntry<UserVisualPatenteConfig[]> | null = null;

const isFresh = (cachedAt: number, ttl: number): boolean =>
  Date.now() - cachedAt <= ttl;

const readVisualCatalogSessionCache = (): VisualCatalogSessionEnvelope | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(VISUAL_CATALOG_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as VisualCatalogSessionEnvelope;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.cachedAt !== "number" ||
      !Array.isArray(parsed.plans) ||
      !Array.isArray(parsed.patentes)
    ) {
      window.sessionStorage.removeItem(VISUAL_CATALOG_SESSION_KEY);
      return null;
    }

    if (!isFresh(parsed.cachedAt, VISUAL_CATALOG_SESSION_TTL_MS)) {
      window.sessionStorage.removeItem(VISUAL_CATALOG_SESSION_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const writeVisualCatalogSessionCache = (
  plans: UserVisualPlanConfig[],
  patentes: UserVisualPatenteConfig[]
): void => {
  if (typeof window === "undefined") return;

  try {
    const payload: VisualCatalogSessionEnvelope = {
      cachedAt: Date.now(),
      plans,
      patentes,
    };
    window.sessionStorage.setItem(
      VISUAL_CATALOG_SESSION_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignora erro de quota
  }
};

const hydrateVisualCatalogCachesFromSession = (): boolean => {
  const cached = readVisualCatalogSessionCache();
  if (!cached) return false;

  if (!planCache || !isFresh(planCache.cachedAt, PLAN_CACHE_TTL_MS)) {
    planCache = {
      cachedAt: cached.cachedAt,
      value: cached.plans,
    };
  }

  if (!patenteCache || !isFresh(patenteCache.cachedAt, PATENTE_CACHE_TTL_MS)) {
    patenteCache = {
      cachedAt: cached.cachedAt,
      value: cached.patentes,
    };
  }

  return true;
};

const normalizePlanName = (value: string): string => {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";

  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.startsWith("plano ")) {
    return cleaned.slice("plano ".length).trim();
  }

  return cleaned;
};

const normalizeLabel = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isPlaceholderLabel = (normalizedValue: string): boolean =>
  normalizedValue === "" ||
  normalizedValue === "visitante" ||
  normalizedValue === "visitor" ||
  normalizedValue.startsWith("visitante ") ||
  normalizedValue.startsWith("visitor ");

const chunkArray = <T>(values: T[], chunkSize: number): T[][] => {
  if (values.length === 0) return [];
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    output.push(values.slice(index, index + chunkSize));
  }
  return output;
};

const sanitizeIds = (userIds: string[]): string[] => {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  userIds.forEach((rawId) => {
    const value = rawId.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    sanitized.push(value);
  });

  return sanitized;
};

const toRawUserVisualRow = (row: Row): RawUserVisualRow => ({
  uid: asString(row.uid).trim(),
  nome: asString(row.nome).trim(),
  apelido: asString(row.apelido).trim(),
  foto: asString(row.foto).trim(),
  turma: asString(row.turma).trim(),
  role: asString(row.role).trim(),
  tenant_role: asString(row.tenant_role).trim(),
  plano: asString(row.plano).trim(),
  plano_cor: asString(row.plano_cor).trim(),
  plano_icon: asString(row.plano_icon).trim(),
  patente: asString(row.patente).trim(),
  patente_icon: asString(row.patente_icon).trim(),
  patente_cor: asString(row.patente_cor).trim(),
  xp: asNumber(row.xp, 0),
});

const fetchPlanRows = async (): Promise<UserVisualPlanConfig[]> => {
  hydrateVisualCatalogCachesFromSession();

  if (planCache && isFresh(planCache.cachedAt, PLAN_CACHE_TTL_MS)) {
    return planCache.value;
  }

  const supabase = getSupabaseClient();
  const prioritizedQuery = await supabase
    .from("planos")
    .select("nome,cor,icon,descontoLoja,xpMultiplier,nivelPrioridade")
    .limit(MAX_PLAN_RESULTS);

  let planRowsSource: Row[] = [];

  if (prioritizedQuery.error) {
    const normalizedMessage = `${asString(prioritizedQuery.error.message)} ${asString(prioritizedQuery.error.details)}`.toLowerCase();
    const isMissingPriorityColumn =
      normalizedMessage.includes("nivelprioridade") &&
      (normalizedMessage.includes("column") ||
        normalizedMessage.includes("schema") ||
        normalizedMessage.includes("cache"));

    if (!isMissingPriorityColumn) {
      throwSupabaseError(prioritizedQuery.error);
    }

    const fallbackQuery = await supabase
      .from("planos")
      .select("nome,cor,icon,descontoLoja,xpMultiplier")
      .limit(MAX_PLAN_RESULTS);

    if (fallbackQuery.error) throwSupabaseError(fallbackQuery.error);
    planRowsSource = (fallbackQuery.data ?? []) as Row[];
  } else {
    planRowsSource = (prioritizedQuery.data ?? []) as Row[];
  }

  const rows = planRowsSource
    .map((row) => ({
      nome: asString(row.nome).trim(),
      cor: asString(row.cor).trim(),
      icon: asString(row.icon).trim(),
      descontoLoja: asNumber((row as Row).descontoLoja, 0),
      xpMultiplier: asNumber((row as Row).xpMultiplier, 1),
      nivelPrioridade: asNumber((row as Row).nivelPrioridade, Number.MAX_SAFE_INTEGER),
    }))
    .filter((row) => row.nome.length > 0);

  rows.sort((left, right) => {
    if (left.nivelPrioridade !== right.nivelPrioridade) {
      return left.nivelPrioridade - right.nivelPrioridade;
    }

    return left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" });
  });

  planCache = { cachedAt: Date.now(), value: rows };
  return rows;
};

const fetchPatenteRows = async (): Promise<UserVisualPatenteConfig[]> => {
  hydrateVisualCatalogCachesFromSession();

  if (patenteCache && isFresh(patenteCache.cachedAt, PATENTE_CACHE_TTL_MS)) {
    return patenteCache.value;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("patentes_config")
    .select("titulo,minXp,cor,iconName")
    .order("minXp", { ascending: true })
    .limit(MAX_PATENTE_RESULTS);

  if (error) throwSupabaseError(error);

  const rows = ((data ?? []) as Row[])
    .map((row) => ({
      titulo: asString(row.titulo).trim(),
      minXp: asNumber(row.minXp, 0),
      cor: asString(row.cor).trim(),
      iconName: asString(row.iconName).trim(),
    }))
    .filter((row) => row.titulo.length > 0)
    .sort((left, right) => left.minXp - right.minXp);

  patenteCache = { cachedAt: Date.now(), value: rows };
  return rows;
};

const resolvePatenteByXp = (
  patentes: UserVisualPatenteConfig[],
  xp: number
): UserVisualPatenteConfig | null => {
  if (patentes.length === 0) return null;

  let selected: UserVisualPatenteConfig | null = null;
  for (const patente of patentes) {
    if (xp >= patente.minXp) {
      selected = patente;
      continue;
    }
    break;
  }
  return selected;
};

const fetchUsersByIds = async (userIds: string[]): Promise<void> => {
  const supabase = getSupabaseClient();
  const chunks = chunkArray(userIds, MAX_IN_CLAUSE);

  for (const idsChunk of chunks) {
    const { data, error } = await supabase
      .from("users")
      .select(
        "uid,nome,apelido,foto,turma,role,tenant_role,plano,plano_cor,plano_icon,patente,patente_icon,patente_cor,xp"
      )
      .in("uid", idsChunk);

    if (error) throwSupabaseError(error);

    const foundById = new Map<string, RawUserVisualRow>();
    ((data ?? []) as Row[]).forEach((row) => {
      const normalized = toRawUserVisualRow(row);
      if (!normalized.uid) return;
      foundById.set(normalized.uid, normalized);
      userCache.set(normalized.uid, {
        cachedAt: Date.now(),
        value: normalized,
      });
    });

    idsChunk.forEach((id) => {
      if (foundById.has(id)) return;
      userCache.set(id, {
        cachedAt: Date.now(),
        value: null,
      });
    });
  }
};

const shouldFetchUserFromDb = (userId: string): boolean => {
  const cached = userCache.get(userId);
  if (!cached) return true;
  return !isFresh(cached.cachedAt, USER_CACHE_TTL_MS);
};

const buildPlanMap = (
  plans: UserVisualPlanConfig[]
): Map<string, UserVisualPlanConfig> => {
  const map = new Map<string, UserVisualPlanConfig>();
  plans.forEach((plan) => {
    const normalized = normalizePlanName(plan.nome);
    if (!normalized || map.has(normalized)) return;
    map.set(normalized, plan);
  });
  return map;
};

const getDefaultPlan = (
  plans: UserVisualPlanConfig[]
): UserVisualPlanConfig | null => plans[0] ?? null;

const resolvePlanVisual = (
  rawPlan: string,
  rawColor: string,
  rawIcon: string,
  planMap: Map<string, UserVisualPlanConfig>,
  defaultPlan: UserVisualPlanConfig | null
): {
  planName: string;
  planColor: string;
  planIcon: string;
} => {
  const normalizedRawPlan = normalizePlanName(rawPlan);

  let matchedPlan = planMap.get(normalizedRawPlan);
  if (!matchedPlan && normalizedRawPlan === "bicho") {
    matchedPlan = planMap.get("bicho solto");
  }
  if (!matchedPlan && isPlaceholderLabel(normalizedRawPlan)) {
    matchedPlan = defaultPlan ?? undefined;
  }

  if (matchedPlan) {
    return {
      planName: matchedPlan.nome,
      planColor: matchedPlan.cor,
      planIcon: matchedPlan.icon,
    };
  }

  if (isPlaceholderLabel(normalizedRawPlan)) {
    return { planName: "", planColor: "", planIcon: "" };
  }

  return {
    planName: rawPlan,
    planColor: rawColor,
    planIcon: rawIcon,
  };
};

const toCanonicalVisual = (
  raw: RawUserVisualRow,
  planMap: Map<string, UserVisualPlanConfig>,
  patentes: UserVisualPatenteConfig[],
  defaultPlan: UserVisualPlanConfig | null
): CanonicalUserVisual => {
  const planVisual = resolvePlanVisual(
    raw.plano,
    raw.plano_cor,
    raw.plano_icon,
    planMap,
    defaultPlan
  );
  const patenteByXp = resolvePatenteByXp(patentes, raw.xp);
  const normalizedRawPatente = normalizeLabel(raw.patente);
  const safeRawPatente = isPlaceholderLabel(normalizedRawPatente) ? "" : raw.patente;
  const safeRawPatenteIcon = isPlaceholderLabel(normalizeLabel(raw.patente_icon))
    ? ""
    : raw.patente_icon;
  const safeRawPatenteCor = isPlaceholderLabel(normalizeLabel(raw.patente_cor))
    ? ""
    : raw.patente_cor;

  return {
    uid: raw.uid,
    nome: raw.nome,
    apelido: raw.apelido,
    foto: raw.foto,
    turma: raw.turma,
    role: raw.role,
    tenant_role: raw.tenant_role,
    plano: planVisual.planName,
    plano_cor: planVisual.planColor,
    plano_icon: planVisual.planIcon,
    patente: safeRawPatente || patenteByXp?.titulo || "",
    patente_icon: safeRawPatenteIcon || patenteByXp?.iconName || "",
    patente_cor: safeRawPatenteCor || patenteByXp?.cor || "",
    xp: raw.xp,
  };
};

export async function fetchCanonicalUserVisuals(
  userIds: string[]
): Promise<Map<string, CanonicalUserVisual>> {
  const ids = sanitizeIds(userIds);
  const output = new Map<string, CanonicalUserVisual>();
  if (ids.length === 0) return output;

  const missing = ids.filter((id) => shouldFetchUserFromDb(id));
  if (missing.length > 0) {
    await fetchUsersByIds(missing);
  }

  const [plans, patentes] = await Promise.all([fetchPlanRows(), fetchPatenteRows()]);
  writeVisualCatalogSessionCache(plans, patentes);
  const planMap = buildPlanMap(plans);
  const defaultPlan = getDefaultPlan(plans);

  ids.forEach((id) => {
    const cached = userCache.get(id);
    const raw = cached?.value;
    if (!raw) return;
    output.set(id, toCanonicalVisual(raw, planMap, patentes, defaultPlan));
  });

  return output;
}

export async function fetchUserVisualCatalog(): Promise<{
  plans: UserVisualPlanConfig[];
  patentes: UserVisualPatenteConfig[];
}> {
  hydrateVisualCatalogCachesFromSession();

  const [plans, patentes] = await Promise.all([fetchPlanRows(), fetchPatenteRows()]);
  writeVisualCatalogSessionCache(plans, patentes);

  return { plans, patentes };
}
