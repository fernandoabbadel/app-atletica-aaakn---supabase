"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

// Suas frases excelentes (Mantidas!)
const LOADING_FRASES = [
  "Afiando o bisturi... e os dentes. 🦈",
  "Os tubarões estão revisando Anatomia...",
  "Procurando a veia certa... aguarde.",
  "Tubarão não dorme, estuda Fisiologia.",
  "Calibrando a mordida para o Intermed. 🏆",
  "Mergulhando em um mar de apostilas.",
  "Oxigenando as brânquias para o plantão. 🫁",
  "Esperando o R1 passar a visita...",
  "Consultando o Harrison... um momento. 📚",
  "Nadando contra a corrente (e o sono).",
];

export default function Loading() {
  const [frase, setFrase] = useState("Carregando...");

  useEffect(() => {
    // Escolhe frase aleatória e troca a cada 2.5s para não ficar estático se demorar
    const randomIndex = Math.floor(Math.random() * LOADING_FRASES.length);
    setFrase(LOADING_FRASES[randomIndex]);

    const interval = setInterval(() => {
      const newIndex = Math.floor(Math.random() * LOADING_FRASES.length);
      setFrase(LOADING_FRASES[newIndex]);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center">
      {/* CONTAINER DA ANIMAÇÃO (Bolinha) */}
      <div className="relative w-32 h-32 rounded-full border-4 border-zinc-800 overflow-hidden bg-black shadow-[0_0_50px_rgba(16,185,129,0.3)] mb-8 flex items-center justify-center">
        {/* LOGO NO CENTRO (Frente da água) */}
        <div className="relative z-20 w-20 h-20 flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="Loading"
            fill
            sizes="80px"
            className="object-contain drop-shadow-2xl animate-pulse-slow"
            onError={(e) => {
              // Fallback para o emoji caso a imagem falhe
              e.currentTarget.style.display = "none";
              const span = document.createElement("span");
              span.innerText = "🦈";
              span.style.fontSize = "3rem";
              e.currentTarget.parentElement?.appendChild(span);
            }}
          />
        </div>

        {/* ONDA ESMERALDA (Fundo) */}
        <div className="absolute left-0 w-[200%] h-[200%] bg-emerald-600/20 rounded-[40%] animate-wave-fill z-10"></div>
        {/* Segunda onda para dar profundidade */}
        <div
          className="absolute left-0 w-[200%] h-[200%] bg-emerald-500/10 rounded-[45%] animate-wave-fill z-0"
          style={{ animationDuration: "4s", animationDelay: "1s" }}
        ></div>
      </div>

      {/* TEXTO */}
      <div className="text-center px-6 max-w-sm">
        <h2 className="text-emerald-500 font-black text-xl tracking-[0.2em] animate-pulse mb-3 uppercase">
          Carregando
        </h2>
        <p className="text-zinc-400 text-sm font-medium italic leading-relaxed min-h-[3rem] transition-all duration-500">
          &quot;{frase}&quot;
        </p>
      </div>

      {/* STYLES */}
      <style jsx>{`
        @keyframes wave-fill {
          0% {
            transform: rotate(0deg) translateY(0);
            top: 100%;
            left: -50%;
          }
          100% {
            transform: rotate(360deg) translateY(0);
            top: 20%; /* Sobe até cobrir boa parte */
            left: -50%;
          }
        }
        .animate-wave-fill {
          animation: wave-fill 2.5s ease-in-out infinite alternate;
        }
        .animate-pulse-slow {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}
