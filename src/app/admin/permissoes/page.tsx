"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CheckSquare,
  Crown,
  DollarSign,
  Dumbbell,
  LayoutList,
  Loader2,
  Lock,
  Save,
  Settings,
  Shield,
  Store,
  User,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { APP_PAGES, resolveAppPageLabel } from "@/lib/appRoutes";
import {
  fetchEffectivePermissionMatrix,
  fetchPermissionMatrix,
  savePermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";
import { isPermissionError } from "@/lib/backendErrors";
import { logActivity } from "@/lib/logger";
import { buildPermissionMatrixStorageKey } from "@/lib/permissionCache";
import {
  canManageTenant,
  isMasterOnlyAdminPath,
  isPlatformMaster,
} from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

const MASTER_SCOPE_ROLES = [
  { id: "master", label: "Master Plataforma", icon: Crown, color: "text-red-500" },
  { id: "master_tenant", label: "Master Tenant", icon: Crown, color: "text-rose-300" },
  { id: "admin_geral", label: "Admin Geral", icon: Shield, color: "text-emerald-500" },
  { id: "admin_gestor", label: "Gestor", icon: Settings, color: "text-blue-500" },
  { id: "admin_treino", label: "Adm Treino", icon: Zap, color: "text-orange-600" },
  { id: "vendas", label: "Vendas", icon: DollarSign, color: "text-yellow-400" },
  { id: "treinador", label: "Coach", icon: Dumbbell, color: "text-orange-500" },
  { id: "empresa", label: "Empresa", icon: Briefcase, color: "text-cyan-400" },
  { id: "mini_vendor", label: "Mini Vendor", icon: Store, color: "text-fuchsia-400" },
  { id: "user", label: "Membro", icon: User, color: "text-zinc-400" },
  { id: "visitante", label: "Visitante", icon: User, color: "text-zinc-600" },
] as const;

const TENANT_SCOPE_ROLES = MASTER_SCOPE_ROLES.filter((role) => role.id !== "master");

const PUBLIC_PLATFORM_PERMISSION_PATHS = new Set<string>(["/nova-atletica"]);
const ALL_PERMISSION_ROLE_IDS = MASTER_SCOPE_ROLES.map((role) => role.id);
const MEMBER_ROLE_IDS = MASTER_SCOPE_ROLES.filter((role) => role.id !== "visitante").map(
  (role) => role.id
);
const TENANT_MANAGER_ROLE_IDS = ["master", "master_tenant", "admin_geral", "admin_gestor"] as const;
const SECURITY_ROLE_IDS = ["master", "master_tenant", "admin_geral"] as const;
const TRAINING_ADMIN_ROLE_IDS = [
  ...TENANT_MANAGER_ROLE_IDS,
  "admin_treino",
  "treinador",
] as const;
const COMMERCIAL_ADMIN_ROLE_IDS = [
  ...TENANT_MANAGER_ROLE_IDS,
  "vendas",
] as const;
const PARTNERS_ADMIN_ROLE_IDS = [...TENANT_MANAGER_ROLE_IDS, "empresa"] as const;
const MINI_VENDOR_ROLE_IDS = [...TENANT_MANAGER_ROLE_IDS, "mini_vendor"] as const;
const COMPANY_ROLE_IDS = [...TENANT_MANAGER_ROLE_IDS, "empresa"] as const;

const toRoleList = (roles: readonly string[]): string[] => Array.from(new Set(roles));

const matchesRoute = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const resolveDefaultRolesForPath = (path: string): string[] => {
  const normalizedPath = path.trim().toLowerCase();

  if (isMasterOnlyAdminPath(normalizedPath)) {
    return ["master"];
  }

  if (PUBLIC_PLATFORM_PERMISSION_PATHS.has(normalizedPath)) {
    return [...ALL_PERMISSION_ROLE_IDS];
  }

  if (matchesRoute(normalizedPath, "/admin/permissoes")) {
    return toRoleList(SECURITY_ROLE_IDS);
  }

  if (matchesRoute(normalizedPath, "/admin/lancamento")) {
    return toRoleList(SECURITY_ROLE_IDS);
  }

  if (
    normalizedPath === "/admin" ||
    matchesRoute(normalizedPath, "/admin/configuracoes") ||
    matchesRoute(normalizedPath, "/admin/dashboard-modulos") ||
    matchesRoute(normalizedPath, "/admin/logs") ||
    matchesRoute(normalizedPath, "/admin/usuarios") ||
    matchesRoute(normalizedPath, "/admin/denuncias") ||
    matchesRoute(normalizedPath, "/admin/album") ||
    matchesRoute(normalizedPath, "/admin/comunidade") ||
    matchesRoute(normalizedPath, "/admin/conquistas") ||
    matchesRoute(normalizedPath, "/admin/carteirinha") ||
    matchesRoute(normalizedPath, "/admin/fidelidade") ||
    matchesRoute(normalizedPath, "/admin/guia") ||
    matchesRoute(normalizedPath, "/admin/historico") ||
    matchesRoute(normalizedPath, "/admin/ligas") ||
    matchesRoute(normalizedPath, "/admin/sharkround") ||
    matchesRoute(normalizedPath, "/admin/landing")
  ) {
    return toRoleList(TENANT_MANAGER_ROLE_IDS);
  }

  if (
    matchesRoute(normalizedPath, "/admin/turma") ||
    matchesRoute(normalizedPath, "/admin/eventos") ||
    matchesRoute(normalizedPath, "/admin/games") ||
    matchesRoute(normalizedPath, "/admin/gym") ||
    matchesRoute(normalizedPath, "/admin/treinos")
  ) {
    return toRoleList(TRAINING_ADMIN_ROLE_IDS);
  }

  if (
    matchesRoute(normalizedPath, "/admin/loja") ||
    matchesRoute(normalizedPath, "/admin/mini-vendors") ||
    matchesRoute(normalizedPath, "/admin/planos") ||
    matchesRoute(normalizedPath, "/admin/scanner")
  ) {
    return toRoleList([...COMMERCIAL_ADMIN_ROLE_IDS, "empresa"]);
  }

  if (matchesRoute(normalizedPath, "/admin/parceiros")) {
    return toRoleList(PARTNERS_ADMIN_ROLE_IDS);
  }

  if (matchesRoute(normalizedPath, "/configuracoes/mini-vendor")) {
    return toRoleList(MINI_VENDOR_ROLE_IDS);
  }

  if (
    normalizedPath === "/visitante" ||
    matchesRoute(normalizedPath, "/dashboard") ||
    matchesRoute(normalizedPath, "/historico") ||
    matchesRoute(normalizedPath, "/loja") ||
    matchesRoute(normalizedPath, "/planos") ||
    matchesRoute(normalizedPath, "/perfil/mini-vendor") ||
    matchesRoute(normalizedPath, "/parceiros") ||
    matchesRoute(normalizedPath, "/eventos") ||
    matchesRoute(normalizedPath, "/games") ||
    matchesRoute(normalizedPath, "/arena-games") ||
    matchesRoute(normalizedPath, "/guia") ||
    matchesRoute(normalizedPath, "/ligas") ||
    matchesRoute(normalizedPath, "/ligas_unitau") ||
    matchesRoute(normalizedPath, "/album") ||
    matchesRoute(normalizedPath, "/carteirinha") ||
    matchesRoute(normalizedPath, "/comunidade") ||
    matchesRoute(normalizedPath, "/conquistas") ||
    matchesRoute(normalizedPath, "/fidelidade") ||
    matchesRoute(normalizedPath, "/gym") ||
    matchesRoute(normalizedPath, "/ranking") ||
    matchesRoute(normalizedPath, "/sharkround") ||
    matchesRoute(normalizedPath, "/treinos") ||
    matchesRoute(normalizedPath, "/configuracoes")
  ) {
    return [...ALL_PERMISSION_ROLE_IDS];
  }

  if (matchesRoute(normalizedPath, "/empresa")) {
    return toRoleList(COMPANY_ROLE_IDS);
  }

  if (matchesRoute(normalizedPath, "/aguardando-aprovacao")) {
    return [...MEMBER_ROLE_IDS];
  }

  return [...MEMBER_ROLE_IDS];
};

const buildFallbackPageEntry = (path: string) => ({
  path,
  label: resolveAppPageLabel(path),
});

const buildVisiblePages = (
  isMasterScope: boolean,
  permissionMatrix: PermissionMatrix
) => {
  const source = isMasterScope
    ? APP_PAGES
    : APP_PAGES.filter((page) => {
        const permissionPath = page.permissionPath || page.path;
        return (
          !isMasterOnlyAdminPath(page.path) &&
          !isMasterOnlyAdminPath(permissionPath) &&
          !PUBLIC_PLATFORM_PERMISSION_PATHS.has(page.path) &&
          !PUBLIC_PLATFORM_PERMISSION_PATHS.has(permissionPath)
        );
      });

  const pageMap = new Map<string, (typeof APP_PAGES)[number]>();
  source.forEach((page) => {
    pageMap.set(`${page.path}::${page.permissionPath || page.path}`, page);
  });

  Object.keys(permissionMatrix)
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .forEach((path) => {
      const cleanPath = path.trim();
      if (!cleanPath.startsWith("/")) return;
      if (
        !isMasterScope &&
        (isMasterOnlyAdminPath(cleanPath) || PUBLIC_PLATFORM_PERMISSION_PATHS.has(cleanPath))
      ) {
        return;
      }
      const page = buildFallbackPageEntry(cleanPath);
      pageMap.set(`${page.path}::${page.path}`, page);
    });

  return Array.from(pageMap.values()).sort((left, right) =>
    left.path.localeCompare(right.path, "pt-BR")
  );
};

const buildDefaultMatrix = (): PermissionMatrix => {
  const defaultMatrix: PermissionMatrix = {};

  APP_PAGES.forEach((page) => {
    const permissionPath = page.permissionPath || page.path;
    defaultMatrix[permissionPath] = resolveDefaultRolesForPath(permissionPath);
  });

  return defaultMatrix;
};

const mergeMatrixWithDefaults = (
  baseMatrix: PermissionMatrix,
  matrix: PermissionMatrix | null
): PermissionMatrix => {
  const merged = {
    ...baseMatrix,
    ...(matrix || {}),
  };

  PUBLIC_PLATFORM_PERMISSION_PATHS.forEach((path) => {
    merged[path] = [...ALL_PERMISSION_ROLE_IDS];
  });

  return merged;
};

const applyRecommendedMasterMatrix = (
  baseMatrix: PermissionMatrix,
  matrix: PermissionMatrix | null
): PermissionMatrix | null => {
  const hydrated: PermissionMatrix = {};
  const knownPaths = new Set([
    ...Object.keys(baseMatrix),
    ...Object.keys(matrix || {}),
  ]);

  knownPaths.forEach((path) => {
    hydrated[path] = Array.from(
      new Set([...(baseMatrix[path] || []), ...((matrix?.[path]) || [])])
    );
  });

  return hydrated;
};

export default function AdminPermissoesPage() {
  const { user, loading: authLoading } = useAuth();
  const { tenantId: activeTenantId } = useTenantTheme();
  const { addToast } = useToast();
  const pathname = usePathname() || "/admin/permissoes";
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionMatrix>({});
  const [savingMatrix, setSavingMatrix] = useState(false);

  const pathInfo = parseTenantScopedPath(pathname);
  const currentPath = pathInfo.scopedPath;
  const isPlatformMasterUser = isPlatformMaster(user);
  const isMasterScope = currentPath === "/master/permissoes";
  const canViewPermissions = isMasterScope
    ? isPlatformMasterUser
    : isPlatformMasterUser || canManageTenant(user);
  const canEditMatrix = isMasterScope && isPlatformMasterUser;
  const adminBasePath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/admin")
    : "/admin";
  const semPermissaoPath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/sem-permissao")
    : "/sem-permissao";
  const tenantPermissionsPath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/admin/permissoes/usuarios")
    : "/admin/permissoes/usuarios";
  const tenantUsersPath = pathInfo.tenantSlug
    ? withTenantSlug(pathInfo.tenantSlug, "/admin/usuarios")
    : "/admin/usuarios";
  const roleColumns = isMasterScope ? MASTER_SCOPE_ROLES : TENANT_SCOPE_ROLES;
  const defaultMatrix = useMemo(() => buildDefaultMatrix(), []);
  const targetTenantId = isMasterScope
    ? undefined
    : activeTenantId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  const permissionStorageKey = isMasterScope
    ? buildPermissionMatrixStorageKey(undefined, "platform")
    : buildPermissionMatrixStorageKey(targetTenantId, "effective");
  const visiblePages = useMemo(() => {
    return buildVisiblePages(isMasterScope, permissionMatrix);
  }, [isMasterScope, permissionMatrix]);

  const getLocalCachedMatrix = useCallback((): PermissionMatrix | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(permissionStorageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const matrix: PermissionMatrix = {};
      Object.entries(parsed).forEach(([path, roles]) => {
        if (!Array.isArray(roles)) return;
        const cleanRoles = roles
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean);
        matrix[path] = Array.from(new Set(cleanRoles));
      });
      return matrix;
    } catch {
      return null;
    }
  }, [permissionStorageKey]);

  useEffect(() => {
    if (authLoading) return;

    if (!canViewPermissions) {
      setLoading(false);
      router.push(semPermissaoPath);
      return;
    }

    let mounted = true;

    const fetchMatrix = async () => {
      try {
        const loadedMatrix = isMasterScope
          ? await fetchPermissionMatrix({ tenantId: targetTenantId })
          : await fetchEffectivePermissionMatrix({ tenantId: targetTenantId });
        const matrix = isMasterScope
          ? applyRecommendedMasterMatrix(defaultMatrix, loadedMatrix)
          : loadedMatrix;
        if (!mounted) return;
        setPermissionMatrix(mergeMatrixWithDefaults(defaultMatrix, matrix));
      } catch (error: unknown) {
        if (isPermissionError(error)) {
          const cached = getLocalCachedMatrix();
          if (cached) {
            const fallbackMatrix = isMasterScope
              ? applyRecommendedMasterMatrix(defaultMatrix, cached)
              : cached;
            setPermissionMatrix(mergeMatrixWithDefaults(defaultMatrix, fallbackMatrix));
            addToast("Modo leitura: usando matriz local em cache.", "info");
          } else if (isMasterScope && isPlatformMasterUser) {
            addToast("Sem permissao para abrir o painel de permissoes.", "error");
            router.push(semPermissaoPath);
            return;
          } else {
            setPermissionMatrix(defaultMatrix);
            addToast("Modo leitura: exibindo matriz padrao do tenant.", "info");
          }
        } else {
          console.error(error);
          addToast("Erro ao carregar a matriz de acessos.", "error");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void fetchMatrix();

    return () => {
      mounted = false;
    };
  }, [
    addToast,
    authLoading,
    canViewPermissions,
    defaultMatrix,
    getLocalCachedMatrix,
    isMasterScope,
    isPlatformMasterUser,
    router,
    semPermissaoPath,
    targetTenantId,
  ]);

  const togglePermission = (path: string, roleId: string) => {
    if (
      !canEditMatrix ||
      roleId === "master" ||
      isMasterOnlyAdminPath(path) ||
      PUBLIC_PLATFORM_PERMISSION_PATHS.has(path)
    ) {
      return;
    }

    setPermissionMatrix((prev) => {
      const currentRoles = prev[path] || [];
      const hasAccess = currentRoles.includes(roleId);
      const nextRoles = hasAccess
        ? currentRoles.filter((entry) => entry !== roleId)
        : [...currentRoles, roleId];

      return { ...prev, [path]: nextRoles };
    });
  };

  const saveMatrix = async () => {
    if (!canEditMatrix) {
      addToast("Somente o master da plataforma pode editar a matriz.", "error");
      return;
    }

    setSavingMatrix(true);
    try {
      const adminName =
        typeof user?.displayName === "string" ? user.displayName : "Admin Master";

      await savePermissionMatrix(permissionMatrix, { tenantId: targetTenantId });

      await logActivity(
        user?.uid || "sistema",
        adminName,
        "UPDATE",
        "Permissoes - Matriz",
        "Atualizou a matriz de acesso global"
      );

      addToast("Matriz de acessos atualizada.", "success");
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissao para salvar a matriz.", "error");
        return;
      }

      console.error(error);
      addToast("Erro ao salvar as regras.", "error");
    } finally {
      setSavingMatrix(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!canViewPermissions) return null;

  return (
    <div className="min-h-screen bg-[#050505] pb-32 font-sans text-white">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-800 bg-[#09090b]/95 p-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link
            href={isMasterScope ? "/master" : adminBasePath}
            className="rounded-full bg-zinc-900 p-2 transition hover:bg-zinc-800"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black uppercase">
              <Shield className="text-red-600" />
              {isMasterScope ? "Permissoes Globais" : "Controle de Acesso"}
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {isMasterScope
                ? "Area restrita do master da plataforma"
                : "Modo leitura para admin do tenant"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isMasterScope && (
            <Link
              href="/master/permissoes/perfis-admin"
              className="inline-flex items-center gap-2 rounded-lg border border-red-700/40 bg-zinc-900 px-4 py-2 text-[11px] font-black uppercase text-red-200 transition hover:bg-zinc-800"
            >
              <LayoutList size={14} />
              Perfis do Admin
            </Link>
          )}
          {!isMasterScope && canManageTenant(user) && (
            <Link
              href={tenantPermissionsPath}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-700/40 bg-zinc-900 px-4 py-2 text-[11px] font-black uppercase text-cyan-300 transition hover:bg-zinc-800"
            >
              <Users size={14} />
              Cargos do Tenant
            </Link>
          )}
          {!isMasterScope && (
            <Link
              href={tenantUsersPath}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-[11px] font-black uppercase text-zinc-300 transition hover:bg-zinc-800"
            >
              <Users size={14} />
              Status
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[95vw] overflow-hidden p-6">
        <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-[11px] font-black uppercase text-zinc-400">
          <LayoutList size={14} />
          Matriz de Acesso
        </div>

        <div className="space-y-6 animate-in fade-in">
          <div className="flex items-start gap-3 rounded-xl border border-yellow-600/30 bg-yellow-900/20 p-4">
            <AlertTriangle className="shrink-0 text-yellow-500" size={20} />
            <div>
              <h3 className="text-sm font-bold uppercase text-yellow-500">
                {canEditMatrix ? "Atencao, Master" : "Visualizacao do Tenant"}
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                {canEditMatrix
                  ? "Esta matriz controla o acesso por rota. A edicao global fica apenas no painel master."
                  : "Aqui o admin da atletica so visualiza a matriz efetiva. Quando existir regra global salva pelo master, ela prevalece sobre registros antigos do tenant."}
              </p>
            </div>
          </div>

          <div className="relative max-h-[70vh] overflow-auto rounded-xl border border-zinc-800 bg-[#0a0a0a] shadow-2xl">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-40 bg-zinc-900 shadow-md">
                <tr>
                  <th className="sticky left-0 top-0 z-50 min-w-[220px] border-b border-zinc-800 bg-zinc-900 p-4 text-xs font-black uppercase tracking-wider text-zinc-400 shadow-[2px_0_5px_rgba(0,0,0,0.5)]">
                    Pagina / Rota
                  </th>
                  {roleColumns.map((role) => (
                    <th
                      key={role.id}
                      className="sticky top-0 z-40 min-w-[90px] border-b border-l border-zinc-800/50 border-zinc-800 bg-zinc-900/95 p-4 text-center backdrop-blur"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`rounded-full bg-black/50 p-2 ${role.color}`}>
                          <role.icon size={16} />
                        </div>
                        <span className={`text-[9px] font-black uppercase ${role.color}`}>
                          {role.label}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-black">
                {visiblePages.map((page, idx) => {
                  const permissionPath = page.permissionPath || page.path;
                  const isAdmin = page.path.startsWith("/admin");
                  const isMasterOnlyRoute = isMasterOnlyAdminPath(permissionPath);
                  const prevPage = idx > 0 ? visiblePages[idx - 1] : null;
                  const prevIsAdmin = prevPage ? prevPage.path.startsWith("/admin") : isAdmin;
                  const showSeparator = Boolean(prevPage) && isAdmin !== prevIsAdmin;

                  return (
                    <React.Fragment key={page.path}>
                      {showSeparator && (
                        <tr>
                          <td
                            colSpan={roleColumns.length + 1}
                            className="h-4 border-y border-zinc-800 bg-zinc-900/50"
                          />
                        </tr>
                      )}

                      <tr
                        className={`group transition hover:bg-zinc-900/30 ${
                          idx !== visiblePages.length - 1 ? "border-b border-zinc-800/50" : ""
                        } ${isAdmin ? "bg-red-950/5 hover:bg-red-900/10" : ""}`}
                      >
                        <td
                          className={`sticky left-0 z-30 border-r border-zinc-800 p-4 text-xs font-bold text-white shadow-[2px_0_5px_rgba(0,0,0,0.5)] transition group-hover:bg-zinc-900 ${
                            isAdmin ? "bg-[#0f0505]" : "bg-black"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span
                              className={`flex items-center gap-2 text-sm ${
                                isAdmin ? "text-red-200" : "text-zinc-200"
                              }`}
                            >
                              {page.label}
                            </span>
                            <span className="mt-0.5 font-mono text-[10px] text-zinc-600">
                              {page.path}
                            </span>
                          </div>
                        </td>

                        {roleColumns.map((role) => {
                          const allowedRoles = permissionMatrix[permissionPath] || [];
                          const isAllowed = isMasterOnlyRoute
                            ? role.id === "master"
                            : allowedRoles.includes(role.id) || role.id === "master";
                          const isLocked =
                            !canEditMatrix ||
                            role.id === "master" ||
                            isMasterOnlyRoute ||
                            PUBLIC_PLATFORM_PERMISSION_PATHS.has(page.path);

                          return (
                            <td
                              key={`${page.path}-${role.id}`}
                              className="border-l border-zinc-800/30 p-4 text-center"
                            >
                              <button
                                onClick={() => togglePermission(permissionPath, role.id)}
                                disabled={isLocked}
                                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                                  isAllowed
                                    ? "scale-100 bg-emerald-500 text-black shadow-lg"
                                    : "scale-90 border border-zinc-800 bg-zinc-900 text-zinc-700 grayscale"
                                } ${
                                  isLocked
                                    ? "cursor-not-allowed opacity-50"
                                    : "hover:scale-110 active:scale-95"
                                }`}
                                title={`${page.label} - ${role.label}`}
                              >
                                {isAllowed ? (
                                  <CheckSquare size={16} strokeWidth={3} />
                                ) : (
                                  <Lock size={14} />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canEditMatrix && (
            <div className="fixed bottom-6 right-6 z-50">
              <button
                onClick={saveMatrix}
                disabled={savingMatrix}
                className="flex items-center gap-3 rounded-full border-4 border-[#050505] bg-emerald-600 px-8 py-4 font-black text-white shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 hover:bg-emerald-500 active:scale-95"
              >
                {savingMatrix ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                Salvar Alteracoes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
