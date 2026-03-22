"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Dumbbell } from "lucide-react";

import {
  fetchGymModerationReports,
  type AdminModerationRecord,
} from "../../../../lib/reportsService";
import { isPermissionError } from "@/lib/backendErrors";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

const PAGE_SIZE = 20;

export default function AdminDenunciasGymPage() {
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/denuncias") : "/admin/denuncias";
  const [rows, setRows] = useState<AdminModerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const reports = await fetchGymModerationReports(240, {
          tenantId: activeTenantId || undefined,
        });
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
  }, [activeTenantId]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Gym</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Denuncias do modulo de treino e check-in</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">
            Sem denuncias de gym no periodo.
          </div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{row.autor}</p>
                <span
                  className={`text-[10px] uppercase font-bold ${
                    row.status === "resolvida" ? "text-emerald-400" : "text-yellow-400"
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <p className="text-xs text-zinc-400">{row.mensagem}</p>
              <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-3">
                <span>{row.data}</span>
                {row.reporterId ? (
                  <Link
                    href={`/admin/usuarios/${row.reporterId}`}
                    className="text-emerald-400 hover:underline"
                  >
                    Usuario
                  </Link>
                ) : null}
              </div>
            </article>
          ))
        )}

        {rows.length > PAGE_SIZE && (
          <div className="pt-2 flex items-center justify-between text-xs text-zinc-500 font-bold uppercase">
            <span>
              Pagina {page} de {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          </div>
        )}

        <div className="text-[11px] text-zinc-600 inline-flex items-center gap-2">
          <Dumbbell size={13} />
          Leitura paginada e cacheada para reduzir custo.
        </div>
      </main>
    </div>
  );
}

