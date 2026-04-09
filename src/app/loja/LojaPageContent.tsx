import LojaClientPage, { type Produto, type StoreCategory } from "./LojaClientPage";

import { serializeForClient } from "@/lib/clientSerialization";
import { resolveServerTenantScope } from "@/lib/serverTenantScope";
import { fetchStoreCategories, fetchStoreProductsPage } from "@/lib/storePublicService";

const STORE_PAGE_SIZE = 20;

interface LojaPageContentProps {
  tenantSlugOverride?: string;
}

export async function LojaPageContent({
  tenantSlugOverride = "",
}: LojaPageContentProps) {
  const scope = await resolveServerTenantScope({ tenantSlug: tenantSlugOverride });

  let initialProducts: Produto[] = [];
  let initialCategories: StoreCategory[] = [];
  let initialHasMore = false;
  let initialProductsHydrated = false;
  let initialCategoriesHydrated = false;

  const [productsResult, categoriesResult] = await Promise.allSettled([
    fetchStoreProductsPage({
      page: 1,
      pageSize: STORE_PAGE_SIZE,
      forceRefresh: false,
      tenantId: scope.tenantId || undefined,
    }),
    fetchStoreCategories({
      maxResults: 120,
      forceRefresh: false,
      tenantId: scope.tenantId || undefined,
    }),
  ]);

  if (productsResult.status === "fulfilled") {
    initialProducts = productsResult.value.products.map((product) =>
      serializeForClient(product as unknown as Produto)
    );
    initialHasMore = productsResult.value.hasMore;
    initialProductsHydrated = true;
  }

  if (categoriesResult.status === "fulfilled") {
    initialCategories = categoriesResult.value.map((category) =>
      serializeForClient(category as unknown as StoreCategory)
    );
    initialCategoriesHydrated = true;
  }

  return (
    <LojaClientPage
      initialProducts={initialProducts}
      initialCategories={initialCategories}
      initialHasMore={initialHasMore}
      initialProductsHydrated={initialProductsHydrated}
      initialCategoriesHydrated={initialCategoriesHydrated}
      initialPlanScopeKey=""
    />
  );
}
