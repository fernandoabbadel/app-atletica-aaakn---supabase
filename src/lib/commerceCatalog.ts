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

export type CommerceTicketStatus = "ativo" | "lido";

export interface CommercePaymentRecipient {
  userId?: string;
  name: string;
  turma: string;
  avatarUrl: string;
  phone: string;
}

export interface CommerceTicketEntry {
  id: string;
  token: string;
  label: string;
  unitIndex: number;
  status: CommerceTicketStatus;
  orderId?: string;
  orderCode?: string;
  eventId?: string;
  eventTitle?: string;
  loteName?: string;
  holderName?: string;
  holderTurma?: string;
  scannedAt?: string;
  scannedByUserId?: string;
  scannedByUserName?: string;
  scannedByUserTurma?: string;
}

export interface CommercePaymentConfig {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
  recipient?: CommercePaymentRecipient;
  recipients?: CommercePaymentRecipient[];
  ticketEntries?: CommerceTicketEntry[];
}

export interface CommerceSellerSnapshot {
  type: "tenant" | "mini_vendor" | "league";
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

const normalizeOptionalPrice = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
    return null;
  }
  return null;
};

const normalizeTicketStatus = (value: unknown): CommerceTicketStatus => {
  const status = normalizeString(value).toLowerCase();
  return status === "lido" ? "lido" : "ativo";
};

const normalizePaymentRecipient = (
  value: unknown
): CommercePaymentRecipient | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const userId = normalizeString(row.userId || row.uid || row.id);
  const name = normalizeString(row.name || row.nome || row.userName);
  const turma = normalizeString(row.turma || row.userTurma || row.className);
  const avatarUrl = normalizeString(
    row.avatarUrl || row.foto || row.photoUrl || row.userAvatar
  );
  const phone = normalizeString(
    row.phone || row.telefone || row.whatsapp || row.userPhone
  );

  if (!userId && !name && !turma && !avatarUrl && !phone) return null;

  return {
    ...(userId ? { userId } : {}),
    name,
    turma,
    avatarUrl,
    phone,
  };
};

const normalizePaymentRecipients = (value: unknown): CommercePaymentRecipient[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .map((entry) => normalizePaymentRecipient(entry))
    .filter((entry): entry is CommercePaymentRecipient => entry !== null)
    .filter((entry) => {
      const key = [
        entry.userId,
        entry.name,
        entry.turma,
        entry.phone,
      ]
        .map((part) => normalizeString(part).toLowerCase())
        .join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeTicketEntries = (value: unknown): CommerceTicketEntry[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const token = normalizeString(row.token || row.ticketToken);
      const unitIndexRaw = Number(row.unitIndex ?? row.index ?? index + 1);
      const unitIndex =
        Number.isFinite(unitIndexRaw) && unitIndexRaw > 0
          ? Math.floor(unitIndexRaw)
          : index + 1;
      const id =
        normalizeString(row.id || row.ticketId) || `${token || "ticket"}-${unitIndex}`;
      if (!token && !id) return null;

      return {
        id,
        token: token || id,
        label: normalizeString(row.label) || `Ingresso ${unitIndex}`,
        unitIndex,
        status: normalizeTicketStatus(row.status),
        ...(normalizeString(row.orderId) ? { orderId: normalizeString(row.orderId) } : {}),
        ...(normalizeString(row.orderCode) ? { orderCode: normalizeString(row.orderCode) } : {}),
        ...(normalizeString(row.eventId) ? { eventId: normalizeString(row.eventId) } : {}),
        ...(normalizeString(row.eventTitle) ? { eventTitle: normalizeString(row.eventTitle) } : {}),
        ...(normalizeString(row.loteName) ? { loteName: normalizeString(row.loteName) } : {}),
        ...(normalizeString(row.holderName) ? { holderName: normalizeString(row.holderName) } : {}),
        ...(normalizeString(row.holderTurma) ? { holderTurma: normalizeString(row.holderTurma) } : {}),
        ...(normalizeString(row.scannedAt) ? { scannedAt: normalizeString(row.scannedAt) } : {}),
        ...(normalizeString(row.scannedByUserId)
          ? { scannedByUserId: normalizeString(row.scannedByUserId) }
          : {}),
        ...(normalizeString(row.scannedByUserName)
          ? { scannedByUserName: normalizeString(row.scannedByUserName) }
          : {}),
        ...(normalizeString(row.scannedByUserTurma)
          ? { scannedByUserTurma: normalizeString(row.scannedByUserTurma) }
          : {}),
      } satisfies CommerceTicketEntry;
    })
    .filter((entry): entry is CommerceTicketEntry => entry !== null);
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
      const price = normalizeOptionalPrice(row.price ?? row.preco);
      if (price === null) return null;

      return {
        planId,
        planName,
        price,
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
  const recipient =
    normalizePaymentRecipient(row.recipient) ||
    normalizePaymentRecipient({
      userId: row.recipientUserId,
      name: row.recipientUserName || row.recipientName,
      turma: row.recipientUserTurma || row.recipientTurma,
      avatarUrl: row.recipientUserAvatar || row.recipientAvatarUrl,
      phone: row.recipientUserPhone || row.recipientPhone || row.whatsapp,
    });
  const recipients = normalizePaymentRecipients(
    row.recipients || row.paymentRecipients || row.receivers
  );
  const ticketEntries = normalizeTicketEntries(
    row.ticketEntries || row.tickets || row.ingressos
  );

  if (
    !chave &&
    !banco &&
    !titular &&
    !whatsapp &&
    !recipient &&
    recipients.length === 0 &&
    ticketEntries.length === 0
  ) {
    return null;
  }

  return {
    chave,
    banco,
    titular,
    ...(whatsapp ? { whatsapp } : {}),
    ...(recipient ? { recipient } : {}),
    ...(recipients.length > 0 ? { recipients } : {}),
    ...(ticketEntries.length > 0 ? { ticketEntries } : {}),
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
    type: typeRaw === "mini_vendor" ? "mini_vendor" : typeRaw === "league" ? "league" : "tenant",
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
