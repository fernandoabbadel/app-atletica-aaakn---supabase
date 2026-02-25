"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { fetchPlanRequests, type PlanRequestRecord } from "../../../../lib/plansService";

const PAGE_SIZE = 20;

export default function AdminPlanosHistoricoPage() {
  const [rows, setRows] = useState<PlanRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const requests = await fetchPlanRequests({ maxResults: 400, forceRefresh: true });
        if (!mounted) return;
        setRows(requests);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

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
            <h1 className="text-xl font-black uppercase tracking-tight">Historico</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Solicitacoes de adesao</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem solicitacoes.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{row.userName || "Aluno"}</p>
                <p className="text-[11px] text-zinc-400 uppercase">{row.planoNome || row.planoId}</p>
                <p className="text-[10px] text-zinc-500 font-mono">#{row.id.slice(0, 10)}</p>
              </div>

              <div className="text-right">
                <p className="text-sm font-black text-emerald-400">R$ {Number(row.valor || 0).toFixed(2)}</p>
                <p className={`text-[10px] font-bold uppercase ${row.status === "aprovado" ? "text-emerald-400" : row.status === "rejeitado" ? "text-red-400" : "text-yellow-400"}`}>
                  {row.status}
                </p>
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
