"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

export function MiniVendorShell({
  title,
  subtitle,
  backPath = "/configuracoes/mini-vendor",
  children,
  actions,
}: {
  title: string;
  subtitle: string;
  backPath?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { tenantSlug } = useTenantTheme();
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, backPath) : backPath;

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">{title}</h1>
              <p className="text-[11px] font-bold text-zinc-500">{subtitle}</p>
            </div>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
