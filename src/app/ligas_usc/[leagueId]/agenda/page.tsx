import { LeaguePublicDetailClient } from "../_components/LeaguePublicDetailClient";

export default function LeaguePublicAgendaPage({
  params,
}: {
  params: { leagueId: string };
}) {
  return <LeaguePublicDetailClient leagueId={params.leagueId} activeTab="agenda" />;
}
