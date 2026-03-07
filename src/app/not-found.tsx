"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";

export default function NotFound() {
  const { tenantLogoUrl, tenantName } = useTenantTheme();

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
      <div className="relative w-40 h-40 rounded-full border-4 border-zinc-800 overflow-hidden bg-black shadow-[0_0_50px_rgba(239,68,68,0.3)] mb-8 flex items-center justify-center group">
        <div className="relative z-20 w-28 h-28 flex items-center justify-center opacity-80 group-hover:scale-110 transition duration-500">
          <Image
            src={tenantLogoUrl || "/logo.png"}
            alt={`Logo ${tenantName || "Tenant"}`}
            width={112}
            height={112}
            className="w-full h-full object-contain drop-shadow-2xl grayscale"
          />
        </div>

        <div className="absolute top-0 left-0 w-full h-full bg-red-900/40 z-10 animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-[200%] h-[200%] bg-red-600/20 rounded-[40%] animate-wave-slow z-0"></div>
      </div>

      <h1 className="text-red-500 font-black text-6xl mb-2 tracking-tighter">404</h1>
      <h2 className="text-white font-bold text-xl uppercase tracking-widest mb-4">Pagina nao encontrada</h2>
      <p className="text-zinc-400 text-sm font-medium italic max-w-xs mx-auto mb-10 leading-relaxed">
        Nao encontramos a rota solicitada no tenant atual.
      </p>

      <Link
        href="/"
        className="bg-zinc-100 text-black px-8 py-3 rounded-full font-black text-sm hover:bg-emerald-500 hover:text-white transition shadow-lg flex items-center gap-2 group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition" />
        VOLTAR
      </Link>

      <style jsx>{`
        @keyframes wave-slow {
          0% {
            transform: rotate(0deg);
            top: -60%;
            left: -50%;
          }
          100% {
            transform: rotate(360deg);
            top: -60%;
            left: -50%;
          }
        }
        .animate-wave-slow {
          animation: wave-slow 10s linear infinite;
        }
      `}</style>
    </div>
  );
}
