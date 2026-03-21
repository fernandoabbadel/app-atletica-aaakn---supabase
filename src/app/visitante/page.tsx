"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchPublicTenants,
  type TenantPaletteKey,
  type TenantSummary,
} from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

type VisitorPalette = {
  primary: string;
  accent: string;
  rgb: string;
  surface: string;
  soft: string;
};

const VISITOR_PALETTES: Record<TenantPaletteKey, VisitorPalette> = {
  green: {
    primary: "#10b981",
    accent: "#34d399",
    rgb: "16 185 129",
    surface: "#05281f",
    soft: "#d1fae5",
  },
  yellow: {
    primary: "#f59e0b",
    accent: "#fbbf24",
    rgb: "245 158 11",
    surface: "#2d1904",
    soft: "#fef3c7",
  },
  red: {
    primary: "#ef4444",
    accent: "#f87171",
    rgb: "239 68 68",
    surface: "#320809",
    soft: "#fee2e2",
  },
  blue: {
    primary: "#3b82f6",
    accent: "#60a5fa",
    rgb: "59 130 246",
    surface: "#071a38",
    soft: "#dbeafe",
  },
  orange: {
    primary: "#f97316",
    accent: "#fb923c",
    rgb: "249 115 22",
    surface: "#351406",
    soft: "#ffedd5",
  },
  purple: {
    primary: "#8b5cf6",
    accent: "#a78bfa",
    rgb: "139 92 246",
    surface: "#1f113f",
    soft: "#ede9fe",
  },
  pink: {
    primary: "#ec4899",
    accent: "#f472b6",
    rgb: "236 72 153",
    surface: "#351023",
    soft: "#fce7f3",
  },
};

const DEFAULT_VISITOR_PALETTE = VISITOR_PALETTES.green;

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

const getVisitorPalette = (paletteKey?: string | null): VisitorPalette => {
  const normalized = typeof paletteKey === "string" ? paletteKey.trim().toLowerCase() : "";
  if (
    normalized === "green" ||
    normalized === "yellow" ||
    normalized === "red" ||
    normalized === "blue" ||
    normalized === "orange" ||
    normalized === "purple" ||
    normalized === "pink"
  ) {
    return VISITOR_PALETTES[normalized];
  }
  return DEFAULT_VISITOR_PALETTE;
};

const glowColor = (rgb: string, alpha: number): string => `rgb(${rgb} / ${alpha})`;

