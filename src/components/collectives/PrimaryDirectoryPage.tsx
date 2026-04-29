"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Settings2 } from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { fetchPrimaryLeagueRecord } from "@/lib/leaguesService";
import { withTenantSlug } from "@/lib/tenantRouting";
import { CollectivePublicDetailClient } from "./CollectivePublicDetailClient";

type PrimaryDirectoryTab = "overview" | "membros" | "agenda" | "loja";

export function PrimaryDirectoryPage({ activeTab }: { activeTab: PrimaryDirectoryTab }) {
  const { tenantId, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [leagueId, setLeagueId] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const record = await fetchPrimaryLeagueRecord({
          forceRefresh: true,
          tenantId: tenantId || undefined,
          category: "diretorio",
        });
        if (!mounted) return;
        setLeagueId(record?.id || "");
      } catch (error) {
        console.error(error);
        if (!mounted) return;
        setLeagueId("");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const tenantPath = (path: string) => (tenantSlug ? withTenantSlug(tenantSlug, path) : path);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4">
          <Loader2 className="animate-spin text-brand" size={18} />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">Carregando diretório</span>
        </div>
      </div>
    );
  }

  if (!leagueId) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Diretório não configurado</p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">Essa área ainda não foi publicada</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Assim que o diretório for configurado na gestão, a página pública aparecerá aqui.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={tenantPath("/dashboard")}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-5 py-3 text-xs font-black uppercase text-zinc-200 hover:bg-zinc-900"
            >
              <ArrowLeft size={14} />
              Dashboard
            </Link>
            <Link
              href={tenantPath("/admin/diretorio")}
              className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase text-brand-accent hover:opacity-90"
            >
              <Settings2 size={14} />
              Configurar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CollectivePublicDetailClient
      area="diretorio"
      leagueId={leagueId}
      activeTab={activeTab}
      pathMode="root"
      managementHrefOverride="/diretorio/configurar"
      backHrefOverride="/dashboard"
    />
  );
}
