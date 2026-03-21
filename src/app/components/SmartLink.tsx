"use client";

import React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { COMING_SOON_PATHS } from "@/lib/appRoutes";
import {
  buildPermissionMatrixStorageKey,
  clearLegacyPermissionMatrixStorage,
} from "@/lib/permissionCache";
import {
  ADMIN_PANEL_FALLBACK_ROLES,
  getAccessRoleCandidates,
  isMasterOnlyAdminPath,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath } from "@/lib/tenantRouting";

interface SmartLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  showLockIcon?: boolean;
}

const parsePermissionMatrix = (
  raw: string
): Record<string, string[]> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;

    const normalized: Record<string, string[]> = {};
    for (const [path, roles] of Object.entries(parsed)) {
      if (!Array.isArray(roles)) continue;

      const safeRoles = roles.filter(
        (entry): entry is string => typeof entry === "string"
      );
      if (!safeRoles.length) continue;

      normalized[path] = safeRoles;
    }

    return normalized;
  } catch {
    return null;
  }
};

export default function SmartLink({
  href,
  children,
  className,
  showLockIcon = false,
}: SmartLinkProps) {
  const { user } = useAuth();
  const { tenantId: activeTenantId } = useTenantTheme();
  const { addToast } = useToast();

  const checkAccess = () => {
    if (typeof window === "undefined") return true;
    if (!user) return false;

    const path = href.toString().split("?")[0];
    const cleanPath = parseTenantScopedPath(path).scopedPath;
    const userRole = resolveEffectiveAccessRole(user);
    const roleCandidates = getAccessRoleCandidates(user);
    const permissionStorageKey = cleanPath.startsWith("/master")
      ? buildPermissionMatrixStorageKey(undefined, "platform")
      : cleanPath.startsWith("/admin")
        ? buildPermissionMatrixStorageKey(activeTenantId, "effective")
        : buildPermissionMatrixStorageKey(activeTenantId);

    const isComingSoon = COMING_SOON_PATHS.some(
      (comingPath) =>
        cleanPath === comingPath || cleanPath.startsWith(`${comingPath}/`)
    );
    if (isComingSoon) return false;

    if (isMasterOnlyAdminPath(cleanPath)) {
      return isPlatformMaster(user);
    }

    if (isPlatformMaster(user)) return true;

    const cachedRules = localStorage.getItem(permissionStorageKey);
    if (!cachedRules) {
      if (cleanPath.startsWith("/admin")) {
        return roleCandidates.some((role) =>
          ADMIN_PANEL_FALLBACK_ROLES.has(role)
        );
      }
      return true;
    }

    try {
      const permissionMatrix = parsePermissionMatrix(cachedRules);
      if (!permissionMatrix) {
        clearLegacyPermissionMatrixStorage();
        if (cleanPath.startsWith("/admin")) {
          return roleCandidates.some((role) =>
            ADMIN_PANEL_FALLBACK_ROLES.has(role)
          );
        }
        return true;
      }

      const matchedPath = Object.keys(permissionMatrix)
        .filter(
          (rulePath) =>
            cleanPath === rulePath || cleanPath.startsWith(`${rulePath}/`)
        )
        .sort((a, b) => b.length - a.length)[0];

      if (matchedPath) {
        const allowedRoles = permissionMatrix[matchedPath].map((role) =>
          role.toLowerCase()
        );
        return (
          allowedRoles.includes(userRole) ||
          roleCandidates.some((role) => allowedRoles.includes(role))
        );
      }

      if (cleanPath.startsWith("/admin")) {
        return roleCandidates.some((role) =>
          ADMIN_PANEL_FALLBACK_ROLES.has(role)
        );
      }
    } catch (error: unknown) {
      console.error("Erro ao verificar permissao no SmartLink", error);
      if (cleanPath.startsWith("/admin")) {
        return roleCandidates.some((role) =>
          ADMIN_PANEL_FALLBACK_ROLES.has(role)
        );
      }
      return true;
    }

    return true;
  };

  const hasPermission = checkAccess();

  const handleClick = (event: React.MouseEvent) => {
    if (hasPermission) return;

    event.preventDefault();
    addToast("Acesso bloqueado para essa area.", "error");
  };

  if (!hasPermission && showLockIcon) {
    return (
      <div
        className={`${className} opacity-50 cursor-not-allowed flex items-center gap-2`}
        onClick={handleClick}
      >
        {children} <Lock size={14} />
      </div>
    );
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
