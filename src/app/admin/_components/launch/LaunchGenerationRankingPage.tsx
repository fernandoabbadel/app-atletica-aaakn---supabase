"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Rocket } from "lucide-react";

import {
  fetchTenantInviteGenerationRanking,
  fetchTenantInviteListEntries,
  fetchTenantInvites,
  type TenantInvite,
  type TenantInviteGenerationRankingEntry,
  type TenantInviteListEntry,
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

interface LaunchGenerationRankingPageProps {
  scope: LaunchScope;
}

export function LaunchGenerationRankingPage({
  scope,
}: LaunchGenerationRankingPageProps) {
  const workspace = useLaunchWorkspace(scope);
  const {
    addToast,
    authLoading,
    canAccess,
    loading: workspaceLoading,
    refreshing: workspaceRefreshing,
    refreshWorkspace,
    selectedTenantId,
    tenantSlug,
  } = workspace;
  const [pageLoading, setPageLoading] = useState(true);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [invites, setInvites] = useState<TenantInvite[]>([]);
  const [inviteEntries, setInviteEntries] = useState<TenantInviteListEntry[]>([]);
  const [ranking, setRanking] = useState<TenantInviteGenerationRankingEntry[]>([]);
  const launchBasePath = getLaunchBasePath(scope, tenantSlug);

  const totalGeneratedLinks = invites.length;
  const totalUses = useMemo(
    () => invites.reduce((total, invite) => total + Math.max(0, invite.usesCount), 0),
    [invites]
  );

  const loadData = useCallback(
    async (tenantId: string, mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setPageLoading(true);
      if (mode === "refresh") setPageRefreshing(true);

      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        setInvites([]);
        setInviteEntries([]);
        setRanking([]);
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
        return;
      }

      try {
        const [inviteRows, inviteListRows, rankingRows] = await Promise.all([
          fetchTenantInvites(cleanTenantId, { limit: 200 }),
          fetchTenantInviteListEntries(cleanTenantId, { limit: 80 }),
          fetchTenantInviteGenerationRanking(cleanTenantId, { limit: 20 }),
        ]);
        setInvites(inviteRows);
        setInviteEntries(inviteListRows);
        setRanking(rankingRows);
      } catch (error: unknown) {
        addToast(
          `Erro ao carregar ranking de links: ${extractErrorMessage(error)}`,
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
      setInvites([]);
      setInviteEntries([]);
      setRanking([]);
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
        Carregando ranking de links...
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <LaunchPageShell
      scope={scope}
      tenantSlug={tenantSlug}
      title="Ranking de Links Gerados"
      subtitle="usuarios que mais criaram convites no tenant"
      refreshing={workspaceRefreshing || pageRefreshing}
      onRefresh={() => void handleRefresh()}
    >
      <LaunchQuickLinks
        items={[
          {
            href: launchBasePath,
            label: "Painel",
            helper: "voltar para o resumo",
            count: totalGeneratedLinks,
            accentClassName: "border-zinc-700 bg-black/40 text-zinc-100",
          },
          {
            href: `${launchBasePath}/pendentes`,
            label: "Pendentes",
            helper: "fila de solicitacoes",
            count: 0,
            accentClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
          },
          {
            href: `${launchBasePath}/ativacoes`,
            label: "Cadastros Convertidos",
            helper: "ranking de ativacao",
            count: 0,
            accentClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
          },
        ]}
      />

      <LaunchTenantSelectorCard
        workspace={workspace}
        helperText="O ranking contabiliza quem gerou mais links para a atletica selecionada."
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <LaunchRingMetric
          label="Links gerados"
          value={totalGeneratedLinks}
          helper="total de convites emitidos no tenant"
          accentClassName="border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
        />
        <LaunchRingMetric
          label="Top users"
          value={ranking.length}
          helper="usuarios que entraram no ranking"
          accentClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        />
        <LaunchRingMetric
          label="Usos acumulados"
          value={totalUses}
          helper="quantas vezes os links foram consumidos"
          accentClassName="border-amber-500/40 bg-amber-500/10 text-amber-200"
        />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-cyan-300" />
          <h2 className="text-sm font-black uppercase text-cyan-300">
            Quem mais gerou links
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
                    {entry.inviterEmail || "Sem email"} • ultimo link{" "}
                    {formatLaunchDate(entry.lastInviteAt)}
                  </p>
                </div>
                <Rocket size={16} className="text-cyan-400" />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Links
                  </p>
                  <p className="mt-2 text-2xl font-black text-cyan-200">{entry.totalInvites}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Ativos
                  </p>
                  <p className="mt-2 text-2xl font-black text-emerald-200">
                    {entry.activeInvites}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Inativos
                  </p>
                  <p className="mt-2 text-2xl font-black text-rose-200">
                    {entry.inactiveInvites}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Usos
                  </p>
                  <p className="mt-2 text-2xl font-black text-amber-200">{entry.totalUses}</p>
                </div>
              </div>
            </div>
          ))}

          {ranking.length === 0 && (
            <p className="text-sm text-zinc-400">
              Ainda nao existem convites gerados para montar o ranking.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-amber-300" />
          <h2 className="text-sm font-black uppercase text-amber-300">
            Lista de convites criados
          </h2>
        </div>

        <div className="mt-4 space-y-3">
          {inviteEntries.map((invite) => (
            <div
              key={invite.id}
              className="rounded-2xl border border-zinc-800 bg-black/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">
                    {invite.inviterName || invite.inviterEmail || invite.createdBy || "Sem criador"}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {invite.inviterEmail || "Sem email"} • {invite.inviterTurma || "Sem turma"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                    invite.isActive
                      ? "bg-emerald-500/10 text-emerald-200"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {invite.isActive ? "ativo" : "encerrado"}
                </span>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Token
                  </p>
                  <p className="mt-2 truncate text-xs font-black text-cyan-200">{invite.token}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Criado em
                  </p>
                  <p className="mt-2 text-xs font-black text-white">
                    {formatLaunchDate(invite.createdAt)}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Usos
                  </p>
                  <p className="mt-2 text-xl font-black text-amber-200">
                    {invite.usesCount}/{invite.maxUses}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Expira
                  </p>
                  <p className="mt-2 text-xs font-black text-white">
                    {formatLaunchDate(invite.expiresAt)}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {inviteEntries.length === 0 && (
            <p className="text-sm text-zinc-400">
              Nenhum convite gerado para montar a lista detalhada.
            </p>
          )}
        </div>
      </section>
    </LaunchPageShell>
  );
}
