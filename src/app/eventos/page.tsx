import { EventosPageContent } from "./EventosPageContent";

export const revalidate = 60;

export default async function EventosPage() {
  return <EventosPageContent />;
}
