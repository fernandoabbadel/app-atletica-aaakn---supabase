"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
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
import {
  fetchCurrentMiniVendorProfile,
  fetchMiniVendorOrders,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import { approveStoreOrder, setStoreOrderStatus } from "@/lib/storeService";
import { fetchCanonicalUserVisuals } from "@/lib/userVisualsService";

import { getVendorStatusClass, getVendorStatusLabel, type OrderRow } from "../_shared";
import { MiniVendorShell } from "./MiniVendorShell";

type OrdersMode = "pending" | "approved";
type OrderStatus = "pendente" | "approved" | "rejected" | "delivered";

const PAGE_COPY: Record<
  OrdersMode,
  {
    title: string;
    subtitle: string;
    statuses: OrderStatus[];
    accentClass: string;
    emptyText: string;
  }
> = {
  pending: {
    title: "Pedidos Pendentes",
    subtitle: "Aprove ou rejeite comprovantes sem carregar os pedidos aprovados.",
    statuses: ["pendente"],
    accentClass: "border-yellow-500/20 bg-yellow-500/5 text-yellow-300",
    emptyText: "Sem pedidos pendentes.",
  },
  approved: {
    title: "Pedidos Aprovados",
    subtitle: "Historico editavel dos pedidos que ja passaram por aprovacao.",
    statuses: ["approved", "delivered", "rejected"],
    accentClass: "border-blue-500/20 bg-blue-500/5 text-blue-300",
    emptyText: "Nenhum pedido revisado ainda.",
  },
};

const normalizeOrderStatus = (value: unknown): OrderStatus => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "rejected" || normalized === "delivered") {
    return normalized;
  }
  return "pendente";
};

