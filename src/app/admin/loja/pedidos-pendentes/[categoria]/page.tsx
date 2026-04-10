import { AdminStoreOrdersStatusPage } from "../../_components/AdminStoreOrdersStatusPage";

type PageProps = {
  params: Promise<{
    categoria: string;
  }>;
};

export default async function AdminLojaPedidosPendentesCategoriaPage({
  params,
}: PageProps) {
  const { categoria } = await params;
  return (
    <AdminStoreOrdersStatusPage
      mode="pending"
      categoryLabel={decodeURIComponent(categoria)}
    />
  );
}
