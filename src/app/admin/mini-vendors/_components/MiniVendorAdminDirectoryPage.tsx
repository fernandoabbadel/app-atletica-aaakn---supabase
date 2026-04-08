"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  Package,
  Pencil,
  Store,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchTenantMiniVendors,
  setMiniVendorStatus,
  type MiniVendorProfile,
} from "@/lib/miniVendorService";
import { isAdminLikeRole, resolveEffectiveAccessRole } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

type MiniVendorAdminDirectoryMode = "approvals" | "vendors";

const getStatusClass = (status: MiniVendorProfile["status"]): string =>
  status === "approved"
    ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
    : status === "rejected"
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : status === "disabled"
    ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";

const getStatusLabel = (status: MiniVendorProfile["status"]): string =>
  status === "approved"
    ? "Aprovado"
    : status === "rejected"
    ? "Rejeitado"
    : status === "disabled"
    ? "Desativado"
    : "Pendente";

const PAGE_COPY: Record<
  MiniVendorAdminDirectoryMode,
  { title: string; subtitle: string; accentClass: string; emptyText: string }
> = {
  approvals: {
    title: "Pendentes de Aprovacao",
    subtitle: "Cadastros aguardando revisao do admin da atletica.",
    accentClass: "text-yellow-300",
    emptyText: "Nenhum cadastro pendente.",
  },
  vendors: {
    title: "Todos os Mini Vendors",
    subtitle: "Visao completa das lojinhas cadastradas no tenant.",
    accentClass: "text-blue-300",
    emptyText: "Nenhuma lojinha cadastrada ainda.",
  },
};

export default function MiniVendorAdminDirectoryPage({
  mode,
}: {
  mode: MiniVendorAdminDirectoryMode;
}) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSlug } = useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MiniVendorProfile[]>([]);
  const [actionId, setActionId] = useState("");

  const pageCopy = PAGE_COPY[mode];
  const canManageVendorLinks = isAdminLikeRole(resolveEffectiveAccessRole(user));
  const backHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/mini-vendors")
    : "/admin/mini-vendors";
  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";

  const load = useCallback(async (forceRefresh = true) => {
    if (!tenantId.trim()) {
      setRows([]);
      return;
    }
    const data = await fetchTenantMiniVendors({
      tenantId,
      forceRefresh,
    });
    setRows(data);
  }, [tenantId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await load(true);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar mini vendors.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, load]);

  const pendingRows = useMemo(
    () => rows.filter((row) => row.status === "pending"),
    [rows]
  );
  const visibleRows = mode === "approvals" ? pendingRows : rows;

  const handleUpdateStatus = async (
    row: MiniVendorProfile,
    status: MiniVendorProfile["status"]
  ) => {
    try {
      setActionId(row.id);
      await setMiniVendorStatus({
        miniVendorId: row.id,
        tenantId,
        status,
        approvedBy: user?.uid || undefined,
      });
      await load(true);
      addToast("Status do mini vendor atualizado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar mini vendor.", "error");
    } finally {
      setActionId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                {pageCopy.title}
              </h1>
              <p className="text-[11px] font-bold text-zinc-500">
                {pageCopy.subtitle}
              </p>
            </div>
          </div>
          <Link
            href={dashboardHref}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
          >
            <LogOut size={14} />
            Sair do admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div
            className={`flex items-center gap-2 text-xs font-black uppercase ${pageCopy.accentClass}`}
          >
            <Store size={14} />
            {pageCopy.title}
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                Carregando...
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                {pageCopy.emptyText}
              </div>
            ) : mode === "approvals" ? (
              visibleRows.map((row) => (
                <article
                  key={row.id}
                  className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-black/20 p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                      <Image
                        src={row.logoUrl || "/logo.png"}
                        alt={row.storeName || "Loja"}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white">
                        {row.storeName || "Loja sem nome"}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Usuario: {row.userId}
                      </p>
                      <p className="line-clamp-2 text-[11px] text-zinc-500">
                        {row.description || "Sem descricao."}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void handleUpdateStatus(row, "approved")}
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
                      onClick={() => void handleUpdateStatus(row, "rejected")}
                      disabled={actionId === row.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                    >
                      <XCircle size={12} />
                      Rejeitar
                    </button>
                  </div>
                </article>
              ))
            ) : (
              visibleRows.map((row) => (
                <article
                  key={row.id}
                  className="space-y-3 rounded-2xl border border-zinc-800 bg-black/20 p-4"
                >
                  {canManageVendorLinks && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={
                          tenantSlug
                            ? withTenantSlug(tenantSlug, `/perfil/mini-vendor/${row.id}`)
                            : `/perfil/mini-vendor/${row.id}`
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-300 hover:bg-cyan-500/20"
                      >
                        <ExternalLink size={12} />
                        Pagina do mini vendor
                      </Link>
                      <Link
                        href={
                          tenantSlug
                            ? withTenantSlug(
                                tenantSlug,
                                `/configuracoes/mini-vendor/editar?userId=${encodeURIComponent(row.userId)}`
                              )
                            : `/configuracoes/mini-vendor/editar?userId=${encodeURIComponent(row.userId)}`
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] font-black uppercase text-blue-300 hover:bg-blue-500/20"
                      >
                        <Pencil size={12} />
                        Editar dados
                      </Link>
                      <Link
                        href={
                          tenantSlug
                            ? withTenantSlug(
                                tenantSlug,
                                `/configuracoes/mini-vendor/produtos?userId=${encodeURIComponent(row.userId)}`
                              )
                            : `/configuracoes/mini-vendor/produtos?userId=${encodeURIComponent(row.userId)}`
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
                      >
                        <Package size={12} />
                        Editar produtos
                      </Link>
                    </div>
                  )}

                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                        <Image
                          src={row.logoUrl || "/logo.png"}
                          alt={row.storeName || "Loja"}
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-white">
                            {row.storeName || "Loja sem nome"}
                          </p>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${getStatusClass(row.status)}`}
                          >
                            {getStatusLabel(row.status)}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Usuario: {row.userId}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          PIX: {row.pixKey || "-"} | Banco: {row.pixBank || "-"}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Instagram:{" "}
                          {row.instagramEnabled ? row.instagram || "-" : "desligado"} |
                          WhatsApp:{" "}
                          {row.whatsappEnabled ? row.whatsapp || "-" : "desligado"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {row.status !== "approved" ? (
                        <button
                          onClick={() => void handleUpdateStatus(row, "approved")}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60"
                        >
                          <CheckCircle2 size={12} />
                          Aprovar
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleUpdateStatus(row, "disabled")}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-500/30 bg-zinc-500/10 px-3 py-2 text-[10px] font-black uppercase text-zinc-300 hover:bg-zinc-500/20 disabled:opacity-60"
                        >
                          <XCircle size={12} />
                          Desativar
                        </button>
                      )}
                    </div>
                  </div>

                  {row.description && (
                    <p className="text-sm text-zinc-400">{row.description}</p>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
