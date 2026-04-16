import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { PublicEventTicketCard } from "@/components/PublicEventTicketCard";
import { fetchPublicEventTicketView } from "@/lib/publicEventTickets";

export default async function TenantPublicEventTicketPage({
  params,
}: {
  params: Promise<{ tenant: string; orderId: string; ticketToken: string }>;
}) {
  const { tenant, orderId, ticketToken } = await params;
  const ticketView = await fetchPublicEventTicketView(orderId, ticketToken);
  if (!ticketView) {
    notFound();
  }

  const headerList = await headers();
  const protocol = headerList.get("x-forwarded-proto") || "https";
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
  const qrValue = host
    ? `${protocol}://${host}/${encodeURIComponent(tenant)}/public/ingressos/${encodeURIComponent(orderId)}/${encodeURIComponent(ticketToken)}`
    : `/${encodeURIComponent(tenant)}/public/ingressos/${encodeURIComponent(orderId)}/${encodeURIComponent(ticketToken)}`;

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
