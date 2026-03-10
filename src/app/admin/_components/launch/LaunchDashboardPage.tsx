"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, Rocket, ShieldCheck } from "lucide-react";

import {
  createTenantInvite,
  fetchTenantInviteActivationRanking,
  fetchTenantInviteGenerationRanking,
  fetchTenantInvites,
  fetchTenantJoinRequests,
  fetchTenantOnboardingRequests,
  fetchTenantPlatformConfig,
  setTenantLaunchTokenizationActive,
  type TenantInvite,
  type TenantInviteActivationRankingEntry,
  type TenantInviteGenerationRankingEntry,
  type TenantJoinRequest,
  type TenantOnboardingRequest,
} from "@/lib/tenantService";
import {
  LaunchPageShell,
  LaunchQuickLinks,
  LaunchTenantSelectorCard,
  extractErrorMessage,
  formatLaunchDate,
  getLaunchAudienceLabel,
  getLaunchBasePath,
  normalizeIntegerInput,
  useLaunchWorkspace,
  type LaunchScope,
} from "./LaunchShared";
import { withTenantSlug } from "@/lib/tenantRouting";

interface LaunchDashboardPageProps {
  scope: LaunchScope;
}

export function LaunchDashboardPage({ scope }: LaunchDashboardPageProps) {
  const workspace = useLaunchWorkspace(scope);
  const {
    addToast,
    authLoading,
    canAccess,
    isPlatformMasterUser,
    loading: workspaceLoading,
    refreshing: workspaceRefreshing,
    refreshWorkspace,
    selectedTenant,
    selectedTenantId,
    tenantSlug,
  } = workspace;
  const [pageLoading, setPageLoading] = useState(true);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [savingTokenization, setSavingTokenization] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [tokenizationActive, setTokenizationActive] = useState(true);
  const [origin, setOrigin] = useState("");
  const [inviteUses, setInviteUses] = useState(25);
  const [inviteHours, setInviteHours] = useState(72);
  const [inviteRequiresApproval, setInviteRequiresApproval] = useState(true);
  const [invites, setInvites] = useState<TenantInvite[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TenantJoinRequest[]>([]);
  const [generationRanking, setGenerationRanking] = useState<
    TenantInviteGenerationRankingEntry[]
  >([]);
  const [activationRanking, setActivationRanking] = useState<
    TenantInviteActivationRankingEntry[]
  >([]);
  const [onboardingRequests, setOnboardingRequests] = useState<TenantOnboardingRequest[]>([]);

  const isMasterScope = scope === "master" && isPlatformMasterUser;
  const launchBasePath = getLaunchBasePath(scope, tenantSlug);

  const latestInviteLink = useMemo(() => {
    const latestInvite = invites[0];
    if (!latestInvite || !origin.trim()) return "";
    const inviteTenantSlug = (selectedTenant?.slug || tenantSlug).trim();
    const invitePath = inviteTenantSlug
      ? withTenantSlug(inviteTenantSlug, "/cadastro")
      : "/cadastro";
    return `${origin}${invitePath}?invite=${encodeURIComponent(latestInvite.token)}`;
  }, [invites, origin, selectedTenant?.slug, tenantSlug]);

  const activeInvitesCount = useMemo(
    () => invites.filter((invite) => invite.isActive).length,
    [invites]
  );

  const approvedActivationCount = useMemo(
    () =>
      activationRanking.reduce((total, entry) => total + Math.max(0, entry.approvedCount), 0),
    [activationRanking]
  );

  const loadDashboardData = useCallback(
    async (tenantId: string, mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setPageLoading(true);
      if (mode === "refresh") setPageRefreshing(true);

      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        setInvites([]);
        setPendingRequests([]);
        setGenerationRanking([]);
        setActivationRanking([]);
        setOnboardingRequests([]);
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
        return;
      }

      try {
        const [
          invitesRows,
          requestsRows,
          generationRows,
          activationRows,
          platformConfig,
          onboardingRows,
        ] = await Promise.all([
          fetchTenantInvites(cleanTenantId, { limit: 30 }),
          fetchTenantJoinRequests(cleanTenantId, { status: "pending", limit: 80 }),
          fetchTenantInviteGenerationRanking(cleanTenantId, { limit: 8 }),
          fetchTenantInviteActivationRanking(cleanTenantId, { limit: 8 }),
          isMasterScope ? fetchTenantPlatformConfig() : Promise.resolve(null),
          isMasterScope
            ? fetchTenantOnboardingRequests({ status: "pending", limit: 40 })
            : Promise.resolve([]),
        ]);

        setInvites(invitesRows);
        setPendingRequests(requestsRows);
        setGenerationRanking(generationRows);
        setActivationRanking(activationRows);
        setTokenizationActive(platformConfig?.tokenizationActive ?? true);
        setOnboardingRequests(onboardingRows);
      } catch (error: unknown) {
        addToast(
          `Erro ao carregar resumo do lancamento: ${extractErrorMessage(error)}`,
          "error"
        );
      } finally {
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
      }
    },
    [addToast, isMasterScope]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (workspaceLoading) return;
    if (!selectedTenantId) {
      setPageLoading(false);
      setInvites([]);
      setPendingRequests([]);
      setGenerationRanking([]);
      setActivationRanking([]);
      setOnboardingRequests([]);
      return;
    }
    void loadDashboardData(selectedTenantId, "initial");
  }, [loadDashboardData, selectedTenantId, workspaceLoading]);

  const handleRefresh = async () => {
    const tenantId = await refreshWorkspace();
    await loadDashboardData(tenantId || selectedTenantId, "refresh");
  };

  const handleCreateInvite = async () => {
    if (!selectedTenant) {
      addToast("Selecione uma atletica para gerar convite.", "error");
      return;
    }

    try {
      setCreatingInvite(true);
      await createTenantInvite({
        tenantId: selectedTenant.id,
        roleToAssign: "user",
        maxUses: normalizeIntegerInput(inviteUses, 1, 500, 25),
        expiresInHours: normalizeIntegerInput(inviteHours, 1, 24 * 30, 72),
        requiresApproval: inviteRequiresApproval,
      });
      await loadDashboardData(selectedTenant.id, "refresh");
      addToast("Convite user criado com sucesso.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao criar convite: ${extractErrorMessage(error)}`, "error");
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!latestInviteLink.trim()) return;
    try {
      await navigator.clipboard.writeText(latestInviteLink);
      addToast("Link copiado para a area de transferencia.", "success");
    } catch {
      addToast("Nao foi possivel copiar automaticamente.", "error");
    }
  };

  const handleToggleTokenization = async () => {
    if (!isMasterScope) return;
    try {
      setSavingTokenization(true);
      const nextValue = !tokenizationActive;
      await setTenantLaunchTokenizationActive(nextValue);
      setTokenizationActive(nextValue);
      addToast("Tokenizacao global atualizada.", "success");
    } catch (error: unknown) {
      addToast(
        `Erro ao atualizar tokenizacao: ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setSavingTokenization(false);
    }
  };

  if (authLoading || workspaceLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-sm font-black uppercase text-white">
        Carregando modulo de lancamento...
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <LaunchPageShell
      scope={scope}
      tenantSlug={tenantSlug}
      title={isMasterScope ? "Lancamento Master" : "Projeto de Lancamento"}
      subtitle={
        isMasterScope
          ? "painel global do dono do app, separado do admin da atletica"
          : "convites e aprovacoes do tenant no painel admin"
      }
      refreshing={workspaceRefreshing || pageRefreshing}
      onRefresh={() => void handleRefresh()}
      actions={
        isMasterScope ? (
          <button
            onClick={() => void handleToggleTokenization()}
            disabled={savingTokenization}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-black uppercase disabled:opacity-60 ${
              tokenizationActive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-200"
            }`}
          >
            <ShieldCheck size={14} />
            {savingTokenization
              ? "Salvando..."
              : tokenizationActive
              ? "Tokenizacao ativa"
              : "Tokenizacao pausada"}
          </button>
        ) : null
      }
    >
      <LaunchQuickLinks
        items={[
          {
            href: `${launchBasePath}/pendentes`,
            label: "Pendentes",
            helper: "solicitacoes aguardando decisao",
            count: pendingRequests.length + (isMasterScope ? onboardingRequests.length : 0),
            accentClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
          },
          {
            href: `${launchBasePath}/convites`,
            label: "Links Gerados",
            helper: "ranking de quem mais criou convites",
            count: generationRanking.length,
            accentClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
          },
          {
            href: `${launchBasePath}/ativacoes`,
            label: "Cadastros Convertidos",
            helper: "ranking dos convites que viraram cadastro",
            count: activationRanking.length,
            accentClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
          },
        ]}
      />

      <LaunchTenantSelectorCard
        workspace={workspace}
        helperText={`Dados carregados para o ${getLaunchAudienceLabel(scope)} e filtrados pela atletica ativa.`}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div>
            <h2 className="text-sm font-black uppercase text-cyan-400">Gerar Link de Convite</h2>
            <p className="mt-1 text-[11px] font-bold uppercase text-zinc-500">
              A role final agora e sempre user. Ninguem gera link para outras roles.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Role final</label>
              <div className="mt-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-black uppercase text-emerald-200">
                user
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Max usos</label>
              <input
                type="number"
                min={1}
                max={500}
                value={inviteUses}
                onChange={(event) => setInviteUses(Number(event.target.value))}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase text-zinc-400">Expira em horas</label>
              <input
                type="number"
                min={1}
                max={24 * 30}
                value={inviteHours}
                onChange={(event) => setInviteHours(Number(event.target.value))}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
              />
            </div>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
            <input
              type="checkbox"
              checked={inviteRequiresApproval}
              onChange={(event) => setInviteRequiresApproval(event.target.checked)}
              className="accent-emerald-500"
            />
            Exige aprovacao manual
          </label>

          <button
            onClick={() => void handleCreateInvite()}
            disabled={creatingInvite || !selectedTenant}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-black uppercase hover:bg-cyan-500 disabled:opacity-60"
          >
            <KeyRound size={14} />
            {creatingInvite ? "Gerando..." : "Gerar Convite User"}
          </button>

          {latestInviteLink && (
            <div className="mt-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
              <p className="text-[11px] font-black uppercase text-cyan-200">
                Ultimo link criado
              </p>
              <code className="mt-2 block break-all text-[11px] text-cyan-50">
                {latestInviteLink}
              </code>
              <button
                onClick={() => void handleCopyInvite()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-1.5 text-[11px] font-black uppercase text-cyan-100"
              >
                <Copy size={12} />
                Copiar Link
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
              Resumo Rapido
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Solicitacoes
                </p>
                <p className="mt-2 text-3xl font-black text-amber-200">{pendingRequests.length}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Convites ativos
                </p>
                <p className="mt-2 text-3xl font-black text-cyan-200">{activeInvitesCount}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Cadastros por convite
                </p>
                <p className="mt-2 text-3xl font-black text-emerald-200">
                  {approvedActivationCount}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  {isMasterScope ? "Onboarding master" : "Criadores no ranking"}
                </p>
                <p className="mt-2 text-3xl font-black text-fuchsia-200">
                  {isMasterScope ? onboardingRequests.length : generationRanking.length}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-white">
              Ultimos convites
            </p>
            <div className="mt-3 space-y-2">
              {invites.slice(0, 3).map((invite) => (
                <div
                  key={invite.id}
                  className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-black uppercase text-cyan-200">
                      {invite.token}
                    </span>
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
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {invite.usesCount}/{invite.maxUses} usos • expira em{" "}
                    {formatLaunchDate(invite.expiresAt)}
                  </p>
                </div>
              ))}
              {invites.length === 0 && (
                <p className="text-sm text-zinc-400">Nenhum convite criado para este tenant.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-amber-300">Solicitacoes pendentes</h2>
              <p className="mt-1 text-[11px] font-medium text-zinc-500">
                Ultimas entradas aguardando decisao no tenant.
              </p>
            </div>
            <Link
              href={`${launchBasePath}/pendentes`}
              className="text-[11px] font-black uppercase text-amber-200 hover:text-white"
            >
              abrir pagina
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {pendingRequests.slice(0, 4).map((request) => (
              <div key={request.id} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                <p className="text-sm font-black text-white">
                  {request.requesterName || request.requesterEmail || "Usuario sem nome"}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {request.requesterEmail || "Sem email"} • {request.requesterTurma || "Sem turma"}
                </p>
              </div>
            ))}
            {pendingRequests.length === 0 && (
              <p className="text-sm text-zinc-400">Nenhuma solicitacao pendente para este tenant.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-cyan-300">Ranking de convites</h2>
              <p className="mt-1 text-[11px] font-medium text-zinc-500">
                Quem mais gerou links no tenant.
              </p>
            </div>
            <Link
              href={`${launchBasePath}/convites`}
              className="text-[11px] font-black uppercase text-cyan-200 hover:text-white"
            >
              abrir pagina
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {generationRanking.slice(0, 4).map((entry, index) => (
              <div key={entry.inviterUserId} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-white">
                      #{index + 1} {entry.inviterName || entry.inviterEmail || entry.inviterUserId}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {entry.totalInvites} links • {entry.totalUses} usos
                    </p>
                  </div>
                  <Rocket size={16} className="text-cyan-400" />
                </div>
              </div>
            ))}
            {generationRanking.length === 0 && (
              <p className="text-sm text-zinc-400">Ainda nao existem links suficientes para ranking.</p>
            )}
          </div>
        </div>
      </section>
    </LaunchPageShell>
  );
}
