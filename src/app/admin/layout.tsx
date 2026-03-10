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
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "../../lib/logger";
import { isPlatformMaster, resolveEffectiveAccessRole } from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import { usePermission } from "@/hooks/usePermission";

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
  const { user, logout } = useAuth();
  const { tenantName, tenantSigla, tenantSlug: activeTenantSlug, isOverrideActive } = useTenantTheme();
  const { canAccess } = usePermission();
  const loginAuditRef = useRef(false);
  const isPlatformMasterUser = isPlatformMaster(user);
  const effectiveAccessRole = resolveEffectiveAccessRole(user);
  const canViewMasterLink = isPlatformMasterUser && effectiveAccessRole === "master";
  const sidebarTenantSlug = pathInfo.tenantSlug || activeTenantSlug.trim();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);

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
    const userRole = typeof user?.role === "string" ? user.role.toLowerCase() : "";
    if (!userId) return;
    if (loginAuditRef.current) return;
    if (!(userRole === "master" || userRole.includes("admin"))) return;

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
  }, [currentPath, pathname, user?.nome, user?.role, user?.uid]);

  const sidebarItems: SidebarItem[] = [
    { group: "Base", name: "Album da Galera", path: "/admin/album", icon: <Camera size={18} /> },
    { group: "Esportes", name: "Arena Games", path: "/admin/games", icon: <Gamepad2 size={18} /> },
    { group: "Base", name: "Turma", path: "/admin/turma", icon: <Users size={18} /> },
    { group: "Base", name: "Carteirinha", path: "/admin/carteirinha", icon: <CreditCard size={18} /> },
    { group: "Comercial", name: "Configuracoes", path: "/admin/configuracoes", icon: <Settings size={18} /> },
    { group: "Conteudo", name: "Comunidade", path: "/admin/comunidade", icon: <MessageSquare size={18} /> },
    { group: "Conteudo", name: "Conquistas", path: "/admin/conquistas", icon: <Trophy size={18} /> },
    { group: "Base", name: "Dashboard", path: "/admin", icon: <LayoutDashboard size={18} /> },
    { group: "Governanca", name: "Denuncias", path: "/admin/denuncias", icon: <ShieldAlert size={18} /> },
    { group: "Conteudo", name: "Eventos", path: "/admin/eventos", icon: <Calendar size={18} /> },
    { group: "Comercial", name: "Fidelidade", path: "/admin/fidelidade", icon: <Star size={18} /> },
    { group: "Base", name: "Guia do App", path: "/admin/guia", icon: <BookOpen size={18} /> },
    { group: "Esportes", name: "Gym Champ", path: "/admin/gym", icon: <Dumbbell size={18} />, badge: "Em Breve" },
    { group: "Conteudo", name: "Historico", path: "/admin/historico", icon: <History size={18} /> },
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
    { group: "Comercial", name: "Parceiros", path: "/admin/parceiros", icon: <Megaphone size={18} /> },
    { group: "Governanca", name: "Permissoes", path: "/admin/permissoes", icon: <Lock size={18} />, isDanger: true },
    {
      group: "Comercial",
      name: "Planos",
      path: "/admin/planos",
      icon: <Crown size={18} />,
    },
    { group: "Esportes", name: "SharkRound", path: "/admin/sharkround", icon: <Dice5 size={18} /> },
    { group: "Esportes", name: "Treinos", path: "/admin/treinos", icon: <BarChart3 size={18} /> },
    { group: "Base", name: "Usuarios", path: "/admin/usuarios", icon: <Users size={18} /> },
  ];

  const activeSidebarItems = sidebarItems.filter(
    (item) => !item.platformOnly || canViewMasterLink
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
  const semPermissaoHref = sidebarTenantSlug
    ? withTenantSlug(sidebarTenantSlug, "/sem-permissao")
    : "/sem-permissao";

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <aside
        className={`fixed z-40 flex h-full flex-col justify-between overflow-y-auto border-r border-white/5 bg-zinc-900/95 backdrop-blur-xl custom-scrollbar transition-all duration-300 ${
          isSidebarCollapsed ? "w-[88px]" : "w-64"
        }`}
      >
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-zinc-300 shadow-lg transition hover:border-brand hover:text-white"
          title={isSidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
        <div className="p-6">
          <div className="mb-8 flex items-center gap-3">
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
                  {typeof user?.role === "string" ? user.role.replace("admin_", "").replace("_", " ") : "MASTER"}
                </span>
              </div>
            )}
          </div>

          {isOverrideActive && !isSidebarCollapsed && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Contexto: {tenantName || "Tenant selecionado"}
            </div>
          )}

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

        <div className="border-t border-white/5 bg-black/20 p-6">
          <button
            onClick={() => logout()}
            className="group w-full flex items-center justify-center gap-3 rounded-xl border border-red-600/20 bg-red-600/10 p-3 text-[10px] font-bold uppercase tracking-wider text-red-500 transition-all hover:bg-red-600 hover:text-white"
          >
            <LogOut size={16} className="transition-transform group-hover:-translate-x-1" />
            Sair do Painel
          </button>
        </div>
      </aside>

      <main className={`flex-1 p-8 transition-all duration-300 ${isSidebarCollapsed ? "ml-[88px]" : "ml-64"}`}>{children}</main>
    </div>
  );
}
