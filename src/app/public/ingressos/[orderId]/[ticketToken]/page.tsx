import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { PublicEventTicketCard } from "@/components/PublicEventTicketCard";
import { fetchPublicEventTicketView } from "@/lib/publicEventTickets";

export default async function PublicEventTicketPage({
  params,
}: {
  params: Promise<{ orderId: string; ticketToken: string }>;
}) {
  const { orderId, ticketToken } = await params;
  const ticketView = await fetchPublicEventTicketView(orderId, ticketToken);
  if (!ticketView) {
    notFound();
  }

  const headerList = await headers();
  const protocol = headerList.get("x-forwarded-proto") || "https";
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
  const qrValue = host
    ? `${protocol}://${host}/public/ingressos/${encodeURIComponent(orderId)}/${encodeURIComponent(ticketToken)}`
    : `/public/ingressos/${encodeURIComponent(orderId)}/${encodeURIComponent(ticketToken)}`;

  return (
    <PublicEventTicketCard
      qrValue={qrValue}
      imageUrl={ticketView.eventImage}
      eventTitle={ticketView.eventTitle}
      eventDateLabel={ticketView.eventDateLabel}
      eventLocation={ticketView.eventLocation}
      loteName={ticketView.loteName}
      holderName={ticketView.holderName}
      holderTurma={ticketView.holderTurma}
      ticketCode={ticketView.ticketCode}
      status={ticketView.status}
    />
  );
}
