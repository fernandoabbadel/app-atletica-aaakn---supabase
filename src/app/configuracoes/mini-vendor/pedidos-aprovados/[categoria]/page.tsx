"use client";

import { MiniVendorOrdersStatusPage } from "../../_components/MiniVendorOrdersStatusPage";

type PageProps = {
  params: {
    categoria: string;
  };
};

export default function MiniVendorApprovedOrdersByCategoryPage({ params }: PageProps) {
  const categoryLabel = decodeURIComponent(params.categoria);

  return <MiniVendorOrdersStatusPage mode="approved" categoryLabel={categoryLabel} />;
}
