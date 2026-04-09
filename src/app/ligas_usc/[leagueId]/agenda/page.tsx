import { LeaguePublicDetailClient } from "../_components/LeaguePublicDetailClient";

export default async function LeaguePublicAgendaPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  return <LeaguePublicDetailClient leagueId={leagueId} activeTab="agenda" />;
}
