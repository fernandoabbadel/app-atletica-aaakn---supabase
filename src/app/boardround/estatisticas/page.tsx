"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, CheckCircle2, Building2, XCircle } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchBoardroundAppConfig,
  getDefaultBoardroundAppConfig,
  getBoardroundDisplayName,
} from "../../../lib/boardroundConfigService";
import { withTenantSlug } from "@/lib/tenantRouting";

interface BoardroundStats {
  clinicas: number;
  acertos: number;
  erros: number;
}

const SHARKROUND_STATS_STORAGE_KEY = "sharkround_local_stats_v1";
const SHARKROUND_ALLOWED_ROLES = new Set(["master", "admin_geral", "admin_gestor"]);

export default function BoardroundEstatisticasPage() {
  const { user, loading } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const router = useRouter();
  const boardroundStatsStorageKey = `${SHARKROUND_STATS_STORAGE_KEY}:${tenantId || tenantSlug || "default"}`;
  const boardroundHref = tenantSlug ? withTenantSlug(tenantSlug, "/boardround") : "/boardround";
  const emBreveHref = tenantSlug ? withTenantSlug(tenantSlug, "/em-breve") : "/em-breve";
  const userRole =
    typeof user?.role === "string" ? user.role.toLowerCase().trim() : "guest";
  const canAccessBoardround = SHARKROUND_ALLOWED_ROLES.has(userRole);

  useEffect(() => {
    if (loading) return;
    if (canAccessBoardround) return;
    router.replace(emBreveHref);
  }, [loading, canAccessBoardround, emBreveHref, router]);

  const [stats, setStats] = useState<BoardroundStats>({
    clinicas: 0,
    acertos: 0,
    erros: 0,
  });
  const [displayName, setDisplayName] = useState(
    getBoardroundDisplayName(getDefaultBoardroundAppConfig())
  );

  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      try {
        const config = await fetchBoardroundAppConfig({
          forceRefresh: false,
          tenantId: tenantId || undefined,
        });
        if (mounted) {
          setDisplayName(getBoardroundDisplayName(config));
        }
      } catch {
        if (mounted) {
          setDisplayName(getBoardroundDisplayName(getDefaultBoardroundAppConfig()));
        }
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (loading || !canAccessBoardround) return;
    if (!user?.uid) return;
    const raw = window.localStorage.getItem(
      `${boardroundStatsStorageKey}:${user.uid}`
    );
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<BoardroundStats>;
      setStats({
        clinicas:
          typeof parsed.clinicas === "number" ? Math.max(0, parsed.clinicas) : 0,
        acertos:
          typeof parsed.acertos === "number" ? Math.max(0, parsed.acertos) : 0,
        erros: typeof parsed.erros === "number" ? Math.max(0, parsed.erros) : 0,
      });
    } catch {
      setStats({ clinicas: 0, acertos: 0, erros: 0 });
    }
  }, [user?.uid, loading, canAccessBoardround, boardroundStatsStorageKey]);

  const precision = useMemo(() => {
    const total = stats.acertos + stats.erros;
    if (total === 0) return 0;
    return Math.round((stats.acertos / total) * 100);
  }, [stats.acertos, stats.erros]);

  if (loading || !canAccessBoardround) {
    return (
      <div className="min-h-screen bg-[#050505] text-white font-sans flex items-center justify-center">
        <p className="text-xs text-zinc-500 uppercase font-bold">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href={boardroundHref}
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <BarChart3 size={18} className="text-cyan-400" /> {displayName}
            </h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Resumo local sem leituras extras
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <article className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-[10px] font-bold uppercase text-zinc-500">Clinicas</p>
            <p className="mt-2 text-3xl font-black text-cyan-400 flex items-center gap-2">
              <Building2 size={24} /> {stats.clinicas}
            </p>
          </article>

          <article className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-[10px] font-bold uppercase text-zinc-500">Acertos</p>
            <p className="mt-2 text-3xl font-black text-emerald-400 flex items-center gap-2">
              <CheckCircle2 size={24} /> {stats.acertos}
            </p>
          </article>

          <article className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-[10px] font-bold uppercase text-zinc-500">Erros</p>
            <p className="mt-2 text-3xl font-black text-red-400 flex items-center gap-2">
              <XCircle size={24} /> {stats.erros}
            </p>
          </article>
        </section>

        <section className="mt-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <p className="text-[10px] font-bold uppercase text-zinc-500">Precisao</p>
          <p className="mt-2 text-2xl font-black text-emerald-400">{precision}%</p>
        </section>
      </main>
    </div>
  );
}
