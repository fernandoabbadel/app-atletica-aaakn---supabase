"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Heart, Loader2, Settings2, Sparkles, Users } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { fetchCollectiveAreaUiConfig, getDefaultCollectiveAreaUiConfig, type CollectiveAreaKey } from "@/lib/collectiveAreaUiService";
import {
  fetchLeagueSummaries,
  fetchUserLeagueInteractionState,
  resolveLikedLeagueIdsFromUserExtra,
  toggleUserLeagueLike,
  type LeagueCategory,
  type LeagueRecord,
} from "@/lib/leaguesService";
import { canManageLeagueRole } from "@/lib/leagueRoles";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import {
  fetchStoreProductStatsBySellers,
  type StoreSellerProductStats,
} from "@/lib/storePublicService";
import { withTenantSlug } from "@/lib/tenantRouting";
import { fetchTurmaMemberCounts } from "@/lib/turmasService";

type CollectiveCatalogConfig = {
  area: CollectiveAreaKey;
  category: LeagueCategory;
  basePath: string;
  adminPath: string;
};

const CATALOG_CONFIG: Record<CollectiveAreaKey, CollectiveCatalogConfig> = {
  comissoes: {
    area: "comissoes",
    category: "comissao",
    basePath: "/comissoes",
    adminPath: "/admin/comissoes",
  },
  diretorio: {
    area: "diretorio",
    category: "diretorio",
    basePath: "/diretorio",
    adminPath: "/admin/diretorio",
  },
};

const getCardImage = (league?: LeagueRecord | null) =>
  league?.foto?.trim() || resolveLeagueLogoSrc(league, "/placeholder_liga.png");

const EMPTY_PRODUCT_STATS: StoreSellerProductStats = {
  sellerId: "",
  soldCount: 0,
  exposedCount: 0,
  likesCount: 0,
};

