"use client";

import { SubscriptionListPage } from "../_components/SubscriptionsPage";

export default function AdminPlanosListaLendaPage() {
  return (
    <SubscriptionListPage
      title="Lista Lenda"
      planMatcher={(row) => {
        const key = `${row.planoId} ${row.planoNome}`.toLowerCase();
        return key.includes("lenda");
      }}
    />
  );
}
