"use client";

import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

export default function SecuritySoonPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="p-4 flex items-center gap-4 sticky top-0 bg-[#050505]/90 backdrop-blur-md z-10 border-b border-zinc-900">
        <Link href="/configuracoes" className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl uppercase tracking-tight">Seguranca</h1>
      </header>

      <main className="p-6 max-w-md mx-auto">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl border border-zinc-700 bg-black flex items-center justify-center">
            <Lock size={24} className="text-emerald-400" />
          </div>
          <p className="text-[11px] uppercase font-black tracking-widest text-emerald-400">Em breve</p>
          <h2 className="text-xl font-black">Modulo de seguranca em reformulacao</h2>
          <p className="text-sm text-zinc-400">
            Estamos integrando esta tela ao painel admin para controle centralizado de seguranca.
          </p>
          <Link
            href="/configuracoes"
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-zinc-700 text-xs font-black uppercase hover:border-emerald-500/40 hover:text-emerald-300"
          >
            Voltar para configuracoes
          </Link>
        </section>
      </main>
    </div>
  );
}