export default function VisitantePage() {
  const { user } = useAuth();
  const { tenantSlug: activeTenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenantSlug, setSelectedTenantSlug] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAnonymousVisitor = Boolean(user?.isAnonymous);
  const memberDashboardHref = useMemo(() => {
    const tenantSlug = activeTenantSlug.trim().toLowerCase();
    return tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/visitante";
  }, [activeTenantSlug]);

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
        let rows: TenantSummary[];

        try {
          const response = await fetch("/api/public/tenants?limit=60", {
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(`Falha ao carregar atleticas: ${response.status}`);
          }
          rows = (await response.json()) as TenantSummary[];
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          const shouldUseClientFallback =
            message.includes("404") ||
            message.includes("failed to fetch") ||
            message.includes("network");

          if (!shouldUseClientFallback) {
            throw error;
          }

          rows = await fetchPublicTenants({ limit: 60 });
        }

        if (!mounted) return;
        setTenants(Array.isArray(rows) ? rows : []);
      } catch (error: unknown) {
        if (!mounted) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Nao foi possivel carregar as atleticas agora.";
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

  const spotlightTenant = selectedTenant || visibleTenants[0] || tenants[0] || null;
  const spotlightPalette = getVisitorPalette(spotlightTenant?.paletteKey);
  const selectedPalette = getVisitorPalette(selectedTenant?.paletteKey);

  const pageBackgroundStyle: CSSProperties = {
    backgroundImage: [
      `radial-gradient(circle at top left, ${glowColor(spotlightPalette.rgb, 0.2)} 0%, transparent 32%)`,
      `radial-gradient(circle at top right, ${glowColor(spotlightPalette.rgb, 0.1)} 0%, transparent 24%)`,
      "linear-gradient(180deg, #040506 0%, #06080d 46%, #030303 100%)",
    ].join(", "),
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#040506] text-white selection:bg-white/20"
      style={pageBackgroundStyle}
    >
      <div
        className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full blur-3xl"
        style={{ background: glowColor(spotlightPalette.rgb, 0.18) }}
      />
      <div
        className="pointer-events-none absolute -right-20 top-64 h-80 w-80 rounded-full blur-3xl"
        style={{ background: glowColor(spotlightPalette.rgb, 0.12) }}
      />

      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#040506]/72 px-6 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/55">
                Vitrine publica
              </p>
              <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-black uppercase tracking-tight text-white">
                <Compass size={18} style={{ color: spotlightPalette.accent }} />
                Escolha sua atletica
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/nova-atletica"
              className="inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-white transition hover:brightness-110"
              style={{
                borderColor: glowColor(spotlightPalette.rgb, 0.26),
                background: `linear-gradient(135deg, ${glowColor(
                  spotlightPalette.rgb,
                  0.24
                )}, rgba(0,0,0,0.38))`,
              }}
            >
              <Building2 size={15} style={{ color: spotlightPalette.accent }} />
              Criar atletica
            </Link>

            {!isAnonymousVisitor && user && (
              <Link
                href={memberDashboardHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-100 transition hover:bg-white/10"
              >
                <Building2 size={15} style={{ color: spotlightPalette.accent }} />
                Minha area
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <section
          className="mb-10 overflow-hidden rounded-[32px] border border-white/8 p-6 shadow-[0_28px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl md:p-8"
          style={{
            backgroundImage: [
              `linear-gradient(135deg, ${glowColor(spotlightPalette.rgb, 0.14)}, transparent 42%)`,
              "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
            ].join(", "),
          }}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <div
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em]"
                style={{
                  borderColor: glowColor(spotlightPalette.rgb, 0.26),
                  background: glowColor(spotlightPalette.rgb, 0.12),
                  color: spotlightPalette.soft,
                }}
              >
                <Sparkles size={12} />
                Entrada publica
              </div>
              <h2 className="mt-5 max-w-4xl text-4xl font-black uppercase tracking-[-0.04em] text-white md:text-6xl">
                A atletica certa,
                <br />
                na cor da sua atletica
              </h2>
              <p className="mt-4 max-w-2xl text-sm text-zinc-300 md:text-base">
                Busque, escolha e entre.
              </p>
            </div>

            <div
              className="rounded-[28px] border border-white/10 p-5"
              style={{
                background: `linear-gradient(180deg, ${glowColor(
                  spotlightPalette.rgb,
                  0.12
                )}, rgba(0,0,0,0.35))`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 60px ${glowColor(
                  spotlightPalette.rgb,
                  0.12
                )}`,
              }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                Atleticas ativas
              </p>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-5xl font-black" style={{ color: spotlightPalette.soft }}>
                    {tenants.length}
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">paginas disponiveis</p>
                </div>
                <div
                  className="rounded-2xl border px-4 py-3 text-right"
                  style={{
                    borderColor: glowColor(spotlightPalette.rgb, 0.26),
                    background: glowColor(spotlightPalette.rgb, 0.12),
                  }}
                >
                  <p
                    className="text-[10px] font-black uppercase tracking-[0.18em]"
                    style={{ color: spotlightPalette.soft }}
                  >
                    Filtro
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
                className="flex w-full items-center justify-between rounded-[26px] border px-5 py-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition hover:bg-white/[0.06]"
                style={{
                  borderColor: selectedTenant
                    ? glowColor(selectedPalette.rgb, 0.28)
                    : "rgba(255,255,255,0.1)",
                  background: selectedTenant
                    ? `linear-gradient(180deg, ${glowColor(
                        selectedPalette.rgb,
                        0.18
                      )}, rgba(0,0,0,0.32))`
                    : "rgba(0,0,0,0.35)",
                  boxShadow: selectedTenant
                    ? `0 18px 50px ${glowColor(selectedPalette.rgb, 0.18)}`
                    : "0 18px 40px rgba(0,0,0,0.35)",
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border text-white"
                    style={{
                      borderColor: selectedTenant
                        ? glowColor(selectedPalette.rgb, 0.32)
                        : "rgba(255,255,255,0.1)",
                      background: selectedTenant
                        ? `linear-gradient(135deg, ${glowColor(
                            selectedPalette.rgb,
                            0.3
                          )}, rgba(5,8,12,0.88))`
                        : "rgba(255,255,255,0.06)",
                    }}
                  >
                    {selectedTenant?.logoUrl ? (
                      <Image
                        src={selectedTenant.logoUrl}
                        alt={`Logo ${selectedTenant.nome}`}
                        fill
                        unoptimized
                        className="object-contain p-2"
                        sizes="48px"
                      />
                    ) : selectedTenant ? (
                      <span className="text-xs font-black uppercase">
                        {getTenantInitials(selectedTenant)}
                      </span>
                    ) : (
                      <Search size={18} />
                    )}
                  </span>

                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      Atletica
                    </p>
                    <p className="truncate text-sm font-black uppercase text-white md:text-base">
                      {selectedTenant ? selectedTenant.nome : "Abrir seletor"}
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
                      <Search size={16} style={{ color: spotlightPalette.accent }} />
                      <input
                        type="text"
                        placeholder="Buscar por nome, sigla, curso ou cidade..."
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
                          <p className="text-sm font-black uppercase text-white">Mostrar todas</p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                            Ver a vitrine completa
                          </p>
                        </div>
                      </button>
                    </li>

                    {searchedTenants.map((tenant) => {
                      const palette = getVisitorPalette(tenant.paletteKey);
                      return (
                        <li key={`tenant-select-${tenant.id}`} className="mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTenantSlug(tenant.slug);
                              setSearchQuery("");
                              setIsDropdownOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition"
                            style={{
                              borderColor: "transparent",
                              background:
                                selectedTenantSlug === tenant.slug
                                  ? glowColor(palette.rgb, 0.12)
                                  : "transparent",
                            }}
                          >
                            <div
                              className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border"
                              style={{
                                borderColor: glowColor(palette.rgb, 0.24),
                                background: `linear-gradient(135deg, ${glowColor(
                                  palette.rgb,
                                  0.22
                                )}, rgba(0,0,0,0.72))`,
                              }}
                            >
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
                                <span className="text-xs font-black uppercase text-white">
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
                      );
                    })}

                    {searchedTenants.length === 0 && (
                      <li className="px-4 py-8 text-center text-sm text-zinc-500">
                        Nenhuma atletica encontrada.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        {!loading && !errorMessage && !selectedTenantSlug && (
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/8 bg-white/[0.05] px-5 py-3 backdrop-blur-xl">
              <span
                className="h-2.5 w-2.5 rounded-full shadow-[0_0_18px_rgba(255,255,255,0.2)]"
                style={{ background: spotlightPalette.accent }}
              />
              <span className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-300">
                Abra a pagina certa
              </span>
            </div>

            <Link
              href="/nova-atletica"
              className="inline-flex items-center gap-2 rounded-full border px-5 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
              style={{
                borderColor: glowColor(spotlightPalette.rgb, 0.26),
                background: `linear-gradient(135deg, ${glowColor(
                  spotlightPalette.rgb,
                  0.2
                )}, rgba(0,0,0,0.3))`,
              }}
            >
              <Sparkles size={13} style={{ color: spotlightPalette.accent }} />
              Criar minha atletica com login
            </Link>
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
                className="h-[340px] animate-pulse rounded-[30px] border border-white/8 bg-white/[0.05] backdrop-blur-xl"
              />
            ))}

          {!loading &&
            visibleTenants.map((tenant) => {
              const palette = getVisitorPalette(tenant.paletteKey);
              const landingHref = withTenantSlug(tenant.slug, "/");

              return (
                <article
                  key={tenant.id}
                  className="group relative isolate overflow-hidden rounded-[30px] border p-6 transition duration-300 hover:-translate-y-1.5"
                  style={{
                    borderColor: glowColor(palette.rgb, 0.24),
                    backgroundImage: [
                      `linear-gradient(180deg, ${glowColor(palette.rgb, 0.14)}, rgba(5,7,11,0.96))`,
                      `radial-gradient(circle at top right, ${glowColor(
                        palette.rgb,
                        0.22
                      )}, transparent 34%)`,
                    ].join(", "),
                    boxShadow: `0 24px 80px rgba(0,0,0,0.42), 0 0 0 1px ${glowColor(
                      palette.rgb,
                      0.08
                    )}`,
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-x-10 -bottom-12 h-36 blur-3xl transition duration-300 group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(circle, ${glowColor(
                        palette.rgb,
                        0.34
                      )} 0%, ${glowColor(palette.rgb, 0)} 72%)`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute inset-0 opacity-80"
                    style={{
                      backgroundImage: `linear-gradient(145deg, ${glowColor(
                        palette.rgb,
                        0.12
                      )}, transparent 32%)`,
                    }}
                  />

                  <div className="relative z-10 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="relative">
                        <div
                          className="absolute inset-0 scale-110 rounded-[28px] blur-2xl"
                          style={{ background: glowColor(palette.rgb, 0.28) }}
                        />
                        <div
                          className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[24px] border"
                          style={{
                            borderColor: glowColor(palette.rgb, 0.34),
                            background: `linear-gradient(135deg, ${glowColor(
                              palette.rgb,
                              0.3
                            )}, rgba(4,6,9,0.94))`,
                            boxShadow: `inset 0 0 30px ${glowColor(palette.rgb, 0.16)}`,
                          }}
                        >
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
                            <span className="text-xl font-black uppercase text-white">
                              {getTenantInitials(tenant)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p
                          className="text-[10px] font-black uppercase tracking-[0.24em]"
                          style={{ color: palette.accent }}
                        >
                          {tenant.sigla}
                        </p>
                        <h3 className="mt-2 truncate text-xl font-black uppercase tracking-tight text-white">
                          {tenant.nome}
                        </h3>
                      </div>
                    </div>

                    <span
                      className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]"
                      style={{
                        borderColor: glowColor(palette.rgb, 0.24),
                        background: glowColor(palette.rgb, 0.12),
                        color: palette.soft,
                      }}
                    >
                      Ativa
                    </span>
                  </div>

                  <div className="relative z-10 mt-6 space-y-3 text-sm text-zinc-300">
                    <div
                      className="rounded-2xl border px-4 py-3"
                      style={{
                        borderColor: glowColor(palette.rgb, 0.16),
                        background: glowColor(palette.rgb, 0.08),
                      }}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Faculdade
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {tenant.faculdade || "Nao informada"}
                      </p>
                    </div>

                    <div
                      className="rounded-2xl border px-4 py-3"
                      style={{
                        borderColor: glowColor(palette.rgb, 0.16),
                        background: glowColor(palette.rgb, 0.08),
                      }}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Curso
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {tenant.curso || "Nao informado"}
                      </p>
                    </div>

                    <div
                      className="rounded-2xl border px-4 py-3"
                      style={{
                        borderColor: glowColor(palette.rgb, 0.16),
                        background: glowColor(palette.rgb, 0.08),
                      }}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Cidade
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {tenant.cidade || "Nao informada"}
                        {tenant.area ? ` - ${tenant.area}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="relative z-10 mt-6">
                    <Link
                      href={landingHref}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition hover:brightness-110 active:scale-[0.99]"
                      style={{
                        background: `linear-gradient(135deg, ${palette.accent}, ${palette.primary})`,
                        color: palette.surface,
                        boxShadow: `0 18px 40px ${glowColor(palette.rgb, 0.28)}`,
                      }}
                    >
                      Abrir pagina
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
              Nenhuma atletica encontrada
            </h3>
            <p className="mt-3 text-sm text-zinc-500">
              Ajuste a busca para tentar outro nome.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
