"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { fetchSupportReports, type AdminReportRecord } from "../../../../lib/reportsService";
import { isPermissionError } from "@/lib/backendErrors";

const PAGE_SIZE = 20;

export default function AdminDenunciasSuportePage() {
  const [rows, setRows] = useState<AdminReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const reports = await fetchSupportReports(240);
        if (!mounted) return;
        setRows(reports);
      } catch (error: unknown) {
        if (!isPermissionError(error) && mounted) {
          setRows([]);
        }
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
          <Link href="/admin/denuncias" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Suporte</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Integrado com /configuracoes/suporte</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem chamados de suporte.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{row.autor}</p>
                <span className={`text-[10px] font-bold uppercase ${row.status === "resolvida" ? "text-emerald-400" : "text-yellow-400"}`}>{row.status}</span>
              </div>
              <p className="text-xs text-zinc-400">{row.motivo}</p>
              <p className="text-xs text-zinc-500 line-clamp-3">{row.descricao}</p>
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

