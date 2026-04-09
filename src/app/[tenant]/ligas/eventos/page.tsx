import { LigasAdminPageContent } from "../../../ligas/page";

interface TenantLigasEventosPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantLigasEventosPage({
  params,
}: TenantLigasEventosPageProps) {
  await params;
  return <LigasAdminPageContent initialTab="events" />;
}
