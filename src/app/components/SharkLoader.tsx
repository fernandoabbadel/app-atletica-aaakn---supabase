"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

const FRASES_TUBARAO = [
  "Afiando o bisturi e os dentes.",
  "Os tubaroes estao revisando Anatomia.",
  "Procurando a veia certa. Aguarde.",
  "Tubarao nao dorme, estuda Fisiologia.",
  "Calibrando a mordida para o Intermed.",
  "Mergulhando em um mar de apostilas.",
  "Oxigenando as branquias para o plantao.",
];

export default function SharkLoader() {
  const [frase, setFrase] = useState("Carregando...");
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setFrase(FRASES_TUBARAO[Math.floor(Math.random() * FRASES_TUBARAO.length)]);

    const interval = setInterval(() => {
      setFrase(FRASES_TUBARAO[Math.floor(Math.random() * FRASES_TUBARAO.length)]);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center">
      <div className="relative w-32 h-32 rounded-full border-4 border-zinc-800 overflow-hidden bg-black shadow-[0_0_50px_rgba(16,185,129,0.3)] mb-8 flex items-center justify-center">
        <div className="relative z-20 w-20 h-20 flex items-center justify-center">
          {!imgError ? (
            <div className="relative w-full h-full">
              <Image
                src="/logo.png"
                alt="Loading"
                fill
                sizes="80px"
                priority
                className="object-contain drop-shadow-2xl animate-pulse"
                onError={() => setImgError(true)}
                unoptimized
              />
            </div>
          ) : (
            <span style={{ fontSize: "3rem" }}>T</span>
          )}
        </div>

        <div className="absolute left-[-50%] w-[200%] h-[200%] bg-emerald-600/20 rounded-[40%] animate-wave-fill z-10" />
        <div
          className="absolute left-[-50%] w-[200%] h-[200%] bg-emerald-500/10 rounded-[45%] animate-wave-fill z-0"
          style={{ animationDuration: "4s", animationDelay: "1s" }}
        />
      </div>

      <div className="text-center px-6 max-w-sm">
        <h2 className="text-emerald-500 font-black text-xl tracking-[0.2em] animate-pulse mb-3 uppercase">
          Carregando
        </h2>
        <p className="text-zinc-400 text-sm font-medium italic leading-relaxed min-h-[3rem] transition-all duration-500">
          &quot;{frase}&quot;
        </p>
      </div>

      <style jsx>{`
        @keyframes wave-fill {
          0% {
            transform: rotate(0deg) translateY(0);
            top: 100%;
          }
          100% {
            transform: rotate(360deg) translateY(0);
            top: 20%;
          }
        }
        .animate-wave-fill {
          animation: wave-fill 2.5s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}
