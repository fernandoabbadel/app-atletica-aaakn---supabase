"use client";

import React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { COMING_SOON_PATHS } from "@/lib/appRoutes";

interface SmartLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  showLockIcon?: boolean;
}

const ADMIN_FALLBACK_ROLES = new Set([
  "master",
  "admin",
  "admin_geral",
  "admin_gestor",
  "staff",
]);

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
  const { addToast } = useToast();

  const checkAccess = () => {
    if (typeof window === "undefined") return true;
    if (!user) return false;

    const path = href.toString().split("?")[0];
    const userRole = (user.role || "user").toLowerCase();

    const isComingSoon = COMING_SOON_PATHS.some(
      (comingPath) => path === comingPath || path.startsWith(`${comingPath}/`)
    );
    if (isComingSoon) return false;

    if (userRole === "master") return true;

    const cachedRules = localStorage.getItem("shark_permissions");
    if (!cachedRules) {
      if (path.startsWith("/admin")) {
        return ADMIN_FALLBACK_ROLES.has(userRole);
      }
      return true;
    }

    try {
      const permissionMatrix = parsePermissionMatrix(cachedRules);
      if (!permissionMatrix) {
        if (path.startsWith("/admin")) {
          return ADMIN_FALLBACK_ROLES.has(userRole);
        }
        return true;
      }

      const matchedPath = Object.keys(permissionMatrix)
        .filter(
          (rulePath) => path === rulePath || path.startsWith(`${rulePath}/`)
        )
        .sort((a, b) => b.length - a.length)[0];

      if (matchedPath) {
        const allowedRoles = permissionMatrix[matchedPath].map((role) =>
          role.toLowerCase()
        );
        return allowedRoles.includes(userRole);
      }

      if (path.startsWith("/admin")) {
        return ADMIN_FALLBACK_ROLES.has(userRole);
      }
    } catch (error: unknown) {
      console.error("Erro ao verificar permissao no SmartLink", error);
      if (path.startsWith("/admin")) {
        return ADMIN_FALLBACK_ROLES.has(userRole);
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
