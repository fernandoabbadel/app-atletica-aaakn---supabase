import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default async function AdminEventBiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AdminEventWorkspace eventId={decodeURIComponent(id)} section="bi" />;
}
