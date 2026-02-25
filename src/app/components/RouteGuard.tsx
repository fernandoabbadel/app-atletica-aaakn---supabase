"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import SharkLoader from "./SharkLoader";
import { useAuth } from "@/context/AuthContext";
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

const ADMIN_FALLBACK_ROLES = new Set([
  "master",
  "admin",
  "admin_geral",
  "admin_gestor",
  "staff",
]);

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
  const { addToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const [authorized, setAuthorized] = useState(false);
  const [permissionMatrix, setPermissionMatrix] =
    useState<PermissionMatrix | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const hasUser = !!user;
  const userUid = user?.uid || "";
  const userRole = (user?.role || "visitante").toLowerCase();
  const userIsAnonymous = Boolean(user?.isAnonymous);

  useEffect(() => {
    if (authLoading) return;

    let isMounted = true;
    const currentPath = pathname ? pathname.split("?")[0] : "/";
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
  }, [authLoading, hasUser, pathname, userIsAnonymous, userRole]);

  useEffect(() => {
    const currentPath = pathname ? pathname.split("?")[0] : "/";

    if (currentPath === "/login" && !authLoading && user) {
      setAuthorized(false);
      router.replace("/dashboard");
      return;
    }

    const isPublic = PUBLIC_PATHS.some(
      (path) => currentPath === path || currentPath.startsWith("/public")
    );
    if (isPublic) {
      setAuthorized(true);
      return;
    }

    if (authLoading || rulesLoading) return;

    let currentUserRole = "visitante";
    if (user) {
      if (userIsAnonymous) currentUserRole = "guest_anon";
      else currentUserRole = userRole || "user";
    }

    if (
      currentPath !== "/em-breve" &&
      COMING_SOON_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith(`${path}/`)
      )
    ) {
      setAuthorized(false);
      router.replace("/em-breve");
      return;
    }

    if (!user) {
      setAuthorized(false);
      if (currentPath !== "/login") {
        addToast("Opa! Faz login pra nadar com o cardume!", "info");
        router.replace("/login");
      }
      return;
    }

    if (user.status === "banned" || user.status === "bloqueado") {
      setAuthorized(false);
      if (currentPath !== "/banned") {
        router.replace("/banned");
      }
      return;
    }

    if (currentUserRole === "guest_anon") {
      const isAllowed = GUEST_ALLOWED_PATHS.some(
        (path) => currentPath === path || currentPath.startsWith(`${path}/`)
      );

      if (!isAllowed) {
        setAuthorized(false);
        addToast("Essa area eh exclusiva para membros oficiais!", "error");
        const fallbackPath = currentPath === "/dashboard" ? "/login" : "/dashboard";
        router.replace(fallbackPath);
        return;
      }
    }

    if (userRole === "master") {
      setAuthorized(true);
      return;
    }

    const hasPermissionRules =
      permissionMatrix !== null && Object.keys(permissionMatrix).length > 0;

    if (!hasPermissionRules && currentPath.startsWith("/admin")) {
      if (!ADMIN_FALLBACK_ROLES.has(currentUserRole)) {
        setAuthorized(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        router.replace("/sem-permissao");
        return;
      }

      setAuthorized(true);
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
        const isRoleAllowed = allowedRoles.includes(currentUserRole);

        if (!isRoleAllowed) {
          setAuthorized(false);
          addToast("Eita! Voce nao tem permissao para essa area!", "error");
          router.replace(user.isAnonymous ? "/dashboard" : "/sem-permissao");
          return;
        }
      } else if (currentPath.startsWith("/admin")) {
        setAuthorized(false);
        addToast("Opa! Area restrita da diretoria!", "error");
        router.replace("/sem-permissao");
        return;
      }
    }

    setAuthorized(true);
  }, [
    user,
    userUid,
    userRole,
    userIsAnonymous,
    authLoading,
    rulesLoading,
    pathname,
    router,
    permissionMatrix,
    addToast,
  ]);

  const currentPath = pathname ? pathname.split("?")[0] : "/";
  const isPublicRenderCheck = PUBLIC_PATHS.includes(currentPath);

  if (isPublicRenderCheck) return <>{children}</>;
  if (authLoading || rulesLoading) return <SharkLoader />;
  if (!authorized) return <SharkLoader />;

  return <>{children}</>;
}

