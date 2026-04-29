import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventLotesPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="lotes" />;
}
