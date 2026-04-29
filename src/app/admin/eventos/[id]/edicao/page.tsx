import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventEdicaoPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="edicao" />;
}
