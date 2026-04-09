import { LigasAdminPageContent } from "../../../ligas/page";

interface TenantLigasInformacoesPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantLigasInformacoesPage({
  params,
}: TenantLigasInformacoesPageProps) {
  await params;
  return <LigasAdminPageContent initialTab="visual" />;
}
