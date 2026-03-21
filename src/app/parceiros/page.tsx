"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Crown,
  Loader2,
  Search,
  Shield,
  Star,
} from "lucide-react";

import { fetchPublicPartners, type PartnerRecord } from "../../lib/partnersPublicService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { resolveTenantBrandLabel } from "@/lib/tenantBranding";
import { withTenantSlug } from "@/lib/tenantRouting";

interface TierSection {
  id: "ouro" | "prata" | "standard";
  title: string;
  subtitle: string;
}

const TIER_SECTIONS: TierSection[] = [
  { id: "ouro", title: "Plano Ouro", subtitle: "Maior destaque" },
  { id: "prata", title: "Plano Prata", subtitle: "Destaque medio" },
  { id: "standard", title: "Plano Standard", subtitle: "Todos os parceiros" },
];

const tierBadgeClass: Record<string, string> = {
  ouro: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  prata: "bg-zinc-500/20 text-zinc-200 border-zinc-500/30",
  standard: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export default function ParceirosPage() {
  const { tenantId: activeTenantId, tenantSigla, tenantName, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PartnerRecord[]>([]);
  const brandLabel = resolveTenantBrandLabel(tenantSigla, tenantName);
  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  const empresaHref = tenantSlug ? withTenantSlug(tenantSlug, "/empresa") : "/empresa";

  useEffect(() => {
    let mounted = true;

    const loadPartners = async () => {
      try {
        const data = await fetchPublicPartners({
          maxResults: 240,
          forceRefresh: false,
          tenantId: activeTenantId || undefined,
        });
        if (mounted) setRows(data);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadPartners();

    return () => {
      mounted = false;
    };
  }, [activeTenantId]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const base = `${row.nome} ${row.categoria} ${row.descricao}`.toLowerCase();
      return base.includes(term);
    });
  }, [rows, search]);

  const grouped = useMemo(() => {
    return {
      ouro: filteredRows.filter((row) => row.tier === "ouro"),
      prata: filteredRows.filter((row) => row.tier === "prata"),
      standard: filteredRows.filter((row) => row.tier === "standard"),
    };
  }, [filteredRows]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="p-6 sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <Link
              href={dashboardHref}
              className="bg-zinc-900 p-2.5 rounded-full hover:bg-zinc-800 border border-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-400" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                Parceiros {brandLabel}
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">Beneficios por plano</p>
            </div>
          </div>

          <Link
            href={empresaHref}
            className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-[11px] uppercase font-black text-zinc-300 hover:bg-zinc-800"
          >
            Area Empresa
          </Link>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar parceiro..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500"
          />
        </div>
      </header>

      <main className="p-6 space-y-8 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-zinc-400 py-16">
            <Loader2 size={18} className="animate-spin" /> Carregando parceiros...
          </div>
        ) : (
          <>
            {TIER_SECTIONS.map((section) => {
              const sectionRows = grouped[section.id];
              const titleIcon =
                section.id === "ouro" ? (
                  <Crown size={16} className="text-yellow-400" />
                ) : section.id === "prata" ? (
                  <Shield size={16} className="text-zinc-300" />
                ) : (
                  <Star size={16} className="text-emerald-400" />
                );

              return (
                <section key={section.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {titleIcon}
                      <h2 className="font-black uppercase text-sm tracking-wider">{section.title}</h2>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-zinc-500">
                      {section.subtitle} • {sectionRows.length}
                    </span>
                  </div>

                  {sectionRows.length === 0 ? (
                    <div className="border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-xs text-zinc-500">
                      Nenhum parceiro neste plano.
                    </div>
                  ) : (
                    <div
                      className={`grid gap-4 ${
                        section.id === "ouro"
                          ? "grid-cols-1 md:grid-cols-2"
                          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                      }`}
                    >
                      {sectionRows.map((row) => (
                        <Link
                          key={row.id}
                          href={tenantSlug ? withTenantSlug(tenantSlug, `/parceiros/${row.id}`) : `/parceiros/${row.id}`}
                          className="group bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/40 transition"
                        >
                          <div className="relative h-40 bg-black">
                            {row.imgCapa ? (
                              <Image
                                src={row.imgCapa}
                                alt={row.nome}
                                fill
                                className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition duration-500"
                                
                              />
                            ) : (
                              <div className="w-full h-full bg-zinc-950" />
                            )}
                            <span
                              className={`absolute top-3 left-3 px-2 py-1 text-[10px] font-black uppercase rounded border ${tierBadgeClass[row.tier]}`}
                            >
                              {row.tier}
                            </span>
                          </div>
                          <div className="p-4 space-y-1">
                            <h3 className="font-black text-white line-clamp-1">{row.nome}</h3>
                            <p className="text-[11px] uppercase font-bold text-zinc-500">
                              {row.categoria || "Parceiro"}
                            </p>
                            <p className="text-xs text-zinc-400 line-clamp-2">
                              {row.descricao || "Beneficios exclusivos para associados."}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
