import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default function ComissaoMembersPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <CollectivePublicDetailClient area="comissoes" leagueId={decodeURIComponent(params.leagueId)} activeTab="membros" />;
}
