import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function ComissaoDetailPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="comissoes" leagueId={decodeURIComponent(params.leagueId)} activeTab="overview" />;
}
