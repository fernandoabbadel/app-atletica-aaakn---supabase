import AdminEventWorkspace from "../../_components/AdminEventWorkspace";

export default function AdminEventEnquetesPage({
  params,
}: {
  params: { id: string };
}) {
  return <AdminEventWorkspace eventId={decodeURIComponent(params.id)} section="enquetes" />;
}
