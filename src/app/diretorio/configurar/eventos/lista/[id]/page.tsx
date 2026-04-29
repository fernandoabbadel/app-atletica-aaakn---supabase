import { DirectoryManagementEventPresencePage } from "@/components/collectives/DirectoryManagementPages";

export default async function DiretorioConfigurarEventosListaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DirectoryManagementEventPresencePage eventId={id} />;
}
