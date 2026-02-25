"use client";

import Link from "next/link";
import { ArrowLeft, CreditCard, ShoppingBag, Ticket } from "lucide-react";

const cards = [
  {
    href: "/configuracoes/pedidos/eventos",
    title: "Pedidos de Eventos",
    description: "Ingressos e lotes",
    icon: Ticket,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  {
    href: "/configuracoes/pedidos/loja",
    title: "Pedidos da Loja",
    description: "Compras de produtos",
    icon: ShoppingBag,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  },
  {
    href: "/configuracoes/pedidos/planos",
    title: "Pedidos de Planos",
    description: "Adesoes e status",
    icon: CreditCard,
    color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  },
] as const;

export default function ConfigPedidosMenuPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24 font-sans">
      <header className="p-4 sticky top-0 z-30 flex items-center gap-4 border-b border-white/5 bg-[#050505]/90 backdrop-blur-md">
        <Link href="/configuracoes" className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full transition hover:bg-zinc-900">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl italic uppercase tracking-tighter text-white">Meus Pedidos</h1>
      </header>

      <main className="p-4 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.href} href={card.href} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-600 transition">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${card.color}`}>
                  <Icon size={16} />
                </div>
                <h2 className="mt-3 text-sm font-black uppercase">{card.title}</h2>
                <p className="mt-2 text-xs text-zinc-400">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
