import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function ComissaoStorePage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="comissoes" leagueId={decodeURIComponent(params.leagueId)} activeTab="loja" />;
}
