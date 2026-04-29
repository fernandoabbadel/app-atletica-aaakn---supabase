import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function DiretorioAgendaPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="diretorio" leagueId={decodeURIComponent(params.leagueId)} activeTab="agenda" />;
}
