import { LigasAdminPageContent } from "../../../ligas/page";

interface TenantLigasMembrosPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantLigasMembrosPage({
  params,
}: TenantLigasMembrosPageProps) {
  await params;
  return <LigasAdminPageContent initialTab="members" />;
}
