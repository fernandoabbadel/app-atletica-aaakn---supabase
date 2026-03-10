"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3, Building2, ClipboardList, History, Plus } from "lucide-react";

const menuItems = [
  {
    href: "/admin/parceiros/ativos",
    title: "Parceiros Ativos",
    description: "Resumo por plano e status",
    icon: BarChart3,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  {
    href: "/admin/parceiros/empresas",
    title: "Empresas",
    description: "Tabela paginada de parceiros",
    icon: Building2,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  },
  {
    href: "/admin/parceiros/dados",
    title: "Dados Cadastrais",
    description: "Campos administrativos e contatos",
    icon: ClipboardList,
    color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  },
  {
    href: "/admin/parceiros/historico",
    title: "Historico",
    description: "Scans validados 20 em 20",
    icon: History,
    color: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  },
] as const;

export default function AdminParceirosMenuPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Admin Parceiros</h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                Menu leve: sem carregar tabelas nesta tela
              </p>
            </div>
          </div>
          <Link
            href="/admin/parceiros/empresas?new=1"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15"
          >
            <Plus size={14} />
            Criar Parceiro
          </Link>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-600 transition"
              >
                <div
                  className={`w-11 h-11 rounded-xl border flex items-center justify-center ${item.color}`}
                >
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
