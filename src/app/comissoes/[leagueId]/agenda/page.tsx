import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function ComissaoAgendaPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="comissoes" leagueId={decodeURIComponent(params.leagueId)} activeTab="agenda" />;
}
