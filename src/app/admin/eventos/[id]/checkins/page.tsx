import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventCheckinsPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="checkins" />;
}
