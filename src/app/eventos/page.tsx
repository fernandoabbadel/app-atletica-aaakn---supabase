import EventosClientPage, { type Evento } from "./EventosClientPage";
import { fetchEventsFeed } from "../../lib/eventsNativeService";
import { serializeForClient } from "../../lib/clientSerialization";

export const revalidate = 60;

export default async function EventosPage() {
  let initialEventos: Evento[] = [];

  try {
    const rows = await fetchEventsFeed({ maxResults: 24, forceRefresh: false });
    initialEventos = serializeForClient(rows as unknown as Evento[]);
  } catch {
    initialEventos = [];
  }

  return <EventosClientPage initialEventos={initialEventos} />;
}
