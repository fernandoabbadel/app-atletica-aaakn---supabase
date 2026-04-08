"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ShieldAlert, Waypoints } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  dispatchMasterRolePreviewChanged,
  MASTER_ROLE_PREVIEW_STORAGE_KEY,
  type TenantContextUserLike,
} from "@/lib/tenantContext";
import {
  fetchManageableTenants,
  type TenantSummary,
} from "@/lib/tenantService";
import {
  isPlatformMaster,
  normalizeTenantRole,
  resolveEffectiveAccessRole,
  type TenantScopedRole,
} from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

type RoleOption = {
  value: TenantScopedRole;
  label: string;
};

const ROLE_OPTIONS: RoleOption[] = [
  { value: "master", label: "Master Plataforma" },
  { value: "master_tenant", label: "Master Tenant" },
  { value: "admin_geral", label: "Admin Geral" },
  { value: "admin_gestor", label: "Gestor" },
  { value: "admin_treino", label: "Adm Treino" },
  { value: "vendas", label: "Vendas" },
  { value: "treinador", label: "Coach" },
  { value: "empresa", label: "Empresa" },
  { value: "user", label: "Membro" },
  { value: "visitante", label: "Visitante" },
];

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Nao foi possivel carregar os tenants do master.";
};

const resolveMasterViewMode = (path: string): string => {
  if (path === "/master" || path.startsWith("/master/")) return "painel master";
  if (path === "/admin" || path.startsWith("/admin/")) return "painel da atletica";
  return "app da atletica";
};

const getPreviewRole = (
  user: (TenantContextUserLike & { master_role_preview?: unknown }) | null | undefined
): TenantScopedRole => normalizeTenantRole(user?.master_role_preview) || "master";

const getRoleLabel = (role: string): string => {
  const match = ROLE_OPTIONS.find((option) => option.value === role);
  if (match) return match.label;
  return role.replaceAll("_", " ");
};

