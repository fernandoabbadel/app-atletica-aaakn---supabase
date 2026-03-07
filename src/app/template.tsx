"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";

import { useTenantTheme } from "@/context/TenantThemeContext";

export default function Template({ children }: { children: React.ReactNode }) {
  const { tenantLogoUrl, tenantName } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [frase, setFrase] = useState("");
  const pathname = usePathname();

  useEffect(() => {
    const frases = [
      "Afiando o bisturi e os dentes.",
      "Os tubaroes estao revisando Anatomia.",
      "Procurando a veia certa. Aguarde.",
      "Nadando contra a corrente e o sono.",
      "Consultando o Harrison. Um momento.",
    ];

    setFrase(frases[Math.floor(Math.random() * frases.length)]);
    setLoading(true);

    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [pathname]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center animate-in fade-in duration-300">
        <div className="relative w-40 h-40 rounded-full border-4 border-zinc-800 overflow-hidden bg-black shadow-[0_0_50px_rgba(16,185,129,0.3)] mb-8 flex items-center justify-center">
          <div className="relative z-20 w-28 h-28 flex items-center justify-center">
            <Image
              src={tenantLogoUrl || "/logo.png"}
              alt={`Logo ${tenantName || "Tenant"}`}
              fill
              sizes="112px"
              className="object-contain drop-shadow-2xl"
              priority
            />
          </div>

          <div className="absolute left-[-50%] w-[200%] h-[200%] bg-emerald-600/90 rounded-[40%] animate-wave z-10 top-[100%]" />
        </div>

        <div className="text-center px-6">
          <h2 className="text-emerald-500 font-black text-xl tracking-widest mb-3 animate-pulse">
            CARREGANDO
          </h2>
          <p className="text-zinc-400 text-sm font-medium italic max-w-xs mx-auto leading-relaxed">
            &quot;{frase}&quot;
          </p>
        </div>

        <style jsx>{`
          @keyframes wave {
            0% {
              transform: rotate(0deg);
              top: 100%;
            }
            100% {
              transform: rotate(360deg);
              top: -20%;
            }
          }
          .animate-wave {
            animation: wave 3s ease-in-out forwards;
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
}
