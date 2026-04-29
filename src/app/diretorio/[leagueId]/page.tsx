import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function DiretorioDetailPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="diretorio" leagueId={decodeURIComponent(params.leagueId)} activeTab="overview" />;
}
