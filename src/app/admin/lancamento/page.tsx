"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCw,
  Rocket,
  UserCheck2,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  approveTenantJoinRequest,
  createTenantInvite,
  fetchManageableTenants,
  fetchTenantInvites,
  fetchTenantJoinRequests,
  fetchTenantPlatformConfig,
  rejectTenantJoinRequest,
  setTenantLaunchTokenizationActive,
  type TenantInvite,
  type TenantJoinRequest,
  type TenantSummary,
} from "@/lib/tenantService";

type InviteRole = "visitante" | "user" | "admin_tenant";

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

const normalizeIntegerInput = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
};

export default function AdminLancamentoPage() {
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingTokenization, setSavingTokenization] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState("");

  const [tokenizationActive, setTokenizationActive] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [invites, setInvites] = useState<TenantInvite[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TenantJoinRequest[]>([]);

  const [inviteRole, setInviteRole] = useState<InviteRole>("user");
  const [inviteUses, setInviteUses] = useState(25);
  const [inviteHours, setInviteHours] = useState(72);
  const [inviteRequiresApproval, setInviteRequiresApproval] = useState(true);
  const [rejectReason, setRejectReason] = useState("");
  const [origin, setOrigin] = useState("");
  const initialLoadRef = useRef(false);

  const isPlatformMaster = String(user?.role || "")
    .trim()
    .toLowerCase() === "master";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
  }, []);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [selectedTenantId, tenants]
  );

  const latestInvite = invites[0] || null;
  const latestInviteLink =
    latestInvite && origin
      ? `${origin}/cadastro?invite=${encodeURIComponent(latestInvite.token)}`
      : "";

  const loadTenantScopedData = useCallback(async (tenantId: string): Promise<void> => {
    const cleanTenantId = tenantId.trim();
    if (!cleanTenantId) {
      setInvites([]);
      setPendingRequests([]);
      return;
    }

    const [invitesRows, requestsRows] = await Promise.all([
      fetchTenantInvites(cleanTenantId, { limit: 25 }),
      fetchTenantJoinRequests(cleanTenantId, { status: "pending", limit: 80 }),
    ]);
    setInvites(invitesRows);
    setPendingRequests(requestsRows);
  }, []);

  const loadPageData = useCallback(
    async (mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "refresh") setRefreshing(true);
      if (mode === "initial") setLoading(true);

      try {
        const [platformConfig, tenantRows] = await Promise.all([
          fetchTenantPlatformConfig(),
          fetchManageableTenants({ includeAll: isPlatformMaster }),
        ]);

        setTokenizationActive(platformConfig.tokenizationActive);
        setTenants(tenantRows);

        const fallbackTenantId = tenantRows[0]?.id || "";
        const nextTenantId = tenantRows.some((entry) => entry.id === selectedTenantId)
          ? selectedTenantId
          : fallbackTenantId;

        setSelectedTenantId(nextTenantId);
        await loadTenantScopedData(nextTenantId);
      } catch (error: unknown) {
        addToast(`Erro ao carregar lancamento: ${extractErrorMessage(error)}`, "error");
      } finally {
        if (mode === "refresh") setRefreshing(false);
        if (mode === "initial") setLoading(false);
      }
    },
    [addToast, isPlatformMaster, loadTenantScopedData, selectedTenantId]
  );

  useEffect(() => {
    if (authLoading || initialLoadRef.current) return;
    initialLoadRef.current = true;
    void loadPageData("initial");
  }, [authLoading, loadPageData]);

  useEffect(() => {
    if (!selectedTenantId || loading) return;

    let mounted = true;
    const syncTenantData = async () => {
      try {
        const [invitesRows, requestsRows] = await Promise.all([
          fetchTenantInvites(selectedTenantId, { limit: 25 }),
          fetchTenantJoinRequests(selectedTenantId, { status: "pending", limit: 80 }),
        ]);
        if (!mounted) return;
        setInvites(invitesRows);
        setPendingRequests(requestsRows);
      } catch (error: unknown) {
        if (!mounted) return;
        addToast(`Erro ao atualizar dados do tenant: ${extractErrorMessage(error)}`, "error");
      }
    };

    void syncTenantData();
    return () => {
      mounted = false;
    };
  }, [addToast, loading, selectedTenantId]);

  const handleToggleTokenization = async () => {
    if (!isPlatformMaster) {
      addToast("Somente o master da plataforma pode alternar a tokenizacao.", "error");
      return;
    }

    const nextValue = !tokenizationActive;
    try {
      setSavingTokenization(true);
      await setTenantLaunchTokenizationActive(nextValue);
      setTokenizationActive(nextValue);
      addToast(
        nextValue ? "Tokenizacao ativada para novos cadastros." : "Tokenizacao pausada.",
        "success"
      );
    } catch (error: unknown) {
      addToast(`Erro ao atualizar tokenizacao: ${extractErrorMessage(error)}`, "error");
    } finally {
      setSavingTokenization(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!selectedTenant) {
      addToast("Selecione uma atletica para gerar convite.", "error");
      return;
    }

    try {
      setCreatingInvite(true);
      const createdInvite = await createTenantInvite({
        tenantId: selectedTenant.id,
        roleToAssign: inviteRole,
        maxUses: normalizeIntegerInput(inviteUses, 1, 500, 25),
        expiresInHours: normalizeIntegerInput(inviteHours, 1, 24 * 30, 72),
        requiresApproval: inviteRequiresApproval,
      });

      setInvites((prev) => [
        createdInvite,
        ...prev.filter((invite) => invite.id !== createdInvite.id),
      ]);

      addToast("Convite criado com sucesso.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao criar convite: ${extractErrorMessage(error)}`, "error");
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyInvite = async (value: string) => {
    if (!value.trim()) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("Clipboard indisponivel.");
      }
      addToast("Link copiado para a area de transferencia.", "success");
    } catch {
      addToast("Nao foi possivel copiar automaticamente.", "error");
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    if (!requestId.trim()) return;
    try {
      setProcessingRequestId(requestId);
      await approveTenantJoinRequest({ requestId, approvedRole: "user" });
      setPendingRequests((prev) => prev.filter((request) => request.id !== requestId));
      addToast("Solicitacao aprovada.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao aprovar solicitacao: ${extractErrorMessage(error)}`, "error");
    } finally {
      setProcessingRequestId("");
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!requestId.trim()) return;
    try {
      setProcessingRequestId(requestId);
      await rejectTenantJoinRequest({
        requestId,
        reason: rejectReason.trim() || undefined,
      });
      setPendingRequests((prev) => prev.filter((request) => request.id !== requestId));
      setRejectReason("");
      addToast("Solicitacao rejeitada.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao rejeitar solicitacao: ${extractErrorMessage(error)}`, "error");
    } finally {
      setProcessingRequestId("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        Carregando modulo de lancamento...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 font-sans">
      <header className="sticky top-0 z-20 bg-[#050505]/95 backdrop-blur border-b border-zinc-800 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight inline-flex items-center gap-2">
                <Rocket size={18} className="text-emerald-400" />
                Projeto de Lancamento
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold uppercase">
                Convites, aprovacoes e tokenizacao global
              </p>
            </div>
          </div>

          <button
            onClick={() => void loadPageData("refresh")}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-black uppercase inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-emerald-400">
                Tokenizacao Global
              </h2>
              <p className="text-[11px] text-zinc-500 font-bold">
                Quando desligada, bloqueia novos cadastros sem impactar usuarios ja aprovados.
              </p>
            </div>
            <button
              onClick={handleToggleTokenization}
              disabled={savingTokenization || !isPlatformMaster}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase inline-flex items-center gap-2 border disabled:opacity-60 ${
                tokenizationActive
                  ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                  : "bg-zinc-800 border-zinc-600 text-zinc-200"
              }`}
            >
              <KeyRound size={14} />
              {tokenizationActive ? "Ativa" : "Pausada"}
            </button>
          </div>
          {!isPlatformMaster && (
            <p className="text-[11px] text-amber-300 font-bold uppercase">
              Apenas usuario com role `master` pode alterar este switch.
            </p>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-[11px] text-zinc-400 font-bold uppercase">
                Atletica para gerenciamento
              </label>
              <select
                value={selectedTenantId}
                onChange={(event) => setSelectedTenantId(event.target.value)}
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.sigla} - {tenant.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Status</label>
              <div className="mt-1 px-3 py-2 rounded-xl bg-black border border-zinc-700 text-xs font-black uppercase text-zinc-300">
                {selectedTenant ? selectedTenant.status : "Sem tenant"}
              </div>
            </div>
          </div>

          {tenants.length === 0 && (
            <p className="text-sm text-zinc-400">
              Nenhuma atletica disponivel para seu usuario neste momento.
            </p>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-black uppercase text-cyan-400">Gerar Link de Convite</h2>
            <p className="text-[11px] text-zinc-500 font-bold">
              O convidado entra como visitante e aguarda aprovacao se a flag estiver ativa.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Role final</label>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as InviteRole)}
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              >
                <option value="visitante">visitante</option>
                <option value="user">user</option>
                <option value="admin_tenant">admin_tenant</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Max usos</label>
              <input
                type="number"
                min={1}
                max={500}
                value={inviteUses}
                onChange={(event) => setInviteUses(Number(event.target.value))}
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-bold uppercase">Expira em horas</label>
              <input
                type="number"
                min={1}
                max={24 * 30}
                value={inviteHours}
                onChange={(event) => setInviteHours(Number(event.target.value))}
                className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
                <input
                  type="checkbox"
                  checked={inviteRequiresApproval}
                  onChange={(event) => setInviteRequiresApproval(event.target.checked)}
                  className="accent-emerald-500"
                />
                Exige aprovacao
              </label>
            </div>
          </div>

          <button
            onClick={handleCreateInvite}
            disabled={creatingInvite || !selectedTenant}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-xs font-black uppercase inline-flex items-center gap-2"
          >
            <KeyRound size={14} />
            {creatingInvite ? "Gerando..." : "Gerar Convite"}
          </button>

          {latestInvite && (
            <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3">
              <p className="text-[11px] font-black uppercase text-cyan-200">
                Ultimo token: {latestInvite.token}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="text-[11px] text-cyan-100 break-all">{latestInviteLink}</code>
                <button
                  onClick={() => void handleCopyInvite(latestInviteLink)}
                  className="px-2 py-1 rounded-md border border-cyan-400/40 text-[10px] font-black uppercase inline-flex items-center gap-1"
                >
                  <Copy size={12} />
                  Copiar Link
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase text-amber-300">
                Solicitacoes Pendentes
              </h2>
              <p className="text-[11px] text-zinc-500 font-bold">
                Ao aprovar, o usuario vira `user`. Reprovar remove o vinculo em andamento.
              </p>
            </div>
            <div className="text-xs font-black uppercase text-zinc-300">
              {pendingRequests.length} pendente(s)
            </div>
          </div>

          <div>
            <label className="text-[11px] text-zinc-400 font-bold uppercase">
              Motivo para rejeicao (opcional)
            </label>
            <input
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Ex: cadastro duplicado"
              className="mt-1 w-full bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            {pendingRequests.map((request) => {
              const isBusy = processingRequestId === request.id;
              const requesterName =
                request.requesterName || request.requesterEmail || request.requesterUserId;

              return (
                <div
                  key={request.id}
                  className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-white inline-flex items-center gap-2">
                        <UserCheck2 size={14} className="text-cyan-300" />
                        {requesterName}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        role pedida: {request.requestedRole} | turma: {request.requesterTurma || "-"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleApproveRequest(request.id)}
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs font-black uppercase text-emerald-300 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        <CheckCircle2 size={14} />
                        Aprovar
                      </button>
                      <button
                        onClick={() => void handleRejectRequest(request.id)}
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/40 text-xs font-black uppercase text-red-300 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        <XCircle size={14} />
                        Reprovar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {pendingRequests.length === 0 && (
            <p className="text-sm text-zinc-400">
              Nenhuma solicitacao pendente para este tenant.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
