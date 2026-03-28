import { LojaPageContent } from "../../loja/LojaPageContent";

interface TenantLojaPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export const revalidate = 60;

export default async function TenantLojaPage({ params }: TenantLojaPageProps) {
  const { tenant } = await params;
  return <LojaPageContent tenantSlugOverride={tenant} />;
}
