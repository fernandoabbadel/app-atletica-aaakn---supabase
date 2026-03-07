import LojaClientPage, { type Produto } from "./LojaClientPage";
import {
  fetchStoreCategories,
  fetchStoreProductsPage,
} from "../../lib/storePublicService";
import { serializeForClient } from "../../lib/clientSerialization";

export const revalidate = 60;

export default async function LojaPage() {
  let initialProducts: Produto[] = [];
  let initialCategories: string[] = [];
  let initialHasMore = false;
  let initialHydrated = false;

  try {
    const [categoriesRows, firstProductsPage] = await Promise.all([
      fetchStoreCategories({ maxResults: 120, forceRefresh: false }),
      fetchStoreProductsPage({
        page: 1,
        pageSize: 20,
        category: "Todos",
        forceRefresh: false,
      }),
    ]);

    initialProducts = serializeForClient(
      firstProductsPage.products as unknown as Produto[]
    );
    initialHasMore = firstProductsPage.hasMore;
    initialCategories = categoriesRows
      .map((row) =>
        typeof (row as { nome?: unknown }).nome === "string"
          ? ((row as { nome: string }).nome || "").trim()
          : ""
      )
      .filter((entry): entry is string => entry.length > 0);
    // No server a leitura usa anon key e pode vir vazia por RLS mesmo com sessao no browser.
    initialHydrated = initialProducts.length > 0 || initialCategories.length > 0;
  } catch {
    initialProducts = [];
    initialCategories = [];
    initialHasMore = false;
    initialHydrated = false;
  }

  return (
    <LojaClientPage
      initialProducts={initialProducts}
      initialCategories={initialCategories}
      initialHasMore={initialHasMore}
      initialHydrated={initialHydrated}
    />
  );
}
