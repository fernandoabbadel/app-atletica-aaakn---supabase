"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Shield, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { buildLoginPath } from "@/lib/authRedirect";
import { resolveEffectiveAccessRole } from "@/lib/roles";
import {
  fetchTurmaLeaderPendingRequests,
  reviewTurmaLeaderPendingRequest,
  type TurmaLeaderPendingRequest,
} from "@/lib/turmaLeaderService";
import { withTenantSlug } from "@/lib/tenantRouting";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export default function ConfiguracoesLiderTurmaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const { tenantName, tenantSlug } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState<TurmaLeaderPendingRequest[]>([]);
  const [leaderTurma, setLeaderTurma] = useState("");
  const [canManageAll, setCanManageAll] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState("");

  const extra = useMemo(() => asObject(user?.extra) ?? {}, [user?.extra]);
  const isTurmaLeader = extra.turmaLeader === true;
  const effectiveAccessRole = resolveEffectiveAccessRole(user);
  const canManageAllByRole =
    user?.role === "master" ||
    effectiveAccessRole === "master_tenant" ||
    effectiveAccessRole === "admin_geral" ||
    effectiveAccessRole === "admin_gestor";
  const canAccess = Boolean(user) && (isTurmaLeader || canManageAllByRole);
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/configuracoes") : "/configuracoes";
  const pageHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/lider-turma")
    : "/configuracoes/lider-turma";

  const loadData = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);

      try {
        const response = await fetchTurmaLeaderPendingRequests();
        setRequests(response.requests);
        setLeaderTurma(response.leaderTurma);
        setCanManageAll(response.canManageAll);
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Erro ao carregar pendencias da turma.";
        addToast(message, "error");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(buildLoginPath(pageHref));
      return;
    }
    if (!canAccess) {
      router.replace(tenantSlug ? withTenantSlug(tenantSlug, "/sem-permissao") : "/sem-permissao");
      return;
    }
    void loadData("initial");
  }, [authLoading, canAccess, loadData, pageHref, router, tenantSlug, user]);

  const reviewRequest = async (
    requestId: string,
    action: "approve" | "reject"
  ) => {
    try {
      setProcessingRequestId(requestId);
      const reason =
        action === "reject"
          ? window.prompt("Motivo da rejeicao (opcional):", "") || ""
          : "";
      await reviewTurmaLeaderPendingRequest({ requestId, action, reason });
      await loadData("refresh");
      addToast(
        action === "approve" ? "Solicitacao aprovada." : "Solicitacao rejeitada.",
        "success"
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao revisar solicitacao.";
      addToast(message, "error");
    } finally {
      setProcessingRequestId("");
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="h-10 w-10 animate-spin text-brand" />
      </div>
    );
  }

  if (!user || !canAccess) return null;

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                <Shield size={18} className="text-cyan-400" />
                Lider da Turma
              </h1>
              <p className="text-[11px] font-bold uppercase text-zinc-500">
                {canManageAll
                  ? `visao completa do tenant ${tenantName || ""}`.trim()
                  : `pendencias da turma ${leaderTurma || user.turma || ""}`.trim()}
              </p>
            </div>
          </div>

          <button
            onClick={() => void loadData("refresh")}
            disabled={refreshing}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          >
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-black uppercase text-cyan-300">
            Aprovacoes pendentes
          </h2>
          <p className="mt-1 text-[11px] font-medium text-zinc-500">
            {canManageAll
              ? "Voce enxerga todas as solicitacoes do tenant."
              : "Voce so pode revisar usuarios da sua propria turma."}
          </p>

          <div className="mt-4 space-y-3">
            {requests.map((request) => {
              const isProcessing = processingRequestId === request.id;
              return (
                <div
                  key={request.id}
                  className="rounded-2xl border border-zinc-800 bg-black/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">
                        {request.requesterName || request.requesterEmail || request.requesterUserId}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {request.requesterEmail || "Sem email"} • {request.requesterTurma || "Sem turma"}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Convite: {request.inviteToken || "manual"} • origem:{" "}
                        {request.inviterName || request.inviterEmail || "sem criador"}
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-black uppercase text-zinc-300">
                      {request.requestedAt ? new Date(request.requestedAt).toLocaleDateString("pt-BR") : "agora"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void reviewRequest(request.id, "approve")}
                      disabled={isProcessing}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      <CheckCircle2 size={14} />
                      Aprovar user
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewRequest(request.id, "reject")}
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

            {requests.length === 0 && (
              <p className="text-sm text-zinc-400">
                Nenhuma solicitacao pendente para a sua faixa de lideranca.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
