"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CreditCard, Loader2, Pencil, Rocket, Shield, Waypoints } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { isPlatformMaster } from "@/lib/roles";
import {
  fetchManageableTenants,
  type TenantSummary,
} from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

const statusClass: Record<TenantSummary["status"], string> = {
  active: "border-brand bg-brand-soft text-brand-accent",
  inactive: "border-zinc-600/40 bg-zinc-700/20 text-zinc-300",
  blocked: "border-red-500/30 bg-red-500/10 text-red-300",
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Falha ao carregar tenants da plataforma.";
};

export default function MasterPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { setMasterTenantOverride, refreshTenantTheme, tenantId: activeTenantId } =
    useTenantTheme();

  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);

  const canAccess = isPlatformMaster(user);

  const loadTenants = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await fetchManageableTenants({ includeAll: true });
      setTenants(rows);
    } catch (error: unknown) {
      addToast(extractErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!canAccess) return;
    void loadTenants();
  }, [canAccess, loadTenants]);

  const sortedTenants = useMemo(
    () => [...tenants].sort((left, right) => left.nome.localeCompare(right.nome)),
    [tenants]
  );

  const handleSetContext = (tenant: TenantSummary) => {
    setMasterTenantOverride(tenant.id);
    refreshTenantTheme();
    addToast(`Contexto master definido para ${tenant.sigla}.`, "success");
  };

  if (!canAccess) return null;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-red-300">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="mb-8 rounded-[2rem] border border-red-500/15 bg-[linear-gradient(135deg,rgba(127,29,29,0.22),rgba(10,10,10,0.94)_52%,rgba(127,29,29,0.12))] p-6 shadow-[0_24px_70px_rgba(127,29,29,0.18)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-200">
              Plataforma USC
            </p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-black uppercase tracking-tight text-white">
              <Building2 className="text-red-300" /> Controle Global
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-300">
              Aqui fica o painel do dono do app. O `master` escolhe o tenant que quer inspecionar,
              troca a role de visualizacao na faixa vermelha e entra no admin do tenant sem misturar
              isso com o painel da atletica.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Link
              href="/master/landing"
              className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-red-500/25 hover:bg-zinc-900"
            >
              <Rocket size={15} className="mb-2 text-red-300" />
              Landing USC
            </Link>
            <Link
              href="/master/permissoes"
              className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-red-500/25 hover:bg-zinc-900"
            >
              <Shield size={15} className="mb-2 text-red-300" />
              Permissoes Globais
            </Link>
            <Link
              href="/master/solicitacoes"
              className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-red-500/25 hover:bg-zinc-900"
            >
              <CreditCard size={15} className="mb-2 text-red-300" />
              Solicitacoes
            </Link>
          </div>
        </div>
      </header>

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
            Tenants cadastrados
          </p>
          <p className="mt-3 text-3xl font-black text-white">{sortedTenants.length}</p>
        </div>
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
            Contexto ativo
          </p>
          <p className="mt-3 text-lg font-black text-white">
            {sortedTenants.find((tenant) => tenant.id === activeTenantId)?.sigla || "Plataforma USC"}
          </p>
        </div>
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
            Acesso atual
          </p>
          <p className="mt-3 text-lg font-black text-white">Role master da plataforma</p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black uppercase text-white">Tenants da plataforma</h2>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              escolha o tenant e entre no painel correto
            </p>
          </div>
          <button
            onClick={() => void loadTenants()}
            className="rounded-xl border border-zinc-700 bg-black px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-300 transition hover:bg-zinc-800"
          >
            Atualizar
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {sortedTenants.map((tenant) => {
            const adminHref = withTenantSlug(tenant.slug, "/admin");
            const dashboardHref = withTenantSlug(tenant.slug, "/dashboard");
            const isCurrent = tenant.id === activeTenantId;

            return (
              <article
                key={tenant.id}
                className="rounded-3xl border border-zinc-800 bg-black/35 p-5 transition hover:border-red-500/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-black uppercase text-white">
                        {tenant.sigla} • {tenant.nome}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${statusClass[tenant.status]}`}
                      >
                        {tenant.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
                      {tenant.faculdade || "Sem faculdade"} • {tenant.curso || "Sem curso"}
                    </p>
                    <p className="mt-2 text-sm text-zinc-300">
                      slug <span className="font-mono text-zinc-100">/{tenant.slug}</span>
                    </p>
                  </div>

                  {isCurrent && (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-amber-200">
                      contexto atual
                    </span>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSetContext(tenant)}
                    className="inline-flex items-center gap-2 rounded-xl border border-brand bg-brand-soft px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-brand-accent transition hover:bg-brand-soft-strong"
                  >
                    <Waypoints size={14} /> Usar contexto
                  </button>
                  <Link
                    href={`/master/tenants/${tenant.id}`}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800"
                  >
                    <Pencil size={14} /> Editar tenant
                  </Link>
                  <Link
                    href={adminHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800"
                  >
                    <Shield size={14} /> Abrir admin
                  </Link>
                  <Link
                    href={dashboardHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:bg-zinc-800"
                  >
                    <Building2 size={14} /> Abrir app
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
