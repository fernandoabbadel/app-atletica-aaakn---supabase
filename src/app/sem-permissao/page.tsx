"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";

const FRASES = [
  "Sem CRM para realizar essa cirurgia, doutor(a).",
  "Voce nadou fundo demais... volte para o raso.",
  "Area de isolamento. Risco biologico (e de ban).",
  "Acesso restrito apenas para Predadores Alfa.",
  "Opa! Voce bateu num recife de corais. De meia volta.",
  "Nem o Harrison explica o que voce ta fazendo aqui.",
  "Sua carteirinha nao abre essa porta. Tente a Diretoria.",
  "Calma, bixo! Voce ainda nao tem level para essa area.",
  "Area esteril. Sua entrada contaminaria o ambiente.",
  "Acesso negado. O tubarao esta de olho.",
];

export default function SemPermissao() {
  const frase = useMemo(() => {
    const randomIndex = Math.floor(Math.random() * FRASES.length);
    return FRASES[randomIndex];
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center overflow-hidden">
      <div className="relative w-40 h-40 rounded-full border-4 border-zinc-800 overflow-hidden bg-black shadow-[0_0_60px_rgba(249,115,22,0.4)] mb-8 flex items-center justify-center group">
        <div className="relative z-20 flex items-center justify-center">
          <ShieldAlert size={64} className="text-white drop-shadow-lg animate-pulse" />
        </div>

        <div className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-600/20 rounded-[40%] animate-wave-fill z-10" />

        <div
          className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-500/10 rounded-[45%] animate-wave-fill z-0"
          style={{ animationDuration: "5s", animationDelay: "1s" }}
        />
      </div>

      <div className="text-center px-6 max-w-md space-y-4">
        <div>
          <h2 className="text-orange-500 font-black text-3xl tracking-[0.2em] uppercase mb-1 drop-shadow-[0_0_10px_rgba(249,115,22,0.5)]">
            Restrito
          </h2>
          <div className="h-1 w-24 bg-orange-600 mx-auto rounded-full" />
        </div>

        <p className="text-zinc-400 text-lg font-medium italic leading-relaxed">&quot;{frase}&quot;</p>

        <div className="pt-6">
          <Link
            href="/dashboard"
            className="group relative inline-flex items-center gap-3 px-8 py-3 bg-transparent border border-orange-600/50 rounded-full text-orange-500 font-bold uppercase tracking-widest hover:bg-orange-600 hover:text-white transition-all duration-300 hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] hover:scale-105"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
            <span>Voltar pro Raso</span>
          </Link>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />

      <style jsx>{`
        @keyframes wave-fill {
          0% {
            transform: rotate(0deg) translateY(0);
            top: 60%;
          }
          100% {
            transform: rotate(360deg) translateY(0);
            top: 40%;
          }
        }

        .animate-wave-fill {
          animation: wave-fill 4s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}
