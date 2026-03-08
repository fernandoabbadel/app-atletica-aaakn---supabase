import PublicLandingPage from "@/app/components/PublicLandingPage";

type TenantPageProps = {
  params: Promise<{ tenant: string }>;
};

export default async function TenantLandingPage({ params }: TenantPageProps) {
  const { tenant } = await params;
  return <PublicLandingPage tenantSlugOverride={tenant} />;
}
