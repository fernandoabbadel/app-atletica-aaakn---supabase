import { LigaEventPresencePage } from "@/app/ligas/_components/LigaEventPresencePage";

export default async function LigasEventosListaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LigaEventPresencePage eventId={id} />;
}
