"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import SharkLoader from "./SharkLoader";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  createDefaultTenantAppModulesConfig,
  fetchEffectiveTenantAppModulesConfig,
  isTenantAppModulePathVisible,
  resolveTenantAppModuleByPath,
  type TenantAppModulesConfig,
} from "@/lib/tenantAppModulesService";
import {
  PUBLIC_PATHS,
  COMING_SOON_PATHS,
  GUEST_ALLOWED_PATHS,
} from "@/lib/appRoutes";
import {
  fetchEffectivePermissionMatrix,
  fetchPermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";
import { isPermissionError } from "@/lib/backendErrors";
import {
  ADMIN_PANEL_FALLBACK_ROLES,
  canManageTenant,
  getAccessRoleCandidates,
  hasAdminPanelAccess,
  isMasterOnlyAdminPath,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import {
  parseTenantScopedPath,
  shouldAutoScopePath,
  withTenantSlug,
} from "@/lib/tenantRouting";
import { buildLoginPath } from "@/lib/authRedirect";
import {
  buildPermissionMatrixStorageKey,
  clearLegacyPermissionMatrixStorage,
} from "@/lib/permissionCache";
import { fetchPublicTenantIdBySlugCached } from "@/lib/publicTenantLookup";

const resolvePermissionPath = (path: string): string => {
  if (path === "/admin/atletica" || path.startsWith("/admin/atletica/")) {
    return "/admin/configuracoes";
  }
  if (path === "/admin/boardround" || path.startsWith("/admin/boardround/")) {
    return path.replace("/admin/boardround", "/admin/sharkround");
  }
  if (path === "/boardround" || path.startsWith("/boardround/")) {
    return path.replace("/boardround", "/sharkround");
  }
  if (path === "/ligas_usc" || path.startsWith("/ligas_usc/")) {
    return path.replace("/ligas_usc", "/ligas_unitau");
  }
  if (path === "/historico/organograma" || path.startsWith("/historico/organograma/")) {
    return "/historico";
  }
  if (path === "/admin/historico/organograma" || path.startsWith("/admin/historico/organograma/")) {
    return "/admin/historico";
  }
  return path;
};

const normalizePermissionMatrix = (raw: unknown): PermissionMatrix | null => {
  if (typeof raw !== "object" || raw === null) return null;

  const normalized: PermissionMatrix = {};
  for (const [path, roles] of Object.entries(raw)) {
    if (!Array.isArray(roles)) continue;

    const safeRoles = roles.filter(
      (entry): entry is string => typeof entry === "string"
    );
    if (!safeRoles.length) continue;

    normalized[path] = safeRoles;
  }

  return normalized;
};

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const {
    tenantId: activeTenantId,
    tenantSlug: activeTenantSlug,
    loading: tenantThemeLoading,
  } = useTenantTheme();
  const { addToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const rawCurrentPath = pathname ? pathname.split("?")[0] : "/";
  const routePathInfo = useMemo(
    () => parseTenantScopedPath(rawCurrentPath),
    [rawCurrentPath]
  );
  const currentPath = routePathInfo.scopedPath;
  const routeTenantSlug = routePathInfo.tenantSlug;
  const isTenantLandingRoot = routeTenantSlug.length > 0 && currentPath === "/";
  const tenantNotFoundPath = routeTenantSlug
    ? withTenantSlug(routeTenantSlug, "/nao-encontrado")
    : activeTenantSlug.trim()
      ? withTenantSlug(activeTenantSlug, "/nao-encontrado")
      : "/nao-encontrado";

  const [authorized, setAuthorized] = useState(false);
  const [permissionMatrix, setPermissionMatrix] =
    useState<PermissionMatrix | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [routeTenantId, setRouteTenantId] = useState("");
  const [routeTenantLoading, setRouteTenantLoading] = useState(false);
  const [routeTenantResolved, setRouteTenantResolved] = useState(true);
  const [modulesConfig, setModulesConfig] = useState<TenantAppModulesConfig>(
    createDefaultTenantAppModulesConfig
  );
  const [modulesLoading, setModulesLoading] = useState(false);
  const loginToastPathRef = useRef("");
  const tenantFallbackToastPathRef = useRef("");
  const lastPathRef = useRef("");
  const pendingRedirectRef = useRef("");
  const hasUser = !!user;
  const userIsAnonymous = Boolean(user?.isAnonymous);
  const effectiveAccessRole = useMemo(
    () => resolveEffectiveAccessRole(user),
    [user]
  );
  const normalizedActiveTenantId =
    typeof activeTenantId === "string" ? activeTenantId.trim() : "";
  const normalizedActiveTenantSlug = activeTenantSlug.trim().toLowerCase();
  const authenticatedTenantId =
    typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "";
  const roleCandidates = useMemo(
    () => getAccessRoleCandidates(user),
    [user]
  );
  const isPlatformMasterUser = isPlatformMaster(user);
  const effectiveRouteTenantId = useMemo(() => {
    const explicitRouteTenantId = routeTenantId.trim();
    if (explicitRouteTenantId) return explicitRouteTenantId;

    // Evita falso negativo no primeiro render apos redirecionar para /{slug}/...
    if (
      routeTenantSlug &&
      normalizedActiveTenantSlug &&
      routeTenantSlug === normalizedActiveTenantSlug
    ) {
      if (normalizedActiveTenantId) return normalizedActiveTenantId;
      if (!isPlatformMasterUser && authenticatedTenantId) {
        return authenticatedTenantId;
      }
    }

    return "";
  }, [
    routeTenantId,
    routeTenantSlug,
    normalizedActiveTenantSlug,
    normalizedActiveTenantId,
    isPlatformMasterUser,
    authenticatedTenantId,
  ]);
  const permissionTargetTenantId = useMemo(() => {
    if (currentPath.startsWith("/master")) return "";
    return (
      effectiveRouteTenantId ||
      normalizedActiveTenantId ||
      authenticatedTenantId
    );
  }, [
    authenticatedTenantId,
    currentPath,
    effectiveRouteTenantId,
    normalizedActiveTenantId,
  ]);
  const managedTenantAppModule = useMemo(
    () => resolveTenantAppModuleByPath(currentPath),
    [currentPath]
  );
  const permissionStorageKey = useMemo(
    () =>
      currentPath.startsWith("/master")
        ? buildPermissionMatrixStorageKey(undefined, "platform")
        : buildPermissionMatrixStorageKey(
            permissionTargetTenantId,
            currentPath.startsWith("/admin") ? "effective" : "tenant"
          ),
    [currentPath, permissionTargetTenantId]
  );
  const setAuthorizedSafe = useCallback((next: boolean) => {
    setAuthorized((previous) => (previous === next ? previous : next));
  }, []);

  useEffect(() => {
    if (!hasUser || !routeTenantSlug) {
      setRouteTenantId("");
      setRouteTenantLoading(false);
      setRouteTenantResolved(true);
      return;
    }

    const userTenantId =
      typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "";
    if (
      normalizedActiveTenantId &&
      normalizedActiveTenantSlug &&
      routeTenantSlug === normalizedActiveTenantSlug
    ) {
      setRouteTenantId(normalizedActiveTenantId);
      setRouteTenantLoading(false);
      setRouteTenantResolved(true);
      return;
    }

    let mounted = true;
    setRouteTenantId("");
    setRouteTenantResolved(false);
    setRouteTenantLoading(true);

    const resolveRouteTenant = async () => {
      try {
        const resolvedTenantId = await fetchPublicTenantIdBySlugCached(routeTenantSlug);
        if (!mounted) return;
        setRouteTenantId(resolvedTenantId);
      } catch {
        if (!mounted) return;
        if (
          normalizedActiveTenantId &&
          normalizedActiveTenantSlug &&
          routeTenantSlug === normalizedActiveTenantSlug
        ) {
          setRouteTenantId(normalizedActiveTenantId);
        } else if (
          userTenantId &&
          normalizedActiveTenantSlug &&
          routeTenantSlug === normalizedActiveTenantSlug
        ) {
          setRouteTenantId(userTenantId);
        } else {
          setRouteTenantId("");
        }
      } finally {
        if (mounted) {
          setRouteTenantLoading(false);
          setRouteTenantResolved(true);
        }
      }
    };

    void resolveRouteTenant();
    return () => {
      mounted = false;
    };
  }, [
    hasUser,
    routeTenantSlug,
    user?.tenant_id,
    normalizedActiveTenantId,
    normalizedActiveTenantSlug,
  ]);

  useEffect(() => {
    if (authLoading) return;

    let isMounted = true;
    const shouldLoadRemoteRules =
      hasUser &&
      !userIsAnonymous &&
      currentPath.startsWith("/admin");

    if (!shouldLoadRemoteRules) {
      setPermissionMatrix({});
      setRulesLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setRulesLoading(true);

    const fetchRules = async () => {
      let hasCachedRules = false;

      const cachedRules = localStorage.getItem(permissionStorageKey);
      if (cachedRules) {
        try {
          const parsed = normalizePermissionMatrix(JSON.parse(cachedRules));
          if (parsed && isMounted) {
            hasCachedRules = true;
            setPermissionMatrix(parsed);
            setRulesLoading(false);
          }
        } catch {
          localStorage.removeItem(permissionStorageKey);
          clearLegacyPermissionMatrixStorage();
        }
      }

      try {
        const liveRules = currentPath.startsWith("/admin")
          ? await fetchEffectivePermissionMatrix({
              forceRefresh: false,
              tenantId: permissionTargetTenantId || undefined,
            })
          : await fetchPermissionMatrix({
              forceRefresh: false,
              tenantId:
                currentPath.startsWith("/master")
                  ? undefined
                  : permissionTargetTenantId || undefined,
            });
        if (!isMounted) return;

        const resolvedRules = liveRules ?? {};
        setPermissionMatrix(resolvedRules);

        if (liveRules) {
          localStorage.setItem(
            permissionStorageKey,
            JSON.stringify(liveRules)
          );
        } else {
          localStorage.removeItem(permissionStorageKey);
        }
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.warn("RouteGuard: usando regras locais (offline/permissao).");
        }

        if (isMounted && !hasCachedRules) {
          setPermissionMatrix({});
        }
      } finally {
        if (isMounted) {
          setRulesLoading(false);
        }
      }
    };

    void fetchRules();
    return () => {
      isMounted = false;
    };
  }, [
    authLoading,
    currentPath,
    hasUser,
    permissionStorageKey,
    permissionTargetTenantId,
    userIsAnonymous,
  ]);

  useEffect(() => {
    const shouldLoadModuleRules =
      Boolean(managedTenantAppModule) &&
      !currentPath.startsWith("/admin") &&
      !currentPath.startsWith("/master") &&
      permissionTargetTenantId.length > 0;

    if (!shouldLoadModuleRules) {
      setModulesConfig(createDefaultTenantAppModulesConfig());
      setModulesLoading(false);
      return;
    }

    let mounted = true;
    setModulesLoading(true);

    const loadModules = async () => {
      try {
        const nextConfig = await fetchEffectiveTenantAppModulesConfig({
          tenantId: permissionTargetTenantId,
          tenantSlug: routeTenantSlug || activeTenantSlug,
          forceRefresh: false,
        });
        if (!mounted) return;
        setModulesConfig(nextConfig);
      } catch {
        if (!mounted) return;
        setModulesConfig(createDefaultTenantAppModulesConfig());
      } finally {
        if (mounted) setModulesLoading(false);
      }
    };

    void loadModules();
    return () => {
      mounted = false;
    };
  }, [activeTenantSlug, currentPath, managedTenantAppModule, permissionTargetTenantId, routeTenantSlug]);

  useEffect(() => {
    if (lastPathRef.current !== rawCurrentPath) {
      lastPathRef.current = rawCurrentPath;
      pendingRedirectRef.current = "";
    }

    const safeReplace = (targetPath: string) => {
      if (rawCurrentPath === targetPath) {
        pendingRedirectRef.current = "";
        return;
      }
      if (pendingRedirectRef.current === targetPath) return;
      pendingRedirectRef.current = targetPath;
      router.replace(targetPath);
    };

    const dashboardPath =
      activeTenantSlug && activeTenantSlug.trim()
        ? withTenantSlug(activeTenantSlug, "/dashboard")
        : "/dashboard";
    const semPermissaoPath =
      routeTenantSlug && routeTenantSlug.trim()
        ? withTenantSlug(routeTenantSlug, "/sem-permissao")
        : activeTenantSlug && activeTenantSlug.trim()
          ? withTenantSlug(activeTenantSlug, "/sem-permissao")
          : "/sem-permissao";

    const isPublic =
      isTenantLandingRoot ||
      PUBLIC_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith("/public")
      );
    if (isPublic) {
      loginToastPathRef.current = "";
      tenantFallbackToastPathRef.current = "";
      pendingRedirectRef.current = "";
      setAuthorizedSafe(true);
      return;
    }

    if (
      authLoading ||
      rulesLoading ||
      modulesLoading ||
      tenantThemeLoading ||
      routeTenantLoading ||
      (hasUser && !!routeTenantSlug && !routeTenantResolved && !effectiveRouteTenantId)
    ) {
      return;
    }

    let currentUserRole = "visitante";
    let currentRoleCandidates = [...roleCandidates];
    if (user) {
      if (userIsAnonymous) {
        currentUserRole = "guest_anon";
        currentRoleCandidates = ["guest_anon", "visitante", "guest"];
      } else {
        currentUserRole = effectiveAccessRole || "visitante";
      }
    }

    if (
      currentPath !== "/em-breve" &&
      COMING_SOON_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith(`${path}/`)
      )
    ) {
      setAuthorizedSafe(false);
      safeReplace("/em-breve");
      return;
    }

    if (!user) {
      setAuthorizedSafe(false);
      if (currentPath !== "/login") {
        if (loginToastPathRef.current !== rawCurrentPath) {
          addToast("Faca login para continuar.", "info");
          loginToastPathRef.current = rawCurrentPath;
        }
        safeReplace(buildLoginPath(rawCurrentPath));
      } else {
        loginToastPathRef.current = "";
      }
      return;
    }

    if (
      managedTenantAppModule &&
      !isPlatformMasterUser &&
      !isTenantAppModulePathVisible(modulesConfig, currentPath)
    ) {
      setAuthorizedSafe(false);
      addToast("Esse modulo foi ocultado para esta atletica.", "error");
      safeReplace(semPermissaoPath);
      return;
    }

    if (isMasterOnlyAdminPath(currentPath) && !isPlatformMasterUser) {
      setAuthorizedSafe(false);
      addToast("Area exclusiva do master da plataforma.", "error");
      safeReplace(semPermissaoPath);
      return;
    }

    if (shouldAutoScopePath(currentPath) && !routeTenantSlug && activeTenantSlug) {
      setAuthorizedSafe(false);
      safeReplace(withTenantSlug(activeTenantSlug, currentPath));
      return;
    }

    if (routeTenantSlug) {
      if (!effectiveRouteTenantId) {
        setAuthorizedSafe(false);
        const hasAuthenticatedTenantContext =
          Boolean(user) &&
          (authenticatedTenantId.length > 0 || activeTenantSlug.trim().length > 0);

        if (hasAuthenticatedTenantContext) {
          if (tenantFallbackToastPathRef.current !== rawCurrentPath) {
            tenantFallbackToastPathRef.current = rawCurrentPath;
          }
          safeReplace(dashboardPath);
          return;
        }

        safeReplace(tenantNotFoundPath);
        return;
      }

      if (!isPlatformMasterUser) {
        const userTenantId = typeof user.tenant_id === "string" ? user.tenant_id.trim() : "";
        const userTenantStatus =
          typeof user.tenant_status === "string"
            ? user.tenant_status.trim().toLowerCase()
            : "";
        const hasScopedTenantContext =
          userTenantId.length > 0 &&
          (!userTenantStatus ||
            userTenantStatus === "approved" ||
            userTenantStatus === "pending");

        if (hasScopedTenantContext && userTenantId !== effectiveRouteTenantId) {
          setAuthorizedSafe(false);
          addToast("Essa atletica nao pertence ao seu acesso atual.", "error");
          safeReplace(dashboardPath);
          return;
        }
      }
    }

    loginToastPathRef.current = "";
    tenantFallbackToastPathRef.current = "";
    pendingRedirectRef.current = "";

    if (user.status === "banned" || user.status === "bloqueado") {
      setAuthorizedSafe(false);
      if (currentPath !== "/banned") {
        safeReplace("/banned");
      }
      return;
    }

    if (currentUserRole === "guest_anon") {
      if (currentPath === "/dashboard" && !routeTenantSlug && !activeTenantSlug) {
        setAuthorizedSafe(false);
        safeReplace("/visitante");
        return;
      }

      const isAllowed = GUEST_ALLOWED_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith(`${path}/`)
      );

      if (!isAllowed) {
        setAuthorizedSafe(false);
        addToast("Essa area eh exclusiva para membros oficiais!", "error");
        const fallbackPath =
          currentPath === "/dashboard" ? buildLoginPath(rawCurrentPath) : dashboardPath;
        safeReplace(fallbackPath);
        return;
      }
    }

    if (isMasterOnlyAdminPath(currentPath) && isPlatformMasterUser) {
      setAuthorizedSafe(true);
      return;
    }

    const tenantCanManageInvites = canManageTenant(user);
    const isTenantLaunchPath =
      currentPath === "/admin/lancamento" ||
      currentPath.startsWith("/admin/lancamento/");

    if (isTenantLaunchPath && tenantCanManageInvites) {
      setAuthorizedSafe(true);
      return;
    }

    const hasPermissionRules =
      permissionMatrix !== null && Object.keys(permissionMatrix).length > 0;
    const permissionCheckPath = resolvePermissionPath(currentPath);

    if (!hasPermissionRules && currentPath.startsWith("/admin")) {
        const hasAdminFallback = currentRoleCandidates.some((role) =>
          ADMIN_PANEL_FALLBACK_ROLES.has(role)
        );

      if (!hasAdminFallback && !hasAdminPanelAccess(user)) {
        setAuthorizedSafe(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        safeReplace(semPermissaoPath);
        return;
      }

      setAuthorizedSafe(true);
      return;
    }

    if (hasPermissionRules && permissionMatrix) {
      const matchedRulePath = Object.keys(permissionMatrix)
        .filter(
          (rulePath) =>
            permissionCheckPath === rulePath ||
            permissionCheckPath.startsWith(`${rulePath}/`)
        )
        .sort((a, b) => b.length - a.length)[0];

      if (matchedRulePath) {
        const allowedRoles = permissionMatrix[matchedRulePath].map((role) =>
          role.toLowerCase()
        );
          const isRoleAllowed =
            allowedRoles.includes(currentUserRole) ||
            currentRoleCandidates.some((role) => allowedRoles.includes(role));

        if (!isRoleAllowed) {
          setAuthorizedSafe(false);
          addToast("Eita! Voce nao tem permissao para essa area!", "error");
          safeReplace(user.isAnonymous ? dashboardPath : semPermissaoPath);
          return;
        }
      } else if (isMasterOnlyAdminPath(permissionCheckPath) && isPlatformMasterUser) {
        setAuthorizedSafe(true);
        return;
      } else if (permissionCheckPath.startsWith("/admin") || permissionCheckPath.startsWith("/master")) {
        setAuthorizedSafe(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        safeReplace(semPermissaoPath);
        return;
      }
    }

    setAuthorizedSafe(true);
  }, [
    user,
    hasUser,
    userIsAnonymous,
    roleCandidates,
    effectiveAccessRole,
    isPlatformMasterUser,
    effectiveRouteTenantId,
    authLoading,
    rulesLoading,
    modulesConfig,
    modulesLoading,
    managedTenantAppModule,
    tenantThemeLoading,
    routeTenantId,
    routeTenantLoading,
    routeTenantResolved,
    routeTenantSlug,
    rawCurrentPath,
    currentPath,
    isTenantLandingRoot,
    activeTenantSlug,
    authenticatedTenantId,
    tenantNotFoundPath,
    router,
    permissionMatrix,
    addToast,
    setAuthorizedSafe,
  ]);

  const isPublicRenderCheck = isTenantLandingRoot || PUBLIC_PATHS.includes(currentPath);

  if (isPublicRenderCheck) return <>{children}</>;
  if (authLoading || rulesLoading || modulesLoading || tenantThemeLoading || routeTenantLoading) return <SharkLoader />;
  if (!authorized) return <SharkLoader />;

  return <>{children}</>;
}
