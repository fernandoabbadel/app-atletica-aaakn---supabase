import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";

export type PartnerTier = "ouro" | "prata" | "standard";
export type PartnerStatus = "active" | "pending" | "disabled";

export interface PartnerCoupon {
  id: string;
  titulo: string;
  regra: string;
  valor: string;
  imagem?: string;
}

export interface PartnerRecord {
  id: string;
  nome: string;
  categoria: string;
  tier: PartnerTier;
  status: PartnerStatus;
  cnpj: string;
  responsavel: string;
  email: string;
  telefone: string;
  descricao: string;
  endereco: string;
  horario: string;
  insta: string;
  site: string;
  whats: string;
  imgCapa: string;
  imgLogo: string;
  mensalidade: number;
  vendasTotal: number;
  totalScans: number;
  cupons: PartnerCoupon[];
  senha?: string;
  createdAt?: unknown;
}

export interface PartnerLoginResult {
  id: string;
  nome: string;
  status: PartnerStatus | string;
  passwordValid: boolean;
}

type CacheEntry<T> = { cachedAt: number; value: T };
const TTL_MS = 30_000;
const MAX_RESULTS = 600;
const publicPartnersCache = new Map<string, CacheEntry<PartnerRecord[]>>();
const PUBLIC_PARTNER_LIST_RPC = "public_partner_list_bundle";
const PARTNERS_SELECT_COLUMNS =
  "id,nome,categoria,tier,status,descricao,imgCapa,imgLogo,createdAt";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const resolvePartnersTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /column\s+(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const extracted = match[2] ?? match[1];
    if (extracted) return extracted;
  }

  return null;
};

const isMissingTenantIdColumn = (error: unknown): boolean =>
  extractMissingSchemaColumn(error)?.trim().toLowerCase() === "tenant_id";

const boundedLimit = (requested: number, maxAllowed: number): number => {
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

const normalizeCoupon = (raw: unknown): PartnerCoupon | null => {
  const obj = asObject(raw);
  if (!obj) return null;
  return {
    id: asString(obj.id) || `${Date.now()}-${Math.random()}`,
    titulo: asString(obj.titulo, "Cupom"),
    regra: asString(obj.regra),
    valor: asString(obj.valor),
    imagem: asString(obj.imagem) || undefined,
  };
};

const normalizePartner = (raw: unknown): PartnerRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const id = asString(obj.id);
  if (!id) return null;

  const cupons = asArray(obj.cupons)
    .map(normalizeCoupon)
    .filter((item): item is PartnerCoupon => item !== null);

  return {
    id,
    nome: asString(obj.nome, "Parceiro"),
    categoria: asString(obj.categoria, "Parceiro"),
    tier: asString(obj.tier, "standard") as PartnerTier,
    status: asString(obj.status, "pending") as PartnerStatus,
    cnpj: asString(obj.cnpj),
    responsavel: asString(obj.responsavel),
    email: asString(obj.email).toLowerCase(),
    telefone: asString(obj.telefone),
    descricao: asString(obj.descricao),
    endereco: asString(obj.endereco),
    horario: asString(obj.horario),
    insta: asString(obj.insta),
    site: asString(obj.site),
    whats: asString(obj.whats),
    imgCapa: asString(obj.imgCapa),
    imgLogo: asString(obj.imgLogo),
    mensalidade: asNumber(obj.mensalidade),
    vendasTotal: asNumber(obj.vendasTotal),
    totalScans: asNumber(obj.totalScans),
    cupons,
    senha: asString(obj.senha) || undefined,
    createdAt: obj.createdAt,
  };
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const isMissingRpcError = (error: { code?: string | null; message?: string | null }): boolean => {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("does not exist"))
  );
};

async function fetchPublicPartnersViaRpc(options?: {
  maxResults?: number;
  tenantId?: string | null;
}): Promise<PartnerRecord[] | undefined> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  if (!scopedTenantId) return [];

  const { data, error } = await supabase.rpc(PUBLIC_PARTNER_LIST_RPC, {
    p_tenant_id: scopedTenantId,
    p_limit: boundedLimit(options?.maxResults ?? 240, MAX_RESULTS),
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return undefined;
    }
    throwSupabaseError(error);
  }

  return asArray(asObject(data)?.partners)
    .map(normalizePartner)
    .filter((row): row is PartnerRecord => row !== null);
}

export async function fetchPublicPartners(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<PartnerRecord[]> {
  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(options?.maxResults ?? 240, MAX_RESULTS);
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolvePartnersTenantId(options?.tenantId);
  const cacheKey = `${scopedTenantId || "none"}:${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(publicPartnersCache, cacheKey);
    if (cached) return cached;
  }

  if (!scopedTenantId) {
    setCache(publicPartnersCache, cacheKey, []);
    return [];
  }

  const rpcRows = await fetchPublicPartnersViaRpc({
    maxResults,
    tenantId: scopedTenantId,
  });
  if (rpcRows) {
    setCache(publicPartnersCache, cacheKey, rpcRows);
    return rpcRows;
  }

  let data: unknown[] | null = null;

  const primary = await supabase
    .from("parceiros")
    .select(PARTNERS_SELECT_COLUMNS)
    .eq("tenant_id", scopedTenantId)
    .eq("status", "active")
    .order("tier", { ascending: true })
    .order("nome", { ascending: true })
    .limit(maxResults);

  if (!primary.error) {
    data = primary.data as unknown[];
  } else {
    if (isMissingTenantIdColumn(primary.error)) {
      setCache(publicPartnersCache, cacheKey, []);
      return [];
    }

    const fallback = await supabase
      .from("parceiros")
      .select(PARTNERS_SELECT_COLUMNS)
      .eq("tenant_id", scopedTenantId)
      .eq("status", "active")
      .order("nome", { ascending: true })
      .limit(maxResults);

    if (fallback.error) {
      if (isMissingTenantIdColumn(fallback.error)) {
        setCache(publicPartnersCache, cacheKey, []);
        return [];
      }
      throwSupabaseError(fallback.error);
    }
    data = fallback.data as unknown[];
  }

  const rows = (data ?? [])
    .map(normalizePartner)
    .filter((row): row is PartnerRecord => row !== null)
    .sort((a, b) => {
      const rank = { ouro: 0, prata: 1, standard: 2 } as const;
      return rank[a.tier] - rank[b.tier] || a.nome.localeCompare(b.nome, "pt-BR");
    });

  setCache(publicPartnersCache, cacheKey, rows);
  return rows;
}

export async function loginPartnerByEmail(payload: {
  email: string;
  senha: string;
  tenantId?: string | null;
}): Promise<PartnerLoginResult | null> {
  const supabase = getSupabaseClient();
  const email = payload.email.trim().toLowerCase();
  const senha = payload.senha.trim();
  const scopedTenantId = resolvePartnersTenantId(payload.tenantId);
  if (!email || !senha || !scopedTenantId) return null;

  const { data, error } = await supabase
    .from("parceiros")
    .select("id,nome,status,senha,email")
    .eq("tenant_id", scopedTenantId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTenantIdColumn(error)) {
      return null;
    }
    throwSupabaseError(error);
  }
  if (!data) return null;

  const row = asObject(data);
  if (!row) return null;

  return {
    id: asString(row.id),
    nome: asString(row.nome, "Parceiro"),
    status: asString(row.status, "active"),
    passwordValid: asString(row.senha) === senha,
  };
}
