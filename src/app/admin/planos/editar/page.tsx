"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";

import {
  deletePlan,
  fetchPlanCatalog,
  type PlanRecord,
} from "../../../../lib/plansService";
import { useToast } from "../../../../context/ToastContext";

export default function AdminPlanosEditarPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (forceRefresh = true) => {
    const plans = await fetchPlanCatalog({ maxResults: 40, forceRefresh });
    setRows(plans);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await load(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Remover plano?")) return;
    try {
      await deletePlan(id);
      addToast("Plano removido.", "success");
      await load(true);
    } catch {
      addToast("Erro ao remover plano.", "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/planos" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Editar</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Catalogo de planos</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem planos cadastrados.</div>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold">{row.nome}</p>
                <p className="text-[11px] text-zinc-400 uppercase">Prioridade: {row.nivelPrioridade}</p>
                <p className="text-sm font-black text-emerald-400">R$ {Number(row.precoVal || 0).toFixed(2)}</p>
              </div>
              <button onClick={() => void handleDelete(row.id)} className="p-2 rounded-lg border border-red-500/30 bg-red-900/20 text-red-400 hover:bg-red-900/40">
                <Trash2 size={14} />
              </button>
            </article>
          ))
        )}
      </main>
    </div>
  );
}
