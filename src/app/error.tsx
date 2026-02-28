"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, ArrowLeft, RefreshCcw } from "lucide-react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#140900] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-600/20 via-[#140900] to-black z-0" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full">
        <div className="relative w-40 h-40 rounded-full border-4 border-orange-500/40 overflow-hidden bg-black shadow-[0_0_70px_rgba(251,146,60,0.25)] mb-8 flex items-center justify-center">
          <div className="relative z-20 w-24 h-24 flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="Logo AAAKN"
              fill
              sizes="96px"
              className="object-contain drop-shadow-2xl"
              priority
            />
          </div>

          <div className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-500/25 rounded-[40%] animate-wave-fill z-10" />
          <div
            className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-400/20 rounded-[45%] animate-wave-fill z-0"
            style={{ animationDuration: "4s", animationDelay: "1s" }}
          />
        </div>

        <h1 className="text-3xl font-black uppercase tracking-wider text-orange-400 flex items-center gap-2 mb-2">
          <AlertTriangle size={24} /> Erro no Oceano
        </h1>
        <p className="text-zinc-300 text-sm mb-8">
          A pagina encontrou um erro inesperado. Tente novamente.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-black text-xs uppercase transition"
          >
            <RefreshCcw size={16} /> Tentar de novo
          </button>

          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-black text-xs uppercase transition"
          >
            <ArrowLeft size={16} /> Ir para dashboard
          </Link>
        </div>
      </div>

      <style jsx>{`
        @keyframes wave-fill {
          0% {
            transform: rotate(0deg) translateY(0);
            top: 100%;
            left: -50%;
          }
          100% {
            transform: rotate(360deg) translateY(0);
            top: 18%;
            left: -50%;
          }
        }
        .animate-wave-fill {
          animation: wave-fill 2.6s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}

