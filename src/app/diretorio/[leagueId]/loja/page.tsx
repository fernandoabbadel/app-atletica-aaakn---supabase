import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default async function DiretorioStorePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return <CollectivePublicDetailClient area="diretorio" leagueId={decodeURIComponent(leagueId)} activeTab="loja" />;
}
