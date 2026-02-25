"use client";

import Link from "next/link";
import { ArrowLeft, FileClock, ListChecks, Megaphone, PencilRuler, ShieldCheck, Users } from "lucide-react";

const menuItems = [
  { href: "/admin/planos/historico", title: "Historico", description: "Solicitacoes e aprovacoes", icon: FileClock },
  { href: "/admin/planos/lista_bicho_solto", title: "Lista Bicho Solto", description: "Assinaturas por plano", icon: Users },
  { href: "/admin/planos/lista_cardume_livre", title: "Lista Cardume Livre", description: "Assinaturas por plano", icon: Users },
  { href: "/admin/planos/lista_atleta", title: "Lista Atleta", description: "Assinaturas por plano", icon: Users },
  { href: "/admin/planos/lista_lenda", title: "Lista Lenda", description: "Assinaturas por plano", icon: Users },
  { href: "/admin/planos/auditoria", title: "Auditoria", description: "Conferencia de statuses", icon: ShieldCheck },
  { href: "/admin/planos/editar", title: "Editar", description: "Catalogo e configuracoes", icon: PencilRuler },
] as const;

export default function AdminPlanosMenuPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Admin Planos</h1>
              <p className="text-[11px] text-zinc-500 font-bold">Menu dividido por pagina para reduzir leituras</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/admin/planos/editar" className="px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[11px] font-black uppercase inline-flex items-center gap-1">
              <ListChecks size={12} /> Criar novo plano
            </Link>
            <Link href="/planos" className="px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/10 text-blue-400 text-[11px] font-black uppercase inline-flex items-center gap-1">
              <Megaphone size={12} /> Marketing CSS
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-600 transition">
                <div className="w-11 h-11 rounded-xl border border-zinc-700 bg-zinc-950 text-emerald-400 flex items-center justify-center">
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
