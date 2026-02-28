"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Trash2, X } from "lucide-react";

import {
  approvePlanRequest,
  deletePlanRequestAndUnlock,
  fetchPlanCatalog,
  fetchPlanRequests,
  rejectPlanRequest,
  type PlanRecord,
  type PlanRequestRecord,
} from "../../../../lib/plansService";
import { useToast } from "../../../../context/ToastContext";
import { useAuth } from "../../../../context/AuthContext";
import { logActivity } from "../../../../lib/logger";

const PAGE_SIZE = 20;
const normalizeToken = (value: string) => value.trim().toLowerCase();

const resolveTier = (plan: PlanRecord): "lenda" | "atleta" | "cardume" | "bicho" => {
  const key = `${plan.id} ${plan.nome}`.toLowerCase();
  if (key.includes("lenda")) return "lenda";
  if (key.includes("atleta")) return "atleta";
  if (key.includes("cardume")) return "cardume";
  return "bicho";
};

export default function AdminPlanosHistoricoPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<PlanRequestRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    const [requests, catalog] = await Promise.all([
      fetchPlanRequests({ maxResults: 400, forceRefresh: true }),
      fetchPlanCatalog({ maxResults: 80, forceRefresh: true }),
    ]);
    setRows(requests);
    setPlans(catalog);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const [requests, catalog] = await Promise.all([
          fetchPlanRequests({ maxResults: 400, forceRefresh: true }),
          fetchPlanCatalog({ maxResults: 80, forceRefresh: true }),
        ]);
        if (!mounted) return;
        setRows(requests);
        setPlans(catalog);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const findPlanForRequest = (row: PlanRequestRecord): PlanRecord | null => {
    const byId = plans.find((plan) => normalizeToken(plan.id) === normalizeToken(row.planoId));
    if (byId) return byId;
    const byName = plans.find((plan) => normalizeToken(plan.nome) === normalizeToken(row.planoNome));
    return byName || null;
  };

  const handleApprove = async (row: PlanRequestRecord) => {
    const plan = findPlanForRequest(row);
    if (!plan) {
      addToast("Plano nao encontrado no catalogo para aprovar este pedido.", "error");
      return;
    }

    setBusyId(row.id);
    try {
      await approvePlanRequest({
        requestId: row.id,
        userId: row.userId,
        userName: row.userName,
        userTurma: row.userTurma,
        planoId: plan.id,
        planoNome: plan.nome,
        valor: plan.precoVal,
        userPatch: {
          plano: plan.nome,
          planoBadge: plan.nome,
          planoCor: plan.cor,
          planoIcon: plan.icon,
          tier: resolveTier(plan),
          xpMultiplier: plan.xpMultiplier,
          nivelPrioridade: plan.nivelPrioridade,
          descontoLoja: plan.descontoLoja,
        },
      });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Planos/Pedidos",
          `Aprovou comprovante de plano: ${row.userName || row.userId} -> ${plan.nome}`
        ).catch(() => {});
      }
      addToast("Pedido aprovado com sucesso.", "success");
      await load();
    } catch (error: unknown) {
      console.error("Erro ao aprovar pedido de plano:", error);
      addToast("Erro ao aprovar pedido.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (row: PlanRequestRecord) => {
    setBusyId(row.id);
    try {
      await rejectPlanRequest({
        requestId: row.id,
        userId: row.userId,
      });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Planos/Pedidos",
          `Rejeitou comprovante de plano: ${row.userName || row.userId} -> ${row.planoNome || row.planoId}`
        ).catch(() => {});
      }
      addToast("Pedido rejeitado.", "success");
      await load();
    } catch (error: unknown) {
      console.error("Erro ao rejeitar pedido de plano:", error);
      addToast("Erro ao rejeitar pedido.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: PlanRequestRecord) => {
    if (!confirm("Excluir esta solicitacao?")) return;
    setBusyId(row.id);
    try {
      await deletePlanRequestAndUnlock({
        requestId: row.id,
        userId: row.userId,
      });
      addToast("Solicitacao excluida.", "success");
      await load();
    } catch (error: unknown) {
      console.error("Erro ao excluir solicitacao de plano:", error);
      addToast("Erro ao excluir solicitacao.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/planos" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Histórico</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Solicitações de adesão</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem solicitações.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{row.userName || "Aluno"}</p>
                <p className="text-[11px] text-zinc-400 uppercase">{row.planoNome || row.planoId}</p>
                <p className="text-[10px] text-zinc-500 font-mono">#{row.id.slice(0, 10)}</p>
              </div>

              <div className="text-right min-w-[210px]">
                <p className="text-sm font-black text-emerald-400">R$ {Number(row.valor || 0).toFixed(2)}</p>
                <p className={`text-[10px] font-bold uppercase ${row.status === "aprovado" ? "text-emerald-400" : row.status === "rejeitado" ? "text-red-400" : "text-yellow-400"}`}>
                  {row.status}
                </p>
                {row.status === "pendente" && (
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => void handleApprove(row)}
                      disabled={busyId === row.id}
                      className="px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Check size={12} /> Aprovar
                    </button>
                    <button
                      onClick={() => void handleReject(row)}
                      disabled={busyId === row.id}
                      className="px-2.5 py-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-[10px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <X size={12} /> Rejeitar
                    </button>
                  </div>
                )}
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => void handleDelete(row)}
                    disabled={busyId === row.id}
                    className="px-2.5 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-[10px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Trash2 size={12} /> Excluir
                  </button>
                </div>
              </div>
            </article>
          ))
        )}

        {rows.length > PAGE_SIZE && (
          <div className="pt-2 flex items-center justify-between text-xs text-zinc-500 font-bold uppercase">
            <span>Página {page} de {totalPages}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Anterior</button>
              <button onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Próxima</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
