import AdminEventWorkspace from "../_components/AdminEventWorkspace";

export default function AdminEventHomePage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="extrato" />;
}
