"use client";

import { MiniVendorOrdersStatusPage } from "../../_components/MiniVendorOrdersStatusPage";

type PageProps = {
  params: {
    categoria: string;
  };
};

export default function MiniVendorPendingOrdersByCategoryPage({ params }: PageProps) {
  const categoryLabel = decodeURIComponent(params.categoria);

  return (
    <MiniVendorOrdersStatusPage
      mode="pending"
      titleOverride={`Pedidos Pendentes • ${categoryLabel}`}
      subtitleOverride={`Mostra a fila pendente da categoria ${categoryLabel}.`}
    />
  );
}
