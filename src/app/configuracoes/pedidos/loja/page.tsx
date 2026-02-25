"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PedidosByTypePage } from "../_components/PedidosByTypePage";

export default function ConfigPedidosLojaPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24 font-sans">
      <header className="p-4 sticky top-0 z-30 flex items-center gap-4 border-b border-white/5 bg-[#050505]/90 backdrop-blur-md">
        <Link href="/configuracoes/pedidos" className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full transition hover:bg-zinc-900">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl italic uppercase tracking-tighter text-white">Pedidos Loja</h1>
      </header>
      <PedidosByTypePage tab="loja" />
    </div>
  );
}
