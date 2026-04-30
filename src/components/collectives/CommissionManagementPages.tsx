"use client";

import LigasAdminPageContent from "@/app/ligas/LigasAdminPageContent";
import { LeagueStoreAdminPage } from "@/app/ligas/LeagueStoreAdminPage";
import { LigaEventPresencePage } from "@/app/ligas/_components/LigaEventPresencePage";
import { LeagueFinanceDashboard } from "@/app/ligas/_components/LeagueFinanceDashboard";
import { LeagueFrequencyPage } from "@/app/ligas/_components/LeagueFrequencyPage";
import { CommissionManagementGate } from "./CommissionManagementGate";

const COMMISSION_BASE_PATH = "/comissoes/configurar";

const sharedAdminProps = {
  basePath: COMMISSION_BASE_PATH,
  showBoard: false,
  category: "comissao" as const,
  storageNamespace: "comissoes",
  entityLabel: "comissão",
  entityArticle: "da" as const,
};

export function CommissionManagementHub() {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          pageVariant="hub"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementInfoPage() {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="visual"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementMembersPage() {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="members"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementEventsPage() {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="events"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementStorePage({
  mode = "overview",
}: {
  mode?: "overview" | "products" | "pending" | "approved";
}) {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LeagueStoreAdminPage
          mode={mode}
          basePath={COMMISSION_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementFinancePage({
  view = "hub",
}: {
  view?: "hub" | "eventos" | "produtos";
}) {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LeagueFinanceDashboard
          view={view}
          basePath={COMMISSION_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
          entityLabel="comissão"
          entityArticle="da"
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementFrequencyPage() {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => (
        <LeagueFrequencyPage
          basePath={COMMISSION_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
          memberScope="turma"
        />
      )}
    </CommissionManagementGate>
  );
}

export function CommissionManagementEventPresencePage({ eventId }: { eventId: string }) {
  return (
    <CommissionManagementGate>
      {({ leagueId }) => <LigaEventPresencePage eventId={eventId} leagueId={leagueId} />}
    </CommissionManagementGate>
  );
}
