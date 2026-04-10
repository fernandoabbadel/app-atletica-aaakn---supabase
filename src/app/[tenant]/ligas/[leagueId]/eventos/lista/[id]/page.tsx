import { LigaEventPresencePage } from "@/app/ligas/_components/LigaEventPresencePage";

export default async function TenantLigaScopedEventosListaPage({
  params,
}: {
  params: Promise<{ id: string; leagueId: string }>;
}) {
  const { id, leagueId } = await params;
  return <LigaEventPresencePage eventId={id} leagueId={leagueId} />;
}
