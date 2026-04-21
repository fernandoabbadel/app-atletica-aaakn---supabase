"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import {
  approveTenantJoinRequest,
  fetchTenantInvites,
  fetchTenantJoinRequests,
  rejectTenantJoinRequest,
  type TenantInvite,
  type TenantJoinRequest,
} from "@/lib/tenantService";
import {
  LaunchPageShell,
  LaunchTenantSelectorCard,
  extractErrorMessage,
  formatLaunchDate,
  useLaunchWorkspace,
  type LaunchScope,
} from "./LaunchShared";

const PAGE_SIZE = 8;

interface LaunchPendingPageProps {
  scope: LaunchScope;
}

interface PendenciaRow {
  id: string;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;
  requesterTurma: string;
  inviteToken: string;
  requestedAt: string;
  currentRole: "VISITANTE";
  statusLabel: "Pendente";
}

type PendingAction = "approve" | "reject" | "";

const getRequesterLabel = (request: TenantJoinRequest): string =>
  request.requesterName.trim() ||
  request.requesterEmail.trim() ||
  request.requesterUserId.trim() ||
  "Usuário sem identificação";

const getRequesterInitial = (label: string): string => label.trim().charAt(0).toUpperCase() || "?";

const buildRows = (
  requests: TenantJoinRequest[],
  invites: TenantInvite[]
): PendenciaRow[] => {
  const inviteMap = new Map(invites.map((invite) => [invite.id, invite.token]));

  return requests.map((request) => ({
    id: request.id,
    requesterUserId: request.requesterUserId,
    requesterName: getRequesterLabel(request),
    requesterEmail: request.requesterEmail.trim() || "Sem email informado",
    requesterTurma: request.requesterTurma.trim() || "Sem turma informada",
    inviteToken: inviteMap.get(request.inviteId) || "Convite sem token visivel",
    requestedAt: request.requestedAt,
    currentRole: "VISITANTE",
    statusLabel: "Pendente",
  }));
};

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-black/60">
        <CheckCircle2 size={24} className="text-brand" />
      </div>
      <h2 className="mt-4 text-base font-black uppercase text-white">
        Fila zerada
      </h2>
      <p className="mt-2 text-sm text-zinc-400">
        Ninguém aguardando aprovação neste tenant agora.
      </p>
    </div>
  );
}

