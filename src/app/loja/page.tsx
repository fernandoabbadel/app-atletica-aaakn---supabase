import LojaClientPage, { type Produto } from "./LojaClientPage";

export const revalidate = 60;

export default async function LojaPage() {
  return (
    <LojaClientPage
      initialProducts={[] as Produto[]}
      initialCategories={[]}
      initialHasMore={false}
      initialHydrated={false}
    />
  );
}
