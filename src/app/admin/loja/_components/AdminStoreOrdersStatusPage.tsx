"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  Pencil,
  RotateCcw,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import {
  approveStoreOrder,
  fetchStoreOrdersPage,
  fetchStoreProducts,
  setStoreOrderStatus,
} from "@/lib/storeService";
import { withTenantSlug } from "@/lib/tenantRouting";
import { fetchCanonicalUserVisuals } from "@/lib/userVisualsService";

type OrdersMode = "pending" | "approved";

type OrderRow = {
  id: string;
  userId?: string;
  userName?: string;
  productId?: string;
  productName?: string;
  price?: number;
  total?: number;
  quantidade?: number;
  itens?: number;
  status?: string;
  approvedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

const PAGE_SIZE = 20;

const PAGE_COPY: Record<
  OrdersMode,
  {
    title: string;
    subtitle: string;
    status: "pendente" | "approved";
    emptyText: string;
    badgeClass: string;
  }
> = {
  pending: {
    title: "Pedidos Pendentes",
    subtitle: "Aprove ou rejeite comprovantes sem carregar o historico ja confirmado.",
    status: "pendente",
    emptyText: "Sem pedidos pendentes.",
    badgeClass: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  },
  approved: {
    title: "Pedidos Aprovados",
    subtitle: "Historico dos comprovantes confirmados com edicao rapida de status.",
    status: "approved",
    emptyText: "Nenhum pedido aprovado ainda.",
    badgeClass: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  },
};

const formatCurrency = (value: number): string => `R$ ${value.toFixed(2)}`;

const formatDateTime = (value?: string): string => {
  const isoValue = String(value || "").trim();
  if (!isoValue) return "Nao informado";

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return "Nao informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
};

const compactUserId = (value: string): string =>
  value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;

export function AdminStoreOrdersStatusPage({
  mode,
  categoryLabel,
}: {
  mode: OrdersMode;
  categoryLabel?: string | null;
}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantSlug } = useTenantTheme();
  const normalizedCategory = String(categoryLabel || "").trim();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [actionId, setActionId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});

  const pageCopy = PAGE_COPY[mode];
  const backHref = tenantSlug
    ? withTenantSlug(tenantSlug, normalizedCategory ? "/admin/loja/categorias" : "/admin/loja")
    : normalizedCategory
    ? "/admin/loja/categorias"
    : "/admin/loja";
  const pendingHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/pedidos-pendentes")
    : "/admin/loja/pedidos-pendentes";
  const approvedHref = tenantSlug
      ? withTenantSlug(tenantSlug, "/admin/loja/pedidos-aprovados")
      : "/admin/loja/pedidos-aprovados";
  const pageTitle = normalizedCategory
    ? `${pageCopy.title} • ${normalizedCategory}`
    : pageCopy.title;
  const pageSubtitle = normalizedCategory
    ? `Mostra somente os comprovantes da categoria ${normalizedCategory}.`
    : pageCopy.subtitle;

  const load = useCallback(
    async (targetPage: number) => {
      let result = await fetchStoreOrdersPage({
        page: normalizedCategory ? 1 : targetPage,
        pageSize: normalizedCategory ? 200 : PAGE_SIZE,
        status: pageCopy.status,
      });

      if (normalizedCategory) {
        const categoryProducts = await fetchStoreProducts({
          maxResults: 240,
          forceRefresh: false,
          category: normalizedCategory,
        });
        const productIds = new Set(
          categoryProducts
            .map((row) => String(row.id || "").trim())
            .filter((value) => value.length > 0)
        );
        result = {
          rows: result.rows.filter((row) => productIds.has(String(row.productId || "").trim())),
          hasMore: false,
        };
      }

      if (!normalizedCategory && targetPage > 1 && result.rows.length === 0) {
        setPage((prev) => Math.max(1, prev - 1));
        return;
      }

      const nextRows = result.rows as OrderRow[];
      setRows(nextRows);
      setHasMore(result.hasMore);

      if (mode !== "approved") {
        setApproverNames({});
        return;
      }

      const approverIds = Array.from(
        new Set(
          nextRows
            .map((row) => String(row.approvedBy || "").trim())
            .filter((value) => value.length > 0 && value !== "admin")
        )
      );
      if (approverIds.length === 0) {
        setApproverNames({});
        return;
      }

      const visuals = await fetchCanonicalUserVisuals(approverIds);
      const nextNames: Record<string, string> = {};
      approverIds.forEach((id) => {
        const visual = visuals.get(id);
        nextNames[id] = visual?.nome || compactUserId(id);
      });
      setApproverNames(nextNames);
    },
    [mode, normalizedCategory, pageCopy.status]
  );

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        await load(page);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) {
          addToast("Erro ao carregar pedidos da loja.", "error");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, load, page]);

  const reloadCurrentPage = async () => {
    await load(page);
  };

  const writeOrderLog = async (message: string) => {
    if (!user?.uid) return;
    await logActivity(user.uid, user.nome || "Admin", "UPDATE", "Loja/Pagamentos", message).catch(
      () => {}
    );
  };

  const handleApprove = async (row: OrderRow) => {
    try {
      setActionId(row.id);
      await approveStoreOrder({
        orderId: row.id,
        userId: String(row.userId || ""),
        userName: String(row.userName || "Usuario"),
        productId: String(row.productId || ""),
        productName: String(row.productName || "Produto"),
        price: Number(row.total || row.price || 0),
        quantidade: Number(row.quantidade || row.itens || 0) || undefined,
        itens: Number(row.itens || row.quantidade || 0) || undefined,
        approvedBy: user?.uid || "admin",
      });
      await writeOrderLog(
        `Aprovou comprovante do pedido ${row.id} (${row.productName || "Produto"})`
      );
      addToast("Pedido aprovado.", "success");
      await reloadCurrentPage();
    } catch (error: unknown) {
      console.error("Erro ao aprovar pedido (admin/loja):", error);
      addToast("Erro ao aprovar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const handleStatusChange = async (
    row: OrderRow,
    status: "pendente" | "rejected" | "delivered",
    successMessage: string,
    logLabel: string
  ) => {
    try {
      setActionId(row.id);
      await setStoreOrderStatus({ orderId: row.id, status });
      await writeOrderLog(`${logLabel} o pedido ${row.id} (${row.productName || "Produto"})`);
      addToast(successMessage, status === "rejected" ? "info" : "success");
      setEditingId("");
      await reloadCurrentPage();
    } catch (error: unknown) {
      console.error("Erro ao atualizar pedido (admin/loja):", error);
      addToast("Erro ao atualizar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const resolveApproverLabel = (row: OrderRow): string => {
    const approvedBy = String(row.approvedBy || "").trim();
    if (!approvedBy) return "Nao informado";
    if (approvedBy === "admin") return "Admin";
    return approverNames[approvedBy] || compactUserId(approvedBy);
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">{pageTitle}</h1>
              <p className="text-[11px] font-bold text-zinc-500">{pageSubtitle}</p>
            </div>
          </div>

          {!normalizedCategory && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={pendingHref}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wide transition ${
                  mode === "pending"
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <Clock3 size={14} />
                Pendentes
              </Link>
              <Link
                href={approvedHref}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wide transition ${
                  mode === "approved"
                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <ShoppingBag size={14} />
                Aprovados
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-3 px-6 py-6">
        {loading ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-xs font-bold uppercase text-zinc-500">
            Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-500">
            {pageCopy.emptyText}
          </div>
        ) : (
          rows.map((row) => {
            const isEditing = editingId === row.id;
            const isBusy = actionId === row.id;
            const totalValue = Number(row.total || row.price || 0);

            return (
              <article
                key={row.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-white">
                        {row.productName || "Produto"}
                      </p>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${pageCopy.badgeClass}`}
                      >
                        {mode === "pending" ? "Pendente" : "Confirmado"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Comprador: {row.userName || "Usuario"}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Quantidade: {Math.max(1, Number(row.quantidade || row.itens || 1) || 1)}
                    </p>
                    <p className="text-[10px] font-mono text-zinc-500">#{row.id.slice(0, 10)}</p>

                    {mode === "approved" && (
                      <div className="mt-3 grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-2">
                        <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                            Aprovado por
                          </p>
                          <p className="mt-1 font-bold text-white">{resolveApproverLabel(row)}</p>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                            Data da aprovacao
                          </p>
                          <p className="mt-1 font-bold text-white">
                            {formatDateTime(row.updatedAt || row.createdAt)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-[220px] flex-col items-start gap-3 lg:items-end">
                    <p className="text-sm font-black text-emerald-400">
                      {formatCurrency(totalValue)}
                    </p>

                    {mode === "pending" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApprove(row)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                        >
                          {isBusy ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={12} />
                          )}
                          Aprovar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleStatusChange(row, "rejected", "Pedido rejeitado.", "Rejeitou")
                          }
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                        >
                          <XCircle size={12} />
                          Rejeitar
                        </button>
                      </div>
                    ) : (
                      <div className="w-full space-y-2">
                        <button
                          type="button"
                          onClick={() => setEditingId((prev) => (prev === row.id ? "" : row.id))}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-300 hover:bg-cyan-500/20"
                        >
                          <Pencil size={12} />
                          {isEditing ? "Fechar edicao" : "Editar aprovacao"}
                        </button>

                        {isEditing && (
                          <div className="grid gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void handleStatusChange(
                                  row,
                                  "pendente",
                                  "Pedido voltou para pendente.",
                                  "Reabriu"
                                )
                              }
                              disabled={isBusy}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[10px] font-black uppercase text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-60"
                            >
                              <RotateCcw size={12} />
                              Voltar para pendente
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleStatusChange(
                                  row,
                                  "delivered",
                                  "Pedido marcado como entregue.",
                                  "Marcou como entregue"
                                )
                              }
                              disabled={isBusy}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
                            >
                              <Truck size={12} />
                              Marcar entregue
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleStatusChange(
                                  row,
                                  "rejected",
                                  "Pedido rejeitado.",
                                  "Rejeitou"
                                )
                              }
                              disabled={isBusy}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                            >
                              <XCircle size={12} />
                              Rejeitar
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}

        {!normalizedCategory && (page > 1 || hasMore) && (
          <div className="flex items-center justify-between pt-2 text-xs font-bold uppercase text-zinc-500">
            <span>Pagina {page}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasMore}
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
