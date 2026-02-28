"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

import { useAuth } from "../../../../context/AuthContext";
import { useToast } from "../../../../context/ToastContext";
import { logActivity } from "../../../../lib/logger";
import {
  approveStoreOrder,
  fetchAdminStoreBundle,
  setStoreOrderStatus,
} from "../../../../lib/storeService";

type OrderRow = {
  id: string;
  userId?: string;
  userName?: string;
  productId?: string;
  productName?: string;
  price?: number;
  quantidade?: number;
  itens?: number;
  status?: string;
};

const PAGE_SIZE = 20;

export default function AdminLojaPedidosPendentesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = async (forceRefresh = true) => {
    const bundle = await fetchAdminStoreBundle({
      ordersLimit: 300,
      productsLimit: 1,
      categoriesLimit: 1,
      reviewsLimit: 1,
      forceRefresh,
    });

    const orders = (bundle.pedidos as OrderRow[]).sort((a, b) => String(b.id).localeCompare(String(a.id)));
    setRows(orders);
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        await load(true);
      } catch {
        if (mounted) addToast("Erro ao carregar pedidos.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const pending = useMemo(() => rows.filter((row) => row.status === "pendente"), [rows]);
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return pending.slice(start, start + PAGE_SIZE);
  }, [pending, page]);

  const totalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));

  const handleApprove = async (row: OrderRow) => {
    try {
      await approveStoreOrder({
        orderId: row.id,
        userId: String(row.userId || ""),
        userName: String(row.userName || "Usuario"),
        productId: String(row.productId || ""),
        productName: String(row.productName || "Produto"),
        price: Number(row.price || 0),
        quantidade: Number(row.quantidade || 0) || undefined,
        itens: Number(row.itens || 0) || undefined,
        approvedBy: user?.uid || "admin",
      });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Loja/Pagamentos",
          `Aprovou comprovante do pedido ${row.id} (${row.productName || "Produto"})`
        ).catch(() => {});
      }
      addToast("Pedido aprovado.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error("Erro ao aprovar pedido (admin/loja):", error);
      addToast("Erro ao aprovar pedido.", "error");
    }
  };

  const handleReject = async (row: OrderRow) => {
    try {
      await setStoreOrderStatus({ orderId: row.id, status: "rejected" });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Loja/Pagamentos",
          `Rejeitou comprovante do pedido ${row.id} (${row.productName || "Produto"})`
        ).catch(() => {});
      }
      addToast("Pedido rejeitado.", "info");
      await load(true);
    } catch (error: unknown) {
      console.error("Erro ao rejeitar pedido (admin/loja):", error);
      addToast("Erro ao rejeitar pedido.", "error");
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
            <h1 className="text-xl font-black uppercase tracking-tight">Pedidos Pendentes</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Leitura dedicada: somente pedidos</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto space-y-3">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Sem pedidos pendentes.</div>
        ) : (
          paged.map((row) => (
            <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{row.productName || "Produto"}</p>
                <p className="text-[11px] text-zinc-400">Comprador: {row.userName || "Usuario"}</p>
                <p className="text-[10px] text-zinc-500 font-mono">#{row.id.slice(0, 10)}</p>
              </div>

              <div className="text-right">
                <p className="text-sm font-black text-emerald-400">R$ {Number(row.price || 0).toFixed(2)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void handleApprove(row)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase bg-emerald-600 hover:bg-emerald-500"
                  >
                    <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Aprovar</span>
                  </button>
                  <button
                    onClick={() => void handleReject(row)}
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
