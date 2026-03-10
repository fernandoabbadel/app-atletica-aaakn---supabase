"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldEllipsis,
  XCircle,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  approveTenantOnboardingRequest,
  fetchTenantOnboardingRequests,
  rejectTenantOnboardingRequest,
  type TenantOnboardingRequest,
} from "@/lib/tenantService";

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Erro inesperado.";
};

export default function MasterSolicitacoesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<TenantOnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const loadRows = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);

      try {
        const pending = await fetchTenantOnboardingRequests({
          status: "pending",
          limit: 80,
        });
        setRows(pending);
      } catch (error: unknown) {
        addToast(
          `Erro ao carregar solicitacoes: ${extractErrorMessage(error)}`,
          "error"
        );
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    void loadRows("initial");
  }, [loadRows]);

  const handleApprove = async (requestId: string) => {
    try {
      setBusyId(requestId);
      await approveTenantOnboardingRequest(requestId);
      await loadRows("refresh");
      addToast("Atlética aprovada com sucesso.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao aprovar: ${extractErrorMessage(error)}`, "error");
    } finally {
      setBusyId("");
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      setBusyId(requestId);
      await rejectTenantOnboardingRequest({
        requestId,
        reason: rejectReason.trim() || undefined,
      });
      setRejectReason("");
      await loadRows("refresh");
      addToast("Solicitação rejeitada.", "success");
    } catch (error: unknown) {
      addToast(`Erro ao rejeitar: ${extractErrorMessage(error)}`, "error");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/master"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="inline-flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                <ShieldEllipsis size={18} className="text-fuchsia-400" />
                Solicitações da Plataforma
              </h1>
              <p className="text-[11px] font-bold uppercase text-zinc-500">
                aprovações de criação de atléticas
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/nova-atletica?mode=master"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase text-white hover:bg-emerald-500"
            >
              <Plus size={14} />
              Criar Atletica
            </Link>
            <button
              onClick={() => void loadRows("refresh")}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">
            Fluxo Direto do Master
          </p>
          <h2 className="mt-2 text-lg font-black uppercase text-white">
            O master da plataforma pode criar e operar mais de uma atletica
          </h2>
          <p className="mt-2 text-sm text-emerald-50/80">
            Use o botao acima para abrir o cadastro direto da nova atletica sem passar pela
            fila publica de solicitacoes.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <label className="block text-[11px] font-bold uppercase text-zinc-500">
            Motivo para rejeição
            <input
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Ex: dados incompletos"
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </label>
        </section>

        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-sm font-black uppercase text-zinc-400">
            Carregando solicitações...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Nenhuma nova atlética aguardando aprovação.
          </div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {rows.map((request) => {
              const isBusy = busyId === request.id;
              return (
                <article
                  key={request.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black uppercase text-white">
                        {request.sigla} - {request.nome}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                        {request.faculdade || "Sem faculdade"} • {request.cidade || "Sem cidade"}
                      </p>
                    </div>
                    <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-black uppercase text-fuchsia-200">
                      pendente
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        Curso
                      </p>
                      <p>{request.curso || "Não informado"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        Área
                      </p>
                      <p>{request.area || "Não informada"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        E-mail
                      </p>
                      <p>{request.contatoEmail || "Não informado"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        Telefone
                      </p>
                      <p>{request.contatoTelefone || "Não informado"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        Solicitante
                      </p>
                      <p>{request.requesterName || request.requesterEmail || request.requesterUserId}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        Paleta
                      </p>
                      <p>{request.paletteKey}</p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleApprove(request.id)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Aprovar
                    </button>
                    <button
                      onClick={() => void handleReject(request.id)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] font-black uppercase text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                      Rejeitar
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
