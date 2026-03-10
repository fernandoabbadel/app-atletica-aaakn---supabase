"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

import { useTenantTheme } from "@/context/TenantThemeContext";

const FRASES = [
  "Afiando o bisturi e os dentes.",
  "Os tubaroes estao revisando Anatomia.",
  "Procurando a veia certa. Aguarde.",
  "Calibrando a mordida para o Intermed.",
  "Mergulhando em um mar de apostilas.",
  "Oxigenando as branqueas para o plantao.",
];

export default function SharkLoader() {
  const { tenantLogoUrl, tenantName } = useTenantTheme();
  const [frase, setFrase] = useState("Carregando...");
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setFrase(FRASES[Math.floor(Math.random() * FRASES.length)]);

    const interval = setInterval(() => {
      setFrase(FRASES[Math.floor(Math.random() * FRASES.length)]);
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
          {!imgError ? (
            <div className="relative w-full h-full">
              <Image
                src={tenantLogoUrl || "/logo.png"}
                alt={`Loading ${tenantName || "Tenant"}`}
                fill
                sizes="80px"
                priority
                className="object-contain drop-shadow-2xl animate-pulse"
                onError={() => setImgError(true)}
              />
            </div>
          ) : (
            <span style={{ fontSize: "3rem", color: "var(--tenant-primary)" }}>U</span>
          )}
        </div>

        <div
          className="absolute left-[-50%] z-10 h-[200%] w-[200%] rounded-[40%] animate-wave-fill"
          style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.22)" }}
        />
        <div
          className="absolute left-[-50%] z-0 h-[200%] w-[200%] rounded-[45%] animate-wave-fill"
          style={{
            backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.12)",
            animationDuration: "4s",
            animationDelay: "1s",
          }}
        />
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
