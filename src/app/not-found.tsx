"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";

export default function NotFound() {
  const { tenantLogoUrl, tenantName, tenantSlug } = useTenantTheme();
  const homeHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/";

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
      <div
        className="relative mb-8 flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-4 border-zinc-800 bg-black group"
        style={{ boxShadow: "0 0 50px rgb(var(--tenant-primary-rgb) / 0.28)" }}
      >
        <div className="relative z-20 w-28 h-28 flex items-center justify-center opacity-80 group-hover:scale-110 transition duration-500">
          <Image
            src={tenantLogoUrl || "/logo.png"}
            alt={`Logo ${tenantName || "Tenant"}`}
            width={112}
            height={112}
            className="w-full h-full object-contain drop-shadow-2xl grayscale"
            priority
          />
        </div>

        <div
          className="absolute top-0 left-0 z-10 h-full w-full animate-pulse"
          style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.18)" }}
        ></div>
        <div
          className="absolute bottom-0 left-0 z-0 h-[200%] w-[200%] rounded-[40%] animate-wave-slow"
          style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.16)" }}
        ></div>
      </div>

      <h1 className="text-brand font-black text-6xl mb-2 tracking-tighter">404</h1>
      <h2 className="text-white font-bold text-xl uppercase tracking-widest mb-4">Página não encontrada</h2>
      <p className="text-zinc-400 text-sm font-medium italic max-w-xs mx-auto mb-10 leading-relaxed">
        Não encontramos a rota solicitada no tenant atual.
      </p>

      <Link
        href={homeHref}
        className="brand-button-solid rounded-full px-8 py-3 text-sm group"
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
