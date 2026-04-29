import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventRecebedoresPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="recebedores" />;
}
