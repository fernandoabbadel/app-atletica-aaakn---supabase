"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, Calendar, Dumbbell, CreditCard, Menu, X, Wallet,
  Trophy, Gamepad2, ShoppingBag, Settings, HelpCircle, LogOut,
  ChevronRight, Handshake, Clock, CalendarRange, MessageCircle, MapPin,
  Crown, Medal, Star, ShieldCheck, Ghost, LogIn, Layout, Camera,
  Target, GraduationCap, Users, Lock, Bell, Fish, Swords, Sparkles, ScanLine // ðŸ¦ˆ Adicionado Sparkles
} from "lucide-react";
import { Store } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { isPermissionError } from "@/lib/backendErrors";
import { OptimizedImage } from "@/app/components/shared/OptimizedImage";
import { getTurmaImage } from "../../constants/turmaImages";
import { resolvePlanTextClass, resolveUserPlanIcon } from "@/constants/planVisuals";
import { parseTenantScopedPath, shouldAutoScopePath, withTenantSlug } from "@/lib/tenantRouting";
import { usePermission } from "@/hooks/usePermission";
import { buildLoginPath } from "@/lib/authRedirect";
import { fetchCurrentMiniVendorProfile } from "@/lib/miniVendorService";
import {
  createDefaultTenantAppModulesConfig,
  fetchEffectiveTenantAppModulesConfig,
  isTenantAppModuleVisible,
  type TenantAppModuleKey,
} from "@/lib/tenantAppModulesService";
import {
  fetchSharkroundAppConfig,
  getSharkroundDisplayName,
} from "@/lib/sharkroundConfigService";
import {
  fetchBottomNavBannedAppealsCount,
  fetchBottomNavNotifications,
  markBottomNavNotificationRead,
  type BottomNavNotification,
} from "../../lib/bottomNavService";

const FOCUS_REFETCH_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const shouldEnableFocusRefetch = (): boolean => {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_ENABLE_FOCUS_REFETCH === "true";
};

// --- ðŸ¦ˆ UTILITÁRIO LOCAL ---
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

// --- TIPAGEM ---
interface UserData {
    uid: string; nome: string; foto?: string; turma?: string;
    tier?: 'bicho' | 'atleta' | 'lenda' | 'standard'; 
    level?: number; role?: string;
    plano?: string; plano_cor?: string; plano_icon?: string;
    patente?: string; patente_icon?: string; patente_cor?: string;
}
type Notification = BottomNavNotification;
interface NavItemProps {
    id: string; label: string; path?: string; icon: React.ReactNode; 
    action?: () => void; isMain?: boolean; badge?: string;
    isComingSoon?: boolean; isLocked?: boolean;
    moduleKey?: TenantAppModuleKey;
}
interface BannerProps {
    tier: string; closeMenu: () => void; router: ReturnType<typeof useRouter>; tenantSlug: string;
}

// --- CONFIGURAÃ‡Ã•ES VISUAIS ---

const resolveTurmaSlug = (turmaRaw?: string): string => {
    if (!turmaRaw) return "t8";
    const normalized = turmaRaw.trim().toUpperCase();
    if (normalized.startsWith("T")) return normalized.toLowerCase();
    const digits = normalized.replace(/\D/g, "");
    return digits ? `t${digits}` : "t8";
};

// --- SUB-COMPONENTES OTIMIZADOS ---
const UserBadges = ({
    userData,
    showAdminBadge,
    showMiniVendorBadge,
}: {
    userData: UserData;
    showAdminBadge: boolean;
    showMiniVendorBadge: boolean;
}) => {
    const planColorClass = resolvePlanTextClass(userData?.plano_cor || "zinc");
    const PlanIcon = resolveUserPlanIcon(userData?.plano_icon, userData?.plano, Ghost);

    return (
        <div className="flex items-center gap-1.5">
            {showAdminBadge && <span className="flex items-center bg-red-500/10 p-0.5 rounded border border-red-500/20"><ShieldCheck size={12} className="text-red-500" /></span>}
            {!showAdminBadge && showMiniVendorBadge && <span className="flex items-center bg-blue-500/10 p-0.5 rounded border border-blue-500/20"><Store size={12} className="text-blue-400" /></span>}
            <span className={cn("flex items-center opacity-80", planColorClass)}><PlanIcon size={14} /></span>
        </div>
    );
};

