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

export const buildTenantFinanceFallback = (options?: {
  tenantSigla?: string | null;
  tenantName?: string | null;
}): TenantFinanceFallback => ({
  chave: "financeiro@atletica.com.br",
  banco: "Banco da Atletica",
  titular: resolveTenantBrandLabel(options?.tenantSigla, options?.tenantName),
  whatsapp: "",
});

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
    `Fala, equipe [${organizerLabel}]! Quero garantir meu lugar no ${eventTitle}.`,
    "",
    `[NOME] ${buyerName}`,
    `[TURMA] ${buyerTurma}`,
    `[CONTATO] ${buyerPhone}`,
    `[INGRESSO] ${ticketLabel}`,
    `[VALOR] Valor Total: R$ ${totalValue}`,
    `[PEDIDO] Pedido: ${orderCode}`,
    "",
    "Segue o comprovante!",
  ].join("\n");
};
