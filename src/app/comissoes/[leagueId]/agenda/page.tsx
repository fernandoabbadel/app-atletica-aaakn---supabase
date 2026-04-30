import { CollectivePublicDetailClient } from "@/components/collectives/CollectivePublicDetailClient";

export default async function ComissaoAgendaPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return <CollectivePublicDetailClient area="comissoes" leagueId={decodeURIComponent(leagueId)} activeTab="agenda" />;
}
