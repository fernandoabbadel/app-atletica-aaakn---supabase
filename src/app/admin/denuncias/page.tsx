"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, Dumbbell, LifeBuoy, MessageCircle } from "lucide-react";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

const menuItems = [
  {
    href: "/admin/denuncias/banidos",
    title: "Banidos",
    description: "Recursos de bloqueio",
    icon: AlertTriangle,
    color: "text-red-400 border-red-500/30 bg-red-500/10",
  },
  {
    href: "/admin/denuncias/comunidade",
    title: "Comunidade",
    description: "Mensagens denunciadas",
    icon: MessageCircle,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  },
  {
    href: "/admin/denuncias/gym",
    title: "Gym",
    description: "Denuncias relacionadas a treino",
    icon: Dumbbell,
    color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  },
  {
    href: "/admin/denuncias/suporte",
    title: "Suporte",
    description: "Chamados de /configuracoes/suporte",
    icon: LifeBuoy,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
] as const;

export default function AdminDenunciasMenuPage() {
  const { tenantSlug } = useTenantTheme();
  const adminHomeHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href={adminHomeHref} className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Admin Denuncias</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Rotas separadas por categoria</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={tenantSlug ? withTenantSlug(tenantSlug, item.href) : item.href}
                className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-600 transition"
              >
                <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${item.color}`}>
                  <Icon size={18} />
                </div>
                <h2 className="mt-4 text-sm font-black uppercase">{item.title}</h2>
                <p className="mt-2 text-xs text-zinc-400">{item.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
