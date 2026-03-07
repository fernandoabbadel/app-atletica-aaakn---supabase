"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, ShieldEllipsis, XCircle } from "lucide-react";

import {
  approveTenantJoinRequest,
  approveTenantOnboardingRequest,
  fetchTenantInvites,
  fetchTenantJoinRequests,
  fetchTenantOnboardingRequests,
  rejectTenantJoinRequest,
  rejectTenantOnboardingRequest,
  type TenantInvite,
  type TenantJoinRequest,
  type TenantOnboardingRequest,
} from "@/lib/tenantService";
import {
  LaunchPageShell,
  LaunchQuickLinks,
  LaunchRingMetric,
  LaunchTenantSelectorCard,
  extractErrorMessage,
  getLaunchBasePath,
  useLaunchWorkspace,
  type LaunchScope,
} from "./LaunchShared";

interface LaunchPendingPageProps {
  scope: LaunchScope;
}

export function LaunchPendingPage({ scope }: LaunchPendingPageProps) {
  const workspace = useLaunchWorkspace(scope);
  const {
    addToast,
    authLoading,
    canAccess,
    isPlatformMasterUser,
    loading: workspaceLoading,
    refreshing: workspaceRefreshing,
    refreshWorkspace,
    selectedTenantId,
  } = workspace;
  const [pageLoading, setPageLoading] = useState(true);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState("");
  const [processingOnboardingId, setProcessingOnboardingId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [onboardingRejectReason, setOnboardingRejectReason] = useState("");
  const [invites, setInvites] = useState<TenantInvite[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TenantJoinRequest[]>([]);
  const [onboardingRequests, setOnboardingRequests] = useState<TenantOnboardingRequest[]>([]);

  const isMasterScope = scope === "master" && isPlatformMasterUser;
  const launchBasePath = getLaunchBasePath(scope);
  const activeInvitesCount = invites.filter((invite) => invite.isActive).length;

  const loadData = useCallback(
    async (tenantId: string, mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setPageLoading(true);
      if (mode === "refresh") setPageRefreshing(true);

      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        setInvites([]);
        setPendingRequests([]);
        setOnboardingRequests([]);
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
        return;
      }

      try {
        const [inviteRows, requestRows, onboardingRows] = await Promise.all([
          fetchTenantInvites(cleanTenantId, { limit: 40 }),
          fetchTenantJoinRequests(cleanTenantId, { status: "pending", limit: 80 }),
          isMasterScope
            ? fetchTenantOnboardingRequests({ status: "pending", limit: 40 })
            : Promise.resolve([]),
        ]);
        setInvites(inviteRows);
        setPendingRequests(requestRows);
        setOnboardingRequests(onboardingRows);
      } catch (error: unknown) {
        addToast(
          `Erro ao carregar pendencias: ${extractErrorMessage(error)}`,
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
    if (workspaceLoading) return;
    if (!selectedTenantId) {
      setPageLoading(false);
      setInvites([]);
      setPendingRequests([]);
      setOnboardingRequests([]);
      return;
    }
    void loadData(selectedTenantId, "initial");
  }, [loadData, selectedTenantId, workspaceLoading]);

  const handleRefresh = async () => {
    const tenantId = await refreshWorkspace();
    await loadData(tenantId || selectedTenantId, "refresh");
  };

  const handleApproveRequest = async (requestId: string) => {
    try {
      setProcessingRequestId(requestId);
      await approveTenantJoinRequest({ requestId, approvedRole: "user" });
      await loadData(selectedTenantId, "refresh");
      addToast("Solicitacao aprovada como user.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao aprovar: ${extractErrorMessage(error)}`, "error");
    } finally {
      setProcessingRequestId("");
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      setProcessingRequestId(requestId);
      await rejectTenantJoinRequest({
        requestId,
        reason: rejectReason.trim() || undefined,
      });
      setRejectReason("");
      await loadData(selectedTenantId, "refresh");
      addToast("Solicitacao rejeitada.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao rejeitar: ${extractErrorMessage(error)}`, "error");
    } finally {
      setProcessingRequestId("");
    }
  };

  const handleApproveOnboarding = async (requestId: string) => {
    try {
      setProcessingOnboardingId(requestId);
      await approveTenantOnboardingRequest(requestId);
      await loadData(selectedTenantId, "refresh");
      addToast("Onboarding aprovado.", "success");
    } catch (error: unknown) {
      addToast(
        `Erro ao aprovar onboarding: ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setProcessingOnboardingId("");
    }
  };

  const handleRejectOnboarding = async (requestId: string) => {
    try {
      setProcessingOnboardingId(requestId);
      await rejectTenantOnboardingRequest({
        requestId,
        reason: onboardingRejectReason.trim() || undefined,
      });
      setOnboardingRejectReason("");
      await loadData(selectedTenantId, "refresh");
      addToast("Onboarding rejeitado.", "success");
    } catch (error: unknown) {
      addToast(
        `Erro ao rejeitar onboarding: ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setProcessingOnboardingId("");
    }
  };

  if (authLoading || workspaceLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-sm font-black uppercase text-white">
        Carregando pendencias...
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <LaunchPageShell
      scope={scope}
      title="Pendencias do Lancamento"
      subtitle="contadores redondos e fila de revisao do modulo"
      refreshing={workspaceRefreshing || pageRefreshing}
      onRefresh={() => void handleRefresh()}
    >
      <LaunchQuickLinks
        items={[
          {
            href: launchBasePath,
            label: "Painel",
            helper: "voltar ao resumo do modulo",
            count: pendingRequests.length,
            accentClassName: "border-zinc-700 bg-black/40 text-zinc-100",
          },
          {
            href: `${launchBasePath}/convites`,
            label: "Links Gerados",
            helper: "ranking de criacao de links",
            count: 0,
            accentClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
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
        helperText="Os contadores abaixo consideram apenas a atletica selecionada."
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <LaunchRingMetric
          label="Solicitacoes de acesso"
          value={pendingRequests.length}
          helper="usuarios aguardando aprovacao para entrar como user"
          accentClassName="border-amber-500/40 bg-amber-500/10 text-amber-200"
        />
        <LaunchRingMetric
          label="Convites ativos"
          value={activeInvitesCount}
          helper="tokens ainda validos para novas entradas"
          accentClassName="border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
        />
        {isMasterScope ? (
          <LaunchRingMetric
            label="Onboarding"
            value={onboardingRequests.length}
            helper="novas atleticas aguardando analise do dono do app"
            accentClassName="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200"
          />
        ) : (
          <LaunchRingMetric
            label="Fila atual"
            value={pendingRequests.length}
            helper="volume total de revisao do tenant neste momento"
            accentClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          />
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-amber-300" />
            <h2 className="text-sm font-black uppercase text-amber-300">
              Solicitacoes pendentes
            </h2>
          </div>

          <div className="mt-4 space-y-4">
            <label className="block text-[11px] font-bold uppercase text-zinc-500">
              Motivo para rejeicao
              <input
                type="text"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Ex: cadastro duplicado"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </label>

            {pendingRequests.map((request) => {
              const isProcessing = processingRequestId === request.id;
              return (
                <div key={request.id} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                  <p className="text-sm font-black text-white">
                    {request.requesterName || request.requesterEmail || request.requesterUserId}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {request.requesterEmail || "Sem email"} • {request.requesterTurma || "Sem turma"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleApproveRequest(request.id)}
                      disabled={isProcessing}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      <CheckCircle2 size={14} />
                      Aprovar user
                    </button>
                    <button
                      onClick={() => void handleRejectRequest(request.id)}
                      disabled={isProcessing}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] font-black uppercase text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      <XCircle size={14} />
                      Rejeitar
                    </button>
                  </div>
                </div>
              );
            })}

            {pendingRequests.length === 0 && (
              <p className="text-sm text-zinc-400">
                Nenhuma solicitacao pendente para este tenant.
              </p>
            )}
          </div>
        </div>

        {isMasterScope ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2">
              <ShieldEllipsis size={16} className="text-fuchsia-300" />
              <h2 className="text-sm font-black uppercase text-fuchsia-300">
                Onboarding de atleticas
              </h2>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block text-[11px] font-bold uppercase text-zinc-500">
                Motivo para rejeicao do onboarding
                <input
                  type="text"
                  value={onboardingRejectReason}
                  onChange={(event) => setOnboardingRejectReason(event.target.value)}
                  placeholder="Ex: dados incompletos"
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                />
              </label>

              {onboardingRequests.map((request) => {
                const isProcessing = processingOnboardingId === request.id;
                return (
                  <div key={request.id} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                    <p className="text-sm font-black text-white">
                      {request.sigla} - {request.nome}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {request.faculdade || "Sem faculdade"} • {request.cidade || "Sem cidade"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleApproveOnboarding(request.id)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                      >
                        <CheckCircle2 size={14} />
                        Aprovar
                      </button>
                      <button
                        onClick={() => void handleRejectOnboarding(request.id)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] font-black uppercase text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                      >
                        <XCircle size={14} />
                        Rejeitar
                      </button>
                    </div>
                  </div>
                );
              })}

              {onboardingRequests.length === 0 && (
                <p className="text-sm text-zinc-400">
                  Nenhum onboarding pendente para o dono do app neste momento.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center gap-2">
              <ShieldEllipsis size={16} className="text-cyan-300" />
              <h2 className="text-sm font-black uppercase text-cyan-300">
                Convites ativos do tenant
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              {invites.filter((invite) => invite.isActive).slice(0, 6).map((invite) => (
                <div key={invite.id} className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
                  <p className="text-sm font-black text-white">{invite.token}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {invite.usesCount}/{invite.maxUses} usos • aprovacao{" "}
                    {invite.requiresApproval ? "manual" : "automatica"}
                  </p>
                </div>
              ))}

              {activeInvitesCount === 0 && (
                <p className="text-sm text-zinc-400">
                  Nenhum convite ativo para este tenant neste momento.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </LaunchPageShell>
  );
}
