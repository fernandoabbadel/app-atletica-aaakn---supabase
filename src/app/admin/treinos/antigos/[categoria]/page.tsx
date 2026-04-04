import TreinosAntigosClient from "../TreinosAntigosClient";

export default async function AdminTreinosAntigosCategoriaPage({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  const { categoria } = await params;
  return <TreinosAntigosClient fixedCategory={decodeURIComponent(categoria || "")} />;
}
