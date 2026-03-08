import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../context/AuthContext";
import {
  fetchPermissionMatrix,
  type PermissionMatrix,
} from "@/lib/adminSecurityService";
import {
  getAccessRoleCandidates,
  hasAdminPanelAccess,
  isMasterOnlyAdminPath,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath } from "@/lib/tenantRouting";

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
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionMatrix | null>(null);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      setPermissionMatrix(null);
      return;
    }

    let mounted = true;
    const cachedRules = window.localStorage.getItem("shark_permissions");
    if (cachedRules) {
      try {
        const parsed = normalizePermissionMatrix(JSON.parse(cachedRules));
        if (parsed && mounted) setPermissionMatrix(parsed);
      } catch {
        window.localStorage.removeItem("shark_permissions");
      }
    }

    const loadRules = async () => {
      try {
        const liveRules = await fetchPermissionMatrix({ forceRefresh: false });
        if (!mounted) return;
        setPermissionMatrix(liveRules ?? null);
        if (liveRules) {
          window.localStorage.setItem("shark_permissions", JSON.stringify(liveRules));
        }
      } catch {
        if (!mounted) return;
      }
    };

    void loadRules();
    return () => {
      mounted = false;
    };
  }, [user]);

  const canAccess = useCallback(
    (path: string): boolean => {
      if (!user) return false;

      const cleanPath = parseTenantScopedPath(path.split("?")[0]).scopedPath;
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
        const isTenantMasterCompatible =
          ((allowedRoles.includes("master") &&
            roleCandidates.includes("master_tenant")) ||
            (allowedRoles.includes("master_tenant") &&
              roleCandidates.includes("master")));
        return (
          allowedRoles.includes(userRole) ||
          roleCandidates.some((role) => allowedRoles.includes(role)) ||
          isTenantMasterCompatible
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