const LevelIcon = ({
    level,
    patenteIcon,
    patenteCor,
}: {
    level: number;
    patenteIcon?: string;
    patenteCor?: string;
}) => {
    const PatentIcon = patenteIcon ? resolveUserPlanIcon(patenteIcon, patenteIcon, Fish) : null;
    if (PatentIcon) {
        return <PatentIcon className={resolvePlanTextClass(patenteCor, "text-zinc-400")} size={12} />;
    }
    if (level === 1) return <Fish className="text-orange-400" size={12} />; 
    if (level === 2) return <Swords className="text-blue-400" size={12} />;
    if (level >= 5) return <Crown className="text-yellow-400" size={12} />;
    return <Fish className="text-zinc-500" size={12} />;
};

const SocioGrowthBanner = ({ tier, closeMenu, router, tenantSlug }: BannerProps) => {
    if (tier === 'lenda') return null;
    const plansPath = tenantSlug.trim() ? withTenantSlug(tenantSlug, "/planos") : "/planos";
    return (
        <button onClick={() => { closeMenu(); router.push(plansPath); }} className="w-full group relative overflow-hidden rounded-2xl mb-4 transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl border border-yellow-400/30">
            <div className="absolute inset-0 bg-gradient-to-r from-yellow-900/40 via-amber-700/40 to-yellow-900/40 bg-[length:200%_200%] animate-[gradient_3s_ease_infinite]"></div>
            <div className="relative p-3 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/50"><Crown size={16} className="text-yellow-400" /></div>
                    <div className="text-left"><h4 className="text-xs font-black italic uppercase text-white">VER PLANOS</h4><p className="text-[9px] font-medium text-zinc-300">Confira niveis e beneficios</p></div>
                </div>
                <ChevronRight size={16} className="text-yellow-500/50 group-hover:text-yellow-400 transition-colors" />
            </div>
        </button>
    );
};

