"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  CalendarRange,
  ChevronRight,
  Loader2,
  MapPin,
  Trophy,
} from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  fetchHistoricEvents,
  fetchHistoryPageConfig,
  type HistoricEventRecord,
  type HistoryPageConfig,
} from "../../lib/historyService";

type HistoricEvent = HistoricEventRecord;
type PageConfig = HistoryPageConfig;

type LandingBrandPayload = {
  brand?: {
    logoUrl?: string;
    sigla?: string;
  };
};

const INITIAL_CONFIG: PageConfig = {
  tituloPagina: "Nossa Historia",
  subtituloPagina: "Carregando legado...",
  fotoCapa: "",
};

export default function HistoricoPage() {
  const pathname = usePathname() || "/historico";
  const pathInfo = useMemo(() => parseTenantScopedPath(pathname), [pathname]);
  const routeTenantSlug = pathInfo.tenantSlug;
  const backHref = routeTenantSlug ? withTenantSlug(routeTenantSlug, "/") : "/";

  const { tenantLogoUrl, tenantSigla } = useTenantTheme();
  const [events, setEvents] = useState<HistoricEvent[]>([]);
  const [config, setConfig] = useState<PageConfig>(INITIAL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandSigla, setBrandSigla] = useState("");

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      try {
        const [configData, eventsData] = await Promise.all([
          fetchHistoryPageConfig(),
          fetchHistoricEvents({ order: "asc", maxResults: 200 }),
        ]);

        if (!mounted) return;
        if (configData) {
          setConfig(configData);
        }
        setEvents(eventsData);
      } catch (error: unknown) {
        console.error("Erro ao carregar historico:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadBrand = async () => {
      if (!routeTenantSlug) {
        setBrandLogoUrl(tenantLogoUrl || "/logo.png");
        setBrandSigla(tenantSigla || "USC");
        return;
      }

      try {
        const response = await fetch(
          `/api/public/landing?tenant=${encodeURIComponent(routeTenantSlug)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(`Falha ao carregar marca publica: ${response.status}`);
        }

        const payload = (await response.json()) as LandingBrandPayload;
        if (!mounted) return;

        const nextLogo =
          typeof payload.brand?.logoUrl === "string" && payload.brand.logoUrl.trim()
            ? payload.brand.logoUrl.trim()
            : tenantLogoUrl || "/logo.png";
        const nextSigla =
          typeof payload.brand?.sigla === "string" && payload.brand.sigla.trim()
            ? payload.brand.sigla.trim()
            : tenantSigla || routeTenantSlug.toUpperCase();

        setBrandLogoUrl(nextLogo);
        setBrandSigla(nextSigla);
      } catch (error: unknown) {
        console.error("Erro ao carregar marca publica do tenant:", error);
        if (!mounted) return;
        setBrandLogoUrl(tenantLogoUrl || "/logo.png");
        setBrandSigla(tenantSigla || routeTenantSlug.toUpperCase());
      }
    };

    void loadBrand();
    return () => {
      mounted = false;
    };
  }, [routeTenantSlug, tenantLogoUrl, tenantSigla]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] text-brand">
        <Loader2 className="animate-spin" size={48} />
        <p className="text-xs font-black uppercase tracking-widest animate-pulse">
          Resgatando arquivos...
        </p>
      </div>
    );
  }

  const heroLogoUrl = brandLogoUrl || tenantLogoUrl || "/logo.png";
  const heroSigla = brandSigla || tenantSigla || "USC";
  const titleParts = config.tituloPagina.trim().split(/\s+/).filter(Boolean);
  const lastWord = titleParts.pop() || "Historia";
  const firstWords = titleParts.join(" ");

  return (
    <div className="min-h-screen bg-[#050505] pb-32 font-sans text-white selection:bg-brand-primary/30">
      <div className="relative flex h-72 w-full items-center justify-center overflow-hidden bg-zinc-900 group">
        {config.fotoCapa ? (
          <div className="absolute inset-0 z-0">
            <Image
              src={config.fotoCapa}
              alt="Capa da pagina de historico"
              fill
              sizes="100vw"
              className="object-cover opacity-40 transition duration-1000 group-hover:scale-105"
              unoptimized={config.fotoCapa.startsWith("http")}
            />
          </div>
        ) : null}

        <div className="absolute inset-0 z-10 bg-gradient-to-b from-transparent via-[#050505]/60 to-[#050505]" />

        <div className="relative z-20 flex flex-col items-center px-4 text-center animate-in zoom-in-50 duration-700">
          <div className="relative mb-4 h-24 w-24 rounded-full border-4 border-brand bg-black/50 p-4 shadow-brand-strong backdrop-blur-xl md:h-32 md:w-32">
            <Image
              src={heroLogoUrl}
              alt={`Logo ${heroSigla}`}
              fill
              sizes="(max-width: 768px) 96px, 128px"
              className="object-contain p-1 drop-shadow-xl"
              priority
              unoptimized={heroLogoUrl.startsWith("http")}
            />
          </div>

          <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white drop-shadow-xl md:text-4xl">
            {firstWords ? `${firstWords} ` : ""}
            <span className="text-brand">{lastWord}</span>
          </h1>
          <p className="mt-2 max-w-lg text-xs font-medium text-zinc-400 md:text-sm">
            {config.subtituloPagina}
          </p>
        </div>

        <div className="absolute left-6 top-6 z-30">
          <Link
            href={backHref}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-brand-solid hover:text-black active:scale-95"
          >
            <ArrowLeft size={20} />
          </Link>
        </div>
      </div>

      <div className="relative mx-auto mt-8 max-w-4xl px-4">
        <div className="absolute bottom-0 left-4 top-0 w-0.5 bg-gradient-to-b from-brand-solid via-zinc-800 to-transparent md:left-1/2" />

        <div className="space-y-12">
          {events.length === 0 ? (
            <div className="py-20 text-center text-zinc-600">
              <p className="text-base font-black uppercase italic">
                Nenhuma historia contada ainda...
              </p>
            </div>
          ) : (
            events.map((event, index) => {
              const isEven = index % 2 === 0;

              return (
                <div
                  key={event.id}
                  className={`relative flex flex-col items-start md:flex-row md:items-center ${
                    isEven ? "md:flex-row-reverse" : ""
                  }`}
                >
                  <div className="absolute left-4 z-10 mt-1.5 h-3 w-3 -translate-x-[5px] rounded-full border-2 border-black bg-brand-solid shadow-brand md:left-1/2 md:mt-0 md:-translate-x-1/2" />

                  <div
                    className={`w-full pl-10 md:w-1/2 md:pl-0 ${
                      isEven ? "md:pr-12" : "md:pl-12"
                    }`}
                  >
                    <div className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-xl backdrop-blur-sm transition duration-300 hover:border-brand">
                      {event.foto ? (
                        <div className="relative h-52 w-full overflow-hidden bg-zinc-950">
                          <Image
                            src={event.foto}
                            alt={event.titulo}
                            fill
                            sizes="(max-width: 768px) 100vw, 50vw"
                            className="object-cover transition duration-700 group-hover:scale-105"
                            unoptimized={event.foto.startsWith("http")}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
                        </div>
                      ) : null}

                      <div className="space-y-4 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-brand">
                              {event.ano}
                            </p>
                            <h2 className="text-xl font-black uppercase tracking-tight text-white">
                              {event.titulo}
                            </h2>
                          </div>

                          <div className="rounded-full border border-brand bg-brand-primary/10 p-2 text-brand">
                            <Trophy size={16} />
                          </div>
                        </div>

                        {event.descricao ? (
                          <p className="text-sm leading-relaxed text-zinc-300">
                            {event.descricao}
                          </p>
                        ) : null}

                        <div className="grid gap-2 text-[11px] font-bold uppercase tracking-wide text-zinc-400 md:grid-cols-3">
                          <div className="flex items-center gap-2">
                            <Calendar size={13} className="text-brand" />
                            <span>{event.data || "Data a definir"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin size={13} className="text-brand" />
                            <span>{event.local || "Local a definir"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CalendarRange size={13} className="text-brand" />
                            <span>{event.ano}</span>
                          </div>
                        </div>

                        <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-brand">
                          Linha do tempo
                          <ChevronRight size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