export function CollectiveCatalogPage({ area }: { area: CollectiveAreaKey }) {
  const config = CATALOG_CONFIG[area];
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LeagueRecord[]>([]);
  const [turmaMemberCounts, setTurmaMemberCounts] = useState<Record<string, number>>({});
  const [productStatsBySeller, setProductStatsBySeller] = useState<Record<string, StoreSellerProductStats>>({});
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [togglingLikeIds, setTogglingLikeIds] = useState<string[]>([]);
  const [uiConfig, setUiConfig] = useState(() => getDefaultCollectiveAreaUiConfig(area));

  const tenantPath = (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path);

  useEffect(() => {
    setUiConfig(getDefaultCollectiveAreaUiConfig(area));
  }, [area]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const [nextRecords, nextUiConfig] = await Promise.all([
          fetchLeagueSummaries({
            orderByField: "nome",
            orderDirection: "asc",
            maxResults: 120,
            forceRefresh: true,
            tenantId: tenantId || undefined,
            category: config.category,
          }),
          fetchCollectiveAreaUiConfig({
            area,
            tenantId: tenantId || undefined,
          }),
        ]);

        if (!mounted) return;
        const visibleRecords = nextRecords.filter((item) => item.visivel !== false);
        setRecords(visibleRecords);
        setUiConfig(nextUiConfig);

        if (area === "comissoes") {
          try {
            const [counts, sellerStats] = await Promise.all([
              fetchTurmaMemberCounts({
                tenantId: tenantId || undefined,
                forceRefresh: true,
                turmaIds: visibleRecords
                  .map((item) => item.turmaId || "")
                  .filter((item): item is string => item.trim().length > 0),
              }),
              fetchStoreProductStatsBySellers({
                tenantId: tenantId || undefined,
                forceRefresh: true,
                seller: {
                  type: "league",
                  ids: visibleRecords.map((item) => item.id),
                },
              }),
            ]);
            if (mounted) {
              setTurmaMemberCounts(counts);
              setProductStatsBySeller(sellerStats);
            }
          } catch (error) {
            console.error(error);
            if (mounted) {
              setTurmaMemberCounts({});
              setProductStatsBySeller({});
            }
          }
        } else if (mounted) {
          setTurmaMemberCounts({});
          setProductStatsBySeller({});
        }
      } catch (error) {
        console.error(error);
        if (!mounted) return;
        setRecords([]);
        setTurmaMemberCounts({});
        setProductStatsBySeller({});
        setUiConfig(getDefaultCollectiveAreaUiConfig(area));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [area, config.category, tenantId]);

  const publishedCount = useMemo(
    () => records.filter((entry) => entry.visivel !== false).length,
    [records]
  );
  const orderedRecords = useMemo(() => {
    if (area !== "comissoes") return records;

    return [...records].sort((left, right) => {
      const leftStats = productStatsBySeller[left.id] || EMPTY_PRODUCT_STATS;
      const rightStats = productStatsBySeller[right.id] || EMPTY_PRODUCT_STATS;
      if (leftStats.soldCount !== rightStats.soldCount) {
        return rightStats.soldCount - leftStats.soldCount;
      }
      if (leftStats.exposedCount !== rightStats.exposedCount) {
        return rightStats.exposedCount - leftStats.exposedCount;
      }
      if ((left.likes || 0) !== (right.likes || 0)) {
        return (right.likes || 0) - (left.likes || 0);
      }
      return (left.nome || "").localeCompare(right.nome || "", "pt-BR");
    });
  }, [area, productStatsBySeller, records]);

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <section className="relative overflow-hidden border-b border-white/5 px-6 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.15),transparent_28%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={tenantPath("/dashboard")} className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 hover:bg-zinc-900">
              <ArrowLeft size={14} />
              Dashboard
            </Link>
            {area === "diretorio" && user ? (
              <Link href={tenantPath(config.adminPath)} className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-brand-accent hover:opacity-90">
                <Settings2 size={14} />
                Gerenciar
              </Link>
            ) : null}
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              {area !== "comissoes" ? (
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-brand-accent">{uiConfig.rotuloCard}</p>
              ) : null}
              <h1 className="mt-4 text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">
                {uiConfig.titulo}
              </h1>
              <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-zinc-300 sm:text-base">
                {uiConfig.subtitulo}
              </p>
            </div>

            {area !== "comissoes" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.6rem] border border-white/10 bg-zinc-950/80 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Páginas ativas</p>
                  <p className="mt-3 text-3xl font-black text-white">{publishedCount}</p>
                </div>
                <div className="rounded-[1.6rem] border border-brand/30 bg-brand-soft p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-accent">Identidade</p>
                  <p className="mt-3 text-lg font-black text-white">{uiConfig.sidebarLabel}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-[2rem] border border-zinc-800 bg-zinc-950/80">
            <Loader2 size={22} className="animate-spin text-brand" />
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-10 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-zinc-500">Nada publicado ainda</p>
            <h2 className="mt-3 text-2xl font-black text-white">Esta área ainda está sendo montada</h2>
            <p className="mt-3 text-sm text-zinc-400">Assim que as páginas forem publicadas, elas vão aparecer aqui.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {orderedRecords.map((record) => {
              const href = tenantPath(`${config.basePath}/${record.id}`);
              const imageSrc = getCardImage(record);
              const productStats = productStatsBySeller[record.id] || EMPTY_PRODUCT_STATS;
              const displayMembersCount =
                area === "comissoes" && record.turmaId
                  ? turmaMemberCounts[record.turmaId] ?? record.membersCount ?? record.membros?.length ?? 0
                  : record.membersCount ?? record.membros?.length ?? 0;
              const managementMembersCount = (record.membros || []).filter((member) =>
                canManageLeagueRole(member.cargo)
              ).length;
              return (
                <article key={record.id} className="group overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/85 shadow-[0_24px_70px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-brand/30">
                  <div className="relative h-52 w-full overflow-hidden">
                    <Image src={imageSrc} alt={record.nome} fill sizes="420px" className="object-cover transition duration-500 group-hover:scale-[1.04]" />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.82))]" />
                    <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
                      <span className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">
                        {uiConfig.rotuloCard}
                      </span>
                      {record.turmaId ? (
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
                          {record.turmaId}
                        </span>
                      ) : null}
                    </div>
                    <div className="absolute inset-x-4 bottom-4">
                      <h2 className="text-2xl font-black uppercase tracking-tight text-white">{record.nome}</h2>
                      <p className="mt-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">
                        {record.sigla || uiConfig.sidebarLabel}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <p className="text-sm leading-6 text-zinc-300">
                      {record.descricao || `${uiConfig.rotuloCard} oficial com identidade, membros e agenda própria.`}
                    </p>

                    {record.bizu ? (
                      <div className="rounded-[1.4rem] border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">Bizu</p>
                        <p className="mt-2 text-sm text-amber-50/90">{record.bizu}</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                        <Users size={14} />
                        {displayMembersCount} membros
                      </span>
                      {area === "comissoes" ? (
                        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                          <Sparkles size={14} />
                          {managementMembersCount} da diretoria
                        </span>
                      ) : record.visaoGeral ? (
                        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                          <Sparkles size={14} />
                          Visão geral ativa
                        </span>
                      ) : null}
                      {area === "comissoes" ? (
                        <>
                          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                            {productStats.soldCount} vendidos
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                            {productStats.exposedCount} expostos
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] font-bold text-zinc-300">
                            {record.likes || 0} curtidas
                          </span>
                        </>
                      ) : null}
                    </div>

                    <div className="flex gap-3">
                      <Link href={href} className="brand-button-solid flex-1 justify-center">
                        Abrir página
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
