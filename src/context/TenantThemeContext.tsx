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
import { fetchTenantById, type TenantPaletteKey } from "@/lib/tenantService";
import {
  dispatchMasterTenantOverrideChanged,
  getMasterTenantOverrideId,
  hasMasterTenantOverride,
  MASTER_TENANT_OVERRIDE_STORAGE_KEY,
  resolveEffectiveTenantId,
} from "@/lib/tenantContext";
import { TENANT_SLUG_COOKIE_NAME } from "@/lib/tenantRouting";

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

const TenantThemeContext = createContext<TenantThemeContextValue>({
  palette: DEFAULT_PALETTE,
  tenantId: "",
  tenantSlug: "",
  tenantName: "USC",
  tenantSigla: "USC",
  tenantCourse: "",
  tenantLogoUrl: "/logo.png",
  isOverrideActive: false,
  loading: true,
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
  const [tenantLogoUrl, setTenantLogoUrl] = useState("/logo.png");
  const [isOverrideActive, setIsOverrideActive] = useState(false);
  const [masterOverrideTenantId, setMasterOverrideTenantId] = useState("");
  const [palette, setPalette] = useState<TenantPalette>(DEFAULT_PALETTE);
  const [refreshVersion, setRefreshVersion] = useState(0);

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
          if (!mounted) return;
          setTenantId("");
          setTenantSlug("");
          setPalette(DEFAULT_PALETTE);
          setTenantName("USC");
          setTenantSigla("USC");
          setTenantCourse("");
          setTenantLogoUrl("/logo.png");
          setIsOverrideActive(false);
          syncTenantSlugCookie("");
          persistTenantBrandSnapshot({
            tenantId: "",
            tenantSlug: "",
            tenantName: "USC",
            tenantSigla: "USC",
            tenantCourse: "",
            tenantLogoUrl: "/logo.png",
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
        const resolvedLogo = tenant?.logoUrl || "/logo.png";
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
        setTenantLogoUrl("/logo.png");
        setIsOverrideActive(false);
        syncTenantSlugCookie("");
        persistTenantBrandSnapshot({
          tenantId: "",
          tenantSlug: "",
          tenantName: "USC",
          tenantSigla: "USC",
          tenantCourse: "",
          tenantLogoUrl: "/logo.png",
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
    ]
  );

  return <TenantThemeContext.Provider value={value}>{children}</TenantThemeContext.Provider>;
}

export function useTenantTheme(): TenantThemeContextValue {
  return useContext(TenantThemeContext);
}
