"use client";

import LigasAdminPageContent from "@/app/ligas/LigasAdminPageContent";
import { LeagueStoreAdminPage } from "@/app/ligas/LeagueStoreAdminPage";
import { LigaEventPresencePage } from "@/app/ligas/_components/LigaEventPresencePage";
import { LeagueFinanceDashboard } from "@/app/ligas/_components/LeagueFinanceDashboard";
import { LeagueFrequencyPage } from "@/app/ligas/_components/LeagueFrequencyPage";
import { DirectoryManagementGate } from "./DirectoryManagementGate";

const DIRECTORY_BASE_PATH = "/diretorio/configurar";

const sharedAdminProps = {
  basePath: DIRECTORY_BASE_PATH,
  showBoard: false,
  category: "diretorio" as const,
  storageNamespace: "diretorio",
  entityLabel: "diretório",
  entityArticle: "do" as const,
};

export function DirectoryManagementHub() {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          pageVariant="hub"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementInfoPage() {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="visual"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementMembersPage() {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="members"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementEventsPage() {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LigasAdminPageContent
          lockedTab="events"
          leagueIdOverride={leagueId}
          {...sharedAdminProps}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementStorePage({
  mode = "overview",
}: {
  mode?: "overview" | "products" | "pending" | "approved";
}) {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LeagueStoreAdminPage
          mode={mode}
          basePath={DIRECTORY_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementFinancePage({
  view = "hub",
}: {
  view?: "hub" | "eventos" | "produtos";
}) {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LeagueFinanceDashboard
          view={view}
          basePath={DIRECTORY_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
          entityLabel="diretório"
          entityArticle="do"
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementFrequencyPage() {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => (
        <LeagueFrequencyPage
          basePath={DIRECTORY_BASE_PATH}
          leagueIdOverride={leagueId}
          showBoard={false}
        />
      )}
    </DirectoryManagementGate>
  );
}

export function DirectoryManagementEventPresencePage({ eventId }: { eventId: string }) {
  return (
    <DirectoryManagementGate>
      {({ leagueId }) => <LigaEventPresencePage eventId={eventId} leagueId={leagueId} />}
    </DirectoryManagementGate>
  );
}
