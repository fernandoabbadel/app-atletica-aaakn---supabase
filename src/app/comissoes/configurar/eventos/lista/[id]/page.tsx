import { CommissionManagementEventPresencePage } from "@/components/collectives/CommissionManagementPages";

export default async function ComissoesConfigurarEventosListaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommissionManagementEventPresencePage eventId={id} />;
}
