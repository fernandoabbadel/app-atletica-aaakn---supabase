import { AdminStoreOrdersStatusPage } from "../../_components/AdminStoreOrdersStatusPage";

type PageProps = {
  params: Promise<{
    categoria: string;
  }>;
};

export default async function AdminLojaPedidosAprovadosCategoriaPage({
  params,
}: PageProps) {
  const { categoria } = await params;
  return (
    <AdminStoreOrdersStatusPage
      mode="approved"
      categoryLabel={decodeURIComponent(categoria)}
    />
  );
}
