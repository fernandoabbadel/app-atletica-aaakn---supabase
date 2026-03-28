import EventosClientPage, { type Evento } from "./EventosClientPage";

import { fetchEventsFeed } from "@/lib/eventsNativeService";
import { resolveServerTenantScope } from "@/lib/serverTenantScope";
import {
  createDefaultTenantAppModulesConfig,
  fetchEffectiveTenantAppModulesConfig,
  type TenantAppModulesConfig,
} from "@/lib/tenantAppModulesService";

interface EventosPageContentProps {
  tenantSlugOverride?: string;
}

export async function EventosPageContent({
  tenantSlugOverride = "",
}: EventosPageContentProps) {
  const scope = await resolveServerTenantScope({ tenantSlug: tenantSlugOverride });
  let initialEventos: Evento[] = [];
  let initialModulesConfig: TenantAppModulesConfig = createDefaultTenantAppModulesConfig();
  let initialModulesHydrated = false;

  const [eventosResult, modulesResult] = await Promise.allSettled([
    fetchEventsFeed({
      maxResults: 24,
      forceRefresh: false,
      tenantId: scope.tenantId || undefined,
    }),
    scope.tenantId
      ? fetchEffectiveTenantAppModulesConfig({
          tenantId: scope.tenantId,
          tenantSlug: scope.tenantSlug,
        })
      : Promise.resolve(createDefaultTenantAppModulesConfig()),
  ]);

  if (eventosResult.status === "fulfilled") {
    initialEventos = eventosResult.value as unknown as Evento[];
  }

  if (modulesResult.status === "fulfilled") {
    initialModulesConfig = modulesResult.value;
    initialModulesHydrated = true;
  }

  return (
    <EventosClientPage
      initialEventos={initialEventos}
      initialModulesConfig={initialModulesConfig}
      initialModulesHydrated={initialModulesHydrated}
    />
  );
}
