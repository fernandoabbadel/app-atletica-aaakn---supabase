import EventosClientPage, { type Evento } from "./EventosClientPage";

export const revalidate = 60;

export default async function EventosPage() {
  return <EventosClientPage initialEventos={[] as Evento[]} />;
}
