"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  LogOut,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Trophy,
  Calendar,
  Star,
  Gamepad2,
  BookOpen,
  Dumbbell,
  History,
  ShoppingBag,
  Megaphone,
  MessageSquare,
  Lock,
  Crown,
  BarChart3,
  Users,
  Camera,
  Dice5,
  Rocket,
  Building2,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
  Store,
  ScanBarcode,
  QrCode,
  FileText,
  HeartHandshake,
  X,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "../../lib/logger";
import {
  getRoleLabel,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import { usePermission } from "@/hooks/usePermission";
import {
  createDefaultTenantAdminSidebarProfilesConfig,
  fetchTenantAdminSidebarProfileAssignment,
  fetchTenantAdminSidebarProfilesConfig,
  isTenantAdminSidebarPathVisible,
  type TenantAdminSidebarProfileKey,
} from "@/lib/tenantAdminSidebarService";

interface SidebarItem {
  group: "Base" | "Comercial" | "Conteudo" | "Esportes" | "Governanca" | "Plataforma";
  name: string;
  path: string;
  icon: React.ReactNode;
  badge?: string;
  isDanger?: boolean;
  platformOnly?: boolean;
}

const SIDEBAR_GROUP_ORDER: Array<SidebarItem["group"]> = [
  "Base",
  "Comercial",
  "Conteudo",
  "Esportes",
  "Governanca",
  "Plataforma",
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const pathInfo = parseTenantScopedPath(pathname || "/");
  const currentPath = pathInfo.scopedPath;
  const { user } = useAuth();
  const {
    tenantId: activeTenantId,
    tenantName,
    tenantSigla,
    tenantSlug: activeTenantSlug,
    isOverrideActive,
  } = useTenantTheme();
  const { canAccess } = usePermission();
  const loginAuditRef = useRef(false);
  const isPlatformMasterUser = isPlatformMaster(user);
  const effectiveAccessRole = resolveEffectiveAccessRole(user);
  const canViewMasterLink = isPlatformMasterUser && effectiveAccessRole === "master";
  const canAuditAdminSession =
    Boolean(user) &&
    (isPlatformMasterUser ||
      effectiveAccessRole === "master_tenant" ||
      effectiveAccessRole.includes("admin"));
  const sidebarTenantSlug = pathInfo.tenantSlug || activeTenantSlug.trim();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(false);
  const [sidebarProfilesConfig, setSidebarProfilesConfig] = React.useState(
    createDefaultTenantAdminSidebarProfilesConfig
  );
  const [sidebarProfileKey, setSidebarProfileKey] =
    React.useState<TenantAdminSidebarProfileKey>("A");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("admin_sidebar_collapsed");
    setIsSidebarCollapsed(stored === "1");
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("admin_sidebar_collapsed", next ? "1" : "0");
      }
      return next;
    });
  };

  useEffect(() => {
    const userId = typeof user?.uid === "string" ? user.uid : "";
    if (!userId) return;
    if (loginAuditRef.current) return;
    if (!canAuditAdminSession) return;

    const sessionKey = `audit:admin:painel:${userId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(sessionKey)) {
      loginAuditRef.current = true;
      return;
    }

    loginAuditRef.current = true;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(sessionKey, "1");
    }

    void logActivity(
      userId,
      typeof user?.nome === "string" ? user.nome : "Admin",
      "LOGIN",
      "Admin/Painel",
      `Acessou a base gate em ${pathname || "/admin"}`
    );
  }, [canAuditAdminSession, currentPath, pathname, user?.nome, user?.uid]);

  useEffect(() => {
    let mounted = true;
    const tenantId = (activeTenantId || "").trim();
    const tenantSlug = sidebarTenantSlug.trim().toLowerCase();

    const loadSidebarProfile = async () => {
      try {
        const profilesConfig = await fetchTenantAdminSidebarProfilesConfig({
          forceRefresh: true,
        });
        const profileKey = tenantId
          ? await fetchTenantAdminSidebarProfileAssignment({
              tenantId,
              tenantSlug,
              forceRefresh: true,
              profilesConfig,
            })
          : "A";
        if (!mounted) return;
        setSidebarProfilesConfig(profilesConfig);
        setSidebarProfileKey(profileKey);
      } catch (error: unknown) {
        console.error("Erro ao carregar perfil de menu do admin.", error);
        if (!mounted) return;
        setSidebarProfilesConfig(createDefaultTenantAdminSidebarProfilesConfig());
        setSidebarProfileKey("A");
      }
    };

    void loadSidebarProfile();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, sidebarTenantSlug]);

  const sidebarItems: SidebarItem[] = [
    { group: "Base", name: "Album da Galera", path: "/admin/album", icon: <Camera size={18} /> },
    { group: "Base", name: "Atletica", path: "/admin/atletica", icon: <Building2 size={18} /> },
    { group: "Esportes", name: "Arena Games", path: "/admin/games", icon: <Gamepad2 size={18} /> },
    { group: "Base", name: "Turma", path: "/admin/turma", icon: <Users size={18} /> },
    { group: "Base", name: "Carteirinha", path: "/admin/carteirinha", icon: <CreditCard size={18} /> },
    { group: "Comercial", name: "Configuracoes", path: "/admin/configuracoes", icon: <Settings size={18} /> },
    { group: "Conteudo", name: "Comunidade", path: "/admin/comunidade", icon: <MessageSquare size={18} /> },
    { group: "Conteudo", name: "Conquistas", path: "/admin/conquistas", icon: <Trophy size={18} /> },
    { group: "Base", name: "Dashboard", path: "/admin", icon: <LayoutDashboard size={18} /> },
    { group: "Base", name: "Dashboard Modulos", path: "/admin/dashboard-modulos", icon: <PanelLeftOpen size={18} /> },
    { group: "Governanca", name: "Denuncias", path: "/admin/denuncias", icon: <ShieldAlert size={18} /> },
    { group: "Conteudo", name: "Eventos", path: "/admin/eventos", icon: <Calendar size={18} /> },
    { group: "Comercial", name: "BI Eventos", path: "/admin/gestao/eventos", icon: <BarChart3 size={18} /> },
    { group: "Esportes", name: "BI Treinos", path: "/admin/gestao/treinos", icon: <BarChart3 size={18} /> },
    { group: "Comercial", name: "BI Produtos", path: "/admin/gestao/produtos", icon: <BarChart3 size={18} /> },
    { group: "Conteudo", name: "Apadrinhamento", path: "/admin/apadrinhamento", icon: <HeartHandshake size={18} /> },
    { group: "Comercial", name: "Fidelidade", path: "/admin/fidelidade", icon: <Star size={18} /> },
    { group: "Base", name: "Guia do App", path: "/admin/guia", icon: <BookOpen size={18} /> },
    { group: "Esportes", name: "Gym Champ", path: "/admin/gym", icon: <Dumbbell size={18} />, badge: "Em Breve" },
    { group: "Conteudo", name: "Historico", path: "/admin/historico", icon: <History size={18} /> },
    { group: "Conteudo", name: "Ligas", path: "/admin/ligas", icon: <Users size={18} /> },
    {
      group: "Plataforma",
      name: "Painel Master",
      path: "/master",
      icon: <Building2 size={18} />,
      platformOnly: true,
    },
    { group: "Comercial", name: "Landing", path: "/admin/landing", icon: <Rocket size={18} /> },
    { group: "Plataforma", name: "Lancamento", path: "/admin/lancamento", icon: <Rocket size={18} /> },
    { group: "Comercial", name: "Loja", path: "/admin/loja", icon: <ShoppingBag size={18} /> },
    { group: "Comercial", name: "Mini Vendor Admin", path: "/admin/mini-vendors", icon: <Store size={18} /> },
    { group: "Comercial", name: "Parceiros", path: "/admin/parceiros", icon: <Megaphone size={18} /> },
    { group: "Comercial", name: "Scanner", path: "/admin/scanner", icon: <ScanBarcode size={18} /> },
    { group: "Comercial", name: "Scan Eventos", path: "/admin/scan-eventos", icon: <QrCode size={18} /> },
    { group: "Governanca", name: "Logs", path: "/admin/logs", icon: <FileText size={18} /> },
    { group: "Governanca", name: "Permissoes", path: "/admin/permissoes", icon: <Lock size={18} />, isDanger: true },
    {
      group: "Comercial",
      name: "Planos",
      path: "/admin/planos",
      icon: <Crown size={18} />,
    },
    { group: "Esportes", name: "BoardRound", path: "/admin/boardround", icon: <Dice5 size={18} /> },
    { group: "Esportes", name: "Treinos", path: "/admin/treinos", icon: <BarChart3 size={18} /> },
    { group: "Base", name: "Usuarios", path: "/admin/usuarios", icon: <Users size={18} /> },
  ];

  const activeSidebarItems = sidebarItems.filter(
    (item) =>
      (!item.platformOnly || canViewMasterLink) &&
      (item.platformOnly ||
        isTenantAdminSidebarPathVisible(sidebarProfilesConfig, sidebarProfileKey, item.path))
  );
  const groupedSidebarItems = React.useMemo(
    () =>
      SIDEBAR_GROUP_ORDER
        .map((group) => ({
          group,
          items: activeSidebarItems
            .filter((item) => item.group === group)
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        }))
        .filter((entry) => entry.items.length > 0),
    [activeSidebarItems]
  );

  const resolveSidebarHref = (path: string): string => {
    if (path.startsWith("/admin") && sidebarTenantSlug) {
      return withTenantSlug(sidebarTenantSlug, path);
    }
    return path;
  };
  const appDashboardHref = sidebarTenantSlug
    ? withTenantSlug(sidebarTenantSlug, "/dashboard")
    : "/dashboard";
  const semPermissaoHref = sidebarTenantSlug
    ? withTenantSlug(sidebarTenantSlug, "/sem-permissao")
    : "/sem-permissao";

  useEffect(() => {
    if (canViewMasterLink) return;
    if (!currentPath.startsWith("/admin")) return;
    if (currentPath === "/admin") {
      if (!isTenantAdminSidebarPathVisible(sidebarProfilesConfig, sidebarProfileKey, currentPath)) {
        router.replace(semPermissaoHref);
      }
      return;
    }

    if (!isTenantAdminSidebarPathVisible(sidebarProfilesConfig, sidebarProfileKey, currentPath)) {
      router.replace(semPermissaoHref);
    }
  }, [canViewMasterLink, currentPath, router, semPermissaoHref, sidebarProfileKey, sidebarProfilesConfig]);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  const desktopSidebarWidthClass = isSidebarCollapsed ? "lg:w-[88px]" : "lg:w-64";

  return (
    <div className="min-h-screen bg-[#050505]">
      <button
        type="button"
        onClick={() => setIsMobileSidebarOpen(true)}
        className="fixed left-4 top-[calc(var(--master-topbar-height)+1rem)] z-50 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/95 text-zinc-200 shadow-2xl backdrop-blur-xl transition hover:border-brand hover:text-white lg:hidden"
        aria-label="Abrir menu admin"
      >
        <PanelLeftOpen size={18} />
      </button>

      <button
        type="button"
        onClick={() => setIsMobileSidebarOpen(false)}
        className={`fixed inset-x-0 bottom-0 top-[var(--master-topbar-height)] z-30 bg-black/70 backdrop-blur-sm transition duration-300 lg:inset-0 lg:hidden ${
          isMobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="Fechar menu admin"
      />

      <aside
        className={`fixed left-0 top-[var(--master-topbar-height)] z-40 flex h-[calc(100vh-var(--master-topbar-height))] w-[min(86vw,18rem)] flex-col overflow-hidden border-r border-white/5 bg-zinc-900/95 backdrop-blur-xl transition-all duration-300 lg:translate-x-0 ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${desktopSidebarWidthClass}`}
      >
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-zinc-300 shadow-lg transition hover:border-brand hover:text-white lg:hidden"
          title="Fechar menu"
        >
          <X size={14} />
        </button>

        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 z-10 hidden h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-zinc-300 shadow-lg transition hover:border-brand hover:text-white lg:inline-flex"
          title={isSidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
        <div className="flex min-h-0 flex-1 flex-col p-5 lg:p-6">
          <div className="mb-6 flex items-center justify-between gap-3 lg:mb-8 lg:block">
            <div className="flex items-center gap-3">
              <div className="brand-icon-chip h-10 w-10 shrink-0 rounded-xl">
                <ShieldAlert size={24} className="text-black" />
              </div>
              {!isSidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="leading-none text-lg font-black uppercase tracking-tighter text-white">Painel Admin</h1>
                  <p className="truncate text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    {(tenantSigla || "USC").toUpperCase()} • v2.0
                  </p>
                </div>
              )}
            </div>
          </div>

          <div
            className={`mb-6 flex items-center rounded-xl border border-zinc-800 bg-black/40 p-3 shadow-inner ${
              isSidebarCollapsed ? "justify-center" : "gap-3"
            }`}
          >
            <div className="relative h-9 w-9 shrink-0">
              <Image
                src={user?.foto || "https://github.com/shadcn.png"}
                alt="Admin Avatar"
                fill
                className="rounded-full border border-brand-strong object-cover shadow-brand"
              />
            </div>
            {!isSidebarCollapsed && (
              <div className="overflow-hidden">
                <p className="truncate text-xs font-bold text-white">
                  {user?.nome ? user.nome.split(" ")[0] : "Admin"}
                </p>
                <span className="block truncate text-[8px] font-black uppercase tracking-widest text-red-500">
                  {getRoleLabel(effectiveAccessRole)}
                </span>
              </div>
            )}
          </div>

          {isOverrideActive && !isSidebarCollapsed && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Contexto: {tenantName || "Atletica selecionada"}
            </div>
          )}

          <div className="mb-4">
            <Link
              href={appDashboardHref}
              title="Sair do Admin"
              className={`group flex items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 transition hover:bg-emerald-500 hover:text-black ${
                isSidebarCollapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-3"
              }`}
            >
              <LogOut size={16} className="transition-transform group-hover:-translate-x-1" />
              {!isSidebarCollapsed && (
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">
                  Sair do Admin
                </span>
              )}
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
            <nav className="space-y-4">
              {groupedSidebarItems.map(({ group, items }) => (
                <div key={group} className="space-y-1">
                  {!isSidebarCollapsed && (
                    <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      {group}
                    </p>
                  )}
                  {items.map((item) => {
              const itemPath = item.path.split("#")[0];
              const isActive =
                currentPath === itemPath ||
                (itemPath !== "/admin" && currentPath.startsWith(`${itemPath}/`));
              const itemHref = resolveSidebarHref(item.path);
              const isBlocked = item.path.startsWith("/admin") && !canAccess(item.path);
              const itemClassName = `group flex items-center justify-between rounded-lg px-3 py-2.5 transition-all ${
                isActive
                  ? "bg-brand-solid font-bold text-black shadow-brand"
                  : isBlocked
                  ? "text-zinc-500 hover:bg-zinc-800/50"
                  : item.isDanger
                  ? "text-red-500 hover:bg-red-500/10"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              }`;

              if (isBlocked) {
                return (
                  <button
                    key={item.path}
                    type="button"
                    title={`${item.name} bloqueado`}
                    onClick={() => router.push(semPermissaoHref)}
                    className={itemClassName}
                  >
                    <div
                      className={`flex items-center ${isSidebarCollapsed ? "w-full justify-center" : "gap-3"}`}
                    >
                      <div className="relative">
                        {item.icon}
                        {isSidebarCollapsed && (
                          <span className="absolute -bottom-1 -right-1 rounded-full border border-zinc-800 bg-zinc-950 p-[2px]">
                            <Lock size={8} className="text-zinc-500" />
                          </span>
                        )}
                      </div>
                      {!isSidebarCollapsed && (
                        <span className="text-xs font-medium uppercase tracking-wide">{item.name}</span>
                      )}
                    </div>
                    {!isSidebarCollapsed && <Lock size={14} className="text-zinc-600" />}
                  </button>
                );
              }

              return (
                <Link
                  key={item.path}
                  href={itemHref}
                  title={item.name}
                  className={itemClassName}
                >
                  <div
                    className={`flex items-center ${isSidebarCollapsed ? "w-full justify-center" : "gap-3"}`}
                  >
                    {item.icon}
                    {!isSidebarCollapsed && (
                      <span className="text-xs font-medium uppercase tracking-wide">{item.name}</span>
                    )}
                  </div>
                  {item.badge && !isSidebarCollapsed && (
                    <span className="animate-pulse rounded border border-brand bg-zinc-800 px-1.5 py-0.5 text-[7px] font-black text-brand">
                      {item.badge}
                    </span>
                  )}
                </Link>
                );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      </aside>

      <main
        className={`min-w-0 px-4 pb-8 pt-20 transition-all duration-300 sm:px-6 lg:px-8 lg:pt-8 ${
          isSidebarCollapsed ? "lg:ml-[88px]" : "lg:ml-64"
        }`}
      >
        <div className="mb-4 flex items-center gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(true)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/95 text-zinc-200 shadow-xl backdrop-blur-xl transition hover:border-brand hover:text-white"
            aria-label="Abrir menu admin"
          >
            <PanelLeftOpen size={18} />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
              Painel Admin
            </p>
            <p className="truncate text-sm font-bold text-white">
              Menu lateral e atalhos
            </p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
