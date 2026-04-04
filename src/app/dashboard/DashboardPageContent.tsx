import DashboardClientPage from "./DashboardClientPage";

import { fetchBoardroundAppConfig, getBoardroundDisplayName } from "@/lib/boardroundConfigService";
import { type DashboardBundle } from "@/lib/dashboardPublicService";
import { fetchPublicDashboardViewWithAdmin } from "@/lib/publicDashboardViewAdminService";
import { resolveServerTenantScope } from "@/lib/serverTenantScope";
import {
  createDefaultTenantAppModulesConfig,
  type TenantAppModulesConfig,
} from "@/lib/tenantAppModulesService";

interface DashboardPageContentProps {
  tenantSlugOverride?: string;
}

type DashboardInitialData = Pick<
  DashboardBundle,
  "events" | "produtos" | "parceiros" | "ligas" | "mensagens" | "treinos" | "totalCaca" | "totalAlunos" | "productTurmaStats"
>;

export async function DashboardPageContent({
  tenantSlugOverride = "",
}: DashboardPageContentProps) {
  const scope = await resolveServerTenantScope({ tenantSlug: tenantSlugOverride });
  let initialData: DashboardInitialData | null = null;
  let initialModulesConfig: TenantAppModulesConfig = createDefaultTenantAppModulesConfig();
  let initialBoardroundDisplayName = "BoardRound";

  if (scope.tenantId) {
    const [dashboardViewResult, boardroundResult] = await Promise.allSettled([
      fetchPublicDashboardViewWithAdmin({
        tenantId: scope.tenantId,
        tenantSlug: scope.tenantSlug,
      }),
      fetchBoardroundAppConfig({
        forceRefresh: false,
        tenantId: scope.tenantId,
      }),
    ]);

    if (dashboardViewResult.status === "fulfilled") {
      initialData = dashboardViewResult.value.data;
      initialModulesConfig = dashboardViewResult.value.modulesConfig;
    }

    if (boardroundResult.status === "fulfilled") {
      initialBoardroundDisplayName = getBoardroundDisplayName(boardroundResult.value);
    }
  }

  return (
    <DashboardClientPage
      initialData={initialData}
      initialModulesConfig={initialModulesConfig}
      initialBoardroundDisplayName={initialBoardroundDisplayName}
      initialTenantId={scope.tenantId}
      initialTenantSlug={scope.tenantSlug}
    />
  );
}
