"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, LogOut, ShieldCheck, Store } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function AdminMiniVendorsPage() {
  const { tenantSlug } = useTenantTheme();

  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  const links = useMemo(
    () => [
      {
        title: "Pendentes de aprovação",
        description:
          "Abra a fila separada para aprovar ou rejeitar novos cadastros sem misturar com a listagem geral.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/admin/mini-vendors/aprovacoes")
          : "/admin/mini-vendors/aprovacoes",
        buttonLabel: "Abrir aprovacoes",
        accentClass:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300 shadow-yellow-500/10",
        Icon: ShieldCheck,
      },
      {
        title: "Todos os mini vendors",
        description:
          "Veja todas as lojinhas cadastradas em uma página própria, com status e ações de administração.",
        href: tenantSlug
          ? withTenantSlug(tenantSlug, "/admin/mini-vendors/cadastros")
          : "/admin/mini-vendors/cadastros",
        buttonLabel: "Abrir cadastros",
        accentClass:
          "border-blue-500/30 bg-blue-500/10 text-blue-300 shadow-blue-500/10",
        Icon: Store,
      },
    ],
    [tenantSlug]
  );

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
              <h1 className="text-xl font-black uppercase tracking-tight">
                Mini Vendor Admin
              </h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Abra cada área em página própria para aprovações e cadastros.
              </p>
            </div>
          </div>
          <Link
            href={dashboardHref}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
          >
            <LogOut size={14} />
            Sair do admin
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 md:grid-cols-2">
        {links.map((item) => {
          const Icon = item.Icon;
          return (
            <article
              key={item.href}
              className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]"
            >
              <div
                className={`inline-flex rounded-2xl border p-3 shadow-lg ${item.accentClass}`}
              >
                <Icon size={18} />
              </div>
              <h2 className="mt-5 text-lg font-black uppercase text-white">
                {item.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {item.description}
              </p>
              <Link
                href={item.href}
                className="mt-6 inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/30 px-4 py-3 text-xs font-black uppercase text-white hover:border-zinc-500 hover:bg-black/50"
              >
                {item.buttonLabel}
                <ChevronRight size={14} />
              </Link>
            </article>
          );
        })}
      </main>
    </div>
  );
}
