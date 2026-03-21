import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchEffectivePermissionMatrix,
  fetchPermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";
import {
  buildPermissionMatrixStorageKey,
  clearLegacyPermissionMatrixStorage,
} from "@/lib/permissionCache";
import {
  getAccessRoleCandidates,
  hasAdminPanelAccess,
  isMasterOnlyAdminPath,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath } from "@/lib/tenantRouting";

const resolvePermissionPath = (path: string): string =>
  path === "/admin/atletica" || path.startsWith("/admin/atletica/")
    ? "/admin/configuracoes"
    : path;

const normalizePermissionMatrix = (raw: unknown): PermissionMatrix | null => {
  if (!raw || typeof raw !== "object") return null;

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

export function usePermission() {
  const { user } = useAuth();
  const { tenantId: activeTenantId } = useTenantTheme();
  const pathname = usePathname() || "/";
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionMatrix | null>(null);
  const currentPath = parseTenantScopedPath(pathname).scopedPath;

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      setPermissionMatrix(null);
      return;
    }

    let mounted = true;
    const targetTenantId =
      currentPath.startsWith("/master")
        ? ""
        : activeTenantId ||
          (typeof user.tenant_id === "string" ? user.tenant_id.trim() : "");
    const permissionStorageKey = currentPath.startsWith("/master")
      ? buildPermissionMatrixStorageKey(undefined, "platform")
      : currentPath.startsWith("/admin")
        ? buildPermissionMatrixStorageKey(targetTenantId, "effective")
        : buildPermissionMatrixStorageKey(targetTenantId);
    const cachedRules = window.localStorage.getItem(permissionStorageKey);
    if (cachedRules) {
      try {
        const parsed = normalizePermissionMatrix(JSON.parse(cachedRules));
        if (parsed && mounted) setPermissionMatrix(parsed);
      } catch {
        window.localStorage.removeItem(permissionStorageKey);
        clearLegacyPermissionMatrixStorage();
      }
    }

    const loadRules = async () => {
      try {
        const liveRules = currentPath.startsWith("/admin")
          ? await fetchEffectivePermissionMatrix({
              forceRefresh: false,
              tenantId: targetTenantId || undefined,
            })
          : await fetchPermissionMatrix({
              forceRefresh: false,
              tenantId:
                currentPath.startsWith("/master")
                  ? undefined
                  : targetTenantId || undefined,
            });
        if (!mounted) return;
        setPermissionMatrix(liveRules ?? null);
        if (liveRules) {
          window.localStorage.setItem(
            permissionStorageKey,
            JSON.stringify(liveRules)
          );
        }
      } catch {
        if (!mounted) return;
      }
    };

    void loadRules();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, currentPath, user]);

  const canAccess = useCallback(
    (path: string): boolean => {
      if (!user) return false;

      const cleanPath = resolvePermissionPath(
        parseTenantScopedPath(path.split("?")[0]).scopedPath
      );
      const userRole = resolveEffectiveAccessRole(user);
      const roleCandidates = getAccessRoleCandidates(user);

      if (isMasterOnlyAdminPath(cleanPath)) {
        return isPlatformMaster(user) && userRole === "master";
      }

      const matchedRule = permissionMatrix
        ? Object.keys(permissionMatrix)
            .filter(
              (rulePath) =>
                cleanPath === rulePath || cleanPath.startsWith(`${rulePath}/`)
            )
            .sort((a, b) => b.length - a.length)[0]
        : "";

      if (matchedRule) {
        const allowedRoles = permissionMatrix?.[matchedRule].map((role) =>
          role.toLowerCase()
        ) ?? [];
        return (
          allowedRoles.includes(userRole) ||
          roleCandidates.some((role) => allowedRoles.includes(role))
        );
      }

      if (cleanPath.startsWith("/admin")) {
        return hasAdminPanelAccess(user);
      }

      if (cleanPath.startsWith("/master")) {
        return isPlatformMaster(user) && userRole === "master";
      }

      return true;
    },
    [permissionMatrix, user]
  );

  return { canAccess, permissionMatrix };
}
