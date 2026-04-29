import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventCuponsPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="cupons" />;
}
