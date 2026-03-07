import { useAuth } from "../context/AuthContext";
import {
  getAccessRoleCandidates,
  isMasterOnlyAdminPath,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath } from "@/lib/tenantRouting";

export function usePermission() {
  const { user } = useAuth();

  const canAccess = (path: string): boolean => {
    if (!user) return false;

    const cleanPath = parseTenantScopedPath(path.split("?")[0]).scopedPath;
    if (isPlatformMaster(user)) return true;
    if (isMasterOnlyAdminPath(cleanPath)) return false;

    const cachedRules = localStorage.getItem("shark_permissions");
    if (!cachedRules) return true;

    const matrix = JSON.parse(cachedRules) as Record<string, string[]>;
    const userRole = resolveEffectiveAccessRole(user);
    const roleCandidates = getAccessRoleCandidates(user);

    const matchedRule = Object.keys(matrix)
      .filter(
        (rulePath) =>
          cleanPath === rulePath || cleanPath.startsWith(`${rulePath}/`)
      )
      .sort((a, b) => b.length - a.length)[0];

    if (matchedRule) {
      const allowedRoles = matrix[matchedRule].map((role) => role.toLowerCase());
      return (
        allowedRoles.includes(userRole) ||
        roleCandidates.some((role) => allowedRoles.includes(role))
      );
    }

    return true;
  };

  return { canAccess };
}
