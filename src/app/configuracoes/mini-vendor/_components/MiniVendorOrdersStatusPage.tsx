"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Clock3, Loader2, ShoppingBag, XCircle } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchCurrentMiniVendorProfile,
  fetchMiniVendorOrders,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import { approveStoreOrder, setStoreOrderStatus } from "@/lib/storeService";

import { getVendorStatusClass, getVendorStatusLabel, type OrderRow } from "../_shared";
import { MiniVendorShell } from "./MiniVendorShell";

type OrdersMode = "pending" | "approved";

const PAGE_COPY: Record<
  OrdersMode,
  {
    title: string;
    subtitle: string;
    status: "pendente" | "approved";
    accentClass: string;
    emptyText: string;
  }
> = {
  pending: {
    title: "Pedidos Pendentes",
    subtitle: "Aprove ou rejeite comprovantes sem carregar os pedidos aprovados.",
    status: "pendente",
    accentClass: "border-yellow-500/20 bg-yellow-500/5 text-yellow-300",
    emptyText: "Sem pedidos pendentes.",
  },
  approved: {
    title: "Pedidos Aprovados",
    subtitle: "Historico enxuto dos pedidos que ja foram confirmados.",
    status: "approved",
    accentClass: "border-blue-500/20 bg-blue-500/5 text-blue-300",
    emptyText: "Nenhum pedido aprovado ainda.",
  },
};

export function MiniVendorOrdersStatusPage({ mode }: { mode: OrdersMode }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantLogoUrl } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<MiniVendorProfile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [actionId, setActionId] = useState("");

  const pageCopy = PAGE_COPY[mode];

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
      statuses: [pageCopy.status],
      forceRefresh,
      limit: 80,
    });
    setOrders(rows as OrderRow[]);
  }, [pageCopy.status, tenantId, user?.uid]);

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

  return (
    <MiniVendorShell title={pageCopy.title} subtitle={pageCopy.subtitle}>
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
                {pageCopy.title}
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
                            <span className="inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[10px] font-black uppercase text-blue-300">
                              Confirmado
                            </span>
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
