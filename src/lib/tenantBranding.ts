import type { CommercePaymentConfig } from "./commerceCatalog";

const cleanString = (value?: string | null): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeTextToken = (value?: string | null): string =>
  cleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const extractBracketPrefixedTitle = (
  value?: string | null
): { prefix: string; title: string } => {
  const raw = cleanString(value);
  if (!raw) return { prefix: "", title: "" };

  const match = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) return { prefix: "", title: raw };

  return {
    prefix: cleanString(match[1]).toUpperCase(),
    title: cleanString(match[2]) || raw,
  };
};

export const resolveTenantBrandLabel = (
  tenantSigla?: string | null,
  tenantName?: string | null
): string => {
  const sigla = cleanString(tenantSigla);
  if (sigla) return sigla.toUpperCase();

  const name = cleanString(tenantName);
  if (name) return name;

  return "Atletica";
};

export interface TenantFinanceFallback {
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
}

export interface ReceiptContactProfile {
  userId: string;
  name: string;
  turma: string;
  avatarUrl: string;
  phone: string;
}

export const buildTenantFinanceFallback = (options?: {
  tenantSigla?: string | null;
  tenantName?: string | null;
}): TenantFinanceFallback => ({
  chave: "financeiro@atletica.com.br",
  banco: "Banco da Atletica",
  titular: resolveTenantBrandLabel(options?.tenantSigla, options?.tenantName),
  whatsapp: "",
});

export const resolveReceiptContactProfile = (options: {
  paymentConfig?: CommercePaymentConfig | null;
  tenantSigla?: string | null;
  tenantName?: string | null;
  fallbackAvatarUrl?: string | null;
  fallbackPhone?: string | null;
}): ReceiptContactProfile => {
  const paymentConfig = options.paymentConfig;
  const recipient = paymentConfig?.recipient;
  const tenantLabel = resolveTenantBrandLabel(options.tenantSigla, options.tenantName);

  return {
    userId: cleanString(recipient?.userId),
    name: cleanString(recipient?.name) || tenantLabel,
    turma: cleanString(recipient?.turma) || "Financeiro",
    avatarUrl:
      cleanString(recipient?.avatarUrl) ||
      cleanString(options.fallbackAvatarUrl) ||
      "/logo.png",
    phone:
      cleanString(paymentConfig?.whatsapp) ||
      cleanString(recipient?.phone) ||
      cleanString(options.fallbackPhone),
  };
};

const buildReceiptTargetBlock = (recipientName?: string | null, recipientTurma?: string | null): string[] => {
  const cleanRecipientName = cleanString(recipientName) || "Financeiro";
  const cleanRecipientTurma = cleanString(recipientTurma) || "Sem turma";
  return ["Enviado para", cleanRecipientName, cleanRecipientTurma];
};

export const buildProductReceiptWhatsappMessage = (options: {
  organizerLabel?: string | null;
  productName?: string | null;
  buyerName?: string | null;
  buyerTurma?: string | null;
  buyerPhone?: string | null;
  quantity?: number | string | null;
  color?: string | null;
  totalValue?: string | number | null;
  orderCode?: string | null;
  recipientName?: string | null;
  recipientTurma?: string | null;
}): string => {
  const organizerLabel = cleanString(options.organizerLabel) || "Atletica";
  const productName = cleanString(options.productName).replace(/[.!?]+$/g, "") || "produto";
  const buyerName = cleanString(options.buyerName) || "Aluno";
  const buyerTurma = cleanString(options.buyerTurma) || "Sem turma";
  const buyerPhone = cleanString(options.buyerPhone) || "Nao informado";
  const quantity =
    typeof options.quantity === "number"
      ? String(Math.max(1, Math.floor(options.quantity)))
      : cleanString(String(options.quantity ?? "")) || "1";
  const color = cleanString(options.color);
  const totalValue =
    typeof options.totalValue === "number"
      ? options.totalValue.toFixed(2)
      : cleanString(String(options.totalValue ?? "")) || "0.00";
  const orderCode = cleanString(options.orderCode) || "Nao informado";

  return [
    `Fala, equipe *${organizerLabel}*! Quero finalizar a compra do produto ${productName}.`,
    "",
    `*CLIENTE:* ${buyerName}`,
    `*TURMA:* ${buyerTurma}`,
    `*CONTATO:* ${buyerPhone}`,
    `*PRODUTO:* ${productName}`,
    `*QTD:* ${quantity}`,
    ...(color ? [`*COR:* ${color}`] : []),
    `*VALOR:* R$ ${totalValue}`,
    `*PEDIDO:* ${orderCode}`,
    "",
    "Segue o comprovante do PIX!",
    ...buildReceiptTargetBlock(options.recipientName, options.recipientTurma),
  ].join("\n");
};

export const buildEventReceiptWhatsappMessage = (options: {
  tenantSigla?: string | null;
  tenantName?: string | null;
  eventTitle?: string | null;
  eventType?: string | null;
  eventCategory?: string | null;
  buyerName?: string | null;
  buyerTurma?: string | null;
  buyerPhone?: string | null;
  ticketLabel?: string | null;
  totalValue?: string | number | null;
  orderCode?: string | null;
  recipientName?: string | null;
  recipientTurma?: string | null;
}): string => {
  const tenantLabel = resolveTenantBrandLabel(options.tenantSigla, options.tenantName);
  const titleParts = extractBracketPrefixedTitle(options.eventTitle);
  const isLeagueEvent =
    normalizeTextToken(options.eventType) === "liga" ||
    normalizeTextToken(options.eventCategory) === "liga";
  const organizerLabel =
    isLeagueEvent && titleParts.prefix ? titleParts.prefix : tenantLabel;
  const eventTitle =
    (isLeagueEvent ? titleParts.title : cleanString(options.eventTitle || titleParts.title)).replace(
      /[.!?]+$/g,
      ""
    ) || "evento";
  const buyerName = cleanString(options.buyerName) || "Aluno";
  const buyerTurma = cleanString(options.buyerTurma) || "Sem turma";
  const buyerPhone = cleanString(options.buyerPhone) || "Nao informado";
  const ticketLabel = cleanString(options.ticketLabel) || "1x Ingresso";
  const totalValue =
    typeof options.totalValue === "number"
      ? options.totalValue.toFixed(2)
      : cleanString(String(options.totalValue ?? "")) || "0.00";
  const orderCode = cleanString(options.orderCode) || "Nao informado";

  return [
    `Fala, equipe *${organizerLabel}*! Quero garantir meu lugar no evento ${eventTitle}.`,
    "",
    `*NOME:* ${buyerName}`,
    `*TURMA:* ${buyerTurma}`,
    `*CONTATO:* ${buyerPhone}`,
    `*INGRESSO:* ${ticketLabel}`,
    `*VALOR TOTAL:* R$ ${totalValue}`,
    `*PEDIDO:* ${orderCode}`,
    "",
    "Segue o comprovante!",
    ...buildReceiptTargetBlock(options.recipientName, options.recipientTurma),
  ].join("\n");
};
