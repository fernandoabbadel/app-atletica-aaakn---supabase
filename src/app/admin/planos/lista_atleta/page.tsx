"use client";

import { SubscriptionListPage } from "../_components/SubscriptionsPage";

export default function AdminPlanosListaAtletaPage() {
  return (
    <SubscriptionListPage
      title="Lista Atleta"
      planMatcher={(row) => {
        const key = `${row.planoId} ${row.planoNome}`.toLowerCase();
        return key.includes("atleta");
      }}
    />
  );
}
