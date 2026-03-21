"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Building2, RefreshCw } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { canManageTenant, isPlatformMaster } from "@/lib/roles";
import { fetchManageableTenants, type TenantSummary } from "@/lib/tenantService";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

export type LaunchScope = "tenant" | "master";

type LoadMode = "initial" | "refresh";

export interface LaunchWorkspaceState {
  authLoading: boolean;
  canAccess: boolean;
  loading: boolean;
  refreshing: boolean;
  isPlatformMasterUser: boolean;
  tenantSlug: string;
  tenants: TenantSummary[];
  selectedTenantId: string;
  selectedTenant: TenantSummary | null;
  setSelectedTenantId: (tenantId: string) => void;
  refreshWorkspace: () => Promise<string>;
  addToast: ReturnType<typeof useToast>["addToast"];
}

export const getLaunchBasePath = (
  scope: LaunchScope,
  tenantSlug = ""
): string => {
  if (scope === "master") return "/master/lancamento";
  return tenantSlug.trim() ? withTenantSlug(tenantSlug, "/admin/lancamento") : "/admin/lancamento";
};

export const getLaunchBackPath = (
  scope: LaunchScope,
  tenantSlug = ""
): string => {
  if (scope === "master") return "/master";
  return tenantSlug.trim() ? withTenantSlug(tenantSlug, "/admin") : "/admin";
};

export const getLaunchAudienceLabel = (scope: LaunchScope): string =>
  scope === "master" ? "painel master" : "painel admin";

export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

export const normalizeIntegerInput = (
  value: number,
  min: number,
  max: number,
  fallback: number
): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
};

export const formatLaunchDate = (value: string): string => {
  if (!value.trim()) return "Sem registro";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sem registro";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const resolveNextTenantId = (
  tenants: TenantSummary[],
  activeTenantId: string,
  selectedTenantId: string
): string => {
  const cleanActiveTenantId = activeTenantId.trim();
  const cleanSelectedTenantId = selectedTenantId.trim();

  if (cleanActiveTenantId && tenants.some((tenant) => tenant.id === cleanActiveTenantId)) {
    return cleanActiveTenantId;
  }

  if (cleanSelectedTenantId && tenants.some((tenant) => tenant.id === cleanSelectedTenantId)) {
    return cleanSelectedTenantId;
  }

  return tenants[0]?.id || "";
};

export function useLaunchWorkspace(scope: LaunchScope): LaunchWorkspaceState {
  const { user, loading: authLoading } = useAuth();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const initialLoadRef = useRef(false);
  const pathInfo = useMemo(
    () => parseTenantScopedPath(pathname || "/"),
    [pathname]
  );

  const isPlatformMasterUser = isPlatformMaster(user);
  const canAccess = scope === "master" ? isPlatformMasterUser : canManageTenant(user);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [selectedTenantId, tenants]
  );

  const loadWorkspace = useCallback(
    async (mode: LoadMode): Promise<string> => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);

      if (!canAccess) {
        setTenants([]);
        setSelectedTenantId("");
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
        return "";
      }

      try {
        const tenantRows = await fetchManageableTenants({
          includeAll: scope === "master" && isPlatformMasterUser,
        });
        setTenants(tenantRows);

        const nextTenantId = resolveNextTenantId(
          tenantRows,
          activeTenantId,
          selectedTenantId
        );
        setSelectedTenantId(nextTenantId);
        return nextTenantId;
      } catch (error: unknown) {
        addToast(`Erro ao carregar tenants do lancamento: ${extractErrorMessage(error)}`, "error");
        setTenants([]);
        setSelectedTenantId("");
        return "";
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [activeTenantId, addToast, canAccess, isPlatformMasterUser, scope, selectedTenantId]
  );

  useEffect(() => {
    if (authLoading || initialLoadRef.current) return;
    initialLoadRef.current = true;
    void loadWorkspace("initial");
  }, [authLoading, loadWorkspace]);

  useEffect(() => {
    const cleanTenantSlug = tenantSlug.trim();
    if (scope !== "tenant" || !cleanTenantSlug) return;
    if (pathInfo.tenantSlug) return;
    if (
      pathInfo.scopedPath !== "/admin/lancamento" &&
      !pathInfo.scopedPath.startsWith("/admin/lancamento/")
    ) {
      return;
    }

    router.replace(withTenantSlug(cleanTenantSlug, pathInfo.scopedPath));
  }, [pathInfo.scopedPath, pathInfo.tenantSlug, router, scope, tenantSlug]);

  return {
    authLoading,
    canAccess,
    loading,
    refreshing,
    isPlatformMasterUser,
    tenantSlug,
    tenants,
    selectedTenantId,
    selectedTenant,
    setSelectedTenantId,
    refreshWorkspace: () => loadWorkspace("refresh"),
    addToast,
  };
}

