import { LigasAdminPageContent } from "../../ligas/page";

interface TenantLigasPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantLigasPage({ params }: TenantLigasPageProps) {
  await params;
  return <LigasAdminPageContent initialTab="visual" />;
}
