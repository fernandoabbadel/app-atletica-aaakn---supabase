import { LeaguePublicDetailClient } from "./_components/LeaguePublicDetailClient";

export default function LeaguePublicDetailPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <LeaguePublicDetailClient leagueId={params.leagueId} activeTab="overview" />;
}
