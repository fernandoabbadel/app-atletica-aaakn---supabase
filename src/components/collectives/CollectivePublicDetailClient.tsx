"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Globe2,
  Heart,
  Instagram,
  Lightbulb,
  Link2,
  Linkedin,
  Loader2,
  MessageCircleMore,
  Music4,
  Settings2,
  ShoppingBag,
  Users,
  Wallet,
  Youtube,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { fetchCollectiveAreaUiConfig, getDefaultCollectiveAreaUiConfig, type CollectiveAreaKey } from "@/lib/collectiveAreaUiService";
import { logActivity } from "@/lib/logger";
import {
  fetchUserLeagueInteractionState,
  fetchLeagueById,
  isLeagueCategory,
  resolveFollowedLeagueIdsFromUserExtra,
  resolveLikedLeagueIdsFromUserExtra,
  submitLeagueMemberRequest,
  toggleUserLeagueFollow,
  toggleUserLeagueLike,
  type LeagueCategory,
  type LeagueRecord,
} from "@/lib/leaguesService";
import { fetchStoreCategories, fetchStoreProductsBySeller } from "@/lib/storePublicService";
import { parseEventDateTimeMs } from "@/lib/eventDateUtils";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import {
  canManageLeagueRole,
  DEFAULT_LEAGUE_ROLE,
  LEAGUE_ROLE_OPTIONS,
  resolveLeagueRoleLabel,
  sortLeagueMembersByRole,
} from "@/lib/leagueRoles";
import { withTenantSlug } from "@/lib/tenantRouting";
import { fetchTurmaMemberCounts } from "@/lib/turmasService";

type CollectivePublicTab = "overview" | "membros" | "agenda" | "loja";

type CollectiveStoreProduct = {
  id: string;
  nome?: string;
  img?: string;
  preco?: number;
  categoria?: string;
  tagLabel?: string;
};

type CollectiveStoreCategory = {
  cover_img?: string;
  logo_url?: string;
  visible?: boolean;
  seller_type?: string;
  seller_id?: string;
};

type CollectivePageConfig = {
  area: CollectiveAreaKey;
  category: LeagueCategory;
  basePath: string;
  adminPath: string;
  headerLabel: string;
  emptyTitle: string;
  emptyDescription: string;
};

const PAGE_CONFIG: Record<CollectiveAreaKey, CollectivePageConfig> = {
  comissoes: {
    area: "comissoes",
    category: "comissao",
    basePath: "/comissoes",
    adminPath: "/admin/comissoes",
    headerLabel: "Representação oficial",
    emptyTitle: "Comissão não encontrada",
    emptyDescription: "A comissão pode ter sido removida ou ainda não estar publicada nesta tenant.",
  },
  diretorio: {
    area: "diretorio",
    category: "diretorio",
    basePath: "/diretorio",
    adminPath: "/admin/diretorio",
    headerLabel: "Estrutura institucional",
    emptyTitle: "Página de diretório não encontrada",
    emptyDescription: "O diretório pode ter sido removido ou ainda não estar publicado nesta tenant.",
  },
};

const getCollectiveImage = (league?: LeagueRecord | null) =>
  league?.foto?.trim() || resolveLeagueLogoSrc(league, "/placeholder_liga.png");

const isLeagueStoreCategory = (
  row: CollectiveStoreCategory | null | undefined,
  leagueId: string
): boolean => {
  const sellerId = String(row?.seller_id || "").trim();
  const sellerType = String(row?.seller_type || "").trim().toLowerCase();
  return sellerId === leagueId && (sellerType === "tenant" || sellerType === "league" || !sellerType);
};

const sortEvents = (events: LeagueRecord["eventos"]) =>
  [...events].sort((left, right) => {
    const leftDate = parseEventDateTimeMs(left.data, left.hora);
    const rightDate = parseEventDateTimeMs(right.data, right.hora);
    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
      return leftDate - rightDate;
    }
    return (left.titulo || "").localeCompare(right.titulo || "", "pt-BR");
  });

const isInternalLeagueEvent = (event: LeagueRecord["eventos"][number]): boolean =>
  String(event.visibility || "").trim().toLowerCase() === "internal";

const getVisibilityLabel = (event: LeagueRecord["eventos"][number]): string =>
  isInternalLeagueEvent(event) ? "Evento interno" : "Aberto ao público";

