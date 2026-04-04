import { fetchTenantBySlug, type TenantSummary } from "./tenantService";

type CacheEntry = {
  expiresAt: number;
  value: TenantSummary | null;
};

const TENANT_LOOKUP_TTL_MS = 60_000;

const tenantCache = new Map<string, CacheEntry>();
const pendingLookups = new Map<string, Promise<TenantSummary | null>>();

const normalizeTenantSlug = (tenantSlug: string): string =>
  tenantSlug.trim().toLowerCase();

export const clearPublicTenantLookupCache = (tenantSlugRaw?: string): void => {
  const tenantSlug = normalizeTenantSlug(tenantSlugRaw || "");
  if (!tenantSlug) {
    tenantCache.clear();
    pendingLookups.clear();
    return;
  }

  tenantCache.delete(tenantSlug);
  pendingLookups.delete(tenantSlug);
};

const getCachedTenant = (tenantSlug: string): TenantSummary | null | undefined => {
  const cached = tenantCache.get(tenantSlug);
  if (!cached) return undefined;
  if (Date.now() > cached.expiresAt) {
    tenantCache.delete(tenantSlug);
    return undefined;
  }
  return cached.value;
};

const setCachedTenant = (tenantSlug: string, value: TenantSummary | null): void => {
  tenantCache.set(tenantSlug, {
    expiresAt: Date.now() + TENANT_LOOKUP_TTL_MS,
    value,
  });
};

const mapPublicTenantPayload = (
  tenantSlug: string,
  payload: Record<string, unknown>
): TenantSummary | null => {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;

  return {
    id,
    nome: typeof payload.nome === "string" ? payload.nome.trim() : "",
    sigla: typeof payload.sigla === "string" ? payload.sigla.trim() : "",
    slug:
      typeof payload.slug === "string" && payload.slug.trim()
        ? payload.slug.trim().toLowerCase()
        : tenantSlug,
    faculdade:
      typeof payload.faculdade === "string" ? payload.faculdade.trim() : "",
    cidade: typeof payload.cidade === "string" ? payload.cidade.trim() : "",
    curso: typeof payload.curso === "string" ? payload.curso.trim() : "",
    area: typeof payload.area === "string" ? payload.area.trim() : "",
    cnpj: typeof payload.cnpj === "string" ? payload.cnpj.trim() : "",
    contatoEmail:
      typeof payload.contatoEmail === "string" ? payload.contatoEmail.trim() : "",
    contatoTelefone:
      typeof payload.contatoTelefone === "string"
        ? payload.contatoTelefone.trim()
        : "",
    logoUrl: typeof payload.logoUrl === "string" ? payload.logoUrl.trim() : "",
    paletteKey:
      typeof payload.paletteKey === "string" && payload.paletteKey.trim()
        ? (payload.paletteKey.trim().toLowerCase() as TenantSummary["paletteKey"])
        : "green",
    visibleInDirectory:
      typeof payload.visibleInDirectory === "boolean"
        ? payload.visibleInDirectory
        : true,
    allowPublicSignup:
      typeof payload.allowPublicSignup === "boolean"
        ? payload.allowPublicSignup
        : true,
    status:
      payload.status === "inactive" || payload.status === "blocked"
        ? payload.status
        : "active",
    createdAt:
      typeof payload.createdAt === "string" ? payload.createdAt : "",
    updatedAt:
      typeof payload.updatedAt === "string" ? payload.updatedAt : "",
  };
};

const fetchTenantFromPublicApi = async (
  tenantSlug: string
): Promise<TenantSummary | null> => {
  const response = await fetch(
    `/api/public/tenants?slug=${encodeURIComponent(tenantSlug)}`,
    { cache: "no-store" }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Falha ao carregar tenant publico (${response.status}) para slug ${tenantSlug}.`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return mapPublicTenantPayload(tenantSlug, payload);
};

export async function fetchPublicTenantBySlugCached(
  tenantSlugRaw: string
): Promise<TenantSummary | null> {
  const tenantSlug = normalizeTenantSlug(tenantSlugRaw);
  if (!tenantSlug) return null;

  const cached = getCachedTenant(tenantSlug);
  if (cached !== undefined) return cached;

  const pending = pendingLookups.get(tenantSlug);
  if (pending) return pending;

  const lookupPromise = (async () => {
    const staleEntry = tenantCache.get(tenantSlug)?.value ?? null;

    try {
      const directTenant = await fetchTenantBySlug(tenantSlug);
      if (directTenant) {
        setCachedTenant(tenantSlug, directTenant);
        return directTenant;
      }
    } catch {
      // fallback para API publica logo abaixo
    }

    try {
      const publicTenant = await fetchTenantFromPublicApi(tenantSlug);
      setCachedTenant(tenantSlug, publicTenant);
      return publicTenant;
    } catch {
      try {
        const fallbackTenant = await fetchTenantBySlug(tenantSlug);
        setCachedTenant(tenantSlug, fallbackTenant);
        return fallbackTenant;
      } catch {
        if (staleEntry !== null) {
          setCachedTenant(tenantSlug, staleEntry);
          return staleEntry;
        }
        return null;
      }
    } finally {
      pendingLookups.delete(tenantSlug);
    }
  })();

  pendingLookups.set(tenantSlug, lookupPromise);
  return lookupPromise;
}

export async function fetchPublicTenantIdBySlugCached(
  tenantSlug: string
): Promise<string> {
  const tenant = await fetchPublicTenantBySlugCached(tenantSlug);
  return tenant?.id?.trim() || "";
}
