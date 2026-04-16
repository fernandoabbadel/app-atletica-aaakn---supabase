import { normalizePaymentConfig } from "./commerceCatalog";
import { findEventTicketEntry } from "./eventTickets";
import { supabaseAdmin } from "./supabaseAdmin";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export interface PublicEventTicketView {
  orderId: string;
  eventId: string;
  eventTitle: string;
  eventDateLabel: string;
  eventLocation: string;
  eventImage: string;
  loteName: string;
  holderName: string;
  holderTurma: string;
  ticketCode: string;
  status: "ativo" | "lido";
}

export async function fetchPublicEventTicketView(
  orderId: string,
  ticketToken: string
): Promise<PublicEventTicketView | null> {
  const cleanOrderId = orderId.trim();
  const cleanTicketToken = ticketToken.trim();
  if (!cleanOrderId || !cleanTicketToken) return null;

  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("solicitacoes_ingressos")
    .select("id,eventoId,eventoNome,loteNome,userName,userTurma,payment_config")
    .eq("id", cleanOrderId)
    .maybeSingle();
  if (orderError) {
    throw new Error(orderError.message);
  }

  const order = asObject(orderRow);
  if (!order) return null;

  const paymentConfig = normalizePaymentConfig(order.payment_config);
  const ticketEntry = findEventTicketEntry(paymentConfig, cleanTicketToken);
  if (!ticketEntry) return null;

  const eventId = asString(order.eventoId) || asString(ticketEntry.eventId);
  let eventTitle = asString(order.eventoNome) || asString(ticketEntry.eventTitle) || "Evento";
  let eventDateLabel = "Data a confirmar";
  let eventLocation = "Local a confirmar";
  let eventImage = "/logo.png";

  if (eventId) {
    const { data: eventRow, error: eventError } = await supabaseAdmin
      .from("eventos")
      .select("titulo,data,hora,local,imagem")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) {
      throw new Error(eventError.message);
    }

    const event = asObject(eventRow);
    if (event) {
      eventTitle = asString(event.titulo) || eventTitle;
      const date = asString(event.data);
      const time = asString(event.hora);
      eventDateLabel = [date, time].filter(Boolean).join(" - ") || eventDateLabel;
      eventLocation = asString(event.local) || eventLocation;
      eventImage = asString(event.imagem) || eventImage;
    }
  }

  return {
    orderId: cleanOrderId,
    eventId,
    eventTitle,
    eventDateLabel,
    eventLocation,
    eventImage,
    loteName: asString(ticketEntry.loteName) || asString(order.loteNome) || ticketEntry.label,
    holderName: asString(ticketEntry.holderName) || asString(order.userName) || "Participante",
    holderTurma: asString(ticketEntry.holderTurma) || asString(order.userTurma) || "Sem turma",
    ticketCode: asString(ticketEntry.id) || `${cleanOrderId.slice(0, 8).toUpperCase()}-${ticketEntry.unitIndex}`,
    status: ticketEntry.status === "lido" ? "lido" : "ativo",
  };
}
