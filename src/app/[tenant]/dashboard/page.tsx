import { DashboardPageContent } from "../../dashboard/DashboardPageContent";

interface TenantDashboardPageProps {
  params: Promise<{
    tenant: string;
  }>;
}

export default async function TenantDashboardPage({ params }: TenantDashboardPageProps) {
  const { tenant } = await params;
  return <DashboardPageContent tenantSlugOverride={tenant} />;
}
