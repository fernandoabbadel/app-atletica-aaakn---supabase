"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Users,
  MapPin,
  Mail,
  MessageCircle,
  Phone,
  Globe,
  Instagram,
  Linkedin,
  Music2,
  Star,
  Twitter,
  Youtube,
  Crown,
  Eye,
  Building2,
  Handshake,
  LayoutDashboard,
  Shield,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_BRAND_SIGLA,
  PLATFORM_BRAND_SUBTITLE,
  PLATFORM_LOGO_URL,
} from "@/constants/platformBrand";
import {
  DEFAULT_PLATFORM_LANDING_CONFIG,
  DEFAULT_TENANT_LANDING_CONFIG,
  storeLandingConfigSnapshot,
  type LandingConfig,
} from "@/lib/adminLandingService";
import {
  fetchPublicLandingData,
  type PublicLandingPayload,
} from "@/lib/publicLandingService";
import { type PartnerRecord } from "@/lib/partnersPublicService";
import { hasAdminPanelAccess, isPlatformMaster } from "@/lib/roles";
import { fetchTenantBySlug } from "@/lib/tenantService";
import { withTenantSlug } from "@/lib/tenantRouting";

type BrandState = {
  sigla: string;
  nome: string;
  subtitle: string;
  logoUrl: string;
};

const DEFAULT_BRAND: BrandState = {
  sigla: PLATFORM_BRAND_SIGLA,
  nome: PLATFORM_BRAND_NAME,
  subtitle: PLATFORM_BRAND_SUBTITLE,
  logoUrl: PLATFORM_LOGO_URL,
};

const hexToRgbTriplet = (value: string): string => {
  const clean = value.trim().replace("#", "");
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(clean)) {
    return "16 185 129";
  }

  const normalized =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : clean;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `${red} ${green} ${blue}`;
};

const normalizeUscPalette = (config: LandingConfig): LandingConfig => {
  const normalized = { ...config };
  const colorTagline = config.taglineColor.trim().toLowerCase();
  const colorStart = config.gradientStart.trim().toLowerCase();
  const colorEnd = config.gradientEnd.trim().toLowerCase();

  if (colorTagline === "#10b981") {
    normalized.taglineColor = DEFAULT_PLATFORM_LANDING_CONFIG.taglineColor;
  }
  if (colorStart === "#34d399") {
    normalized.gradientStart = DEFAULT_PLATFORM_LANDING_CONFIG.gradientStart;
  }
  if (colorEnd === "#10b981") {
    normalized.gradientEnd = DEFAULT_PLATFORM_LANDING_CONFIG.gradientEnd;
  }

  return normalized;
};

const resolveSocialIcon = (platform: string) => {
  switch (platform) {
    case "instagram":
      return <Instagram size={14} />;
    case "tiktok":
      return <Music2 size={14} />;
    case "twitter":
      return <Twitter size={14} />;
    case "linkedin":
      return <Linkedin size={14} />;
    case "youtube":
      return <Youtube size={14} />;
    default:
      return <Globe size={14} />;
  }
};

const partnerTierBadgeClass: Record<string, string> = {
  ouro: "border-yellow-500/30 bg-yellow-500/15 text-yellow-200",
  prata: "border-zinc-500/30 bg-zinc-500/15 text-zinc-200",
  standard: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
};

const useCounter = (end: number, duration = 2000) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    if (end === 0) {
      setCount(0);
      return;
    }

    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.ceil(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [duration, end]);

  return count;
};

type StatColor = "brand" | "brandAccent" | "neutral";

type StatCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  color: StatColor;
};

