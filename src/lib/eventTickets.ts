import {
  type CommercePaymentConfig,
  type CommerceTicketEntry,
  normalizePaymentConfig,
} from "./commerceCatalog";
import { withTenantSlug } from "./tenantRouting";

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const buildRandomToken = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const buildEventTicketPublicPath = (options: {
  orderId: string;
  ticketToken: string;
  tenantSlug?: string | null;
}): string => {
  const basePath = `/public/ingressos/${encodeURIComponent(options.orderId)}/${encodeURIComponent(options.ticketToken)}`;
  return options.tenantSlug?.trim()
    ? withTenantSlug(options.tenantSlug.trim(), basePath)
    : basePath;
};

export const parseEventTicketQrPayload = (
  value: string
): { orderId: string; ticketToken: string } | null => {
  const raw = value.trim();
  if (!raw) return null;

  const extractFromPath = (pathname: string): { orderId: string; ticketToken: string } | null => {
    const match = pathname.match(/\/public\/ingressos\/([^/]+)\/([^/]+)/i);
    if (!match) return null;
    return {
      orderId: decodeURIComponent(match[1] || "").trim(),
      ticketToken: decodeURIComponent(match[2] || "").trim(),
    };
  };

  try {
    const url = new URL(raw);
    return extractFromPath(url.pathname);
  } catch {
    return extractFromPath(raw);
  }
};

export const createEventTicketEntries = (options: {
  orderId: string;
  quantity: number;
  eventId?: string | null;
  eventTitle?: string | null;
  loteName?: string | null;
  holderName?: string | null;
  holderTurma?: string | null;
  existing?: CommerceTicketEntry[];
}): CommerceTicketEntry[] => {
  const orderId = asString(options.orderId);
  const quantity = Math.max(1, Math.floor(options.quantity || 1));
  const existing = Array.isArray(options.existing) ? options.existing : [];

  return Array.from({ length: quantity }, (_, index) => {
    const unitIndex = index + 1;
    const previous =
      existing.find((entry) => Number(entry.unitIndex || 0) === unitIndex) ||
      existing[index] ||
      null;
    const ticketId = asString(previous?.id) || `${orderId}:${unitIndex}`;
    const ticketToken = asString(previous?.token) || buildRandomToken();

    return {
      id: ticketId,
      token: ticketToken,
      label: asString(previous?.label) || `Ingresso ${unitIndex}`,
      unitIndex,
      status: previous?.status === "lido" ? "lido" : "ativo",
      ...(orderId ? { orderId } : {}),
      ...(orderId ? { orderCode: orderId.slice(0, 8).toUpperCase() } : {}),
      ...(asString(options.eventId) ? { eventId: asString(options.eventId) } : {}),
      ...(asString(options.eventTitle) ? { eventTitle: asString(options.eventTitle) } : {}),
      ...(asString(options.loteName) ? { loteName: asString(options.loteName) } : {}),
      ...(asString(options.holderName) ? { holderName: asString(options.holderName) } : {}),
      ...(asString(options.holderTurma) ? { holderTurma: asString(options.holderTurma) } : {}),
      ...(previous?.scannedAt ? { scannedAt: previous.scannedAt } : {}),
      ...(previous?.scannedByUserId ? { scannedByUserId: previous.scannedByUserId } : {}),
      ...(previous?.scannedByUserName ? { scannedByUserName: previous.scannedByUserName } : {}),
      ...(previous?.scannedByUserTurma
        ? { scannedByUserTurma: previous.scannedByUserTurma }
        : {}),
    } satisfies CommerceTicketEntry;
  });
};

export const ensureEventTicketEntries = (options: {
  paymentConfig?: CommercePaymentConfig | null;
  orderId: string;
  quantity: number;
  eventId?: string | null;
  eventTitle?: string | null;
  loteName?: string | null;
  holderName?: string | null;
  holderTurma?: string | null;
}): CommercePaymentConfig => {
  const paymentConfig = normalizePaymentConfig(options.paymentConfig) ?? {
    chave: "",
    banco: "",
    titular: "",
  };

  return {
    chave: paymentConfig.chave,
    banco: paymentConfig.banco,
    titular: paymentConfig.titular,
    ...(paymentConfig.whatsapp ? { whatsapp: paymentConfig.whatsapp } : {}),
    ...(paymentConfig.recipient ? { recipient: paymentConfig.recipient } : {}),
    ...(paymentConfig.recipients?.length ? { recipients: paymentConfig.recipients } : {}),
    ticketEntries: createEventTicketEntries({
      orderId: options.orderId,
      quantity: options.quantity,
      eventId: options.eventId,
      eventTitle: options.eventTitle,
      loteName: options.loteName,
      holderName: options.holderName,
      holderTurma: options.holderTurma,
      existing: paymentConfig.ticketEntries,
    }),
  };
};

export const findEventTicketEntry = (
  paymentConfig: CommercePaymentConfig | null | undefined,
  ticketToken: string
): CommerceTicketEntry | null => {
  const cleanToken = ticketToken.trim();
  if (!cleanToken) return null;
  const ticketEntries = normalizePaymentConfig(paymentConfig)?.ticketEntries || [];
  return ticketEntries.find((entry) => entry.token === cleanToken) || null;
};
