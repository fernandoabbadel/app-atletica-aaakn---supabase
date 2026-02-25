"use client";

import { SubscriptionListPage } from "../_components/SubscriptionsPage";

export default function AdminPlanosListaBichoSoltoPage() {
  return (
    <SubscriptionListPage
      title="Lista Bicho Solto"
      planMatcher={(row) => {
        const key = `${row.planoId} ${row.planoNome}`.toLowerCase();
        return key.includes("bicho");
      }}
    />
  );
}
