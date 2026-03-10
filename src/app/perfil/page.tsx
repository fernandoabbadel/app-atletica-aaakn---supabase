"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { buildLoginPath } from "@/lib/authRedirect";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";

export default function MeuPerfilRedirectPage() {
  const router = useRouter();
  const pathname = usePathname() || "/perfil";
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace(buildLoginPath(pathname));
      return;
    }

    if (String(user.role ?? "guest") === "guest") {
      router.replace("/cadastro");
      return;
    }

    const { tenantSlug } = parseTenantScopedPath(pathname);
    const targetPath = `/perfil/${user.uid}`;
    const nextPath = tenantSlug ? withTenantSlug(tenantSlug, targetPath) : targetPath;

    router.replace(nextPath);
  }, [loading, pathname, router, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
      <Loader2 className="h-10 w-10 animate-spin text-brand" />
    </div>
  );
}
