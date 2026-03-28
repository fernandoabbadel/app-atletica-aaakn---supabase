import DashboardClientPage from "./DashboardClientPage";

import { fetchBoardroundAppConfig, getBoardroundDisplayName } from "@/lib/boardroundConfigService";
import { fetchDashboardBundle, type DashboardBundle } from "@/lib/dashboardPublicService";
import { resolveServerTenantScope } from "@/lib/serverTenantScope";
import {
  createDefaultTenantAppModulesConfig,
  fetchEffectiveTenantAppModulesConfig,
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
    const [bundleResult, modulesResult, boardroundResult] = await Promise.allSettled([
      fetchDashboardBundle({ tenantId: scope.tenantId }),
      fetchEffectiveTenantAppModulesConfig({
        tenantId: scope.tenantId,
        tenantSlug: scope.tenantSlug,
      }),
      fetchBoardroundAppConfig({
        forceRefresh: false,
        tenantId: scope.tenantId,
      }),
    ]);

    if (bundleResult.status === "fulfilled") {
      initialData = bundleResult.value;
    }

    if (modulesResult.status === "fulfilled") {
      initialModulesConfig = modulesResult.value;
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
