"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import { fetchTenantById, type TenantPaletteKey } from "@/lib/tenantService";
import {
  clearActiveTurmasSnapshot,
  fetchTurmasConfig,
  persistActiveTurmasSnapshot,
} from "@/lib/turmasService";
import {
  dispatchMasterTenantOverrideChanged,
  getMasterTenantOverrideId,
  hasMasterTenantOverride,
  MASTER_TENANT_OVERRIDE_STORAGE_KEY,
  resolveEffectiveTenantId,
} from "@/lib/tenantContext";
import { parseTenantScopedPath, TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";

interface TenantPalette {
  key: TenantPaletteKey;
  primary: string;
  accent: string;
  rgb: string;
}

interface TenantThemeContextValue {
  palette: TenantPalette;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantSigla: string;
  tenantCourse: string;
  tenantLogoUrl: string;
  isOverrideActive: boolean;
  loading: boolean;
  turmasVersion: number;
  setMasterTenantOverride: (tenantId: string) => void;
  refreshTenantTheme: () => void;
}

const PALETTES: Record<TenantPaletteKey, TenantPalette> = {
  green: { key: "green", primary: "#10b981", accent: "#34d399", rgb: "16 185 129" },
  yellow: { key: "yellow", primary: "#f59e0b", accent: "#fbbf24", rgb: "245 158 11" },
  red: { key: "red", primary: "#ef4444", accent: "#f87171", rgb: "239 68 68" },
  blue: { key: "blue", primary: "#3b82f6", accent: "#60a5fa", rgb: "59 130 246" },
  orange: { key: "orange", primary: "#f97316", accent: "#fb923c", rgb: "249 115 22" },
  purple: { key: "purple", primary: "#8b5cf6", accent: "#a78bfa", rgb: "139 92 246" },
  pink: { key: "pink", primary: "#ec4899", accent: "#f472b6", rgb: "236 72 153" },
};

const DEFAULT_PALETTE = PALETTES.green;
const TENANT_BRAND_SNAPSHOT_STORAGE_KEY = "usc_active_tenant_brand";

const hexToRgbTriplet = (value: string): string => {
  const clean = value.trim().replace("#", "");
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(clean)) {
    return DEFAULT_PALETTE.rgb;
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

const buildPublicPalette = (primary: string, accent: string): TenantPalette => ({
  key: DEFAULT_PALETTE.key,
  primary: primary || DEFAULT_PALETTE.primary,
  accent: accent || primary || DEFAULT_PALETTE.accent,
  rgb: hexToRgbTriplet(primary || DEFAULT_PALETTE.primary),
});

const TenantThemeContext = createContext<TenantThemeContextValue>({
  palette: DEFAULT_PALETTE,
  tenantId: "",
  tenantSlug: "",
  tenantName: "USC",
  tenantSigla: "USC",
  tenantCourse: "",
  tenantLogoUrl: PLATFORM_LOGO_URL,
  isOverrideActive: false,
  loading: true,
  turmasVersion: 0,
  setMasterTenantOverride: () => {},
  refreshTenantTheme: () => {},
});

const resolvePalette = (key: unknown): TenantPalette => {
  const parsedKey = typeof key === "string" ? key.trim().toLowerCase() : "";
  if (
    parsedKey === "green" ||
    parsedKey === "yellow" ||
    parsedKey === "red" ||
    parsedKey === "blue" ||
    parsedKey === "orange" ||
    parsedKey === "purple" ||
    parsedKey === "pink"
  ) {
    return PALETTES[parsedKey];
  }
  return DEFAULT_PALETTE;
};

const applyPaletteToRoot = (palette: TenantPalette): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.style.setProperty("--tenant-primary", palette.primary);
  root.style.setProperty("--tenant-accent", palette.accent);
  root.style.setProperty("--tenant-primary-rgb", palette.rgb);
  root.style.setProperty("--neon-green", palette.primary);
};

const persistTenantBrandSnapshot = (payload: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantSigla: string;
  tenantCourse: string;
  tenantLogoUrl: string;
}): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      TENANT_BRAND_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignora erro de storage
  }
};

