import { LeaguePublicDetailClient } from "../_components/LeaguePublicDetailClient";

export default function LeaguePublicMembersPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <LeaguePublicDetailClient leagueId={params.leagueId} activeTab="membros" />;
}
