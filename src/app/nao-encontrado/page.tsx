"use client";

import Link from "next/link";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function TenantNotFoundPage() {
  const { tenantSlug } = useTenantTheme();
  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/80 p-8 text-center">
        <p className="text-xs font-black tracking-[0.2em] text-zinc-400 uppercase">Tenant</p>
        <h1 className="mt-3 text-3xl font-black uppercase text-brand-accent">Não encontrado</h1>
        <p className="mt-4 text-sm text-zinc-300">
          Não foi possível validar o tenant dessa URL. Confira o link ou volte para o dashboard.
        </p>
        <Link
          href={dashboardHref}
          className="brand-button-solid mt-6 px-5 py-2 text-sm"
        >
          Voltar ao dashboard
        </Link>
      </section>
    </main>
  );
}
