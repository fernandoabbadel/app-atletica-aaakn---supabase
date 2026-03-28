import { EventosPageContent } from "../../eventos/EventosPageContent";

interface TenantEventosPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export const revalidate = 60;

export default async function TenantEventosPage({ params }: TenantEventosPageProps) {
  const { tenant } = await params;
  return <EventosPageContent tenantSlugOverride={tenant} />;
}