const StatCard = ({ icon: Icon, value, label, color }: StatCardProps) => {
  const count = useCounter(value);
  const colors: Record<StatColor, string> = {
    brand: "text-brand bg-brand-primary/10 border-brand",
    brandAccent: "text-brand-accent bg-brand-primary/15 border-brand",
    neutral: "text-zinc-300 bg-zinc-800/80 border-zinc-700",
  };

  return (
    <div className="flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-md transition-all hover:scale-105">
      <div className={`mb-3 rounded-full p-3 ${colors[color]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <span className="text-3xl font-black tracking-tight text-white">{count}</span>
      <span className="mt-1 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        {label}
      </span>
    </div>
  );
};

type PublicLandingPageProps = {
  tenantSlugOverride?: string;
};

const resolveFallbackBrand = (fallbackSlug: string): BrandState => {
  const fallbackName = fallbackSlug.toUpperCase() || "TENANT";
  return {
    sigla: fallbackName,
    nome: fallbackName,
    subtitle: "Landing oficial da atlética.",
    logoUrl: PLATFORM_LOGO_URL,
  };
};

const loadLandingPayloadFallback = async (
  tenantSlug: string
): Promise<Partial<PublicLandingPayload>> => {
  const tenant = tenantSlug ? await fetchTenantBySlug(tenantSlug) : null;
  const tenantId = tenant?.id?.trim() || "";
  const fallbackConfig = tenantSlug
    ? DEFAULT_TENANT_LANDING_CONFIG
    : DEFAULT_PLATFORM_LANDING_CONFIG;
  const data = await fetchPublicLandingData({
    forceRefresh: true,
    fallbackConfig,
    tenantId,
  });

  return {
    ...data,
    tenantId,
    brand: tenant
      ? {
          sigla: tenant.sigla || tenant.slug.toUpperCase() || "TENANT",
          nome: tenant.nome || tenant.sigla || tenant.slug.toUpperCase() || "TENANT",
          subtitle: tenant.curso || tenant.faculdade || "Landing oficial da atlética.",
          logoUrl: tenant.logoUrl || PLATFORM_LOGO_URL,
        }
      : tenantSlug
        ? resolveFallbackBrand(tenantSlug)
        : DEFAULT_BRAND,
  };
};

export default function PublicLandingPage({
  tenantSlugOverride = "",
}: PublicLandingPageProps) {
  const router = useRouter();
  const { user, loginAsGuest, loginGoogle, loading: authLoading } = useAuth();
  const {
    tenantSlug: activeTenantSlug,
    tenantName: themedTenantName,
    tenantSigla: themedTenantSigla,
    tenantCourse: themedTenantCourse,
    tenantLogoUrl: themedTenantLogoUrl,
  } = useTenantTheme();
  const { addToast } = useToast();

  const tenantSlug = tenantSlugOverride.trim().toLowerCase();
  const normalizedActiveTenantSlug = activeTenantSlug.trim().toLowerCase();
  const isTenantLanding = tenantSlug.length > 0;
  const fallbackConfig = isTenantLanding
    ? DEFAULT_TENANT_LANDING_CONFIG
    : DEFAULT_PLATFORM_LANDING_CONFIG;

  const [config, setConfig] = useState<LandingConfig>(fallbackConfig);
  const [realStats, setRealStats] = useState({
    users: 0,
    tenants: 0,
    partners: 0,
  });
  const [landingPartners, setLandingPartners] = useState<PartnerRecord[]>([]);
  const [brand, setBrand] = useState<BrandState>(DEFAULT_BRAND);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"aluno" | "empresa">("aluno");

  const themedTenantBrand = useMemo<BrandState | null>(() => {
    if (!isTenantLanding) return null;
    if (normalizedActiveTenantSlug && normalizedActiveTenantSlug !== tenantSlug) return null;

    const sigla = themedTenantSigla.trim();
    const nome = themedTenantName.trim();
    const subtitle = themedTenantCourse.trim();
    const logoUrl = themedTenantLogoUrl.trim();

    if (!sigla && !nome && !subtitle && !logoUrl) return null;

    return {
      sigla: sigla || tenantSlug.toUpperCase() || "TENANT",
      nome: nome || sigla || tenantSlug.toUpperCase() || "TENANT",
      subtitle: subtitle || "Landing oficial da atlética.",
      logoUrl: logoUrl || "/logo.png",
    };
  }, [
    isTenantLanding,
    normalizedActiveTenantSlug,
    tenantSlug,
    themedTenantCourse,
    themedTenantLogoUrl,
    themedTenantName,
    themedTenantSigla,
  ]);

  const guestPath = useMemo(() => {
    if (!isTenantLanding) {
      return "/visitante";
    }
    return withTenantSlug(tenantSlug, "/dashboard");
  }, [isTenantLanding, tenantSlug]);

  const authenticatedPath = useMemo(() => {
    if (isTenantLanding) {
      return withTenantSlug(tenantSlug, "/dashboard");
    }
    if (user?.isAnonymous) {
      return "/visitante";
    }
    if (isPlatformMaster(user)) {
      return "/master";
    }
    if (normalizedActiveTenantSlug) {
      return withTenantSlug(normalizedActiveTenantSlug, "/");
    }
    return "/dashboard";
  }, [isTenantLanding, normalizedActiveTenantSlug, tenantSlug, user]);

  const publicEntryPath = useMemo(() => {
    if (isTenantLanding) {
      return withTenantSlug(tenantSlug, "/");
    }
    return normalizedActiveTenantSlug
      ? withTenantSlug(normalizedActiveTenantSlug, "/")
      : "/visitante";
  }, [isTenantLanding, normalizedActiveTenantSlug, tenantSlug]);

  const adminTenantSlug = isTenantLanding ? tenantSlug : normalizedActiveTenantSlug;
  const adminPath = useMemo(() => {
    if (adminTenantSlug) {
      return withTenantSlug(adminTenantSlug, "/admin");
    }
    return isPlatformMaster(user) ? "/master" : "/admin";
  }, [adminTenantSlug, user]);

  const authenticatedActionLabel = useMemo(() => {
    if (isTenantLanding) {
      return user?.isAnonymous ? "Abrir como visitante" : "Abrir dashboard";
    }
    if (user?.isAnonymous) {
      return "Abrir como visitante";
    }
    if (isPlatformMaster(user)) {
      return "Abrir painel master";
    }
    if (normalizedActiveTenantSlug) {
      return "Abrir minha atlética";
    }
    return "Abrir dashboard";
  }, [isTenantLanding, normalizedActiveTenantSlug, user]);

  const canOpenAdmin = Boolean(user && !user.isAnonymous && hasAdminPanelAccess(user));

  useEffect(() => {
    let mounted = true;
    let latestRequestId = 0;
    let lastForegroundRefreshAt = 0;

    const fetchData = async ({
      preserveExistingState = false,
      showLoader = false,
      forceRefresh = false,
    }: {
      preserveExistingState?: boolean;
      showLoader?: boolean;
      forceRefresh?: boolean;
    } = {}) => {
      const requestId = latestRequestId + 1;
      latestRequestId = requestId;

      if (showLoader && mounted) {
        setLoading(true);
      }

      try {
        const searchParams = new URLSearchParams(
          tenantSlug
            ? { tenant: tenantSlug }
            : { scope: "platform" }
        );
        if (forceRefresh) {
          searchParams.set("refresh", "1");
        }
        let data: Partial<PublicLandingPayload>;

        try {
          const response = await fetch(`/api/public/landing?${searchParams.toString()}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            throw new Error(`Falha ao carregar landing: ${response.status}`);
          }
          data = (await response.json()) as Partial<PublicLandingPayload>;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          const shouldUseClientFallback =
            message.includes("failed to fetch") ||
            message.includes("network");

          if (!shouldUseClientFallback) {
            throw error;
          }

          data = await loadLandingPayloadFallback(tenantSlug);
        }

        const rawConfig =
          data.config && typeof data.config === "object"
            ? (data.config as LandingConfig)
            : fallbackConfig;
        const nextConfig = isTenantLanding ? rawConfig : normalizeUscPalette(rawConfig);
        const nextBrand =
          data.brand && typeof data.brand === "object"
            ? {
                sigla:
                  typeof data.brand.sigla === "string" && data.brand.sigla.trim()
                    ? data.brand.sigla.trim()
                    : DEFAULT_BRAND.sigla,
                nome:
                  typeof data.brand.nome === "string" && data.brand.nome.trim()
                    ? data.brand.nome.trim()
                    : DEFAULT_BRAND.nome,
                subtitle:
                  typeof data.brand.subtitle === "string" && data.brand.subtitle.trim()
                    ? data.brand.subtitle.trim()
                    : DEFAULT_BRAND.subtitle,
                logoUrl:
                  typeof data.brand.logoUrl === "string" && data.brand.logoUrl.trim()
                    ? data.brand.logoUrl.trim()
                    : DEFAULT_BRAND.logoUrl,
              }
            : isTenantLanding
              ? resolveFallbackBrand(tenantSlug)
              : DEFAULT_BRAND;
        const shouldUseThemedTenantBrand =
          Boolean(themedTenantBrand) &&
          isTenantLanding &&
          nextBrand.nome.trim().toLowerCase() === tenantSlug &&
          nextBrand.sigla.trim().toLowerCase() === tenantSlug &&
          nextBrand.logoUrl.trim() === PLATFORM_LOGO_URL;
        const resolvedBrand =
          shouldUseThemedTenantBrand && themedTenantBrand ? themedTenantBrand : nextBrand;

        if (!mounted || requestId !== latestRequestId) return;

        storeLandingConfigSnapshot(nextConfig, typeof data.tenantId === "string" ? data.tenantId : "");
        setConfig(nextConfig);
        setBrand(resolvedBrand);
        setRealStats({
          users: typeof data.usersCount === "number" ? data.usersCount : 0,
          tenants: typeof data.tenantsCount === "number" ? data.tenantsCount : 0,
          partners: typeof data.partnersCount === "number" ? data.partnersCount : 0,
        });
        setLandingPartners(Array.isArray(data.partners) ? data.partners : []);
      } catch (error: unknown) {
        console.error("Erro ao carregar landing:", error);
        if (mounted && requestId === latestRequestId && !preserveExistingState) {
          setBrand(themedTenantBrand ?? (isTenantLanding ? resolveFallbackBrand(tenantSlug) : DEFAULT_BRAND));
          setLandingPartners([]);
        }
      } finally {
        if (mounted && requestId === latestRequestId) {
          setLoading(false);
        }
      }
    };

    const triggerForegroundRefresh = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastForegroundRefreshAt < 1200) return;

      lastForegroundRefreshAt = now;
      void fetchData({ forceRefresh: true, preserveExistingState: true });
    };

    const triggerFocusRefresh = () => {
      const now = Date.now();
      if (now - lastForegroundRefreshAt < 1200) return;

      lastForegroundRefreshAt = now;
      void fetchData({ forceRefresh: true, preserveExistingState: true });
    };

    void fetchData({ showLoader: true });
    window.addEventListener("focus", triggerFocusRefresh);
    document.addEventListener("visibilitychange", triggerForegroundRefresh);

    return () => {
      mounted = false;
      window.removeEventListener("focus", triggerFocusRefresh);
      document.removeEventListener("visibilitychange", triggerForegroundRefresh);
    };
  }, [fallbackConfig, isTenantLanding, router, tenantSlug, themedTenantBrand]);

  const handleGoogleLogin = async () => {
    try {
      await loginGoogle({ returnTo: authenticatedPath });
    } catch {
      addToast("Erro no login Google", "error");
    }
  };

  const handleGuest = async () => {
    try {
      addToast("Modo visitante ativado.", "info");
      await loginAsGuest();
      router.push(guestPath);
    } catch {
      addToast("Erro ao entrar como visitante.", "error");
    }
  };

  const stats = isTenantLanding
    ? {
        first: config.statUsers || 0,
        second: config.statPosts || 0,
        third: config.statPartners || 0,
        firstLabel: "Atletas",
        secondLabel: "Treinos",
        thirdLabel: "Parceiros",
      }
    : {
        first: config.statUsers || realStats.users,
        second: config.statPosts || realStats.tenants,
        third: config.statPartners || realStats.partners,
        firstLabel: "Socios totais",
        secondLabel: "Atleticas criadas",
        thirdLabel: "Parceiros totais",
      };

  const landingPrimary = config.gradientEnd?.trim() || config.taglineColor?.trim() || "#10b981";
  const landingAccent = config.taglineColor?.trim() || landingPrimary;
  const landingThemeStyle = useMemo(
    () =>
      ({
        "--tenant-primary": landingPrimary,
        "--tenant-accent": landingAccent,
        "--tenant-primary-rgb": hexToRgbTriplet(landingPrimary),
      }) as React.CSSProperties,
    [landingAccent, landingPrimary]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#02050d] font-bold text-brand animate-pulse">
        CARREGANDO CARDUME...
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#02050d] font-sans text-white selection:bg-brand-primary/30"
      style={landingThemeStyle}
    >
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-20%] top-[-10%] h-[80%] w-[80%] animate-pulse-slow rounded-full bg-brand-primary/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-20%] h-[80%] w-[80%] animate-pulse-slow rounded-full bg-brand-primary/10 blur-[120px] delay-700" />
      </div>

      <header className="relative z-20 container mx-auto flex items-center justify-between px-4 pt-5">
        <div className="flex items-center gap-2">
          <Image
            src={brand.logoUrl || "/logo.png"}
            alt={`Logo ${brand.sigla}`}
            width={36}
            height={36}
            className="rounded-lg object-cover"
            unoptimized={brand.logoUrl.startsWith("http")}
          />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {brand.nome}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              {brand.sigla}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTenantLanding ? (
            <Link
              href="/"
              className="rounded-lg border border-brand bg-brand-primary/15 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-brand-accent hover:bg-brand-primary/20"
            >
              USC Oficial
            </Link>
          ) : (
            <>
              <Link
                href="/faq"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-100 hover:bg-white/10"
              >
                Duvidas e como usar
              </Link>
              <Link
                href="/nova-atletica"
                className="rounded-lg border border-brand bg-brand-primary/15 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-brand-accent hover:bg-brand-primary/20"
              >
                Cadastrar Atlética
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-4 pb-20 pt-8 lg:flex lg:items-center lg:gap-16 lg:pt-14">
        <div className="flex-1 space-y-8 text-center lg:text-left">
          <div className="group relative mx-auto h-48 w-48 animate-float-slow lg:mx-0 lg:h-64 lg:w-64">
            <div className="absolute inset-0 scale-75 rounded-full bg-brand-primary/25 blur-[50px]" />
            <Image
              src={brand.logoUrl || "/logo.png"}
              alt={`Logo ${brand.sigla}`}
              width={256}
              height={256}
              className="relative z-10 object-contain mix-blend-screen"
              style={{
                filter: "drop-shadow(0 0 35px rgba(var(--tenant-primary-rgb), 0.45))",
              }}
              priority
              unoptimized={(brand.logoUrl || "").startsWith("http")}
            />
          </div>

          <div className="space-y-4">
            <div
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest animate-pulse lg:mx-0"
              style={{ color: config.taglineColor }}
            >
              <Sparkles size={12} /> {config.tagline}
            </div>

            <h1
              className="text-5xl font-black leading-[0.9] tracking-tighter lg:text-7xl"
              style={{ color: config.titleColor }}
            >
              {config.heroTitle} <br className="hidden lg:block" />
              <span
                className="animate-text-shimmer bg-[length:200%_auto] bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(to right, ${config.gradientStart}, ${config.gradientEnd}, ${config.gradientStart})`,
                }}
              >
                {config.heroHighlight}
              </span>
            </h1>

            <p className="mx-auto max-w-xl text-base font-medium leading-relaxed text-zinc-400 lg:mx-0 lg:text-lg">
              {config.heroSubtitle}
            </p>
          </div>

          <div className="mx-auto grid w-full max-w-lg grid-cols-3 gap-4 lg:mx-0">
            <StatCard icon={Users} value={stats.first} label={stats.firstLabel} color="brand" />
            <StatCard
              icon={Building2}
              value={stats.second}
              label={stats.secondLabel}
              color="neutral"
            />
            <StatCard
              icon={Handshake}
              value={stats.third}
              label={stats.thirdLabel}
              color="brandAccent"
            />
          </div>
        </div>

        <div className="mx-auto mt-12 w-full max-w-md flex-1 lg:mt-0">
          <div className="relative rounded-[2rem] border border-zinc-800 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-6 flex rounded-xl border border-zinc-800/50 bg-zinc-950/60 p-1.5">
              <button
                onClick={() => setActiveTab("aluno")}
                className={`flex-1 rounded-lg py-3 text-[10px] font-extrabold uppercase tracking-wider transition-all ${
                  activeTab === "aluno" ? "bg-zinc-800 text-white shadow-md" : "text-zinc-500"
                }`}
              >
                Sou Aluno
              </button>
              <button
                onClick={() => setActiveTab("empresa")}
                className={`flex-1 rounded-lg py-3 text-[10px] font-extrabold uppercase tracking-wider transition-all ${
                  activeTab === "empresa" ? "bg-zinc-800 text-white shadow-md" : "text-zinc-500"
                }`}
              >
                Parceiro
              </button>
            </div>

            {user ? (
              <div className="space-y-4">
                <button
                  onClick={() => router.push(authenticatedPath)}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 font-black text-zinc-900 transition-all hover:bg-zinc-200"
                >
                  <LayoutDashboard size={18} />
                  {authenticatedActionLabel}
                </button>
                {!isTenantLanding && (
                  <button
                    onClick={() => router.push(publicEntryPath)}
                    className="brand-button-soft flex w-full"
                  >
                    <Globe size={16} /> Abrir página pública
                  </button>
                )}
                {canOpenAdmin && (
                  <button
                    onClick={() => router.push(adminPath)}
                    className="brand-button-soft flex w-full"
                  >
                    <Shield size={16} /> Abrir painel admin
                  </button>
                )}
              </div>
            ) : activeTab === "aluno" ? (
              <div className="space-y-6">
                <button
                  onClick={handleGoogleLogin}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 font-black text-zinc-900 transition-all hover:bg-zinc-200"
                >
                  <Image src="https://www.google.com/favicon.ico" alt="G" width={20} height={20} />
                  {authLoading ? "Conectando..." : "Entrar com Google"}
                </button>
                <button
                  onClick={handleGuest}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800/50 py-3.5 text-xs font-bold uppercase tracking-wider text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                >
                  <Eye size={16} /> {isTenantLanding ? "Visitar esta atlética" : "Entrar como visitante"}
                </button>
                {isTenantLanding && (
                  <Link
                    href="/"
                    className="brand-button-soft flex w-full"
                  >
                    <Building2 size={16} /> Ir para USC oficial
                  </Link>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-500">
                Área restrita a parceiros.
              </div>
            )}
          </div>
        </div>
      </main>

      {isTenantLanding && landingPartners.length > 0 ? (
        <section className="container mx-auto border-t border-white/5 bg-zinc-950/20 px-4 py-20">
          <div className="mb-8 flex items-center justify-center gap-2 lg:justify-start">
            <Handshake className="text-brand" />
            <h3 className="text-xl font-black uppercase tracking-tight text-white">
              Parceiros Oficiais
            </h3>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {landingPartners.map((partner) => {
              const partnerHref = withTenantSlug(tenantSlug, `/parceiros/${partner.id}`);
              const previewImage = partner.imgCapa || partner.imgLogo || "/logo.png";
              const partnerBadgeClass =
                partnerTierBadgeClass[partner.tier] || partnerTierBadgeClass.standard;

              return (
                <Link
                  key={partner.id}
                  href={partnerHref}
                  className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 transition hover:-translate-y-1 hover:border-brand"
                >
                  <div className="relative h-40 overflow-hidden bg-zinc-950">
                    <Image
                      src={previewImage}
                      alt={partner.nome}
                      fill
                      className="object-cover opacity-75 transition duration-500 group-hover:scale-105 group-hover:opacity-95"
                      unoptimized={previewImage.startsWith("http")}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-transparent" />
                    <span
                      className={`absolute left-4 top-4 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${partnerBadgeClass}`}
                    >
                      {partner.tier}
                    </span>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="flex items-center gap-3">
                      <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        <Image
                          src={partner.imgLogo || previewImage}
                          alt={`Logo ${partner.nome}`}
                          fill
                          className="object-cover"
                          unoptimized={(partner.imgLogo || previewImage).startsWith("http")}
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-black uppercase tracking-wide text-white">
                          {partner.nome}
                        </h4>
                        <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                          {partner.categoria || "Parceiro"}
                        </p>
                      </div>
                    </div>

                    <p className="line-clamp-3 text-sm leading-relaxed text-zinc-300">
                      {partner.descricao || "Benefícios exclusivos para a comunidade da atlética."}
                    </p>

                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                      <span>Ver parceiro</span>
                      <span className="text-brand-accent">Abrir</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="container mx-auto border-t border-white/5 bg-zinc-950/30 px-4 py-20">
        <div className="mb-8 flex items-center justify-center gap-2 lg:justify-start">
          <Star className="fill-brand-solid text-brand" />
          <h3 className="text-xl font-black uppercase tracking-tight text-white">
            Quem Usa Aprova
          </h3>
        </div>

        <div className="flex snap-x gap-6 overflow-x-auto px-4 pb-8 scrollbar-hide md:grid md:grid-cols-3 md:overflow-visible">
          {(config.reviews || []).length > 0 ? (
            config.reviews.map((review) => (
              <div
                key={review.id}
                className="min-w-[300px] snap-center rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-lg transition-all hover:border-brand"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-brand bg-zinc-800">
                    <Image
                      src={review.profileUrl || "/logo.png"}
                      alt={review.name}
                      fill
                      className={`object-cover ${review.profileUrl ? "" : "p-1 grayscale opacity-50"}`}
                      unoptimized={(review.profileUrl || "").startsWith("http")}
                    />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold leading-tight text-white">{review.name}</h4>
                    <span className="text-[10px] font-bold uppercase text-zinc-500">
                      {review.role}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex gap-1">
                  {[1, 2, 3, 4, 5].map((index) => (
                    <Star key={index} size={12} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mt-4 line-clamp-4 text-xs italic leading-relaxed text-zinc-300">
                  &quot;{review.text}&quot;
                </p>
              </div>
            ))
          ) : (
            <p className="col-span-3 text-center text-xs italic text-zinc-500">
              Nenhum depoimento cadastrado ainda.
            </p>
          )}
        </div>
      </section>

      <footer className="border-t border-zinc-900 bg-zinc-950 pb-8 pt-16">
        <div className="container mx-auto px-4">
          <div className="mb-12 grid grid-cols-1 gap-12 md:grid-cols-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-brand" />
                <span className="text-xl font-black text-white">{brand.sigla}</span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">{brand.subtitle}</p>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-white">Suporte</h4>
              <ul className="space-y-3 text-xs text-zinc-500">
                {config.address.trim() ? (
                  <li className="flex items-center gap-2">
                    <MapPin size={14} className="text-brand" /> {config.address}
                  </li>
                ) : null}
                {config.email.trim() ? (
                  <li className="flex items-center gap-2">
                    <Mail size={14} className="text-brand" />
                    <a href={`mailto:${config.email}`} className="hover:text-brand-accent">
                      {config.email}
                    </a>
                  </li>
                ) : null}
                {config.phone.trim() ? (
                  <li className="flex items-center gap-2">
                    <Phone size={14} className="text-brand" />
                    <a href={`tel:${config.phone}`} className="hover:text-brand-accent">
                      {config.phone}
                    </a>
                  </li>
                ) : null}
                {config.whatsapp.trim() ? (
                  <li className="flex items-center gap-2">
                    <MessageCircle size={14} className="text-brand" />
                    <a
                      href={`https://wa.me/${config.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-brand-accent"
                    >
                      WhatsApp: {config.whatsapp}
                    </a>
                  </li>
                ) : null}
                {(config.socialLinks || []).map((social) => (
                  <li key={social.id} className="pt-2">
                    <a
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-bold capitalize text-brand-accent hover:text-brand"
                    >
                      {resolveSocialIcon(social.platform)} {social.platform}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-zinc-900 pt-8 text-center text-[10px] text-zinc-600">
            <p>
              &copy; {new Date().getFullYear()} {brand.sigla} - {brand.nome}.
            </p>
            <p className="mt-1">
              {isTenantLanding
                ? "Landing oficial da atlética."
                : "Infraestrutura oficial para gestao de atleticas."}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
