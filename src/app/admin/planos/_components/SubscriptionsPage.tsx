"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { fetchPlanSubscriptions, type PlanSubscriptionRecord } from "../../../../lib/plansService";
import { useTenantTheme } from "@/context/TenantThemeContext";

const PAGE_SIZE = 20;

interface SubscriptionListPageProps {
  title: string;
  planMatcher: (row: PlanSubscriptionRecord) => boolean;
}

export function SubscriptionListPage({ title, planMatcher }: SubscriptionListPageProps) {
  const { tenantId } = useTenantTheme();
  const [rows, setRows] = useState<PlanSubscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const subscriptions = await fetchPlanSubscriptions({
          maxResults: 600,
          forceRefresh: true,
          tenantId,
        });
        if (!mounted) return;
        setRows(subscriptions.filter(planMatcher));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [planMatcher, tenantId]);

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
            <h1 className="text-xl font-black uppercase tracking-tight">{title}</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Paginado 20 em 20</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Nenhuma assinatura encontrada.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-full overflow-hidden border border-zinc-700 bg-black">
                <Image src={row.foto || "https://github.com/shadcn.png"} alt={row.aluno} fill  className="object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{row.aluno || "Aluno"}</p>
                <p className="text-[11px] text-zinc-400 uppercase">{row.turma || "-"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase text-zinc-400">{row.planoNome || row.planoId}</p>
                <p className="text-sm font-black text-emerald-400">R$ {Number(row.valorPago || 0).toFixed(2)}</p>
              </div>
            </article>
          ))
        )}

        {rows.length > PAGE_SIZE && (
          <div className="pt-2 flex items-center justify-between text-xs text-zinc-500 font-bold uppercase">
            <span>Pagina {page} de {totalPages}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Anterior</button>
              <button onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40">Proxima</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