const syncTenantSlugCookie = (tenantSlug: string): void => {
  if (typeof document === "undefined") return;

  const cleanTenantSlug = tenantSlug.trim().toLowerCase();
  if (!cleanTenantSlug) {
    document.cookie = `${TENANT_SLUG_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }

  const maxAge = 60 * 60 * 24 * 30;
  document.cookie = `${TENANT_SLUG_COOKIE_NAME}=${encodeURIComponent(cleanTenantSlug)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
};

export function TenantThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantName, setTenantName] = useState("USC");
  const [tenantSigla, setTenantSigla] = useState("USC");
  const [tenantCourse, setTenantCourse] = useState("");
  const [tenantLogoUrl, setTenantLogoUrl] = useState(PLATFORM_LOGO_URL);
  const [isOverrideActive, setIsOverrideActive] = useState(false);
  const [masterOverrideTenantId, setMasterOverrideTenantId] = useState("");
  const [palette, setPalette] = useState<TenantPalette>(DEFAULT_PALETTE);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [turmasVersion, setTurmasVersion] = useState(0);

  const setMasterTenantOverride = useCallback((nextTenantId: string): void => {
    const cleanTenantId = getMasterTenantOverrideId(nextTenantId);
    setMasterOverrideTenantId(cleanTenantId);
    if (typeof window === "undefined") return;
    if (cleanTenantId) {
      localStorage.setItem(MASTER_TENANT_OVERRIDE_STORAGE_KEY, cleanTenantId);
    } else {
      localStorage.removeItem(MASTER_TENANT_OVERRIDE_STORAGE_KEY);
    }
    dispatchMasterTenantOverrideChanged(cleanTenantId);
  }, []);

  const refreshTenantTheme = useCallback((): void => {
    setRefreshVersion((previous) => previous + 1);
  }, []);

  useEffect(() => {
    applyPaletteToRoot(DEFAULT_PALETTE);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MASTER_TENANT_OVERRIDE_STORAGE_KEY);
    const cleanStored = getMasterTenantOverrideId(stored);
    if (cleanStored) setMasterOverrideTenantId(cleanStored);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== MASTER_TENANT_OVERRIDE_STORAGE_KEY) return;
      setMasterOverrideTenantId(getMasterTenantOverrideId(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (authLoading) return;

    let mounted = true;
    const syncPalette = async () => {
      try {
        const routeTenantSlug =
          typeof window !== "undefined"
            ? parseTenantScopedPath(window.location.pathname || "/").tenantSlug
            : "";
        const userTenantStatus =
          typeof user?.tenant_status === "string" ? user.tenant_status.trim().toLowerCase() : "";
        const selectedTenantId = resolveEffectiveTenantId(
          user,
          masterOverrideTenantId
        );
        const hasTenantContext =
          selectedTenantId.length > 0 &&
          (hasMasterTenantOverride(user, masterOverrideTenantId) ||
            !userTenantStatus ||
            userTenantStatus === "approved");

        if (!hasTenantContext) {
          if (routeTenantSlug) {
            try {
              const response = await fetch(
                `/api/public/landing?tenant=${encodeURIComponent(routeTenantSlug)}`,
                { cache: "no-store" }
              );
              if (!response.ok) {
                throw new Error(`Falha ao carregar tenant publico: ${response.status}`);
              }

              const payload = (await response.json()) as {
                tenantId?: string;
                brand?: {
                  sigla?: string;
                  nome?: string;
                  subtitle?: string;
                  logoUrl?: string;
                };
                config?: {
                  gradientEnd?: string;
                  gradientStart?: string;
                  taglineColor?: string;
                };
              };

              const primary =
                typeof payload.config?.gradientEnd === "string" && payload.config.gradientEnd.trim()
                  ? payload.config.gradientEnd.trim()
                  : DEFAULT_PALETTE.primary;
              const accent =
                typeof payload.config?.taglineColor === "string" && payload.config.taglineColor.trim()
                  ? payload.config.taglineColor.trim()
                  : typeof payload.config?.gradientStart === "string" &&
                      payload.config.gradientStart.trim()
                    ? payload.config.gradientStart.trim()
                    : DEFAULT_PALETTE.accent;
              const publicPalette = buildPublicPalette(primary, accent);
              const publicLogo =
                typeof payload.brand?.logoUrl === "string" && payload.brand.logoUrl.trim()
                  ? payload.brand.logoUrl.trim()
                  : "/logo.png";
              const publicSigla =
                typeof payload.brand?.sigla === "string" && payload.brand.sigla.trim()
                  ? payload.brand.sigla.trim()
                  : routeTenantSlug.toUpperCase();
              const publicName =
                typeof payload.brand?.nome === "string" && payload.brand.nome.trim()
                  ? payload.brand.nome.trim()
                  : publicSigla;
              const publicCourse =
                typeof payload.brand?.subtitle === "string" ? payload.brand.subtitle.trim() : "";
              const publicTenantId =
                typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";

              if (!mounted) return;
              setTenantId(publicTenantId);
              setTenantSlug(routeTenantSlug);
              setPalette(publicPalette);
              setTenantName(publicName);
              setTenantSigla(publicSigla);
              setTenantCourse(publicCourse);
              setTenantLogoUrl(publicLogo);
              setIsOverrideActive(false);
              syncTenantSlugCookie(routeTenantSlug);
              persistTenantBrandSnapshot({
                tenantId: publicTenantId,
                tenantSlug: routeTenantSlug,
                tenantName: publicName,
                tenantSigla: publicSigla,
                tenantCourse: publicCourse,
                tenantLogoUrl: publicLogo,
              });
              applyPaletteToRoot(publicPalette);
              return;
            } catch {
              // se falhar, cai no fallback global logo abaixo
            }
          }

          if (!mounted) return;
          setTenantId("");
          setTenantSlug("");
          setPalette(DEFAULT_PALETTE);
          setTenantName("USC");
          setTenantSigla("USC");
          setTenantCourse("");
          setTenantLogoUrl(PLATFORM_LOGO_URL);
          setIsOverrideActive(false);
          syncTenantSlugCookie("");
          persistTenantBrandSnapshot({
            tenantId: "",
            tenantSlug: "",
            tenantName: "USC",
            tenantSigla: "USC",
            tenantCourse: "",
            tenantLogoUrl: PLATFORM_LOGO_URL,
          });
          applyPaletteToRoot(DEFAULT_PALETTE);
          return;
        }

        const tenant = await fetchTenantById(selectedTenantId);
        if (!mounted) return;

        const resolvedPalette = resolvePalette(tenant?.paletteKey);
        const resolvedSlug = tenant?.slug || "";
        const resolvedName = tenant?.nome || "USC";
        const resolvedSigla = tenant?.sigla || "USC";
        const resolvedCourse = tenant?.curso || "";
        const resolvedLogo = tenant?.logoUrl || PLATFORM_LOGO_URL;
        setTenantId(selectedTenantId);
        setTenantSlug(resolvedSlug);
        setPalette(resolvedPalette);
        setTenantName(resolvedName);
        setTenantSigla(resolvedSigla);
        setTenantCourse(resolvedCourse);
        setTenantLogoUrl(resolvedLogo);
        syncTenantSlugCookie(resolvedSlug);
        setIsOverrideActive(hasMasterTenantOverride(user, masterOverrideTenantId));
        persistTenantBrandSnapshot({
          tenantId: selectedTenantId,
          tenantSlug: resolvedSlug,
          tenantName: resolvedName,
          tenantSigla: resolvedSigla,
          tenantCourse: resolvedCourse,
          tenantLogoUrl: resolvedLogo,
        });
        applyPaletteToRoot(resolvedPalette);
      } catch {
        if (!mounted) return;
        setTenantId("");
        setTenantSlug("");
        setPalette(DEFAULT_PALETTE);
        setTenantName("USC");
        setTenantSigla("USC");
        setTenantCourse("");
        setTenantLogoUrl(PLATFORM_LOGO_URL);
        setIsOverrideActive(false);
        syncTenantSlugCookie("");
        persistTenantBrandSnapshot({
          tenantId: "",
          tenantSlug: "",
          tenantName: "USC",
          tenantSigla: "USC",
          tenantCourse: "",
          tenantLogoUrl: PLATFORM_LOGO_URL,
        });
        applyPaletteToRoot(DEFAULT_PALETTE);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void syncPalette();
    return () => {
      mounted = false;
    };
  }, [
    authLoading,
    masterOverrideTenantId,
    refreshVersion,
    user,
  ]);

  useEffect(() => {
    let mounted = true;

    const scopedTenantId = tenantId.trim();
    const scopedTenantSlug = tenantSlug.trim().toLowerCase();
    if (!scopedTenantId && !scopedTenantSlug) {
      clearActiveTurmasSnapshot();
      setTurmasVersion((previous) => previous + 1);
      return () => {
        mounted = false;
      };
    }

    const syncTurmas = async () => {
      try {
        const rows = await fetchTurmasConfig({
          tenantId: scopedTenantId || undefined,
          forceRefresh: true,
        });
        if (!mounted) return;
        persistActiveTurmasSnapshot({
          tenantId: scopedTenantId,
          tenantSlug: scopedTenantSlug,
          turmas: rows,
        });
      } catch {
        if (!mounted) return;
        clearActiveTurmasSnapshot();
      } finally {
        if (mounted) {
          setTurmasVersion((previous) => previous + 1);
        }
      }
    };

    void syncTurmas();
    return () => {
      mounted = false;
    };
  }, [refreshVersion, tenantId, tenantSlug]);

  const value = useMemo(
    () => ({
      palette,
      tenantId,
      tenantSlug,
      tenantName,
      tenantSigla,
      tenantCourse,
      tenantLogoUrl,
      isOverrideActive,
      loading: authLoading || loading,
      turmasVersion,
      setMasterTenantOverride,
      refreshTenantTheme,
    }),
    [
      authLoading,
      isOverrideActive,
      loading,
      palette,
      refreshTenantTheme,
      setMasterTenantOverride,
      tenantId,
      tenantSlug,
      tenantLogoUrl,
      tenantName,
      tenantSigla,
      tenantCourse,
      turmasVersion,
    ]
  );

  return <TenantThemeContext.Provider value={value}>{children}</TenantThemeContext.Provider>;
}

export function useTenantTheme(): TenantThemeContextValue {
  return useContext(TenantThemeContext);
}
