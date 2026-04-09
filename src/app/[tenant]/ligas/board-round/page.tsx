import { LigasAdminPageContent } from "../../../ligas/page";

interface TenantLigasBoardRoundPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantLigasBoardRoundPage({
  params,
}: TenantLigasBoardRoundPageProps) {
  await params;
  return <LigasAdminPageContent initialTab="shark" />;
}
