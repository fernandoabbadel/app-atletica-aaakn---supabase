"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

import { useTenantTheme } from "@/context/TenantThemeContext";

const LOADING_FRASES = [
  "Afiando o bisturi... e os dentes.",
  "Os tubaroes estao revisando Anatomia...",
  "Procurando a veia certa... aguarde.",
  "Estudando Fisiologia antes do proximo sprint.",
  "Calibrando o ambiente para o proximo evento.",
  "Mergulhando em um mar de apostilas.",
  "Oxigenando as branqueas para o plantao.",
  "Esperando o R1 passar a visita.",
  "Consultando o Harrison... um momento.",
  "Nadando contra a corrente (e o sono).",
];

export default function Loading() {
  const { tenantLogoUrl, tenantName } = useTenantTheme();
  const [frase, setFrase] = useState("Carregando...");

  useEffect(() => {
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
      <div
        className="relative mb-8 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-zinc-800 bg-black"
        style={{ boxShadow: "0 0 50px rgb(var(--tenant-primary-rgb) / 0.3)" }}
      >
        <div className="relative z-20 w-20 h-20 flex items-center justify-center">
          <Image
            src={tenantLogoUrl || "/logo.png"}
            alt={`Loading ${tenantName || "Tenant"}`}
            fill
            sizes="80px"
            className="object-contain drop-shadow-2xl animate-pulse-slow"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const span = document.createElement("span");
              span.innerText = "U";
              span.style.fontSize = "3rem";
              span.style.color = "var(--tenant-primary)";
              e.currentTarget.parentElement?.appendChild(span);
            }}
          />
        </div>

        <div
          className="absolute left-0 z-10 h-[200%] w-[200%] rounded-[40%] animate-wave-fill"
          style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.22)" }}
        ></div>
        <div
          className="absolute left-0 z-0 h-[200%] w-[200%] rounded-[45%] animate-wave-fill"
          style={{
            backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.12)",
            animationDuration: "4s",
            animationDelay: "1s",
          }}
        ></div>
      </div>

      <div className="text-center px-6 max-w-sm">
        <h2
          className="mb-3 animate-pulse text-xl font-black uppercase tracking-[0.2em]"
          style={{ color: "var(--tenant-primary)" }}
        >
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
            left: -50%;
          }
          100% {
            transform: rotate(360deg) translateY(0);
            top: 20%;
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
