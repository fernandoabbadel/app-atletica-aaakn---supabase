"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Compass,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-react";

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

const matchesTenantQuery = (tenant: TenantSummary, query: string): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return (
    tenant.nome.toLowerCase().includes(normalizedQuery) ||
    tenant.sigla.toLowerCase().includes(normalizedQuery) ||
    (tenant.faculdade || "").toLowerCase().includes(normalizedQuery) ||
    (tenant.curso || "").toLowerCase().includes(normalizedQuery) ||
    (tenant.cidade || "").toLowerCase().includes(normalizedQuery)
  );
};

export default function VisitantePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenantSlug, setSelectedTenantSlug] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAnonymousVisitor = Boolean(user?.isAnonymous);
  const memberDashboardHref = useMemo(() => {
    const tenantSlug =
      typeof user?.tenant_slug === "string" ? user.tenant_slug.trim().toLowerCase() : "";
    return tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
            : "Deu ruim no plantao! Nao foi possivel carregar as atleticas.";
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

  const searchedTenants = useMemo(
    () => tenants.filter((tenant) => matchesTenantQuery(tenant, searchQuery)),
    [searchQuery, tenants]
  );

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.slug === selectedTenantSlug) || null,
    [selectedTenantSlug, tenants]
  );

  const visibleTenants = useMemo(() => {
    if (selectedTenantSlug) {
      return tenants.filter((tenant) => tenant.slug === selectedTenantSlug);
    }
    return searchedTenants;
  }, [searchedTenants, selectedTenantSlug, tenants]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040506] text-white selection:bg-emerald-500/30">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_28%),linear-gradient(180deg,#040506_0%,#06080d_46%,#030303_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-emerald-500/14 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-64 h-80 w-80 rounded-full bg-cyan-500/12 blur-3xl" />

      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#040506]/72 px-6 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-emerald-400/40 hover:bg-white/10 hover:text-emerald-100"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-300/80">
                Vitrine Publica
              </p>
              <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-black uppercase tracking-tight text-white">
                <Compass size={18} className="text-emerald-400" />
                Escolha Uma Atletica
              </h1>
            </div>
          </div>

          {!isAnonymousVisitor && user && (
            <Link
              href={memberDashboardHref}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-100 transition hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-white"
            >
              <Building2 size={15} className="text-emerald-300" />
              Voltar ao Meu Dashboard
            </Link>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <section className="mb-10 rounded-[32px] border border-white/8 bg-white/[0.04] p-6 shadow-[0_28px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">
                <Sparkles size={12} />
                Entrada Publica
              </div>
              <h2 className="mt-5 max-w-4xl text-4xl font-black uppercase tracking-[-0.04em] text-white md:text-6xl">
                Escolha a atlética antes de entrar no oceano
              </h2>
              <p className="mt-4 max-w-3xl text-sm text-zinc-300 md:text-base">
                O visitante entra primeiro pelo tenant correto. Selecione a atlética, filtre por
                nome, sigla ou faculdade e siga para o dashboard público já dentro do contexto
                certo.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                Status da Vitrine
              </p>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-5xl font-black text-emerald-200">{tenants.length}</p>
                  <p className="mt-2 text-sm text-zinc-400">atléticas públicas ativas</p>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                    Filtro Atual
                  </p>
                  <p className="mt-1 text-sm font-bold text-white">
                    {selectedTenant ? selectedTenant.sigla : "Todas"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8" ref={dropdownRef}>
            <div className="max-w-2xl">
              <button
                type="button"
                onClick={() => setIsDropdownOpen((previous) => !previous)}
                className="flex w-full items-center justify-between rounded-[26px] border border-white/10 bg-black/35 px-5 py-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition hover:border-emerald-400/30 hover:bg-white/[0.06]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <Search size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      Vitrine de Atléticas
                    </p>
                    <p className="truncate text-sm font-black uppercase text-white md:text-base">
                      {selectedTenant ? selectedTenant.nome : "Selecione uma atlética"}
                    </p>
                  </div>
                </div>

                <ChevronDown
                  size={18}
                  className={`shrink-0 text-zinc-400 transition-transform ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isDropdownOpen && (
                <div className="mt-3 overflow-hidden rounded-[26px] border border-white/10 bg-[#090c11]/96 shadow-[0_28px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl">
                  <div className="border-b border-white/6 p-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/40 px-4 py-3">
                      <Search size={16} className="text-emerald-300" />
                      <input
                        type="text"
                        placeholder="Buscar por nome, sigla, curso, cidade..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                      />
                    </div>
                  </div>

                  <ul className="max-h-80 overflow-y-auto p-3">
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTenantSlug(null);
                          setSearchQuery("");
                          setIsDropdownOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-left transition hover:border-white/8 hover:bg-white/[0.05]"
                      >
                        <div>
                          <p className="text-sm font-black uppercase text-white">Mostrar Todas</p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                            Exibe toda a vitrine pública
                          </p>
                        </div>
                      </button>
                    </li>

                    {searchedTenants.map((tenant) => (
                      <li key={`tenant-select-${tenant.id}`} className="mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTenantSlug(tenant.slug);
                            setSearchQuery("");
                            setIsDropdownOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-emerald-400/20 hover:bg-emerald-500/10"
                        >
                          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black">
                            {tenant.logoUrl ? (
                              <Image
                                src={tenant.logoUrl}
                                alt=""
                                fill
                                unoptimized
                                className="object-contain p-2"
                                sizes="48px"
                              />
                            ) : (
                              <span className="text-xs font-black uppercase text-emerald-300">
                                {getTenantInitials(tenant)}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-black uppercase text-white">
                              {tenant.nome}
                            </p>
                            <p className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                              {tenant.sigla}
                              {tenant.faculdade ? ` - ${tenant.faculdade}` : ""}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}

                    {searchedTenants.length === 0 && (
                      <li className="px-4 py-8 text-center text-sm text-zinc-500">
                        Nenhuma atlética encontrada na busca.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        {!loading && !errorMessage && !selectedTenantSlug && (
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/8 bg-white/[0.05] px-5 py-3 backdrop-blur-xl">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.75)]" />
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-300">
              Escolha uma atlética no droplist ou explore os cards abaixo
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="mb-8 rounded-[28px] border border-rose-500/30 bg-rose-500/12 p-5 text-sm font-medium text-rose-100 backdrop-blur-xl">
            {errorMessage}
          </div>
        )}

        <section
          className={`grid gap-6 ${
            selectedTenantSlug ? "mx-auto max-w-xl" : "md:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {loading &&
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`tenant-skeleton-${index}`}
                className="h-[320px] animate-pulse rounded-[30px] border border-white/8 bg-white/[0.05] backdrop-blur-xl"
              />
            ))}

          {!loading &&
            visibleTenants.map((tenant) => {
              const dashboardHref = withTenantSlug(tenant.slug, "/dashboard");

              return (
                <article
                  key={tenant.id}
                  className="group relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,20,27,0.94),rgba(5,7,11,0.98))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.42)] transition duration-300 hover:-translate-y-1.5 hover:border-emerald-400/30 hover:shadow-[0_28px_90px_rgba(16,185,129,0.16)]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_28%)] opacity-70 transition duration-300 group-hover:opacity-100" />

                  <div className="relative z-10 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-black/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                        {tenant.logoUrl ? (
                          <Image
                            src={tenant.logoUrl}
                            alt={`Logo ${tenant.nome}`}
                            fill
                            unoptimized
                            className="object-contain p-3"
                            sizes="80px"
                          />
                        ) : (
                          <span className="text-xl font-black uppercase text-emerald-300">
                            {getTenantInitials(tenant)}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300/80">
                          {tenant.sigla}
                        </p>
                        <h3 className="mt-2 truncate text-xl font-black uppercase tracking-tight text-white">
                          {tenant.nome}
                        </h3>
                      </div>
                    </div>

                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">
                      Ativa
                    </span>
                  </div>

                  <div className="relative z-10 mt-6 space-y-3 text-sm text-zinc-300">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Faculdade
                      </p>
                      <p className="mt-1 truncate text-sm font-medium text-white">
                        {tenant.faculdade || "Faculdade nao informada"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Curso
                      </p>
                      <p className="mt-1 truncate text-sm font-medium text-white">
                        {tenant.curso || "Curso nao informado"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Cidade
                      </p>
                      <p className="mt-1 truncate text-sm font-medium text-white">
                        {tenant.cidade || "Cidade nao informada"}
                        {tenant.area ? ` - ${tenant.area}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="relative z-10 mt-6">
                    <Link
                      href={dashboardHref}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#34d399,#10b981)] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-[#03120d] shadow-[0_18px_40px_rgba(16,185,129,0.28)] transition hover:brightness-110 active:scale-[0.99]"
                    >
                      Abrir Dashboard
                      <ExternalLink size={14} />
                    </Link>
                  </div>
                </article>
              );
            })}
        </section>

        {!loading && !errorMessage && visibleTenants.length === 0 && (
          <div className="mt-10 rounded-[30px] border border-white/8 bg-white/[0.04] p-10 text-center backdrop-blur-2xl">
            <Compass size={42} className="mx-auto text-zinc-600" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">
              Nenhuma atlética encontrada
            </h3>
            <p className="mt-3 text-sm text-zinc-500">
              Ajuste a busca no droplist acima para explorar outro tenant.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