const getOrderStatusMeta = (
  value: unknown
): { label: string; className: string } => {
  const status = normalizeOrderStatus(value);
  if (status === "approved") {
    return {
      label: "Confirmado",
      className: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    };
  }
  if (status === "delivered") {
    return {
      label: "Entregue",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rejeitado",
      className: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  return {
    label: "Pendente",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  };
};

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

export function MiniVendorOrdersStatusPage({
  mode,
  titleOverride,
  subtitleOverride,
}: {
  mode: OrdersMode;
  titleOverride?: string;
  subtitleOverride?: string;
}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [actionId, setActionId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});

  const pageCopy = PAGE_COPY[mode];
  const pageTitle = titleOverride || pageCopy.title;
  const pageSubtitle = subtitleOverride || pageCopy.subtitle;

  const loadPage = useCallback(async (forceRefresh = true) => {
    const cleanTenantId = tenantId.trim();
    const cleanUserId = user?.uid?.trim() || "";
    if (!cleanTenantId || !cleanUserId) {
      setProfile(null);
      setOrders([]);
      return;
    }

    const vendorProfile = await fetchCurrentMiniVendorProfile({
      tenantId: cleanTenantId,
      userId: cleanUserId,
      forceRefresh,
    });
    setProfile(vendorProfile);

    if (!vendorProfile?.id || vendorProfile.status !== "approved") {
      setOrders([]);
      return;
    }

    const rows = await fetchMiniVendorOrders({
      tenantId: cleanTenantId,
      sellerId: vendorProfile.id,
      statuses: pageCopy.statuses,
      forceRefresh,
      limit: 80,
    });
    const nextRows = rows as OrderRow[];
    setOrders(nextRows);

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
  }, [mode, pageCopy.statuses, tenantId, user?.uid]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await loadPage(false);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar pedidos do mini vendor.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, loadPage]);

  const handleApprove = async (row: OrderRow) => {
    if (!user?.uid) return;
    try {
      setActionId(row.id);
      await approveStoreOrder({
        orderId: row.id,
        userId: String(row.userId || ""),
        userName: String(row.userName || "Aluno"),
        productId: String(row.productId || ""),
        productName: String(row.productName || "Produto"),
        price: Number(row.total || row.price || 0),
        quantidade: Number(row.quantidade || 0) || undefined,
        approvedBy: user.uid,
      });
      await loadPage(true);
      addToast("Pedido aprovado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao aprovar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const handleReject = async (row: OrderRow) => {
    try {
      setActionId(row.id);
      await setStoreOrderStatus({
        orderId: row.id,
        status: "rejected",
        approvedBy: user?.uid || undefined,
      });
      await loadPage(true);
      addToast("Pedido rejeitado.", "info");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao rejeitar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const handleStatusChange = async (
    row: OrderRow,
    status: "pendente" | "rejected" | "delivered",
    successMessage: string
  ) => {
    try {
      setActionId(row.id);
      await setStoreOrderStatus({
        orderId: row.id,
        status,
      });
      await loadPage(true);
      setEditingId("");
      addToast(successMessage, status === "rejected" ? "info" : "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const resolveApproverLabel = (row: OrderRow): string => {
    const approvedBy = String(row.approvedBy || "").trim();
    if (!approvedBy) return "Nao informado";
    if (approvedBy === "admin") return "Admin";
    if (approvedBy === user?.uid) return user.nome || "Voce";
    return approverNames[approvedBy] || compactUserId(approvedBy);
  };

  return (
    <MiniVendorShell title={pageTitle} subtitle={pageSubtitle}>
      <div className="space-y-5">
        {!tenantId.trim() || !user?.uid ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Entre em uma atletica valida para usar a area mini vendor.
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-zinc-700 bg-black">
                    <Image
                      src={profile?.logoUrl || tenantLogoUrl || "/logo.png"}
                      alt={profile?.storeName || "Mini vendor"}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Status da Loja
                    </p>
                    <h2 className="mt-1 text-lg font-black uppercase text-white">
                      {profile?.storeName || "Mini Vendor"}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getVendorStatusClass(profile?.status)}`}
                      >
                        {getVendorStatusLabel(profile?.status)}
                      </span>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${pageCopy.accentClass}`}
                      >
                        {mode === "pending" ? "Fila pendente" : "Historico aprovado"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {!profile ? (
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-5 text-sm text-zinc-400">
                  Cadastre a loja primeiro para liberar os pedidos.
                </div>
              ) : profile.status !== "approved" ? (
                <div
                  className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${getVendorStatusClass(profile.status)}`}
                >
                  Os pedidos aparecem aqui somente depois que a loja estiver aprovada.
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
                {mode === "pending" ? <Clock3 size={14} /> : <ShoppingBag size={14} />}
                {pageTitle}
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                    Carregando pedidos...
                  </div>
                ) : !profile || profile.status !== "approved" ? (
                  <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                    Assim que a loja estiver aprovada, os pedidos passam a aparecer aqui.
                  </div>
                ) : orders.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                    {pageCopy.emptyText}
                  </div>
                ) : (
                  orders.map((row) => (
                    <article
                      key={row.id}
                      className="rounded-2xl border border-zinc-800 bg-black/20 p-4"
                    >
                      {(() => {
                        const statusMeta = getOrderStatusMeta(row.status);
                        return (
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${statusMeta.className}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>
                        );
                      })()}

                      {mode === "approved" && (
                        <div className="mb-3 grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-2">
                          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                              Aprovado por
                            </p>
                            <p className="mt-1 font-bold text-white">{resolveApproverLabel(row)}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                              Data da aprovacao
                            </p>
                            <p className="mt-1 font-bold text-white">
                              {formatDateTime(row.updatedAt || row.createdAt)}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">
                            {row.productName || "Produto"}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-400">
                            Comprador: {row.userName || "Aluno"}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-500">
                            #{row.id.slice(0, 10)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-emerald-400">
                            R$ {Number(row.total || row.price || 0).toFixed(2)}
                          </p>
                          {mode === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleApprove(row)}
                                disabled={actionId === row.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60"
                              >
                                {actionId === row.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}
                                Aprovar
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleReject(row)}
                                disabled={actionId === row.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                              >
                                <XCircle size={12} />
                                Rejeitar
                              </button>
                            </>
                          ) : (
                            <div className="w-full min-w-[220px] space-y-2">
                              <button
                                type="button"
                                onClick={() => setEditingId((prev) => (prev === row.id ? "" : row.id))}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-300 hover:bg-cyan-500/20"
                              >
                                <Pencil size={12} />
                                {editingId === row.id ? "Fechar edicao" : "Editar aprovacao"}
                              </button>
                              {editingId === row.id && (
                                <div className="grid gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleStatusChange(
                                        row,
                                        "pendente",
                                        "Pedido voltou para pendente."
                                      )
                                    }
                                    disabled={actionId === row.id}
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
                                        "Pedido marcado como entregue."
                                      )
                                    }
                                    disabled={actionId === row.id}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
                                  >
                                    <Truck size={12} />
                                    Marcar entregue
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleStatusChange(row, "rejected", "Pedido rejeitado.")
                                    }
                                    disabled={actionId === row.id}
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
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </MiniVendorShell>
  );
}
