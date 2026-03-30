"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";

import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  DEFAULT_LANDING_CONFIG,
  DEFAULT_TENANT_LANDING_CONFIG,
  getStoredLandingConfigSnapshot,
  LANDING_CONFIG_SNAPSHOT_UPDATED_EVENT,
} from "@/lib/adminLandingService";
import { readTenantBrandSnapshot } from "@/lib/tenantBrandSnapshot";

const pickRandomPhrase = (phrases: string[], previous?: string): string => {
  const pool = phrases.filter((entry) => entry.trim().length > 0);
  if (pool.length === 0) return "Carregando...";
  if (pool.length === 1) return pool[0];

  const available = pool.filter((entry) => entry !== previous);
  const source = available.length > 0 ? available : pool;
  const randomIndex = Math.floor(Math.random() * source.length);
  return source[randomIndex] || pool[0];
};

export default function Template({ children }: { children: React.ReactNode }) {
  const { tenantId, tenantLogoUrl, tenantName } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [frase, setFrase] = useState("");
  const pathname = usePathname();
  const snapshot = readTenantBrandSnapshot();
  const resolvedTenantName = tenantName || snapshot?.tenantName || snapshot?.tenantSigla || "USC";
  const resolvedTenantLogo =
    tenantLogoUrl || snapshot?.tenantLogoUrl || PLATFORM_LOGO_URL;

  const resolvedLogo =
    !resolvedTenantName || resolvedTenantName.trim().toUpperCase() === "USC"
      ? PLATFORM_LOGO_URL
      : resolvedTenantLogo;

  useEffect(() => {
    const snapshotTenantId = snapshot?.tenantId || tenantId;
    const fallbackConfig = snapshotTenantId
      ? DEFAULT_TENANT_LANDING_CONFIG
      : DEFAULT_LANDING_CONFIG;
    const storedConfig = getStoredLandingConfigSnapshot({
      tenantId: snapshotTenantId,
      fallbackConfig,
    });
    const nextPhrases =
      storedConfig?.loadingPhrases?.length
        ? storedConfig.loadingPhrases
        : fallbackConfig.loadingPhrases;

    setFrase((previous) => pickRandomPhrase(nextPhrases, previous));
    setLoading(true);

    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [pathname, snapshot?.tenantId, tenantId]);

  useEffect(() => {
    const handleSnapshotUpdate = () => {
      const snapshotTenantId = readTenantBrandSnapshot()?.tenantId || tenantId;
      const fallbackConfig = snapshotTenantId
        ? DEFAULT_TENANT_LANDING_CONFIG
        : DEFAULT_LANDING_CONFIG;
      const storedConfig = getStoredLandingConfigSnapshot({
        tenantId: snapshotTenantId,
        fallbackConfig,
      });
      const nextPhrases =
        storedConfig?.loadingPhrases?.length
          ? storedConfig.loadingPhrases
          : fallbackConfig.loadingPhrases;

      setFrase((previous) => pickRandomPhrase(nextPhrases, previous));
    };

    window.addEventListener(
      LANDING_CONFIG_SNAPSHOT_UPDATED_EVENT,
      handleSnapshotUpdate as EventListener
    );
    return () => {
      window.removeEventListener(
        LANDING_CONFIG_SNAPSHOT_UPDATED_EVENT,
        handleSnapshotUpdate as EventListener
      );
    };
  }, [tenantId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050505] flex flex-col items-center justify-center animate-in fade-in duration-300">
        <div
          className="relative mb-8 flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-4 border-zinc-800 bg-black"
          style={{ boxShadow: "0 0 50px rgb(var(--tenant-primary-rgb) / 0.3)" }}
        >
          <div className="relative z-20 w-28 h-28 flex items-center justify-center">
            <Image
              src={resolvedLogo}
              alt={`Logo ${resolvedTenantName || "Plataforma"}`}
              fill
              sizes="112px"
              className="object-contain drop-shadow-2xl"
              priority
              unoptimized={resolvedLogo.startsWith("http")}
            />
          </div>

          <div
            className="absolute left-[-50%] top-[100%] z-10 h-[200%] w-[200%] rounded-[40%] animate-wave"
            style={{ backgroundColor: "rgb(var(--tenant-primary-rgb) / 0.9)" }}
          />
        </div>

        <div className="text-center px-6">
          <h2
            className="mb-3 animate-pulse text-xl font-black tracking-widest"
            style={{ color: "var(--tenant-primary)" }}
          >
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
