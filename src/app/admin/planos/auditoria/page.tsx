"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import {
  fetchPlanRequests,
  fetchPlanSubscriptions,
  type PlanRequestRecord,
  type PlanSubscriptionRecord,
} from "../../../../lib/plansService";

export default function AdminPlanosAuditoriaPage() {
  const [requests, setRequests] = useState<PlanRequestRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<PlanSubscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [requestRows, subscriptionRows] = await Promise.all([
          fetchPlanRequests({ maxResults: 300, forceRefresh: true }),
          fetchPlanSubscriptions({ maxResults: 600, forceRefresh: true }),
        ]);
        if (!mounted) return;
        setRequests(requestRows);
        setSubscriptions(subscriptionRows);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const pending = requests.filter((row) => row.status === "pendente").length;
    const approved = requests.filter((row) => row.status === "aprovado").length;
    const rejected = requests.filter((row) => row.status === "rejeitado").length;
    const activeSubs = subscriptions.filter((row) => row.status === "ativo").length;
    const pendingSubs = subscriptions.filter((row) => row.status === "pendente").length;

    return { pending, approved, rejected, activeSubs, pendingSubs };
  }, [requests, subscriptions]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/planos" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Auditoria</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Conferencia de fluxo dos planos</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Solicitacoes pendentes</p>
              <p className="text-3xl font-black text-yellow-400 mt-2">{metrics.pending}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Solicitacoes aprovadas</p>
              <p className="text-3xl font-black text-emerald-400 mt-2">{metrics.approved}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Solicitacoes rejeitadas</p>
              <p className="text-3xl font-black text-red-400 mt-2">{metrics.rejected}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Assinaturas ativas</p>
              <p className="text-3xl font-black text-blue-400 mt-2">{metrics.activeSubs}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Assinaturas pendentes</p>
              <p className="text-3xl font-black text-orange-400 mt-2">{metrics.pendingSubs}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-end justify-between">
              <p className="text-[10px] text-zinc-500 uppercase font-bold">Status geral</p>
              <div className="text-emerald-400 inline-flex items-center gap-1 text-sm font-black">
                <ShieldCheck size={15} /> OK
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
