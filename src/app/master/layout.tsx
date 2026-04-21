"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  Building2,
  CircleHelp,
  CreditCard,
  Lock,
  LogOut,
  Mail,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Waypoints,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { MASTER_CONTACT_PENDING_EVENT } from "@/lib/masterContactNotifications";
import { fetchSupportReports } from "@/lib/reportsService";
import { isPlatformMaster } from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

const TENANT_BRAND_SNAPSHOT_STORAGE_KEY = "usc_active_tenant_brand";
const SIDEBAR_STORAGE_KEY = "master_sidebar_collapsed";

type TenantBrandSnapshot = {
  tenantId?: string;
  tenantSlug?: string;
};

type MasterNavItem = {
  name: string;
  path: string;
  icon: React.ReactNode;
  disabled?: boolean;
  pendingCount?: number;
};

export default function MasterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname() || "/master";
  const { user } = useAuth();
  const { tenantId, tenantName, tenantSlug, isOverrideActive } = useTenantTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [resolvedTenantSlug, setResolvedTenantSlug] = useState("");
  const [pendingContactCount, setPendingContactCount] = useState(0);

  const canAccess = isPlatformMaster(user);
  const currentPath = useMemo(
    () => parseTenantScopedPath(pathname).scopedPath,
    [pathname]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!canAccess || typeof window === "undefined") {
      setPendingContactCount(0);
      return;
    }

    let cancelled = false;

    const refreshPendingContacts = async () => {
      try {
        const reports = await fetchSupportReports(240);
        if (cancelled) return;
        setPendingContactCount(reports.filter((report) => report.status !== "resolvida").length);
      } catch (error) {
        console.error("Falha ao carregar marcador do Contato USC:", error);
        if (!cancelled) setPendingContactCount(0);
      }
    };

    const requestRefresh = () => {
      void refreshPendingContacts();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestRefresh();
      }
    };

    requestRefresh();
    window.addEventListener(MASTER_CONTACT_PENDING_EVENT, requestRefresh);
    window.addEventListener("focus", requestRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(requestRefresh, 60_000);

    return () => {
      cancelled = true;
      window.removeEventListener(MASTER_CONTACT_PENDING_EVENT, requestRefresh);
      window.removeEventListener("focus", requestRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [canAccess]);

  useEffect(() => {
    if (tenantSlug.trim()) {
      setResolvedTenantSlug(tenantSlug.trim().toLowerCase());
      return;
    }

    if (typeof window === "undefined") {
      setResolvedTenantSlug("");
      return;
    }

    try {
      const raw = window.localStorage.getItem(TENANT_BRAND_SNAPSHOT_STORAGE_KEY);
      if (!raw) {
        setResolvedTenantSlug("");
        return;
      }

      const parsed = JSON.parse(raw) as TenantBrandSnapshot;
      const snapshotTenantId =
        typeof parsed.tenantId === "string" ? parsed.tenantId.trim() : "";
      const snapshotTenantSlug =
        typeof parsed.tenantSlug === "string" ? parsed.tenantSlug.trim().toLowerCase() : "";

      if (tenantId.trim() && snapshotTenantId === tenantId.trim() && snapshotTenantSlug) {
        setResolvedTenantSlug(snapshotTenantSlug);
        return;
      }

      setResolvedTenantSlug("");
    } catch {
      setResolvedTenantSlug("");
    }
  }, [tenantId, tenantSlug]);

  const toggleSidebar = () => {
    setCollapsed((previous) => {
      const next = !previous;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  if (!canAccess) return <>{children}</>;

  const tenantAdminPath = resolvedTenantSlug
    ? withTenantSlug(resolvedTenantSlug, "/admin")
    : "";
  const appDashboardPath = resolvedTenantSlug
    ? withTenantSlug(resolvedTenantSlug, "/dashboard")
    : "/visitante";

  const navItems: MasterNavItem[] = [
    { name: "Dashboard Master", path: "/master", icon: <Building2 size={18} /> },
    { name: "Landing USC", path: "/master/landing", icon: <Rocket size={18} /> },
    { name: "FAQ USC", path: "/master/faq", icon: <CircleHelp size={18} /> },
    { name: "Contato USC", path: "/master/contato", icon: <Mail size={18} />, pendingCount: pendingContactCount },
    { name: "Permissões Globais", path: "/master/permissoes", icon: <Lock size={18} /> },
    { name: "Perfis do Admin", path: "/master/permissoes/perfis-admin", icon: <PanelLeft size={18} /> },
    { name: "Solicitações", path: "/master/solicitacoes", icon: <CreditCard size={18} /> },
    {
      name: "Painel da Atlética",
      path: tenantAdminPath,
      icon: <Waypoints size={18} />,
      disabled: tenantAdminPath.length === 0,
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <aside
        className={`fixed top-[var(--master-topbar-height)] z-40 flex h-[calc(100vh-var(--master-topbar-height))] flex-col overflow-hidden border-r border-red-500/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] backdrop-blur-xl transition-all duration-300 ${
          collapsed ? "w-[92px]" : "w-[280px]"
        }`}
      >
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-zinc-300 shadow-lg transition hover:border-red-500/40 hover:text-white"
          title={collapsed ? "Expandir painel master" : "Recolher painel master"}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>

        <div className="flex min-h-0 flex-1 flex-col p-6">
          <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-300 shadow-[0_0_24px_rgba(239,68,68,0.18)]">
              <Building2 size={22} />
            </div>
            {!collapsed && (
              <div>
                <h1 className="text-lg font-black uppercase tracking-tight text-white">
                  Painel Master
                </h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                  Plataforma USC
                </p>
              </div>
            )}
          </div>

          <div
            className={`mb-5 flex items-center rounded-2xl border border-zinc-800 bg-black/35 p-3 ${
              collapsed ? "justify-center" : "gap-3"
            }`}
          >
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-red-500/30">
              <Image
                src={user?.foto || "https://github.com/shadcn.png"}
                alt="Master"
                fill
                className="object-cover"
              />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <p className="truncate text-sm font-black text-white">
                  {user?.nome ? user.nome.split(" ")[0] : "Master"}
                </p>
                <p className="truncate text-[9px] font-black uppercase tracking-[0.18em] text-red-300">
                  Dono da Plataforma
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                Contexto atual
              </p>
              <p className="mt-2 text-xs font-bold text-white">
                {isOverrideActive ? tenantName || "Atlética selecionada" : "Plataforma USC"}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                {isOverrideActive ? "navegando com contexto forçado" : "modo global ativo"}
              </p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const itemKey = `${item.name}:${item.path || "disabled"}`;
                const isActive =
                  !item.disabled &&
                  (currentPath === item.path || currentPath.startsWith(`${item.path}/`));

                const itemClassName = `group flex items-center rounded-xl px-3 py-3 transition ${
                  item.disabled
                    ? "cursor-not-allowed text-zinc-600 opacity-60"
                    : isActive
                      ? "bg-red-500/15 text-red-100 shadow-[0_10px_30px_rgba(239,68,68,0.1)]"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                } ${collapsed ? "justify-center" : "gap-3"}`;

                if (item.disabled) {
                  return (
                    <div
                      key={itemKey}
                      title="Selecione uma atlética no topo antes de abrir o painel admin."
                      className={itemClassName}
                    >
                      <span className="relative inline-flex shrink-0">
                        {item.icon}
                        {item.pendingCount ? (
                          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-zinc-950 bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]" />
                        ) : null}
                      </span>
                      {!collapsed && (
                        <span className="text-xs font-bold uppercase tracking-[0.12em]">
                          {item.name}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={itemKey}
                    href={item.path}
                    title={item.name}
                    className={itemClassName}
                  >
                    <span className="relative inline-flex shrink-0">
                      {item.icon}
                      {item.pendingCount ? (
                        <span
                          aria-label={`${item.pendingCount} mensagens pendentes`}
                          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-zinc-950 bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]"
                        />
                      ) : null}
                    </span>
                    {!collapsed && (
                      <span className="text-xs font-bold uppercase tracking-[0.12em]">
                        {item.name}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="border-t border-red-500/10 p-6">
          <Link
            href={appDashboardPath}
            className={`flex w-full items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-[10px] font-black uppercase tracking-[0.18em] text-red-300 transition hover:bg-red-500 hover:text-white ${
              collapsed ? "" : "gap-2"
            }`}
          >
            <LogOut size={15} />
            {!collapsed && "Voltar ao App"}
          </Link>
        </div>
      </aside>

      <main
        className={`flex-1 px-6 py-6 transition-all duration-300 ${
          collapsed ? "ml-[92px]" : "ml-[280px]"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
