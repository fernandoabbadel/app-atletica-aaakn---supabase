"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, UserCheck2 } from "lucide-react";

import {
  fetchTenantInviteActivationRanking,
  fetchTenantJoinRequests,
  type TenantInviteActivationRankingEntry,
  type TenantJoinRequest,
} from "@/lib/tenantService";
import {
  LaunchPageShell,
  LaunchQuickLinks,
  LaunchRingMetric,
  LaunchTenantSelectorCard,
  extractErrorMessage,
  formatLaunchDate,
  getLaunchBasePath,
  useLaunchWorkspace,
  type LaunchScope,
} from "./LaunchShared";

interface LaunchActivationRankingPageProps {
  scope: LaunchScope;
}

export function LaunchActivationRankingPage({
  scope,
}: LaunchActivationRankingPageProps) {
  const workspace = useLaunchWorkspace(scope);
  const {
    addToast,
    authLoading,
    canAccess,
    loading: workspaceLoading,
    refreshing: workspaceRefreshing,
    refreshWorkspace,
    selectedTenantId,
  } = workspace;
  const [pageLoading, setPageLoading] = useState(true);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [ranking, setRanking] = useState<TenantInviteActivationRankingEntry[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TenantJoinRequest[]>([]);
  const launchBasePath = getLaunchBasePath(scope);

  const approvedTotal = useMemo(
    () => ranking.reduce((total, entry) => total + Math.max(0, entry.approvedCount), 0),
    [ranking]
  );
  const pendingTotal = useMemo(
    () => ranking.reduce((total, entry) => total + Math.max(0, entry.pendingCount), 0),
    [ranking]
  );

  const loadData = useCallback(
    async (tenantId: string, mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setPageLoading(true);
      if (mode === "refresh") setPageRefreshing(true);

      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        setRanking([]);
        setPendingRequests([]);
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
        return;
      }

      try {
        const [rankingRows, requestRows] = await Promise.all([
          fetchTenantInviteActivationRanking(cleanTenantId, { limit: 20 }),
          fetchTenantJoinRequests(cleanTenantId, { status: "pending", limit: 80 }),
        ]);
        setRanking(rankingRows);
        setPendingRequests(requestRows);
      } catch (error: unknown) {
        addToast(
          `Erro ao carregar ranking de ativacoes: ${extractErrorMessage(error)}`,
          "error"
        );
      } finally {
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    if (workspaceLoading) return;
    if (!selectedTenantId) {
      setPageLoading(false);
      setRanking([]);
      setPendingRequests([]);
      return;
    }
    void loadData(selectedTenantId, "initial");
  }, [loadData, selectedTenantId, workspaceLoading]);

  const handleRefresh = async () => {
    const tenantId = await refreshWorkspace();
    await loadData(tenantId || selectedTenantId, "refresh");
  };

  if (authLoading || workspaceLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-sm font-black uppercase text-white">
        Carregando ranking de ativacoes...
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <LaunchPageShell
      scope={scope}
      title="Ranking de Convites Ativados"
      subtitle="usuarios cujos links mais viraram cadastro realizado"
      refreshing={workspaceRefreshing || pageRefreshing}
      onRefresh={() => void handleRefresh()}
    >
      <LaunchQuickLinks
        items={[
          {
            href: launchBasePath,
            label: "Painel",
            helper: "voltar ao resumo",
            count: approvedTotal,
            accentClassName: "border-zinc-700 bg-black/40 text-zinc-100",
          },
          {
            href: `${launchBasePath}/pendentes`,
            label: "Pendentes",
            helper: "fila de solicitacoes",
            count: pendingRequests.length,
            accentClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
          },
          {
            href: `${launchBasePath}/convites`,
            label: "Links Gerados",
            helper: "ranking de criacao",
            count: ranking.length,
            accentClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
          },
        ]}
      />

      <LaunchTenantSelectorCard
        workspace={workspace}
        helperText="Aqui aparece quem trouxe mais cadastros reais para a atletica selecionada."
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <LaunchRingMetric
          label="Cadastros aprovados"
          value={approvedTotal}
          helper="conversoes aprovadas pelos links"
          accentClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        />
        <LaunchRingMetric
          label="Cadastros pendentes"
          value={pendingTotal}
          helper="ainda aguardando aprovacao"
          accentClassName="border-amber-500/40 bg-amber-500/10 text-amber-200"
        />
        <LaunchRingMetric
          label="Top users"
          value={ranking.length}
          helper="usuarios com convites ativados"
          accentClassName="border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
        />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-emerald-300" />
          <h2 className="text-sm font-black uppercase text-emerald-300">
            Convites que viraram cadastro
          </h2>
        </div>

        <div className="mt-4 space-y-3">
          {ranking.map((entry, index) => (
            <div key={entry.inviterUserId} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">
                    #{index + 1} {entry.inviterName || entry.inviterEmail || entry.inviterUserId}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {entry.inviterEmail || "Sem email"} • ultima ativacao{" "}
                    {formatLaunchDate(entry.lastActivationAt)}
                  </p>
                </div>
                <UserCheck2 size={16} className="text-emerald-400" />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Aprovados
                  </p>
                  <p className="mt-2 text-2xl font-black text-emerald-200">
                    {entry.approvedCount}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Pendentes
                  </p>
                  <p className="mt-2 text-2xl font-black text-amber-200">
                    {entry.pendingCount}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Total
                  </p>
                  <p className="mt-2 text-2xl font-black text-cyan-200">{entry.totalCount}</p>
                </div>
              </div>
            </div>
          ))}

          {ranking.length === 0 && (
            <p className="text-sm text-zinc-400">
              Ainda nao existem convites ativados para montar o ranking.
            </p>
          )}
        </div>
      </section>
    </LaunchPageShell>
  );
}
