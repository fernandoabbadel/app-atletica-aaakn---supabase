import { parseTenantScopedRowId } from "./tenantScopedCatalog";

export type CommerceAvailabilityStatus = "ativo" | "em_breve" | "esgotado";

export interface CommercePlanEntry {
  planId: string;
  planName: string;
}

export interface CommercePlanPriceEntry extends CommercePlanEntry {
  price: number;
}

export interface CommerceResolvedPlanPrice {
  basePrice: number;
  finalPrice: number;
  matchedEntry: CommercePlanPriceEntry | null;
}

export interface CommercePlanVisibilityEntry extends CommercePlanEntry {
  visible: boolean;
}

export interface CommercePaymentConfig {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
}

export interface CommerceSellerSnapshot {
  type: "tenant" | "mini_vendor";
  id: string;
  name: string;
  logoUrl: string;
}

const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizePlanName = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizePlanMatchToken = (value: string): string =>
  normalizePlanName(value).replace(/[^a-z0-9]+/g, "");

const normalizePrice = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
};

export const normalizeAvailabilityStatus = (
  value: unknown,
  fallback: CommerceAvailabilityStatus = "ativo"
): CommerceAvailabilityStatus => {
  const status = normalizeString(value).toLowerCase();
  if (status === "em_breve" || status === "esgotado") return status;
  if (status === "agendado") return "em_breve";
  if (status === "encerrado") return "esgotado";
  return fallback;
};

export const normalizePlanPriceEntries = (
  value: unknown
): CommercePlanPriceEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const planId = normalizeString(row.planId || row.id);
      const planName = normalizeString(row.planName || row.nome);
      if (!planId && !planName) return null;

      return {
        planId,
        planName,
        price: normalizePrice(row.price ?? row.preco),
      };
    })
    .filter((entry): entry is CommercePlanPriceEntry => entry !== null);
};

export const normalizePlanVisibilityEntries = (
  value: unknown
): CommercePlanVisibilityEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const planId = normalizeString(row.planId || row.id);
      const planName = normalizeString(row.planName || row.nome);
      if (!planId && !planName) return null;

      return {
        planId,
        planName,
        visible:
          typeof row.visible === "boolean"
            ? row.visible
            : normalizeAvailabilityStatus(row.visible, "ativo") === "ativo",
      };
    })
    .filter((entry): entry is CommercePlanVisibilityEntry => entry !== null);
};

export const normalizePaymentConfig = (
  value: unknown
): CommercePaymentConfig | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;

  const chave = normalizeString(row.chave);
  const banco = normalizeString(row.banco);
  const titular = normalizeString(row.titular);
  const whatsapp = normalizeString(row.whatsapp);

  if (!chave && !banco && !titular && !whatsapp) return null;

  return {
    chave,
    banco,
    titular,
    ...(whatsapp ? { whatsapp } : {}),
  };
};

export const normalizeSellerSnapshot = (
  value: unknown
): CommerceSellerSnapshot | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const typeRaw = normalizeString(row.type).toLowerCase();
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  const logoUrl = normalizeString(row.logoUrl);

  if (!id && !name && !logoUrl) return null;

  return {
    type: typeRaw === "mini_vendor" ? "mini_vendor" : "tenant",
    id,
    name,
    logoUrl,
  };
};

const addPlanMatchKeys = (keys: Set<string>, value: unknown): void => {
  const raw = normalizeString(value);
  if (!raw) return;

  const lowered = raw.toLowerCase();
  if (lowered) keys.add(lowered);

  const token = normalizePlanMatchToken(raw);
  if (token) keys.add(token);

  const baseId = parseTenantScopedRowId(raw).baseId;
  if (!baseId || baseId === raw) return;

  const loweredBaseId = baseId.toLowerCase();
  if (loweredBaseId) keys.add(loweredBaseId);

  const baseToken = normalizePlanMatchToken(baseId);
  if (baseToken) keys.add(baseToken);
};

const buildPlanReferenceKeys = (
  planIds?: string[],
  planNames?: string[]
): Set<string> => {
  const keys = new Set<string>();
  (planIds ?? []).forEach((value) => addPlanMatchKeys(keys, value));
  (planNames ?? []).forEach((value) => addPlanMatchKeys(keys, value));
  return keys;
};

const matchesPlanEntry = (
  entry: CommercePlanEntry,
  referenceKeys: ReadonlySet<string>
): boolean => {
  if (referenceKeys.size === 0) return false;

  const entryKeys = new Set<string>();
  addPlanMatchKeys(entryKeys, entry.planId);
  addPlanMatchKeys(entryKeys, entry.planName);

  for (const key of entryKeys) {
    if (referenceKeys.has(key)) return true;
  }

  return false;
};

export const resolvePlanScopedPriceInfo = (options: {
  basePrice: number;
  entries: CommercePlanPriceEntry[];
  userPlanIds?: string[];
  userPlanNames?: string[];
}): CommerceResolvedPlanPrice => {
  const referenceKeys = buildPlanReferenceKeys(
    options.userPlanIds,
    options.userPlanNames
  );

  const match = options.entries.find((entry) =>
    matchesPlanEntry(entry, referenceKeys)
  );

  return {
    basePrice: options.basePrice,
    finalPrice: match ? match.price : options.basePrice,
    matchedEntry: match ?? null,
  };
};

export const resolvePlanScopedPrice = (options: {
  basePrice: number;
  entries: CommercePlanPriceEntry[];
  userPlanIds?: string[];
  userPlanNames?: string[];
}): number => {
  return resolvePlanScopedPriceInfo(options).finalPrice;
};

export const canAccessCommerceItem = (options: {
  entries: CommercePlanVisibilityEntry[];
  userPlanIds?: string[];
  userPlanNames?: string[];
}): boolean => {
  if (options.entries.length === 0) return true;

  const referenceKeys = buildPlanReferenceKeys(
    options.userPlanIds,
    options.userPlanNames
  );

  if (referenceKeys.size === 0) {
    return options.entries.some((entry) => entry.visible);
  }

  const match = options.entries.find((entry) =>
    matchesPlanEntry(entry, referenceKeys)
  );

  if (match) return match.visible;

  // Se todas as entradas estiverem liberadas, nao escondemos o item por uma
  // simples divergencia historica de nome/slug do plano.
  return options.entries.every((entry) => entry.visible);
};