export function LaunchPendingPage({ scope }: LaunchPendingPageProps) {
  const workspace = useLaunchWorkspace(scope);
  const { user } = useAuth();
  const {
    addToast,
    authLoading,
    canAccess,
    loading: workspaceLoading,
    refreshing: workspaceRefreshing,
    refreshWorkspace,
    selectedTenant,
    selectedTenantId,
    tenantSlug,
  } = workspace;

  const [pageLoading, setPageLoading] = useState(true);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<TenantJoinRequest[]>([]);
  const [tenantInvites, setTenantInvites] = useState<TenantInvite[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState("");
  const [processingAction, setProcessingAction] = useState<PendingAction>("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(
    async (tenantId: string, mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setPageLoading(true);
      if (mode === "refresh") setPageRefreshing(true);

      const cleanTenantId = tenantId.trim();
      if (!cleanTenantId) {
        setPendingRequests([]);
        setTenantInvites([]);
        setCurrentPage(1);
        if (mode === "initial") setPageLoading(false);
        if (mode === "refresh") setPageRefreshing(false);
        return;
      }

      try {
        const [requestRows, inviteRows] = await Promise.all([
          fetchTenantJoinRequests(cleanTenantId, { status: "pending", limit: 120 }),
          fetchTenantInvites(cleanTenantId, { limit: 200 }),
        ]);
        setPendingRequests(requestRows);
        setTenantInvites(inviteRows);
        setCurrentPage(1);
      } catch (error: unknown) {
        addToast(
          `Deu ruim no plantao! 🚨 ${extractErrorMessage(error)}`,
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
      setPendingRequests([]);
      setTenantInvites([]);
      setPageLoading(false);
      setCurrentPage(1);
      return;
    }
    void loadData(selectedTenantId, "initial");
  }, [loadData, selectedTenantId, workspaceLoading]);

  const rows = useMemo(
    () => buildRows(pendingRequests, tenantInvites),
    [pendingRequests, tenantInvites]
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return rows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, rows]);

  const handleRefresh = async () => {
    const tenantId = await refreshWorkspace();
    await loadData(tenantId || selectedTenantId, "refresh");
  };

  const handleApprove = async (row: PendenciaRow) => {
    try {
      setProcessingRequestId(row.id);
      setProcessingAction("approve");
      await approveTenantJoinRequest({ requestId: row.id, approvedRole: "user" });
      await logActivity(
        user?.uid || "",
        user?.nome || "Operador",
        "UPDATE",
        "tenantJoinRequests",
        {
          resultado: "aprovado",
          requestId: row.id,
          tenantId: selectedTenantId,
          requesterUserId: row.requesterUserId,
          approvedRole: "user",
        }
      );
      await loadData(selectedTenantId, "refresh");
      addToast("Solicitação aprovada. Usuário liberado como user.", "success");
      return;
      addToast("Solicitação aprovada. Usuário liberado como user.", "success");
    } catch (error: unknown) {
      addToast(
        `Deu ruim no plantao! 🚨 ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setProcessingRequestId("");
      setProcessingAction("");
    }
  };

  const handleReject = async (row: PendenciaRow) => {
    try {
      setProcessingRequestId(row.id);
      setProcessingAction("reject");
      const rejectionReason = rejectReasons[row.id]?.trim() || undefined;
      await rejectTenantJoinRequest({
        requestId: row.id,
        reason: rejectionReason,
      });
      await logActivity(
        user?.uid || "",
        user?.nome || "Operador",
        "UPDATE",
        "tenantJoinRequests",
        {
          resultado: "rejeitado",
          requestId: row.id,
          tenantId: selectedTenantId,
          requesterUserId: row.requesterUserId,
          motivo: rejectionReason || "",
        }
      );
      setRejectReasons((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await loadData(selectedTenantId, "refresh");
      addToast("Aprovação negada e fila atualizada.", "success");
    } catch (error: unknown) {
      addToast(
        `Deu ruim no plantao! 🚨 ${extractErrorMessage(error)}`,
        "error"
      );
    } finally {
      setProcessingRequestId("");
      setProcessingAction("");
    }
  };

  if (authLoading || workspaceLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="h-10 w-10 animate-spin text-brand" />
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <LaunchPageShell
      scope={scope}
      tenantSlug={tenantSlug}
      title="Pendentes"
      subtitle="cadastros via convite aguardando aprovação"
      refreshing={workspaceRefreshing || pageRefreshing}
      onRefresh={() => void handleRefresh()}
    >
      <LaunchTenantSelectorCard
        workspace={workspace}
      helperText="A fila abaixo mostra quem entrou por convite e ainda depende de aprovação manual."
      />

      <section className="rounded-3xl border border-brand/20 bg-zinc-950/80 p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-brand" />
              <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">
                Regra de negocio
              </p>
            </div>
            <h2 className="mt-2 text-lg font-black uppercase text-white">
              Usuário fica como visitante até ser aprovado
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Enquanto a aprovação não sai, o usuário fica travado no estado de{" "}
              <span className="font-black uppercase text-zinc-200">aguardando aprovação</span>.
              A revisão pode ser feita pelo{" "}
              <span className="font-black uppercase text-zinc-200">master do tenant</span>{" "}
              ou pelo{" "}
              <span className="font-black uppercase text-zinc-200">lider da turma</span>{" "}
              no fluxo apropriado.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:min-w-[220px]">
            <div className="rounded-2xl border border-zinc-800 bg-black/60 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Tenant
              </p>
              <p className="mt-2 text-sm font-black uppercase text-white">
                {selectedTenant?.sigla || "Sem tenant"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/60 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Na fila
              </p>
              <p className="mt-2 text-sm font-black uppercase text-white">{rows.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/90">
        <div className="border-b border-zinc-800 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500">
                Fila de aprovação
              </p>
              <h2 className="mt-1 text-lg font-black uppercase text-white">
                Cadastros pendentes
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase">
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-200">
                VISITANTE
              </span>
              <span className="rounded-full border border-zinc-700 bg-black/50 px-3 py-1.5 text-zinc-300">
                Pagina {currentPage} de {totalPages}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {paginatedRows.length === 0 ? (
            <EmptyState />
          ) : (
            paginatedRows.map((row) => {
              const isProcessing = processingRequestId === row.id;
              const isApproving = isProcessing && processingAction === "approve";
              const isRejecting = isProcessing && processingAction === "reject";
              const rejectionReason = rejectReasons[row.id] || "";

              return (
                <article
                  key={row.id}
                  className="rounded-3xl border border-zinc-800 bg-black/40 p-4 sm:p-5"
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_180px_140px]">
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-base font-black uppercase text-white">
                          {getRequesterInitial(row.requesterName)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black uppercase text-white sm:text-base">
                            {row.requesterName}
                          </h3>
                          <p className="truncate text-sm text-zinc-400">{row.requesterEmail}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold uppercase">
                            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-300">
                              Turma {row.requesterTurma}
                            </span>
                            <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-brand">
                              Token {row.inviteToken}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          Solicitado em
                        </p>
                        <p className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-white">
                          <Clock3 size={14} className="text-zinc-500" />
                          {formatLaunchDate(row.requestedAt)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          Estado atual
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase">
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                            {row.currentRole}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-200">
                            {row.statusLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          Motivo da rejeicao
                        </span>
                        <textarea
                          value={rejectionReason}
                          onChange={(event) =>
                            setRejectReasons((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          rows={3}
                          maxLength={160}
                          placeholder="Opcional. Ex: cadastro duplicado."
                          className="mt-2 w-full resize-none rounded-2xl border border-zinc-700 bg-black px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand"
                        />
                      </label>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                        <button
                          type="button"
                          onClick={() => void handleApprove(row)}
                          disabled={isProcessing}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-solid px-4 py-3 text-sm font-black uppercase tracking-wide text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isApproving ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}
                          {isApproving ? "Aprovando..." : "Aprovar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReject(row)}
                          disabled={isProcessing}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-black uppercase tracking-wide text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRejecting ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <XCircle size={16} />
                          )}
                          {isRejecting ? "Rejeitando..." : "Rejeitar"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {rows.length > 0 && (
          <div className="border-t border-zinc-800 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-400">
                Mostrando{" "}
                <span className="font-black text-zinc-100">
                  {(currentPage - 1) * PAGE_SIZE + 1}
                </span>{" "}
                a{" "}
                <span className="font-black text-zinc-100">
                  {Math.min(currentPage * PAGE_SIZE, rows.length)}
                </span>{" "}
                de{" "}
                <span className="font-black text-zinc-100">{rows.length}</span>{" "}
                pendencias.
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-black uppercase text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((page) => Math.min(totalPages, page + 1))
                  }
                  disabled={currentPage >= totalPages}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-black uppercase text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </LaunchPageShell>
  );
}
