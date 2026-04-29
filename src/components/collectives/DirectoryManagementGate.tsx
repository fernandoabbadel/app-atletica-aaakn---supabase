"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchCollectiveAreaUiConfig,
  getDefaultCollectiveAreaUiConfig,
} from "@/lib/collectiveAreaUiService";
import { fetchPrimaryLeagueRecord, type LeagueRecord } from "@/lib/leaguesService";
import { canManageLeagueRole } from "@/lib/leagueRoles";
import { isPlatformMaster } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

type DirectoryManagementGateProps = {
  children: (payload: { leagueId: string; league: LeagueRecord }) => ReactNode;
};

export function DirectoryManagementGate({ children }: DirectoryManagementGateProps) {
  const { user, loading: authLoading } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [managerIds, setManagerIds] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const [directoryRecord, areaConfig] = await Promise.all([
          fetchPrimaryLeagueRecord({
            forceRefresh: true,
            tenantId: tenantId || undefined,
            category: "diretorio",
          }),
          fetchCollectiveAreaUiConfig({
            area: "diretorio",
            tenantId: tenantId || undefined,
          }).catch(() => getDefaultCollectiveAreaUiConfig("diretorio")),
        ]);

        if (!mounted) return;
        setLeague(directoryRecord);
        setManagerIds(
          Array.from(
            new Set([
              ...(directoryRecord?.managerUserIds || []),
              ...(areaConfig.managerUserIds || []),
            ].map((entry) => String(entry || "").trim()).filter(Boolean))
          )
        );
      } catch (error) {
        console.error(error);
        if (!mounted) return;
        setLeague(null);
        setManagerIds([]);
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

  const canAccess = useMemo(() => {
    if (!user?.uid || !league) return false;
    if (isPlatformMaster(user)) return true;
    if (managerIds.includes(user.uid)) return true;
    return (league.membros || []).some(
      (member) => member.id.trim() === user.uid.trim() && canManageLeagueRole(member.cargo)
    );
  }, [league, managerIds, user]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4">
          <Loader2 className="animate-spin text-brand" size={18} />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">Carregando gestão</span>
        </div>
      </div>
    );
  }

  if (!league?.id) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Diretório não configurado</p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">Configure o diretório primeiro</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Antes de abrir a gestão do diretório, defina nome, sigla, logo e gestores na administração do diretório.
          </p>
          <Link
            href={tenantPath("/admin/diretorio")}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase text-brand-accent hover:opacity-90"
          >
            Abrir admin do diretório
          </Link>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-300">
            <ShieldAlert size={24} />
          </div>
          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Acesso restrito</p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">Você não tem acesso a esta gestão</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Somente gestores definidos na página de administração do diretório podem editar esta área.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={tenantPath("/diretorio")}
              className="inline-flex items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 px-5 py-3 text-xs font-black uppercase text-zinc-200 hover:bg-zinc-900"
            >
              Voltar ao diretório
            </Link>
            <Link
              href={tenantPath("/admin/diretorio")}
              className="inline-flex items-center justify-center rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase text-brand-accent hover:opacity-90"
            >
              Ver configuração
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children({ leagueId: league.id, league })}</>;
}
