import { parseEventTicketQrPayload } from "./eventTickets";

const QR_USER_ID_PATTERN = /^[A-Za-z0-9_-]{24,80}$/;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const readPayloadCandidate = (rawValue: string): string => {
  const raw = rawValue.trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return (
      url.searchParams.get("treinoQr") ||
      url.searchParams.get("payload") ||
      url.searchParams.get("qr") ||
      raw
    ).trim();
  } catch {
    return raw;
  }
};

const readUrlUserId = (rawValue: string): string => {
  try {
    const url = new URL(rawValue.trim());
    for (const key of ["uid", "userId", "targetUid", "id"]) {
      const value = url.searchParams.get(key)?.trim() || "";
      if (QR_USER_ID_PATTERN.test(value)) return value;
    }

    const lastPath = url.pathname.split("/").filter(Boolean).pop()?.trim() || "";
    return QR_USER_ID_PATTERN.test(lastPath) ? lastPath : "";
  } catch {
    return "";
  }
};

export type TreinoPresenceQrPayload = {
  kind: "treino-presenca";
  treinoId: string;
  userId: string;
  userName: string;
  userTurma: string;
  userAvatar: string;
  tenantId: string;
};

export type EventTicketQrPayload = {
  kind: "evento-ingresso";
  orderId: string;
  ticketToken: string;
};

export type UserIdentityQrPayload = {
  kind: "usuario";
  userId: string;
  userName: string;
  userTurma: string;
  userAvatar: string;
  tenantId: string;
};

export type KnownAppQrPayload =
  | TreinoPresenceQrPayload
  | EventTicketQrPayload
  | UserIdentityQrPayload;

export const buildTreinoPresenceQrPayload = (payload: {
  treinoId: string;
  tenantId?: string | null;
  userId: string;
  userName?: string | null;
  userTurma?: string | null;
  userAvatar?: string | null;
}): string =>
  JSON.stringify({
    t: "treino-presenca",
    v: 1,
    tid: payload.treinoId,
    ten: payload.tenantId || "",
    uid: payload.userId,
    n: payload.userName || "Atleta",
    tu: payload.userTurma || "Geral",
    av: payload.userAvatar || "",
    ts: Date.now(),
  });

export const buildUserIdentityQrPayload = (payload: {
  userId: string;
  tenantId?: string | null;
  userName?: string | null;
  userTurma?: string | null;
  userAvatar?: string | null;
}): string =>
  JSON.stringify({
    t: "usuario",
    v: 1,
    uid: payload.userId,
    ten: payload.tenantId || "",
    n: payload.userName || "",
    tu: payload.userTurma || "",
    av: payload.userAvatar || "",
  });

export const parseTreinoPresenceQrPayload = (
  rawPayload: string
): TreinoPresenceQrPayload | null => {
  const candidate = readPayloadCandidate(rawPayload);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const type = asString(parsed.t || parsed.type || parsed.kind);
    const treinoId = asString(parsed.tid || parsed.treinoId);
    const userId = asString(parsed.uid || parsed.userId);

    if (type && type !== "treino-presenca" && type !== "training-presence") return null;
    if (!treinoId || !userId) return null;

    return {
      kind: "treino-presenca",
      treinoId,
      userId,
      userName: asString(parsed.n || parsed.userName || parsed.nome) || "Atleta",
      userTurma: asString(parsed.tu || parsed.userTurma || parsed.turma) || "Geral",
      userAvatar: asString(parsed.av || parsed.userAvatar || parsed.avatar),
      tenantId: asString(parsed.ten || parsed.tenantId),
    };
  } catch {
    return null;
  }
};

export const parseUserIdentityQrPayload = (
  rawPayload: string
): UserIdentityQrPayload | null => {
  const raw = rawPayload.trim();
  if (!raw) return null;

  const candidate = readPayloadCandidate(raw);
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const type = asString(parsed.t || parsed.type || parsed.kind);
    const userId = asString(parsed.uid || parsed.userId || parsed.targetUid || parsed.id);

    if (type && !["usuario", "user", "album-user", "identity"].includes(type)) return null;
    if (!QR_USER_ID_PATTERN.test(userId)) return null;

    return {
      kind: "usuario",
      userId,
      userName: asString(parsed.n || parsed.userName || parsed.nome),
      userTurma: asString(parsed.tu || parsed.userTurma || parsed.turma),
      userAvatar: asString(parsed.av || parsed.userAvatar || parsed.avatar),
      tenantId: asString(parsed.ten || parsed.tenantId),
    };
  } catch {
    // QR antigo de usuario ainda pode ser apenas o uid.
  }

  if (QR_USER_ID_PATTERN.test(raw)) {
    return {
      kind: "usuario",
      userId: raw,
      userName: "",
      userTurma: "",
      userAvatar: "",
      tenantId: "",
    };
  }

  const userId = readUrlUserId(raw);
  return userId
    ? {
        kind: "usuario",
        userId,
        userName: "",
        userTurma: "",
        userAvatar: "",
        tenantId: "",
      }
    : null;
};

const parseStructuredEventTicketQrPayload = (
  rawPayload: string
): EventTicketQrPayload | null => {
  const candidate = readPayloadCandidate(rawPayload);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const type = asString(parsed.t || parsed.type || parsed.kind);
    const orderId = asString(parsed.orderId || parsed.pedidoId);
    const ticketToken = asString(parsed.ticketToken || parsed.token);
    if (!["evento-ingresso", "event-ticket", "ingresso-evento"].includes(type)) return null;
    if (!orderId || !ticketToken) return null;

    return {
      kind: "evento-ingresso",
      orderId,
      ticketToken,
    };
  } catch {
    return null;
  }
};

export const parseKnownAppQrPayload = (rawPayload: string): KnownAppQrPayload | null => {
  const eventTicket = parseEventTicketQrPayload(rawPayload);
  if (eventTicket) {
    return {
      kind: "evento-ingresso",
      orderId: eventTicket.orderId,
      ticketToken: eventTicket.ticketToken,
    };
  }

  return (
    parseStructuredEventTicketQrPayload(rawPayload) ||
    parseTreinoPresenceQrPayload(rawPayload) ||
    parseUserIdentityQrPayload(rawPayload)
  );
};
