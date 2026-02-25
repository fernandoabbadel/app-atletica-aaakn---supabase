"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Star, XCircle } from "lucide-react";

import { useToast } from "../../../../context/ToastContext";
import { fetchAdminStoreBundle, setStoreReviewStatus } from "../../../../lib/storeService";

type ReviewRow = {
  id: string;
  userName?: string;
  productId?: string;
  comment?: string;
  rating?: number;
  status?: "pending" | "approved" | "rejected";
};

const PAGE_SIZE = 20;

export default function AdminLojaReviewPage() {
  const { addToast } = useToast();

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = async (forceRefresh = true) => {
    const bundle = await fetchAdminStoreBundle({
      reviewsLimit: 300,
      productsLimit: 1,
      categoriesLimit: 1,
      ordersLimit: 1,
      forceRefresh,
    });
    setRows(bundle.reviews as ReviewRow[]);
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        await load(true);
      } catch {
        if (mounted) addToast("Erro ao carregar reviews.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const pending = useMemo(() => rows.filter((row) => (row.status || "pending") === "pending"), [rows]);
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return pending.slice(start, start + PAGE_SIZE);
  }, [pending, page]);

  const totalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));

  const handleAction = async (row: ReviewRow, status: "approved" | "rejected") => {
    try {
      await setStoreReviewStatus({ reviewId: row.id, status });
      addToast(status === "approved" ? "Review aprovada." : "Review rejeitada.", "success");
      await load(true);
    } catch {
      addToast("Erro ao atualizar review.", "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/loja" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Reviews</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Leitura dedicada: somente avaliacoes</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem reviews pendentes.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{row.userName || "Usuario"}</p>
                  <p className="text-xs text-zinc-400 line-clamp-3">{row.comment || "Sem comentario"}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1 text-yellow-400">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <Star key={`${row.id}-${idx}`} size={12} className={idx < Number(row.rating || 0) ? "fill-current" : "text-zinc-700"} />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/loja/${row.productId || ""}`}
                  target="_blank"
                  className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1"
                >
                  Ver produto <ExternalLink size={12} />
                </Link>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleAction(row, "approved")}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase bg-emerald-600 hover:bg-emerald-500"
                  >
                    <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Aprovar</span>
                  </button>
                  <button
                    onClick={() => void handleAction(row, "rejected")}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase bg-red-900/30 text-red-400 border border-red-500/30 hover:bg-red-800/40"
                  >
                    <span className="inline-flex items-center gap-1"><XCircle size={12} /> Rejeitar</span>
                  </button>
                </div>
              </div>
            </article>
          ))
        )}

        {pending.length > PAGE_SIZE && (
          <div className="pt-2 flex items-center justify-between text-xs text-zinc-500 font-bold uppercase">
            <span>Pagina {page} de {totalPages}</span>
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
      </main>
    </div>
  );
}