export default function MasterTopBar() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { user } = useAuth();
  const {
    palette,
    tenantId,
    tenantName,
    tenantSigla,
    tenantSlug,
    isOverrideActive,
    setMasterTenantOverride,
  } = useTenantTheme();

  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingChange, setLoadingChange] = useState(false);

  const isPlatformMasterUser = isPlatformMaster(user);
  const pathInfo = useMemo(() => parseTenantScopedPath(pathname), [pathname]);
  const currentPath = pathInfo.scopedPath;
  const previewRole = getPreviewRole(user);
  const effectiveRoleLabel = getRoleLabel(resolveEffectiveAccessRole(user));
  const isMasterScope = currentPath === "/master" || currentPath.startsWith("/master/");
  const tenantOptions = tenants
    .slice()
    .sort((left, right) => left.nome.localeCompare(right.nome));
  const routeTenant = tenantOptions.find((tenant) => tenant.slug === pathInfo.tenantSlug) || null;
  const selectedTenantId = isMasterScope
    ? isOverrideActive
      ? tenantId
      : ""
    : tenantId || routeTenant?.id || "";
  const selectedTenant =
    tenantOptions.find((tenant) => tenant.id === selectedTenantId) || routeTenant;
  const adminTargetSlug = pathInfo.tenantSlug || selectedTenant?.slug || tenantSlug;
  const activeTenantLabel =
    isMasterScope && !selectedTenantId
      ? "Plataforma USC"
      : selectedTenant
        ? `${selectedTenant.sigla} - ${selectedTenant.nome}`
        : tenantName.trim() || tenantSigla.trim() || pathInfo.tenantSlug.trim() || "Plataforma USC";
  const mode = resolveMasterViewMode(currentPath);

  useEffect(() => {
    if (!isPlatformMasterUser) return;

    let mounted = true;
    const loadTenants = async () => {
      try {
        const rows = await fetchManageableTenants({ includeAll: true });
        if (!mounted) return;
        setTenants(rows);
      } catch (error: unknown) {
        if (!mounted) return;
        console.error(extractErrorMessage(error));
      } finally {
        if (mounted) setLoadingTenants(false);
      }
    };

    void loadTenants();
    return () => {
      mounted = false;
    };
  }, [isPlatformMasterUser]);

  if (!isPlatformMasterUser) return null;

  const persistRolePreview = (nextRole: string) => {
    const normalized = normalizeTenantRole(nextRole) || "master";
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MASTER_ROLE_PREVIEW_STORAGE_KEY, normalized);
    }
    dispatchMasterRolePreviewChanged(normalized);
  };

  const handleTenantChange = (nextTenantId: string) => {
    const selectedTenant = tenants.find((tenant) => tenant.id === nextTenantId) || null;
    setLoadingChange(true);
    setMasterTenantOverride(nextTenantId);

    if (!nextTenantId) {
      if (currentPath.startsWith("/master")) {
        setLoadingChange(false);
        router.refresh();
        return;
      }
      router.push("/master");
      return;
    }

    if (currentPath.startsWith("/master")) {
      setLoadingChange(false);
      router.refresh();
      return;
    }

    if (selectedTenant?.slug) {
      router.push(withTenantSlug(selectedTenant.slug, currentPath));
      return;
    }

    setLoadingChange(false);
    router.push("/master");
  };

  const handleRoleChange = (nextRole: string) => {
    persistRolePreview(nextRole);
    router.refresh();
  };

  return (
    <div className="sticky top-0 z-[90] border-b border-red-500/20 bg-[linear-gradient(90deg,#2f0505,#120606_28%,#0a0a0a_55%,#120606_78%,#2f0505)] shadow-[0_16px_50px_rgba(127,29,29,0.28)]">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-3 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-white sm:text-[10px] md:flex-nowrap md:px-5 md:tracking-[0.16em]">
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-red-300/30 bg-red-500/12 px-3 py-1 text-red-100">
          <ShieldAlert size={11} />
          Modo Master
        </span>

        <span className="hidden text-zinc-500 md:block">|</span>

        <span className="hidden truncate text-zinc-200 md:block">
          vendo{" "}
          <span style={{ color: selectedTenantId ? palette.accent : undefined }}>
            {activeTenantLabel}
          </span>
        </span>

        <span className="hidden text-zinc-500 xl:block">|</span>

        <span className="hidden truncate text-zinc-400 xl:block">
          role {effectiveRoleLabel} | {mode}
        </span>

        {isOverrideActive && (
          <span
            className="hidden rounded-full border px-2 py-1 text-[9px] md:inline-flex"
            style={{
              borderColor: "rgb(var(--tenant-primary-rgb) / 0.32)",
              backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.12)",
              color: "var(--tenant-accent)",
            }}
          >
            contexto forcado
          </span>
        )}

        <div className="ml-auto grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:w-auto md:flex-row">
          <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 md:min-w-[220px]">
            <span className="shrink-0 text-[9px] text-zinc-500">Tenant</span>
            <select
              value={selectedTenantId}
              onChange={(event) => handleTenantChange(event.target.value)}
              className="w-full bg-transparent text-[10px] font-black uppercase text-white outline-none"
              disabled={loadingTenants || loadingChange}
            >
              <option value="" className="bg-zinc-950 text-white">
                Plataforma USC
              </option>
              {tenantOptions.map((tenant) => (
                <option key={tenant.id} value={tenant.id} className="bg-zinc-950 text-white">
                  {tenant.sigla} - {tenant.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 md:min-w-[190px]">
            <span className="shrink-0 text-[9px] text-zinc-500">Role</span>
            <select
              value={previewRole}
              onChange={(event) => handleRoleChange(event.target.value)}
              className="w-full bg-transparent text-[10px] font-black uppercase text-white outline-none"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2 sm:col-span-2 md:col-auto">
            <Link
              href="/master"
              className="inline-flex items-center gap-1 rounded-full border border-red-300/20 bg-white/5 px-3 py-2 text-[9px] text-zinc-200 transition hover:bg-red-500/15 hover:text-white"
            >
              <Building2 size={11} />
              Master
            </Link>
            {adminTargetSlug ? (
              <Link
                href={withTenantSlug(adminTargetSlug, "/admin")}
                className="inline-flex items-center gap-1 rounded-full border bg-white/5 px-3 py-2 text-[9px] transition hover:text-white"
                style={{
                  borderColor: "rgb(var(--tenant-primary-rgb) / 0.24)",
                  color: "var(--tenant-accent)",
                }}
              >
                <Waypoints size={11} />
                Admin
              </Link>
            ) : (
              <div className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-zinc-700 bg-white/5 px-3 py-2 text-[9px] text-zinc-500 opacity-60">
                <Waypoints size={11} />
                Admin
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
