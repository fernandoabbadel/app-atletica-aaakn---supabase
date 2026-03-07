"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Building2, Compass, ExternalLink } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { fetchPublicTenants, type TenantSummary } from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

const getTenantInitials = (tenant: TenantSummary): string => {
  const raw = `${tenant.sigla} ${tenant.nome}`.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
};

export default function VisitantePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const isAnonymousVisitor = Boolean(user?.isAnonymous);
  const memberDashboardHref = useMemo(() => {
    const tenantSlug =
      typeof user?.tenant_slug === "string" ? user.tenant_slug.trim().toLowerCase() : "";
    return tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  }, [user]);

  useEffect(() => {
    let mounted = true;

    const loadTenants = async () => {
      try {
        setLoading(true);
        setErrorMessage("");
        const rows = await fetchPublicTenants({ limit: 60 });
        if (!mounted) return;
        setTenants(rows);
      } catch (error: unknown) {
        if (!mounted) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Nao foi possivel carregar as atleticas.";
        setErrorMessage(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadTenants();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="inline-flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                <Compass size={18} className="text-emerald-400" />
                Escolha uma Atletica
              </h1>
              <p className="text-[11px] font-bold uppercase text-zinc-500">
                visitante entra primeiro pela vitrine de tenants cadastrados
              </p>
            </div>
          </div>

          {!isAnonymousVisitor && user && (
            <Link
              href={memberDashboardHref}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-200 hover:bg-zinc-800"
            >
              <Building2 size={14} />
              Voltar ao meu dashboard
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-emerald-400">
                Modo Visitante
              </p>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight text-white">
                Entre no dashboard publico da atletica que voce quer conhecer
              </h2>
              <p className="mt-3 max-w-3xl text-sm text-zinc-400">
                O visitante agora nao navega solto pelo app. Primeiro ele escolhe a
                atletica, entra no dashboard dela e o restante do menu fica bloqueado
                ate virar membro oficial.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black/40 p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Status da vitrine
              </p>
              <p className="mt-3 text-4xl font-black text-emerald-200">{tenants.length}</p>
              <p className="mt-2 text-sm text-zinc-400">atleticas publicas ativas</p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading &&
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`tenant-skeleton-${index}`}
                className="h-64 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-900"
              />
            ))}

          {!loading &&
            tenants.map((tenant) => {
              const dashboardHref = withTenantSlug(tenant.slug, "/dashboard");
              return (
                <article
                  key={tenant.id}
                  className="group rounded-3xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-emerald-500/30 hover:bg-zinc-900/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                        {tenant.logoUrl ? (
                          <Image
                            src={tenant.logoUrl}
                            alt={`${tenant.nome} logo`}
                            fill
                            unoptimized
                            className="object-contain p-2"
                          />
                        ) : (
                          <span className="text-lg font-black uppercase text-emerald-300">
                            {getTenantInitials(tenant)}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                          {tenant.sigla}
                        </p>
                        <h3 className="truncate text-lg font-black uppercase text-white">
                          {tenant.nome}
                        </h3>
                      </div>
                    </div>

                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-200">
                      ativa
                    </span>
                  </div>

                  <div className="mt-5 space-y-2 text-sm text-zinc-400">
                    <p>{tenant.faculdade || "Faculdade nao informada"}</p>
                    <p>{tenant.curso || "Curso nao informado"}</p>
                    <p>
                      {tenant.cidade || "Cidade nao informada"}
                      {tenant.area ? ` - ${tenant.area}` : ""}
                    </p>
                  </div>

                  <Link
                    href={dashboardHref}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black uppercase text-black transition group-hover:bg-emerald-400"
                  >
                    Abrir dashboard
                    <ExternalLink size={14} />
                  </Link>
                </article>
              );
            })}
        </section>

        {!loading && errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {errorMessage}
          </div>
        )}

        {!loading && !errorMessage && tenants.length === 0 && (
          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Nenhuma atletica publica encontrada neste momento.
          </div>
        )}
      </main>
    </div>
  );
}
