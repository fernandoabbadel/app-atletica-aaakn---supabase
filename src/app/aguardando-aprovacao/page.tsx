"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, LogOut, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { buildLoginPath } from "@/lib/authRedirect";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  fetchPendingMembershipStatusForCurrentUser,
  fetchTenantById,
  type TenantMembershipStatus,
  type TenantRole,
  type TenantSummary,
} from "@/lib/tenantService";

interface MembershipState {
  tenantId: string;
  role: TenantRole;
  status: TenantMembershipStatus;
}

const formatStatus = (status: TenantMembershipStatus): string => {
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Rejeitado";
  if (status === "disabled") return "Desativado";
  return "Pendente";
};

const statusColorClass = (status: TenantMembershipStatus): string => {
  if (status === "approved") return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
  if (status === "rejected") return "text-red-300 border-red-500/30 bg-red-500/10";
  if (status === "disabled") return "text-amber-200 border-amber-500/30 bg-amber-500/10";
  return "text-cyan-200 border-cyan-500/30 bg-cyan-500/10";
};

export default function AguardandoAprovacaoPage() {
  const router = useRouter();
  const pathname = usePathname() || "/aguardando-aprovacao";
  const { user, loading: authLoading, logout } = useAuth();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [membership, setMembership] = useState<MembershipState | null>(null);
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(
    async (mode: "initial" | "refresh"): Promise<void> => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError("");

      try {
        const nextMembership = await fetchPendingMembershipStatusForCurrentUser();
        if (!nextMembership) {
          router.replace("/dashboard");
          return;
        }

        setMembership(nextMembership);
        const tenantData = await fetchTenantById(nextMembership.tenantId);
        setTenant(tenantData);

        if (nextMembership.status === "approved") {
          addToast("Seu acesso foi aprovado. Bem-vindo!", "success");
          router.replace("/dashboard");
          return;
        }

        if (nextMembership.status === "rejected") {
          addToast("Seu pedido foi rejeitado. Contate o respons\u00e1vel da atl\u00e9tica.", "error");
        }
      } catch (statusError: unknown) {
        const message =
          statusError instanceof Error && statusError.message
            ? statusError.message
            : "Falha ao carregar status de aprova\u00e7\u00e3o.";
        setError(message);
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [addToast, router]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(buildLoginPath(pathname));
      return;
    }
    void loadStatus("initial");
  }, [authLoading, loadStatus, pathname, router, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center text-sm font-black uppercase">
        {"Consultando status da sua aprova\u00e7\u00e3o..."}
      </div>
    );
  }

  const currentStatus = membership?.status || "pending";
  const { tenantSlug } = parseTenantScopedPath(pathname);
  const cadastroPath = tenantSlug ? withTenantSlug(tenantSlug, "/cadastro") : "/cadastro";

  return (
    <div className="min-h-screen bg-[#050505] text-white px-4 py-8">
      <main className="max-w-xl mx-auto rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight inline-flex items-center gap-2">
              <Clock3 size={20} className="text-cyan-300" />
              {"Aguardando Aprova\u00e7\u00e3o"}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">Aguarde seu pedido ser liberado</p>
          </div>
          <button
            onClick={() => void loadStatus("refresh")}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700 bg-black text-xs font-black uppercase disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-3">
            <p className="text-[11px] text-zinc-500 font-bold uppercase">{"Atl\u00e9tica"}</p>
            <p className="text-sm font-bold text-white mt-1">
              {tenant ? `${tenant.sigla} - ${tenant.nome}` : membership?.tenantId || "N\u00e3o identificada"}
            </p>
          </div>

          <div className={`rounded-xl border px-4 py-3 ${statusColorClass(currentStatus)}`}>
            <p className="text-[11px] font-black uppercase">Status atual</p>
            <p className="text-sm font-bold mt-1 inline-flex items-center gap-2">
              {currentStatus === "pending" ? (
                <Clock3 size={14} />
              ) : currentStatus === "approved" ? (
                <ShieldCheck size={14} />
              ) : (
                <TriangleAlert size={14} />
              )}
              {formatStatus(currentStatus)}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={cadastroPath}
            className="inline-flex items-center justify-center px-4 py-3 rounded-xl border border-zinc-700 bg-black text-xs font-black uppercase"
          >
            Revisar Cadastro
          </Link>

          <button
            onClick={() => {
              void logout();
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-black uppercase text-red-300"
          >
            <LogOut size={14} />
            Sair
          </button>
        </div>
      </main>
    </div>
  );
}
