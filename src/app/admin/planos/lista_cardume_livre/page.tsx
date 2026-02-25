"use client";

import { SubscriptionListPage } from "../_components/SubscriptionsPage";

export default function AdminPlanosListaCardumeLivrePage() {
  return (
    <SubscriptionListPage
      title="Lista Cardume Livre"
      planMatcher={(row) => {
        const key = `${row.planoId} ${row.planoNome}`.toLowerCase();
        return key.includes("cardume");
      }}
    />
  );
}
