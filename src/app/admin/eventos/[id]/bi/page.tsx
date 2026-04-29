import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventBiPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="bi" />;
}
