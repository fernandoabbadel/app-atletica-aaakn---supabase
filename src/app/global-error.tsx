"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const BRAND_SNAPSHOT_KEY = "usc_active_tenant_brand";
const CHUNK_RELOAD_KEY = "usc_global_chunk_reload_once";

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  const [logoUrl, setLogoUrl] = useState("/logo.png");
  const [tenantName, setTenantName] = useState("USC");
  const isChunkLoadError = useMemo(
    () => /chunkloaderror|loading chunk/i.test(`${error.name || ""} ${error.message || ""}`),
    [error.message, error.name]
  );
  const isRemoteLogo = /^https?:\/\//i.test(logoUrl);

  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  useEffect(() => {
    if (typeof window === "undefined" || !isChunkLoadError) return;
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, [isChunkLoadError]);

  useEffect(() => {
    if (typeof window === "undefined" || isChunkLoadError) return;
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // ignora falha de storage
    }
  }, [isChunkLoadError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(BRAND_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        tenantLogoUrl?: unknown;
        tenantName?: unknown;
      };
      if (typeof parsed.tenantLogoUrl === "string" && parsed.tenantLogoUrl.trim()) {
        setLogoUrl(parsed.tenantLogoUrl.trim());
      }
      if (typeof parsed.tenantName === "string" && parsed.tenantName.trim()) {
        setTenantName(parsed.tenantName.trim());
      }
    } catch {
      // ignora falha de storage
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (isChunkLoadError && typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // ignora falha de storage
      }
      window.location.reload();
      return;
    }

    reset();
  }, [isChunkLoadError, reset]);

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-[#140900] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-600/20 via-[#140900] to-black z-0" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full">
          <div className="relative w-40 h-40 rounded-full border-4 border-orange-500/40 overflow-hidden bg-black shadow-[0_0_70px_rgba(251,146,60,0.25)] mb-8 flex items-center justify-center">
            <div className="relative z-20 w-24 h-24 flex items-center justify-center">
              <Image
                src={logoUrl}
                alt={`Logo ${tenantName}`}
                fill
                sizes="96px"
                className="object-contain drop-shadow-2xl"
                priority
                unoptimized={isRemoteLogo}
              />
            </div>

            <div className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-500/25 rounded-[40%] animate-wave-fill z-10" />
            <div
              className="absolute left-[-50%] w-[200%] h-[200%] bg-orange-400/20 rounded-[45%] animate-wave-fill z-0"
              style={{ animationDuration: "4s", animationDelay: "1s" }}
            />
          </div>

          <h1 className="text-3xl font-black uppercase tracking-wider text-orange-400 flex items-center gap-2 mb-2">
            <AlertTriangle size={24} /> Falha Critica
          </h1>
          <p className="text-zinc-300 text-sm mb-8">
            {isChunkLoadError
              ? "Os arquivos da aplicacao demoraram para carregar. Vamos tentar recarregar tudo."
              : "Ocorreu um erro global inesperado. Reinicie esta tela."}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-black text-xs uppercase transition"
            >
              <RefreshCcw size={16} /> {isChunkLoadError ? "Recarregar app" : "Tentar de novo"}
            </button>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-black text-xs uppercase transition"
            >
              Ir para dashboard
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
      </body>
    </html>
  );
}