export default function BottomNavbar() {
  const pathname = usePathname();
  const pathInfo = useMemo(
    () => parseTenantScopedPath(pathname || "/"),
    [pathname]
  );
  const normalizedPathname = pathInfo.scopedPath;
  const router = useRouter();
  const { user, logout } = useAuth();
  const { tenantId: activeTenantId, tenantLogoUrl, tenantSigla, tenantSlug } = useTenantTheme();
  const { canAccess } = usePermission();
  const lastNotificationsFocusRefreshAtRef = useRef(0);
  const lastBannedAppealsFocusRefreshAtRef = useRef(0);
  const currentUser = user as unknown as UserData;

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bannedMessagesCount, setBannedMessagesCount] = useState(0); 
  const [modulesConfig, setModulesConfig] = useState(createDefaultTenantAppModulesConfig);
  const lastScrollY = useRef(0);

  const userUid = user?.uid || "";
  const currentTurmaSlug = resolveTurmaSlug(currentUser?.turma);
  const isGuestVirtual = userUid.startsWith("guest_virtual_");
  const isGuestRestricted = Boolean(user?.isAnonymous) || isGuestVirtual;
  const canLoadNotifications = Boolean(userUid) && !user?.isAnonymous && !isGuestVirtual;
  const sidebarNameColor = resolvePlanTextClass(currentUser?.plano_cor || "zinc", "text-white");
  const scopedTenantSlug = pathInfo.tenantSlug || tenantSlug.trim();
  const adminPath = scopedTenantSlug ? withTenantSlug(scopedTenantSlug, "/admin") : "/admin";
  const loginPath = useMemo(() => buildLoginPath(pathname || "/"), [pathname]);
  const semPermissaoPath = scopedTenantSlug
    ? withTenantSlug(scopedTenantSlug, "/sem-permissao")
    : "/sem-permissao";
  const canAccessAdminDashboard = canAccess("/admin");
  const canAccessBannedAppeals = canAccess("/admin/denuncias/banidos");
  const [hasApprovedMiniVendor, setHasApprovedMiniVendor] = useState(false);
  const [boardroundDisplayName, setBoardroundDisplayName] = useState("BoardRound");
  const isModuleVisible = useCallback(
    (key?: TenantAppModuleKey): boolean =>
      key ? isTenantAppModuleVisible(modulesConfig, key) : true,
    [modulesConfig]
  );
  const resolveScopedPath = useCallback(
    (path: string): string => {
      const cleanPath = path.trim();
      if (!cleanPath) return cleanPath;
      if (!cleanPath.startsWith("/")) return cleanPath;
      if (!scopedTenantSlug) return cleanPath;
      if (parseTenantScopedPath(cleanPath).isTenantScoped) return cleanPath;
      if (!shouldAutoScopePath(cleanPath)) return cleanPath;
      return withTenantSlug(scopedTenantSlug, cleanPath);
    },
    [scopedTenantSlug]
  );

  // --- LÃ“GICA DE EFEITOS E DADOS (Mantida 100%) ---
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!user?.uid || !activeTenantId.trim()) {
        if (mounted) setHasApprovedMiniVendor(false);
        return;
      }

      try {
        const profile = await fetchCurrentMiniVendorProfile({
          tenantId: activeTenantId,
          userId: user.uid,
          forceRefresh: false,
        });
        if (mounted) setHasApprovedMiniVendor(profile?.status === "approved");
      } catch {
        if (mounted) setHasApprovedMiniVendor(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, user?.uid]);

  useEffect(() => {
    const handleScroll = () => {
        const currentScrollY = window.scrollY;
        setIsVisible(currentScrollY <= lastScrollY.current || currentScrollY <= 20);
        lastScrollY.current = currentScrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadModulesConfig = async () => {
      try {
        const nextConfig = await fetchEffectiveTenantAppModulesConfig({
          tenantId: activeTenantId || user?.tenant_id || undefined,
          tenantSlug: scopedTenantSlug,
        });
        if (mounted) setModulesConfig(nextConfig);
      } catch {
        if (mounted) setModulesConfig(createDefaultTenantAppModulesConfig());
      }
    };

    void loadModulesConfig();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, scopedTenantSlug, user?.tenant_id]);

  useEffect(() => {
    let mounted = true;

    const loadBoardroundConfig = async () => {
      try {
        const config = await fetchSharkroundAppConfig({
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        });
        if (mounted) {
          setBoardroundDisplayName(getSharkroundDisplayName(config));
        }
      } catch {
        if (mounted) {
          setBoardroundDisplayName("BoardRound");
        }
      }
    };

    void loadBoardroundConfig();
    return () => {
      mounted = false;
    };
  }, [activeTenantId]);

  const loadNotifications = useCallback(async (forceRefresh = false) => {
      if (!canLoadNotifications) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      try {
        const feed = await fetchBottomNavNotifications({
          userId: userUid,
          maxResults: 20,
          forceRefresh,
        });
        setNotifications(feed.notifications);
        setUnreadCount(feed.unreadCount);
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error("Erro ao carregar notificacoes:", error);
        }
        setNotifications([]);
        setUnreadCount(0);
      }
  }, [canLoadNotifications, userUid]);

  const loadBannedAppealsCount = useCallback(async (forceRefresh = false) => {
      if (!canAccessBannedAppeals) {
        setBannedMessagesCount(0);
        return;
      }

      try {
        const count = await fetchBottomNavBannedAppealsCount({ forceRefresh });
        setBannedMessagesCount(count);
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error("Erro ao carregar recursos de banimento:", error);
        }
        setBannedMessagesCount(0);
      }
  }, [canAccessBannedAppeals]);

  useEffect(() => {
      if (!canLoadNotifications) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      lastNotificationsFocusRefreshAtRef.current = Date.now();
      void loadNotifications(false);
      if (!shouldEnableFocusRefetch()) {
        return;
      }
      const refreshNotifications = () => {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now - lastNotificationsFocusRefreshAtRef.current < FOCUS_REFETCH_COOLDOWN_MS) {
          return;
        }
        lastNotificationsFocusRefreshAtRef.current = now;
        void loadNotifications(true);
      };

      const handleWindowFocus = () => refreshNotifications();
      const handleVisibilityChange = () => refreshNotifications();

      window.addEventListener("focus", handleWindowFocus);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        window.removeEventListener("focus", handleWindowFocus);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
  }, [canLoadNotifications, loadNotifications]);

  useEffect(() => {
      if (!showNotifications || !canLoadNotifications) return;
      void loadNotifications(true);
  }, [canLoadNotifications, loadNotifications, showNotifications]);

  useEffect(() => {
      lastBannedAppealsFocusRefreshAtRef.current = Date.now();
      void loadBannedAppealsCount(false);
      if (!canAccessBannedAppeals || !shouldEnableFocusRefetch()) return;

      const refreshBanned = () => {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now - lastBannedAppealsFocusRefreshAtRef.current < FOCUS_REFETCH_COOLDOWN_MS) {
          return;
        }
        lastBannedAppealsFocusRefreshAtRef.current = now;
        void loadBannedAppealsCount(true);
      };

      const handleWindowFocus = () => refreshBanned();
      const handleVisibilityChange = () => refreshBanned();

      window.addEventListener("focus", handleWindowFocus);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        window.removeEventListener("focus", handleWindowFocus);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
  }, [canAccessBannedAppeals, loadBannedAppealsCount]);

  const handleNotificationClick = async (notif: Notification) => {
      if (!notif.read) {
        try {
          await markBottomNavNotificationRead(notif.id);
          setNotifications((prev) =>
            prev.map((entry) =>
              entry.id === notif.id ? { ...entry, read: true } : entry
            )
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (error: unknown) {
          if (!isPermissionError(error)) {
            console.error("Erro ao marcar notificacao como lida:", error);
          }
        }
      }
      if (notif.link) { router.push(resolveScopedPath(notif.link)); setShowNotifications(false); setIsSidebarOpen(false); }
  };

  const formatTimeAgo = (ts: unknown) => {
      if (!ts) return "";
      const tsObj = ts as { toDate?: () => Date };
      const date = typeof tsObj.toDate === "function" ? tsObj.toDate() : new Date(ts as Date);
      if (Number.isNaN(date.getTime())) return "";
      const diff = Math.floor((new Date().getTime() - date.getTime()) / 60000);
      if (diff < 1) return "agora"; if (diff < 60) return `${diff}min`;
      const hours = Math.floor(diff / 60); if (hours < 24) return `${hours}h`;
      return `${Math.floor(hours / 24)}d`;
  };
  const isItemBlocked = (item: NavItemProps): boolean =>
      Boolean(item.isComingSoon || item.isLocked);
  const resolveBlockedTarget = (item?: NavItemProps): string =>
      item?.isComingSoon ? "/em-breve" : semPermissaoPath;
  const handleNavigation = (path: string, isBlocked?: boolean, blockedTarget?: string) => { 
      setIsSidebarOpen(false);
      if (isBlocked) {
        router.push(resolveScopedPath(blockedTarget || semPermissaoPath));
        return;
      }
      router.push(resolveScopedPath(path)); 
  };
  const handleLogout = () => { if (logout) logout(); setIsSidebarOpen(false); router.push("/"); };
  const isHiddenRoute =
    ["/", "/login", "/cadastro", "/banned", "/aguardando-aprovacao", "/visitante"].includes(normalizedPathname) ||
    normalizedPathname.startsWith("/empresa") ||
    normalizedPathname.startsWith("/admin") ||
    normalizedPathname.startsWith("/master");
  if (isHiddenRoute) return null;

  // --- DEFINIÃ‡ÃƒO DOS MENUS (CSS e Badges Atualizados) ---
  const bottomItemsBase: NavItemProps[] = [
      { id: 'home', label: 'Inicio', icon: <Home size={22}/>, path: '/dashboard' },
      { id: 'eventos', label: 'Eventos', icon: <Calendar size={22}/>, path: '/eventos', moduleKey: 'eventos' },
      { id: 'scan', label: 'Scanner', icon: <ScanLine size={28}/>, path: `/album/${currentTurmaSlug}?scan=1`, isMain: true, moduleKey: 'album' },
      { id: 'carteira', label: 'Carteira', icon: <Wallet size={22}/>, path: '/carteirinha', moduleKey: 'carteirinha' },
      { id: 'menu', label: 'Menu', icon: <Menu size={22}/>, action: () => setIsSidebarOpen(true) },
  ];
  
  const sidebarItemsGeneralBase: NavItemProps[] = [
      { id: 'loja', label: 'Lojinha', icon: <ShoppingBag size={18} />, path: '/loja', moduleKey: 'loja' },
      { id: 'eventos_menu', label: 'Eventos', icon: <Calendar size={18} />, path: '/eventos', moduleKey: 'eventos' },
      { id: 'carteira_side', label: 'Carteirinha', icon: <CreditCard size={18} />, path: '/carteirinha', moduleKey: 'carteirinha' },
      { id: 'parceiros', label: 'Parceiros', icon: <Handshake size={18} />, path: '/parceiros', moduleKey: 'parceiros' },
      { id: 'comunidade', label: 'Comunidade', icon: <MessageCircle size={18} />, path: '/comunidade', moduleKey: 'comunidade' },
      { id: 'album', label: 'Album da Galera', icon: <Camera size={18} />, path: '/album', moduleKey: 'album' },
  ];

  const sidebarItemsAtletaBase: NavItemProps[] = [
      { id: 'treinos', label: 'Treinos', icon: <CalendarRange size={18} />, path: '/treinos', moduleKey: 'treinos' },
      { id: 'arena', label: 'Arena Games', icon: <Gamepad2 size={18} />, path: '/arena-games', badge: "Vem ai", isComingSoon: true, moduleKey: 'arena_games' },
      { id: 'shark_round', label: boardroundDisplayName, icon: <Target size={18} />, path: '/boardround', isComingSoon: true, moduleKey: 'sharkround' },
      { id: 'ranking', label: 'Ranking', icon: <Trophy size={18} />, path: '/ranking', badge: "Vem ai", isComingSoon: true, moduleKey: 'ranking' },
      { id: 'gym_side', label: 'Treinos Avancados', icon: <Dumbbell size={18} />, path: '/gym-rats', badge: "Vem ai", isComingSoon: true, moduleKey: 'gym_rats' },
  ];

  const sidebarItemsInfoBase: NavItemProps[] = [
      { id: 'ligas', label: 'Area das Ligas', icon: <Users size={18} />, path: '/ligas_usc', moduleKey: 'ligas' },
      { id: 'avaliacao', label: 'Avaliacao Profs', icon: <GraduationCap size={18} />, path: '/avaliacao', isComingSoon: true, moduleKey: 'avaliacao' },
      { id: 'conquistas', label: 'Conquistas', icon: <Medal size={18} />, path: '/conquistas', isComingSoon: true, moduleKey: 'conquistas' },
      { id: 'fidelidade', label: 'Fidelidade', icon: <Star size={18} />, path: '/fidelidade', isComingSoon: true, moduleKey: 'fidelidade' },
      { id: 'guia', label: 'Guia', icon: <HelpCircle size={18} />, path: '/guia', moduleKey: 'guia' },
      { id: 'historico', label: 'Nossa Historia', icon: <Clock size={18} />, path: '/historico', moduleKey: 'historico' },
  ];

  const lockGuestItem = (item: NavItemProps): NavItemProps =>
      isGuestRestricted ? { ...item, isLocked: true, badge: undefined } : item;
  const bottomItems = bottomItemsBase
    .filter((item) => isModuleVisible(item.moduleKey))
    .map((item) =>
      isGuestRestricted && item.id !== "home" && item.id !== "menu"
            ? { ...item, isLocked: true, badge: undefined }
            : item
      );
  const sidebarItemsGeneral = sidebarItemsGeneralBase
    .filter((item) => isModuleVisible(item.moduleKey))
    .map(lockGuestItem);
  const sidebarItemsAtleta = sidebarItemsAtletaBase
    .filter((item) => isModuleVisible(item.moduleKey))
    .map(lockGuestItem);
  const sidebarItemsInfo = sidebarItemsInfoBase
    .filter((item) => isModuleVisible(item.moduleKey))
    .map(lockGuestItem);

  const userTurmaImg = currentUser?.turma ? getTurmaImage(currentUser.turma) : null;

  return (
    <>
      <div className={cn("fixed inset-0 bg-black/80 backdrop-blur-md z-[60] transition-opacity duration-500", isSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} onClick={() => setIsSidebarOpen(false)}/>
      
      {/* SIDEBAR */}
      <div className={cn("fixed top-0 left-0 h-full w-[85%] max-w-[320px] bg-zinc-950 border-r border-zinc-800 z-[70] transform transition-transform duration-500 flex flex-col shadow-2xl", isSidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        
        {/* HEADER */}
        <div className="p-6 pb-4 border-b border-zinc-800 bg-black/40 backdrop-blur-sm flex justify-between items-center">
            <div className="flex items-center gap-2">
                <div className="brand-icon-chip w-8 h-8 rounded-lg relative">
                    <OptimizedImage src={tenantLogoUrl || "/logo.png"} alt="Logo" fill sizes="32px" className="object-contain p-1" />
                </div>
                <div>
                    <h2 className="text-lg font-black italic uppercase text-white leading-none">{(tenantSigla || "USC").toUpperCase()}</h2>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">App Oficial</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => { if (!isGuestRestricted) setShowNotifications(!showNotifications); }} className={cn("p-2 bg-zinc-900 rounded-full transition relative", isGuestRestricted ? "text-zinc-600 cursor-not-allowed" : "text-zinc-400 hover:text-white")}>
                    <Bell size={18}/>
                    {isGuestRestricted ? <Lock size={10} className="absolute -bottom-0.5 -right-0.5 text-zinc-500" /> : unreadCount > 0 ? <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-zinc-900 animate-pulse"></span> : null}
                </button>
                <button onClick={() => setIsSidebarOpen(false)} className="p-2 bg-zinc-900 rounded-full text-zinc-400 hover:text-white transition"><X size={18}/></button>
            </div>
        </div>

        {/* NOTIFICAÃ‡Ã•ES */}
        {showNotifications && (
            <div className="absolute top-[72px] left-0 w-full h-[calc(100%-72px)] bg-zinc-950 z-20 overflow-y-auto animate-in slide-in-from-top-2 border-t border-zinc-800">
                <div className="p-4 space-y-3">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Notificacoes</h3>
                        <button onClick={() => setShowNotifications(false)} className="text-[10px] text-brand font-bold">Fechar</button>
                    </div>
                    {notifications.length === 0 && <p className="text-center text-xs text-zinc-600 py-4">Tudo limpo por aqui.</p>}
                    {notifications.map(n => (
                        <div key={n.id} onClick={() => handleNotificationClick(n)} className={cn("p-3 rounded-xl border cursor-pointer transition flex flex-col gap-1", n.read ? "bg-zinc-900/50 border-zinc-800 opacity-60" : "bg-zinc-900 border-brand")}>
                            <div className="flex justify-between items-start w-full">
                                <h4 className={cn("text-xs font-bold", n.read ? "text-zinc-400" : "text-white")}>{n.title}</h4>
                                <div className="flex items-center gap-2"><span className="text-[9px] text-zinc-600 font-mono">{formatTimeAgo(n.createdAt)}</span>{!n.read && <div className="w-1.5 h-1.5 bg-brand-solid rounded-full"></div>}</div>
                            </div>
                            <p className="text-[10px] text-zinc-400 leading-snug">{n.message}</p>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* LISTA DE MENUS */}
        {!showNotifications && (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
                
                {currentUser && isModuleVisible("perfil") && (
                    <div onClick={() => handleNavigation('/perfil', isGuestRestricted, semPermissaoPath)} className={cn("flex items-center gap-3 p-3 bg-zinc-900/50 rounded-2xl border border-zinc-800 mb-4 transition group", isGuestRestricted ? "cursor-not-allowed opacity-80" : "cursor-pointer hover:bg-zinc-900 hover:border-brand")}>
                        <div className="relative">
                            <div className="w-12 h-12 rounded-full bg-black overflow-hidden border-2 border-zinc-700 group-hover:border-brand-strong transition relative">
                                <OptimizedImage src={currentUser.foto || "https://github.com/shadcn.png"} alt="User" fill sizes="48px" className="object-cover"/>
                            </div>
                            {userTurmaImg && (
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border border-zinc-900 overflow-hidden shadow-sm z-10">
                                    <OptimizedImage src={userTurmaImg} alt="Turma" fill sizes="20px" className="object-cover"/>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-sm font-bold truncate ${sidebarNameColor}`}>{currentUser.nome?.split(" ")[0]}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center gap-1 bg-black/40 px-1.5 py-0.5 rounded border border-white/5" title={`Nivel ${currentUser.level || 1}`}>
                                    <LevelIcon
                                        level={currentUser.level || 1}
                                        patenteIcon={currentUser.patente_icon}
                                        patenteCor={currentUser.patente_cor}
                                    />
                                    <span className="text-[9px] font-mono text-zinc-400">Nv.{currentUser.level || 1}</span>
                                </div>
                                <div className="flex items-center h-5 bg-black/40 rounded border border-white/5 px-1.5">
                                    <UserBadges userData={currentUser} showAdminBadge={canAccessAdminDashboard} showMiniVendorBadge={hasApprovedMiniVendor} />
                                </div>
                            </div>
                        </div>
                        {isGuestRestricted ? <Lock size={16} className="text-zinc-600" /> : <ChevronRight size={16} className="text-zinc-600 group-hover:text-brand transition"/>}
                    </div>
                )}

                {!isGuestRestricted && <SocioGrowthBanner tier={currentUser?.tier || 'bicho'} closeMenu={() => setIsSidebarOpen(false)} router={router} tenantSlug={scopedTenantSlug} />}

                {/* MENU PRINCIPAL */}
                <div className="px-2 pt-2 pb-2"><h3 className="text-[10px] font-black text-zinc-500 uppercase flex items-center gap-2"><Layout size={10}/> Menu Principal</h3></div>
                <div className="space-y-1">
                    {sidebarItemsGeneral.map((item) => (
                        <button key={item.id} onClick={() => handleNavigation(item.path!, isItemBlocked(item), resolveBlockedTarget(item))} className={cn("w-full flex items-center gap-3 p-3 rounded-xl transition-all group", normalizedPathname === item.path ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200", isItemBlocked(item) && "opacity-50 cursor-not-allowed")}>
                            <div className={cn("p-1.5 rounded-lg", normalizedPathname === item.path ? "text-brand-accent" : "text-zinc-500 group-hover:text-brand")}>{item.icon}</div>
                            <span className="text-xs font-bold uppercase tracking-wide">{item.label}</span>
                            {isItemBlocked(item) && <Lock size={12} className="ml-auto text-zinc-600"/>}
                        </button>
                    ))}
                </div>

                {/* ÁREA DO ATLETA (COM BADGES NOVAS) */}
                <div className="px-2 pt-6 pb-2 border-t border-zinc-800/50 mt-2"><h3 className="text-[10px] font-black text-brand uppercase flex items-center gap-2 tracking-widest"><Dumbbell size={10}/> Area do Atleta</h3></div>
                <div className="space-y-1">
                    {sidebarItemsAtleta.map((item) => (
                        <button key={item.id} onClick={() => handleNavigation(item.path!, isItemBlocked(item), resolveBlockedTarget(item))} className={cn("w-full flex items-center justify-between p-3 rounded-xl transition-all group", normalizedPathname === item.path ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200", isItemBlocked(item) && "opacity-60 cursor-not-allowed grayscale")}>
                            <div className="flex items-center gap-3">
                                <div className={cn("p-1.5 rounded-lg", normalizedPathname === item.path ? "text-brand-accent" : "text-zinc-500 group-hover:text-brand")}>{item.icon}</div>
                                <span className="text-xs font-bold uppercase tracking-wide">{item.label}</span>
                            </div>
                            {item.badge && (
                                <span className="bg-brand-gradient text-brand-accent border border-brand text-[7px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1 shadow-brand">
                                    <Sparkles size={8} /> {item.badge}
                                </span>
                            )}
                            {((!item.badge && item.isComingSoon) || item.isLocked) && <Lock size={12} className="text-zinc-600"/>}
                        </button>
                    ))}
                </div>

                {/* CENTRAL INFO */}
                <div className="px-2 pt-6 pb-2 border-t border-zinc-800/50 mt-2"><h3 className="text-[10px] font-black text-zinc-500 uppercase flex items-center gap-2 tracking-widest"><MapPin size={10}/> Central de Info</h3></div>
                <div className="space-y-1 pb-6">
                    {sidebarItemsInfo.map((item) => (
                        <button key={item.id} onClick={() => handleNavigation(item.path!, isItemBlocked(item), resolveBlockedTarget(item))} className={cn("w-full flex items-center gap-3 p-3 rounded-xl transition-all group", normalizedPathname === item.path ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200", isItemBlocked(item) && "opacity-50 cursor-not-allowed")}>
                            <div className={cn("p-1.5 rounded-lg", normalizedPathname === item.path ? "text-brand-accent" : "text-zinc-500 group-hover:text-brand")}>{item.icon}</div>
                            <span className="text-xs font-bold uppercase tracking-wide">{item.label}</span>
                            {isItemBlocked(item) && <Lock size={12} className="ml-auto text-zinc-600"/>}
                        </button>
                    ))}
                </div>
            </div>
        )}

        {/* FOOTER */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 space-y-3">
            {canAccessAdminDashboard && (
                <button onClick={() => handleNavigation(adminPath)} className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-950/20 border border-red-900/30 text-red-500 hover:bg-red-900/30 hover:text-red-400 transition relative">
                    <ShieldCheck size={16}/>
                    <span className="text-xs font-black uppercase tracking-widest">Painel Admin</span>
                    {bannedMessagesCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#09090b] animate-bounce">{bannedMessagesCount}</span>}
                </button>
            )}
            <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleNavigation('/configuracoes', isGuestRestricted, semPermissaoPath)} className={cn("flex flex-col items-center justify-center p-2 rounded-xl bg-zinc-900 transition", isGuestRestricted ? "cursor-not-allowed text-zinc-600" : "text-zinc-500 hover:text-white hover:bg-zinc-800")}><Settings size={18}/><span className="text-[8px] font-bold uppercase mt-1">{isGuestRestricted ? "Bloqueado" : "Ajustes"}</span></button>
                {currentUser ? (
                    <button onClick={handleLogout} className="flex flex-col items-center justify-center p-2 rounded-xl bg-zinc-900 text-zinc-500 hover:text-red-500 hover:bg-red-900/10 transition"><LogOut size={18}/><span className="text-[8px] font-bold uppercase mt-1">Sair</span></button>
                ) : (
                    <button onClick={() => router.push(loginPath)} className="flex flex-col items-center justify-center p-2 rounded-xl bg-zinc-900 text-brand hover:text-brand-accent hover:bg-brand-primary/10 transition"><LogIn size={18}/><span className="text-[8px] font-bold uppercase mt-1">Entrar</span></button>
                )}
            </div>
        </div>
      </div>

      {/* BOTTOM NAV */}
      <div className={cn("fixed bottom-6 left-0 right-0 z-40 flex justify-center transition-transform duration-500", isVisible && !isSidebarOpen ? "translate-y-0" : "translate-y-[200%]")}>
        <nav className="bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-3xl px-1 py-1 shadow-[0_10px_40px_rgba(0,0,0,0.8)] flex items-center justify-between w-[92%] max-w-md relative">
            {bottomItems.map((item) => (
                item.isMain ? (
                    <div key={item.id} className="relative -top-8 mx-1 group z-20">
                        <div className={cn("absolute inset-0 bg-brand-solid rounded-full blur-xl opacity-40 animate-pulse", isItemBlocked(item) && "bg-zinc-600 opacity-20 animate-none")}></div>
                        <button onClick={() => handleNavigation(item.path!, isItemBlocked(item), resolveBlockedTarget(item))} className={cn("relative w-16 h-16 rounded-full flex items-center justify-center bg-brand-solid text-black shadow-brand-strong border-[4px] border-zinc-950 transition-transform active:scale-95 group-hover:scale-105", isItemBlocked(item) && "bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed")}>
                            {isItemBlocked(item) ? <Lock size={22}/> : item.icon}
                        </button>
                    </div>
                ) : (
                    <div key={item.id} className="flex-1 h-full flex justify-center">
                        <button onClick={() => item.action ? item.action() : handleNavigation(item.path!, isItemBlocked(item), resolveBlockedTarget(item))} className={cn("w-full h-[60px] flex flex-col items-center justify-center gap-1 rounded-2xl active:scale-90 transition-colors", normalizedPathname === item.path ? "text-brand-accent" : "text-zinc-500 hover:text-zinc-300", isItemBlocked(item) && "opacity-40 cursor-not-allowed")}>
                            {isItemBlocked(item) ? <Lock size={22}/> : item.icon}
                            <span className="text-[8px] font-bold uppercase tracking-wide">{item.label}</span>
                        </button>
                    </div>
                )
            ))}
        </nav>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; } 
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
      `}</style>
    </>
  );
}




