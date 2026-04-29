import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventIngressosPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="ingressos" />;
}
