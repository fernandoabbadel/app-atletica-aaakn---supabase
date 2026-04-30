import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default async function DiretorioDetailPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return <CollectivePublicDetailClient area="diretorio" leagueId={decodeURIComponent(leagueId)} activeTab="overview" />;
}