const formatProductPrice = (value: unknown): string => {
  const price = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(price);
};

const LINK_TYPE_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  site: "Site",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  outro: "Link",
};

const getLinkTypeLabel = (type: unknown): string =>
  LINK_TYPE_LABELS[String(type || "").trim().toLowerCase()] || "Link";

const getLinkIcon = (type: unknown) => {
  switch (String(type || "").trim().toLowerCase()) {
    case "instagram":
      return Instagram;
    case "tiktok":
      return Music4;
    case "youtube":
      return Youtube;
    case "site":
      return Globe2;
    case "whatsapp":
      return MessageCircleMore;
    case "linkedin":
      return Linkedin;
    default:
      return Link2;
  }
};

const hasPaymentInfo = (paymentConfig: LeagueRecord["paymentConfig"]): boolean =>
  Boolean(
    paymentConfig &&
      (paymentConfig.chave?.trim() ||
        paymentConfig.banco?.trim() ||
        paymentConfig.titular?.trim() ||
        paymentConfig.whatsapp?.trim())
  );

export function CollectivePublicDetailClient({
  area,
  leagueId,
  activeTab,
  pathMode = "record",
  managementHrefOverride,
  backHrefOverride,
}: {
  area: CollectiveAreaKey;
  leagueId: string;
  activeTab: CollectivePublicTab;
  pathMode?: "record" | "root";
  managementHrefOverride?: string;
  backHrefOverride?: string;
}) {
  const config = PAGE_CONFIG[area];
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const cleanLeagueId = typeof leagueId === "string" ? leagueId.trim() : "";
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";

  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [uiConfig, setUiConfig] = useState(() => getDefaultCollectiveAreaUiConfig(area));
  const [leagueProducts, setLeagueProducts] = useState<CollectiveStoreProduct[]>([]);
  const [storeCategory, setStoreCategory] = useState<CollectiveStoreCategory | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [requestRole, setRequestRole] = useState<string>(DEFAULT_LEAGUE_ROLE);
  const [submittingMemberRequest, setSubmittingMemberRequest] = useState(false);
  const [togglingLike, setTogglingLike] = useState(false);
  const [turmaMemberCount, setTurmaMemberCount] = useState<number | null>(null);

  const tenantPath = (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path);

  useEffect(() => {
    setUiConfig(getDefaultCollectiveAreaUiConfig(area));
  }, [area]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!cleanLeagueId) {
        if (mounted) {
          setLeague(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      try {
        const nextLeague = await fetchLeagueById(cleanLeagueId, {
          forceRefresh: true,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        const matchesRequestedArea = Boolean(
          nextLeague &&
            (isLeagueCategory(nextLeague, config.category) ||
              (area === "comissoes" && Boolean(nextLeague.turmaId)))
        );
        setLeague(matchesRequestedArea ? nextLeague : null);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) setLeague(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [area, cleanLeagueId, config.category, tenantId]);

  useEffect(() => {
    let mounted = true;

    const loadUiConfig = async () => {
      try {
        const nextConfig = await fetchCollectiveAreaUiConfig({
          area,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setUiConfig(nextConfig);
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        setUiConfig(getDefaultCollectiveAreaUiConfig(area));
      }
    };

    void loadUiConfig();
    return () => {
      mounted = false;
    };
  }, [area, tenantId]);

  useEffect(() => {
    let mounted = true;
    const leagueProductId = league?.id?.trim() || "";
    if (!leagueProductId) {
      setStoreCategory(null);
      return () => {
        mounted = false;
      };
    }

    fetchStoreCategories({
      maxResults: 300,
      forceRefresh: true,
      tenantId: tenantId || undefined,
    })
      .then((rows) => {
        if (!mounted) return;
        const nextCategory =
          (rows as CollectiveStoreCategory[]).find((row) => isLeagueStoreCategory(row, leagueProductId)) || null;
        setStoreCategory(nextCategory);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!mounted) return;
        setStoreCategory(null);
      });

    return () => {
      mounted = false;
    };
  }, [league?.id, tenantId]);

  useEffect(() => {
    let mounted = true;
    const leagueProductId = league?.id?.trim() || "";
    if (!leagueProductId || activeTab !== "loja" || storeCategory?.visible === false) {
      setLeagueProducts([]);
      setLoadingProducts(false);
      return () => {
        mounted = false;
      };
    }

    setLoadingProducts(true);
    fetchStoreProductsBySeller({
      seller: { type: "league", id: leagueProductId },
      tenantId: tenantId || undefined,
      maxResults: 12,
      forceRefresh: true,
    })
      .then((products) => {
        if (!mounted) return;
        setLeagueProducts(products as unknown as CollectiveStoreProduct[]);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!mounted) return;
        setLeagueProducts([]);
      })
      .finally(() => {
        if (mounted) setLoadingProducts(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTab, league?.id, storeCategory?.visible, tenantId]);

  useEffect(() => {
    let mounted = true;
    if (area !== "comissoes" || !league?.turmaId) {
      setTurmaMemberCount(null);
      return () => {
        mounted = false;
      };
    }

    fetchTurmaMemberCounts({
      tenantId: tenantId || undefined,
      forceRefresh: true,
      turmaIds: [league.turmaId],
    })
      .then((counts) => {
        if (!mounted) return;
        setTurmaMemberCount(counts[league.turmaId || ""] ?? 0);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!mounted) return;
        setTurmaMemberCount(null);
      });

    return () => {
      mounted = false;
    };
  }, [area, league?.turmaId, tenantId]);

  useEffect(() => {
    let mounted = true;
    if (!user?.uid) {
      setFollowedIds([]);
      setLikedIds([]);
      return () => {
        mounted = false;
      };
    }

    const fallbackFollowedIds = resolveFollowedLeagueIdsFromUserExtra(user.extra, tenantId);
    const fallbackLikedIds = resolveLikedLeagueIdsFromUserExtra(user.extra, tenantId);
    setFollowedIds(fallbackFollowedIds);
    setLikedIds(fallbackLikedIds);

    const syncInteractionState = async () => {
      try {
        const state = await fetchUserLeagueInteractionState({
          userId: user.uid,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setFollowedIds(state.followedIds);
        setLikedIds(state.likedIds);
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        setFollowedIds(fallbackFollowedIds);
        setLikedIds(fallbackLikedIds);
      }
    };

    void syncInteractionState();
    return () => {
      mounted = false;
    };
  }, [tenantId, user?.uid, user?.extra]);

  const sortedMembers = useMemo(
    () =>
      sortLeagueMembersByRole(league?.membros || []).map((member) => ({
        ...member,
        cargo: resolveLeagueRoleLabel(member.cargo),
      })),
    [league]
  );
  const sortedEvents = useMemo(() => sortEvents(league?.eventos || []), [league]);
  const overviewHighlights = useMemo(
    () =>
      String(league?.visaoGeral || "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    [league?.visaoGeral]
  );
  const presidentName =
    sortedMembers.find((member) => member.cargo.trim().toLowerCase() === "presidente")?.nome || league?.presidente;
  const isLiked = Boolean(league && likedIds.includes(league.id));
  const isFollowing = Boolean(league && followedIds.includes(league.id));
  const currentMemberRequest =
    league?.memberRequests?.find((entry) => entry.userId.trim() === (user?.uid || "").trim()) || null;
  const isOfficialMember = Boolean(
    user?.uid && sortedMembers.some((member) => member.id.trim() === user.uid.trim())
  );
  const canManagePage = Boolean(
    user?.uid &&
      (league?.managerUserIds?.includes(user.uid) ||
        uiConfig.managerUserIds.includes(user.uid) ||
        (area === "diretorio"
          ? sortedMembers.some(
              (member) => member.id.trim() === user.uid.trim() && canManageLeagueRole(member.cargo)
            )
          : isOfficialMember))
  );
  const publicAgendaEvents = useMemo(
    () => sortedEvents.filter((event) => !isInternalLeagueEvent(event)),
    [sortedEvents]
  );
  const internalAgendaEvents = useMemo(
    () => (isOfficialMember ? sortedEvents.filter(isInternalLeagueEvent) : []),
    [isOfficialMember, sortedEvents]
  );
  const visibleAgendaCount = publicAgendaEvents.length + internalAgendaEvents.length;
  const displayMembersCount =
    area === "comissoes"
      ? turmaMemberCount ?? league?.membersCount ?? sortedMembers.length
      : league?.membersCount ?? sortedMembers.length;
  const entityLabel = area === "diretorio" ? "diretório" : area === "comissoes" ? "comissão" : "página";
  const entityArticle = area === "comissoes" ? "da" : "do";
  const publicLinks = useMemo(
    () => (league?.links || []).filter((link) => String(link.url || "").trim()),
    [league?.links]
  );
  const paymentInfo = league?.paymentConfig || null;

  useEffect(() => {
    if (!currentMemberRequest) return;
    setRequestRole(resolveLeagueRoleLabel(currentMemberRequest.requestedRole));
  }, [currentMemberRequest]);

  const handleLike = async () => {
    if (!user || !league || togglingLike) return;
    const wasLiked = likedIds.includes(league.id);
    const optimisticDelta = wasLiked ? -1 : 1;
    setTogglingLike(true);
    setLikedIds((current) => (wasLiked ? current.filter((entry) => entry !== league.id) : [...current, league.id]));
    setLeague((current) =>
      current ? { ...current, likes: Math.max(0, (current.likes || 0) + optimisticDelta) } : current
    );

    try {
      const result = await toggleUserLeagueLike({
        leagueId: league.id,
        userId: user.uid,
        tenantId: tenantId || undefined,
      });
      setLikedIds(result.likedIds);
      if (result.isLiked) {
        void logActivity(user.uid, user.nome || "Atleta", "LIKE", "Ligas", `Curtiu ${uiConfig.rotuloCard.toLowerCase()} ${league.sigla || league.nome}`);
      }
    } catch (error: unknown) {
      console.error(error);
      setLikedIds((current) => (wasLiked ? [...current, league.id] : current.filter((entry) => entry !== league.id)));
      setLeague((current) =>
        current ? { ...current, likes: Math.max(0, (current.likes || 0) + (wasLiked ? 1 : -1)) } : current
      );
    } finally {
      setTogglingLike(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !league) return;
    const previousIds = followedIds;
    const nextIds = isFollowing
      ? previousIds.filter((entry) => entry !== league.id)
      : Array.from(new Set([...previousIds, league.id]));
    setFollowedIds(nextIds);

    try {
      const updatedIds = await toggleUserLeagueFollow({
        leagueId: league.id,
        userId: user.uid,
        currentlyFollowing: isFollowing,
        tenantId: tenantId || undefined,
      });
      setFollowedIds(updatedIds);
    } catch (error: unknown) {
      console.error(error);
      setFollowedIds(previousIds);
    }
  };

  const handleSubmitMemberRequest = async () => {
    if (!user?.uid || !league || submittingMemberRequest) return;
    if (isOfficialMember) {
      addToast(`Você já faz parte d${area === "comissoes" ? "a" : "o"} ${uiConfig.rotuloCard.toLowerCase()}.`, "info");
      return;
    }
    if (currentMemberRequest) {
      addToast("Sua solicitação já está pendente de análise.", "info");
      return;
    }

    try {
      setSubmittingMemberRequest(true);
      const nextRequest = await submitLeagueMemberRequest({
        leagueId: league.id,
        requestedRole: requestRole,
      });
      setLeague((current) =>
        current
          ? {
              ...current,
              memberRequests: [
                ...(current.memberRequests || []).filter((entry) => entry.userId.trim() !== nextRequest.userId.trim()),
                nextRequest,
              ],
            }
          : current
      );
      addToast("Solicitação enviada com sucesso.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Não consegui enviar a solicitação agora.", "error");
    } finally {
      setSubmittingMemberRequest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4">
          <Loader2 className="animate-spin text-brand" size={18} />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">Carregando página</span>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">{config.emptyTitle}</p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">Essa página não está disponível</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{config.emptyDescription}</p>
          <Link href={tenantPath(config.basePath)} className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase text-brand-accent hover:opacity-90">
            <ArrowLeft size={14} />
            Voltar
          </Link>
        </div>
      </div>
    );
  }

  const rootBaseHref = tenantPath(config.basePath);
  const overviewHref =
    pathMode === "root" ? rootBaseHref : tenantPath(`${config.basePath}/${league.id}`);
  const membersHref =
    pathMode === "root" ? tenantPath(`${config.basePath}/membros`) : tenantPath(`${config.basePath}/${league.id}/membros`);
  const agendaHref =
    pathMode === "root" ? tenantPath(`${config.basePath}/agenda`) : tenantPath(`${config.basePath}/${league.id}/agenda`);
  const storeTabHref =
    pathMode === "root" ? tenantPath(`${config.basePath}/loja`) : tenantPath(`${config.basePath}/${league.id}/loja`);
  const managementHref = tenantPath(managementHrefOverride || config.adminPath);
  const backHref = tenantPath(backHrefOverride || config.basePath);
  const imageSrc = getCollectiveImage(league);
  const storeEnabled = storeCategory ? storeCategory.visible !== false : true;
  const storeCoverImage =
    String(storeCategory?.cover_img || "").trim() ||
    String(storeCategory?.logo_url || "").trim() ||
    imageSrc;
  const heroImageSrc = activeTab === "loja" && storeEnabled ? storeCoverImage : imageSrc;

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="relative h-[300px] sm:h-[360px]">
          <Image src={heroImageSrc} alt={league.nome} fill sizes="100vw" priority className="object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2),rgba(5,5,5,0.92))]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_left,rgba(52,211,153,0.2),transparent_32%)]" />
        </div>

        <div className="relative z-10 -mt-24 px-6 pb-6">
          <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-[#050505]/88 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={backHref} className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 hover:bg-zinc-900">
                <ArrowLeft size={14} />
                Voltar
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                {canManagePage ? (
                  <Link
                    href={managementHref}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand/30 bg-brand-soft text-brand-accent transition hover:opacity-90"
                    aria-label="Abrir gestão"
                    title="Abrir gestão"
                  >
                    <Settings2 size={16} />
                  </Link>
                ) : null}
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{uiConfig.rotuloCard}</span>
                {league.turmaId ? (
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-200">
                    {league.turmaId}
                  </span>
                ) : null}
                <span className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-brand-accent">
                  {league.sigla || league.nome}
                </span>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="relative h-24 w-24 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/40 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                  <Image src={imageSrc} alt={league.nome} fill sizes="96px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-brand-accent">{config.headerLabel}</p>
                  <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">{league.nome}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                    {league.descricao || `${uiConfig.rotuloCard} oficial com página própria para mostrar membros, agenda e identidade visual.`}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">
                      {league.sigla || uiConfig.rotuloCard}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
                      {displayMembersCount} membros
                    </span>
                    {presidentName ? (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                        Presidente: {presidentName}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Curtidas</p>
                  <p className="mt-3 text-2xl font-black text-white">{league.likes || 0}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Agenda</p>
                  <p className="mt-3 text-2xl font-black text-white">{visibleAgendaCount}</p>
                </div>
                <button type="button" onClick={() => void handleLike()} disabled={!user || togglingLike} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLiked ? "border-red-500/30 bg-red-500/10 text-red-100" : "border-white/10 bg-white/5 text-zinc-100 hover:border-red-500/30 hover:bg-red-500/10"}`}>
                  <div className="flex items-center justify-between">
                    <Heart size={18} className={isLiked ? "fill-current" : ""} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isLiked ? "Curtida" : "Curtir"}</span>
                  </div>
                </button>
                <button type="button" onClick={() => void handleFollow()} disabled={!user} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isFollowing ? "border-brand/30 bg-brand-soft text-white" : "border-white/10 bg-white/5 text-zinc-100 hover:border-brand/30 hover:bg-brand-soft"}`}>
                  <div className="flex items-center justify-between">
                    <Users size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isFollowing ? "Seguindo" : "Seguir"}</span>
                  </div>
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-brand/30 bg-brand-soft p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">
                    Participação na página
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/85">
                    {isOfficialMember
                      ? `Seu perfil já está na equipe oficial d${area === "comissoes" ? "a" : "o"} ${uiConfig.rotuloCard.toLowerCase()}.`
                      : currentMemberRequest
                        ? `Solicitação enviada como ${resolveLeagueRoleLabel(currentMemberRequest.requestedRole)}.`
                        : "Escolha o cargo desejado e envie sua solicitação para a equipe analisar."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={requestRole}
                    onChange={(event) => setRequestRole(resolveLeagueRoleLabel(event.target.value))}
                    disabled={!user || isOfficialMember || Boolean(currentMemberRequest) || submittingMemberRequest}
                    className="rounded-full border border-brand/30 bg-[#050505]/80 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {LEAGUE_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role} className="bg-zinc-950 text-white">
                        {role}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleSubmitMemberRequest()}
                    disabled={!user || isOfficialMember || Boolean(currentMemberRequest) || submittingMemberRequest}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingMemberRequest ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                    {isOfficialMember
                      ? "Você já faz parte"
                      : currentMemberRequest
                        ? "Solicitação pendente"
                        : user
                          ? "Solicitar entrada"
                          : "Entre para solicitar"}
                  </button>
                </div>
              </div>
            </div>

            {league.bizu ? (
              <div className="mt-5 rounded-[1.75rem] border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-200">
                    <Lightbulb size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                      Bizu {uiConfig.rotuloCard.toLowerCase()}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-50/90">{league.bizu}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-2">
        <nav className="grid gap-3 sm:grid-cols-4">
          {[
            { href: overviewHref, label: "Visão geral", tab: "overview" as const },
            { href: membersHref, label: "Membros", tab: "membros" as const },
            { href: agendaHref, label: "Agenda", tab: "agenda" as const },
            { href: storeTabHref, label: "Loja", tab: "loja" as const },
          ]
            .filter((item) => item.tab !== "loja" || storeEnabled || activeTab === "loja")
            .map((item) => (
            <Link key={item.href} href={item.href} className={`flex min-h-[76px] items-center justify-center rounded-[1.5rem] border px-5 py-4 text-center text-[12px] font-black uppercase tracking-[0.24em] transition ${activeTab === item.tab ? "border-brand/30 bg-brand-soft text-brand-accent shadow-brand" : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <section className="space-y-6">
            <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200">
                  <Lightbulb size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Visão geral</p>
                  <h2 className="mt-2 text-2xl font-black text-white">O que esse espaço faz</h2>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {overviewHighlights.length > 0 ? overviewHighlights.map((entry, index) => (
                  <div key={`${entry}-${index}`} className="rounded-[1.5rem] border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm font-semibold leading-6 text-cyan-50">
                    {entry}
                  </div>
                )) : <p className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-500">Essa página ainda não publicou a visão geral.</p>}
              </div>
            </article>

            {publicLinks.length > 0 ? (
              <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,22,28,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200">
                    <Link2 size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Links oficiais</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Canais publicados</h2>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {publicLinks.map((link) => {
                    const Icon = getLinkIcon(link.type);
                    return (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex min-h-[84px] items-center justify-between gap-3 rounded-[1.4rem] border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,34,42,0.96),rgba(6,18,24,0.94))] px-4 py-3 text-sm font-black text-cyan-50 transition hover:-translate-y-1 hover:border-cyan-300/40"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                            <Icon size={18} />
                          </div>
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{link.label || getLinkTypeLabel(link.type)}</span>
                            <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">{getLinkTypeLabel(link.type)}</span>
                          </span>
                        </div>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-cyan-100 transition group-hover:border-cyan-300/30 group-hover:bg-cyan-400/10">
                          <ExternalLink size={16} />
                        </div>
                      </a>
                    );
                  })}
                </div>
              </article>
            ) : null}

            {hasPaymentInfo(paymentInfo) ? (
              <article className="rounded-[2rem] border border-brand/30 bg-[linear-gradient(180deg,rgba(10,24,20,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-brand/30 bg-brand-soft p-3 text-brand-accent">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">Pagamento</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Dados publicados</h2>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {paymentInfo?.chave ? <div className="rounded-[1.25rem] border border-brand/30 bg-brand-soft p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">Chave PIX</p><p className="mt-2 break-words text-sm font-bold text-white">{paymentInfo.chave}</p></div> : null}
                  {paymentInfo?.banco ? <div className="rounded-[1.25rem] border border-brand/30 bg-brand-soft p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">Banco</p><p className="mt-2 break-words text-sm font-bold text-white">{paymentInfo.banco}</p></div> : null}
                  {paymentInfo?.titular ? <div className="rounded-[1.25rem] border border-brand/30 bg-brand-soft p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">Titular</p><p className="mt-2 break-words text-sm font-bold text-white">{paymentInfo.titular}</p></div> : null}
                  {paymentInfo?.whatsapp ? <a href={`https://wa.me/${paymentInfo.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-[1.25rem] border border-brand/30 bg-brand-soft p-4 transition hover:opacity-90"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">Comprovante</p><p className="mt-2 break-words text-sm font-bold text-white">{paymentInfo.whatsapp}</p></a> : null}
                </div>
              </article>
            ) : null}
          </section>
        ) : activeTab === "membros" ? (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,22,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <h2 className="text-2xl font-black text-white">Membros</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedMembers.map((member) => {
                const href = member.linkPerfil?.startsWith("/") ? tenantPath(member.linkPerfil) : member.linkPerfil || "";
                const card = (
                  <article className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 hover:border-brand/30">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-300 opacity-80" />
                    <div className="flex items-start gap-4">
                      <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                        <Image src={member.foto || "/logo.png"} alt={member.nome} fill sizes="64px" className="object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">{member.cargo}</p>
                        <h3 className="mt-2 truncate text-lg font-black text-white">{member.nome}</h3>
                        <p className="mt-2 text-sm text-zinc-400">{`Membro oficial ${entityArticle} ${entityLabel}.`}</p>
                      </div>
                    </div>
                  </article>
                );
                return href ? <Link key={`${member.id}-${member.nome}`} href={href}>{card}</Link> : <div key={`${member.id}-${member.nome}`}>{card}</div>;
              })}
              {sortedMembers.length === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">Essa página ainda não publicou os membros oficiais.</p> : null}
            </div>
          </section>
        ) : activeTab === "agenda" ? (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,26,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Agenda oficial</p>
              <h2 className="mt-2 text-2xl font-black text-white">Eventos abertos e internos</h2>
            </div>

            {[
              { title: "Aberto ao público", events: publicAgendaEvents },
              { title: "Evento interno", events: internalAgendaEvents },
            ]
              .filter((group) => group.events.length > 0)
              .map((group) => (
                <article key={group.title} className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                  <h3 className="text-lg font-black text-white">{group.title}</h3>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {group.events.map((event) => (
                      <div key={`${group.title}-${event.id}`} className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-accent">{getVisibilityLabel(event)}</p>
                            <h4 className="mt-2 text-lg font-black text-white">{event.titulo}</h4>
                            <p className="mt-2 text-sm text-zinc-400">{event.descricao || "Sem descrição publicada."}</p>
                          </div>
                          <div className="rounded-2xl border border-brand/30 bg-brand-soft px-3 py-2 text-center text-brand-accent">
                            <p className="text-[10px] font-black uppercase">Data</p>
                            <p className="mt-1 text-xs font-bold">{event.data || "--"}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-zinc-400">
                          {event.local ? <span className="rounded-full border border-zinc-800 bg-black/30 px-3 py-2">{event.local}</span> : null}
                          {event.hora ? <span className="rounded-full border border-zinc-800 bg-black/30 px-3 py-2">{event.hora}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}

            {visibleAgendaCount === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">A agenda desta página ainda está vazia.</p> : null}
          </section>
        ) : (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-brand/30 bg-brand-soft p-3 text-brand-accent">
                  <ShoppingBag size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-accent">
                    {storeEnabled ? "Loja publicada" : "Loja oculta"}
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-white">
                    {storeEnabled
                      ? area === "diretorio"
                        ? "Produtos do diretório"
                        : area === "comissoes"
                          ? "Produtos da comissão"
                          : "Produtos publicados"
                      : "Loja temporariamente indisponível"}
                  </h2>
                </div>
              </div>
            </div>

            {!storeEnabled ? (
              <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">
                {`A loja ${entityArticle} ${entityLabel} está oculta no momento.`}
              </p>
            ) : loadingProducts ? (
              <div className="flex items-center justify-center rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-10">
                <Loader2 className="animate-spin text-brand" size={20} />
              </div>
            ) : leagueProducts.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {leagueProducts.map((product) => (
                  <article key={product.id} className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/80">
                    <div className="relative h-44 w-full bg-black/40">
                      <Image src={product.img || "/logo.png"} alt={product.nome || "Produto"} fill sizes="360px" className="object-cover" />
                    </div>
                    <div className="p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{product.categoria || "Loja"}</p>
                      <h3 className="mt-2 text-lg font-black text-white">{product.nome || "Produto sem nome"}</h3>
                      <p className="mt-3 text-sm font-bold text-brand-accent">{formatProductPrice(product.preco)}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">
                Ainda não existem produtos publicados nesta loja.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
