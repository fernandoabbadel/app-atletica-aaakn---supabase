"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { isPlatformMaster } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function LegacyAdminLandingRedirect() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tenantSlug, loading: tenantThemeLoading } = useTenantTheme();

  useEffect(() => {
    if (authLoading || tenantThemeLoading) return;

    const normalizedTenantSlug = tenantSlug.trim().toLowerCase();
    if (normalizedTenantSlug) {
      router.replace(withTenantSlug(normalizedTenantSlug, "/admin/landing"));
      return;
    }

    if (isPlatformMaster(user)) {
      router.replace("/master/landing");
      return;
    }

    router.replace("/sem-permissao");
  }, [authLoading, router, tenantSlug, tenantThemeLoading, user]);

  return <div className="p-8 text-white">Redirecionando editor da landing...</div>;
}
