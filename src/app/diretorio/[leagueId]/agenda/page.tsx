import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default async function DiretorioAgendaPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return <CollectivePublicDetailClient area="diretorio" leagueId={decodeURIComponent(leagueId)} activeTab="agenda" />;
}
