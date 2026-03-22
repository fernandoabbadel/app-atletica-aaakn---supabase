"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import {
  DEFAULT_LANDING_CONFIG,
  fetchLandingConfig,
  getStoredLandingConfigSnapshot,
} from "@/lib/adminLandingService";
import { readTenantBrandSnapshot } from "@/lib/tenantBrandSnapshot";

type LoadingBrandState = {
  tenantId: string;
  tenantName: string;
  tenantLogoUrl: string;
};

const DEFAULT_BRAND: LoadingBrandState = {
  tenantId: "",
  tenantName: "USC",
  tenantLogoUrl: PLATFORM_LOGO_URL,
};

const pickRandomPhrase = (phrases: string[], previous?: string): string => {
  const pool = phrases.filter((entry) => entry.trim().length > 0);
  if (pool.length === 0) return "Carregando...";
  if (pool.length === 1) return pool[0];

  const available = pool.filter((entry) => entry !== previous);
  const source = available.length > 0 ? available : pool;
  const randomIndex = Math.floor(Math.random() * source.length);
  return source[randomIndex] || pool[0];
};

export default function Loading() {
  const [brand, setBrand] = useState<LoadingBrandState>(DEFAULT_BRAND);
  const [phrases, setPhrases] = useState<string[]>(DEFAULT_LANDING_CONFIG.loadingPhrases);
  const [frase, setFrase] = useState("Carregando...");
  const resolvedLogo =
    !brand.tenantName || brand.tenantName.trim().toUpperCase() === "USC"
      ? PLATFORM_LOGO_URL
      : brand.tenantLogoUrl || PLATFORM_LOGO_URL;

  useEffect(() => {
    const snapshot = readTenantBrandSnapshot();
    const nextBrand: LoadingBrandState = snapshot
      ? {
          tenantId: snapshot.tenantId,
          tenantName: snapshot.tenantName || snapshot.tenantSigla || "Tenant",
          tenantLogoUrl: snapshot.tenantLogoUrl || PLATFORM_LOGO_URL,
        }
      : DEFAULT_BRAND;

    setBrand(nextBrand);

    const storedConfig = getStoredLandingConfigSnapshot({
      tenantId: nextBrand.tenantId,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
    });
    if (storedConfig?.loadingPhrases?.length) {
      setPhrases(storedConfig.loadingPhrases);
    }

    let mounted = true;
    if (!nextBrand.tenantId) {
      return () => {
        mounted = false;
      };
    }

    void fetchLandingConfig({
      tenantId: nextBrand.tenantId,
      fallbackConfig: DEFAULT_LANDING_CONFIG,
    })
      .then((config) => {
        if (!mounted || !config.loadingPhrases.length) return;
        setPhrases(config.loadingPhrases);
      })
      .catch(() => {
        // mantem o fallback em memoria/localStorage
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setFrase((previous) => pickRandomPhrase(phrases, previous));

    const interval = setInterval(() => {
      setFrase((previous) => pickRandomPhrase(phrases, previous));
    }, 2500);

    return () => clearInterval(interval);
  }, [phrases]);

  return (
    <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center">
      <div
        className="relative mb-8 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-zinc-800 bg-black"
        style={{ boxShadow: "0 0 50px rgb(var(--tenant-primary-rgb) / 0.3)" }}
      >
        <div className="relative z-20 w-20 h-20 flex items-center justify-center">
          <Image
            src={resolvedLogo}
            alt={`Loading ${brand.tenantName || "Plataforma"}`}
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
            unoptimized={resolvedLogo.startsWith("http")}
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
