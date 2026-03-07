"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import SharkLoader from "./SharkLoader";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  PUBLIC_PATHS,
  COMING_SOON_PATHS,
  GUEST_ALLOWED_PATHS,
} from "@/lib/appRoutes";
import {
  fetchPermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";
import { isPermissionError } from "@/lib/backendErrors";
import {
  ADMIN_PANEL_FALLBACK_ROLES,
  canManageTenant,
  getAccessRoleCandidates,
  hasAdminPanelAccess,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import {
  parseTenantScopedPath,
  shouldAutoScopePath,
  withTenantSlug,
} from "@/lib/tenantRouting";
import { fetchTenantBySlug } from "@/lib/tenantService";

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
  const { tenantSlug: activeTenantSlug } = useTenantTheme();
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

  const [authorized, setAuthorized] = useState(false);
  const [permissionMatrix, setPermissionMatrix] =
    useState<PermissionMatrix | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [routeTenantId, setRouteTenantId] = useState("");
  const [routeTenantLoading, setRouteTenantLoading] = useState(false);
  const [routeTenantResolved, setRouteTenantResolved] = useState(true);
  const loginToastPathRef = useRef("");
  const lastPathRef = useRef("");
  const pendingRedirectRef = useRef("");
  const hasUser = !!user;
  const userIsAnonymous = Boolean(user?.isAnonymous);
  const effectiveAccessRole = useMemo(
    () => resolveEffectiveAccessRole(user),
    [user]
  );
  const roleCandidates = useMemo(
    () => getAccessRoleCandidates(user),
    [user]
  );
  const isPlatformMasterUser = isPlatformMaster(user);
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
    const normalizedActiveTenantSlug = activeTenantSlug.trim().toLowerCase();
    if (
      userTenantId &&
      normalizedActiveTenantSlug &&
      routeTenantSlug === normalizedActiveTenantSlug
    ) {
      setRouteTenantId(userTenantId);
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
        const tenant = await fetchTenantBySlug(routeTenantSlug);
        if (!mounted) return;
        setRouteTenantId(tenant?.id || "");
      } catch {
        if (!mounted) return;
        if (
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
  }, [hasUser, routeTenantSlug, user?.tenant_id, activeTenantSlug]);

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

      const cachedRules = localStorage.getItem("shark_permissions");
      if (cachedRules) {
        try {
          const parsed = normalizePermissionMatrix(JSON.parse(cachedRules));
          if (parsed && isMounted) {
            hasCachedRules = true;
            setPermissionMatrix(parsed);
            setRulesLoading(false);
          }
        } catch {
          localStorage.removeItem("shark_permissions");
        }
      }

      try {
        const liveRules = await fetchPermissionMatrix({ forceRefresh: false });
        if (!isMounted) return;

        const resolvedRules = liveRules ?? {};
        setPermissionMatrix(resolvedRules);

        if (liveRules) {
          localStorage.setItem("shark_permissions", JSON.stringify(liveRules));
        } else {
          localStorage.removeItem("shark_permissions");
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
  }, [authLoading, currentPath, hasUser, userIsAnonymous]);

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

    if (currentPath === "/login" && !authLoading && user) {
      setAuthorizedSafe(false);
      safeReplace(dashboardPath);
      return;
    }

    const isPublic = PUBLIC_PATHS.some(
      (path) => currentPath === path || currentPath.startsWith("/public")
    );
    if (isPublic) {
      loginToastPathRef.current = "";
      pendingRedirectRef.current = "";
      setAuthorizedSafe(true);
      return;
    }

    if (
      authLoading ||
      rulesLoading ||
      routeTenantLoading ||
      (hasUser && !!routeTenantSlug && !routeTenantResolved)
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
          addToast("Opa! Faz login pra nadar com o cardume!", "info");
          loginToastPathRef.current = rawCurrentPath;
        }
        safeReplace("/login");
      } else {
        loginToastPathRef.current = "";
      }
      return;
    }

    if (shouldAutoScopePath(currentPath) && !routeTenantSlug && activeTenantSlug) {
      setAuthorizedSafe(false);
      safeReplace(withTenantSlug(activeTenantSlug, currentPath));
      return;
    }

    if (routeTenantSlug) {
      if (!routeTenantId) {
        setAuthorizedSafe(false);
        safeReplace("/nao-encontrado");
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

        if (hasScopedTenantContext && userTenantId !== routeTenantId) {
          setAuthorizedSafe(false);
          addToast("Esse tenant nao pertence ao seu acesso atual.", "error");
          safeReplace(dashboardPath);
          return;
        }
      }
    }

    loginToastPathRef.current = "";
    pendingRedirectRef.current = "";

    if (user.status === "banned" || user.status === "bloqueado") {
      setAuthorizedSafe(false);
      if (currentPath !== "/banned") {
        safeReplace("/banned");
      }
      return;
    }

    if (currentUserRole === "guest_anon") {
      const isAllowed = GUEST_ALLOWED_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith(`${path}/`)
      );

      if (!isAllowed) {
        setAuthorizedSafe(false);
        addToast("Essa area eh exclusiva para membros oficiais!", "error");
        const fallbackPath = currentPath === "/dashboard" ? "/login" : dashboardPath;
        safeReplace(fallbackPath);
        return;
      }
    }

    if (isPlatformMasterUser) {
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

    if (!hasPermissionRules && currentPath.startsWith("/admin")) {
      const hasAdminFallback = currentRoleCandidates.some((role) =>
        ADMIN_PANEL_FALLBACK_ROLES.has(role)
      );

      if (!hasAdminFallback && !hasAdminPanelAccess(user)) {
        setAuthorizedSafe(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        safeReplace("/sem-permissao");
        return;
      }

      setAuthorizedSafe(true);
      return;
    }

    if (hasPermissionRules && permissionMatrix) {
      const matchedRulePath = Object.keys(permissionMatrix)
        .filter(
          (rulePath) =>
            currentPath === rulePath || currentPath.startsWith(`${rulePath}/`)
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
          safeReplace(user.isAnonymous ? dashboardPath : "/sem-permissao");
          return;
        }
      } else if (currentPath.startsWith("/admin/master") && isPlatformMasterUser) {
        setAuthorizedSafe(true);
        return;
      } else if (currentPath.startsWith("/admin")) {
        setAuthorizedSafe(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        safeReplace("/sem-permissao");
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
    authLoading,
    rulesLoading,
    routeTenantId,
    routeTenantLoading,
    routeTenantResolved,
    routeTenantSlug,
    rawCurrentPath,
    currentPath,
    activeTenantSlug,
    router,
    permissionMatrix,
    addToast,
    setAuthorizedSafe,
  ]);

  const isPublicRenderCheck = PUBLIC_PATHS.includes(currentPath);

  if (isPublicRenderCheck) return <>{children}</>;
  if (authLoading || rulesLoading || routeTenantLoading) return <SharkLoader />;
  if (!authorized) return <SharkLoader />;

  return <>{children}</>;
}
