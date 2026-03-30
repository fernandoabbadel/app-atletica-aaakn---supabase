import TenantLandingEditor from "@/features/landing/TenantLandingEditor";

type TenantAdminLandingPageProps = {
  params: Promise<{ tenant: string }>;
};

export default async function TenantAdminLandingPage({
  params,
}: TenantAdminLandingPageProps) {
  const { tenant } = await params;
  return <TenantLandingEditor tenantSlug={tenant} />;
}
