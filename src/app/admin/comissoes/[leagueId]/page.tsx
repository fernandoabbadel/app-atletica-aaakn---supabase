import { CommissionAdminEditorPage } from "@/components/collectives/CommissionAdminEditorPage";

export default async function AdminComissaoDiretoriaPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return (
    <CommissionAdminEditorPage
      leagueId={decodeURIComponent(leagueId)}
    />
  );
}
