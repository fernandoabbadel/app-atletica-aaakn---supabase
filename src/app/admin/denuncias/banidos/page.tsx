"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";

import { isPermissionError } from "@/lib/backendErrors";
import {
  deleteAdminReport,
  fetchBannedAppeals,
  resolveAdminReport,
  type AdminReportRecord,
} from "@/lib/reportsService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

const PAGE_SIZE = 20;

export default function AdminDenunciasBanidosPage() {
  const { tenantId: activeTenantId } = useTenantTheme();
  const pathname = usePathname() || "/admin/denuncias/banidos";
  const pathInfo = parseTenantScopedPath(pathname);
  const backHref = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/admin/denuncias")
    : "/admin/denuncias";

  const [rows, setRows] = useState<AdminReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [responseById, setResponseById] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const reports = await fetchBannedAppeals(240, {
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setRows(reports);
        setResponseById(
          reports.reduce<Record<string, string>>((acc, row) => {
            acc[row.id] = row.respostaAdmin || "";
            return acc;
          }, {})
        );
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
  }, [page, rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const handleResolve = async (row: AdminReportRecord) => {
    const response = (responseById[row.id] || "").trim();
    if (!response) return;

    try {
      setBusyId(row.id);
      await resolveAdminReport({
        reportId: row.id,
        originCollection: row.originCollection,
        response,
        reporterId: row.reporterId,
        tenantId: activeTenantId || undefined,
      });
      setRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? { ...entry, status: "resolvida", respostaAdmin: response }
            : entry
        )
      );
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (row: AdminReportRecord) => {
    try {
      setBusyId(row.id);
      await deleteAdminReport({
        reportId: row.id,
        originCollection: row.originCollection,
        tenantId: activeTenantId || undefined,
      });
      setRows((prev) => prev.filter((entry) => entry.id !== row.id));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Banidos</h1>
            <p className="text-[11px] font-bold text-zinc-500">
              Recursos e devolutivas do fluxo de bloqueio
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {loading ? (
          <div className="text-xs font-bold uppercase text-zinc-500">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-500">
            Sem recursos de banidos.
          </div>
        ) : (
          paged.map((row) => {
            const response = responseById[row.id] || "";
            const isBusy = busyId === row.id;
            const isResolved = row.status === "resolvida";

            return (
              <article
                key={row.id}
                className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{row.autor}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{row.motivo}</p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      isResolved ? "text-emerald-400" : "text-yellow-400"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>

                <p className="rounded-xl border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-300">
                  {row.descricao}
                </p>

                <div className="text-[11px] text-zinc-500">{row.data}</div>

                <label className="block space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Devolutiva do admin
                  </span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={response}
                    onChange={(event) =>
                      setResponseById((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                    className="w-full resize-none rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand"
                    placeholder="Escreva a resposta para o usuario..."
                  />
                </label>

                {row.respostaAdmin ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-emerald-300">
                      Ultima resposta salva
                    </span>
                    {row.respostaAdmin}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => void handleDelete(row)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Excluir
                  </button>
                  <button
                    onClick={() => void handleResolve(row)}
                    disabled={isBusy || response.trim().length === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Responder e concluir
                  </button>
                </div>
              </article>
            );
          })
        )}

        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2 text-xs font-bold uppercase text-zinc-500">
            <span>
              Pagina {page} de {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