interface LaunchPageShellProps {
  scope: LaunchScope;
  title: string;
  subtitle: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function LaunchPageShell({
  scope,
  tenantSlug = "",
  title,
  subtitle,
  refreshing = false,
  onRefresh,
  actions,
  children,
}: LaunchPageShellProps & { tenantSlug?: string }) {
  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/95 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={getLaunchBackPath(scope, tenantSlug)}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="inline-flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                {scope === "master" ? (
                  <Building2 size={18} className="text-cyan-400" />
                ) : (
                  <Building2 size={18} className="text-emerald-400" />
                )}
                {title}
              </h1>
              <p className="text-[11px] font-bold uppercase text-zinc-500">{subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                Atualizar
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6">{children}</main>
    </div>
  );
}

interface LaunchTenantSelectorCardProps {
  workspace: LaunchWorkspaceState;
  helperText: string;
  statusTitle?: string;
  statusValue?: string;
  statusHelper?: string;
  statusAction?: ReactNode;
  selectable?: boolean;
}

export function LaunchTenantSelectorCard({
  workspace,
  helperText,
  statusTitle,
  statusValue,
  statusHelper,
  statusAction,
  selectable = true,
}: LaunchTenantSelectorCardProps) {
  const shouldRenderSelect = selectable && workspace.tenants.length > 1;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <div>
          <label className="text-[11px] font-bold uppercase text-zinc-400">
            Atletica selecionada
          </label>
          {shouldRenderSelect ? (
            <select
              value={workspace.selectedTenantId}
              onChange={(event) => workspace.setSelectedTenantId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
            >
              {workspace.tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.sigla} - {tenant.nome}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm font-black uppercase text-white">
              {workspace.selectedTenant
                ? `${workspace.selectedTenant.sigla} - ${workspace.selectedTenant.nome}`
                : "Sem atletica"}
            </div>
          )}
          <p className="mt-2 text-[11px] font-medium text-zinc-500">{helperText}</p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            {statusTitle || "Status"}
          </p>
          <p className="mt-2 text-sm font-black uppercase text-white">
            {statusValue || workspace.selectedTenant?.status || "Sem atletica"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {statusHelper || workspace.selectedTenant?.curso || "Curso nao informado"}
          </p>
          {statusAction ? <div className="mt-4">{statusAction}</div> : null}
        </div>
      </div>

      {workspace.tenants.length === 0 && (
        <p className="mt-4 text-sm text-zinc-400">
          Nenhuma atletica disponivel para o seu acesso neste modulo.
        </p>
      )}
    </section>
  );
}

interface LaunchQuickLinkItem {
  href: string;
  label: string;
  helper: string;
  count: number;
  accentClassName: string;
}

interface LaunchQuickLinksProps {
  items: LaunchQuickLinkItem[];
}

export function LaunchQuickLinks({ items }: LaunchQuickLinksProps) {
  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/80"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white">
                {item.label}
              </p>
              <p className="mt-1 text-[11px] font-medium text-zinc-500">{item.helper}</p>
            </div>
            <span
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-black ${item.accentClassName}`}
            >
              {item.count}
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}

interface LaunchRingMetricProps {
  label: string;
  value: number;
  helper: string;
  accentClassName: string;
}

export function LaunchRingMetric({
  label,
  value,
  helper,
  accentClassName,
}: LaunchRingMetricProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 text-2xl font-black ${accentClassName}`}
        >
          {value}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-white">{label}</p>
          <p className="mt-1 text-[11px] font-medium text-zinc-500">{helper}</p>
        </div>
      </div>
    </div>
  );
}
