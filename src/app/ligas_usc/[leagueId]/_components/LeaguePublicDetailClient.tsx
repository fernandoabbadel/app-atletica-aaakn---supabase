"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Heart, Lightbulb, Loader2, ShoppingBag, Users } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import {
  fetchUserLeagueInteractionState,
  fetchLeagueById,
  resolveFollowedLeagueIdsFromUserExtra,
  resolveLikedLeagueIdsFromUserExtra,
  submitLeagueMemberRequest,
  toggleUserLeagueLike,
  toggleUserLeagueFollow,
  type LeagueRecord,
} from "@/lib/leaguesService";
import { fetchStoreProductsBySeller } from "@/lib/storePublicService";
import { parseEventDateTimeMs } from "@/lib/eventDateUtils";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import {
  DEFAULT_LEAGUE_ROLE,
  LEAGUE_ROLE_OPTIONS,
  resolveLeagueRoleLabel,
  sortLeagueMembersByRole,
} from "@/lib/leagueRoles";
import {
  DEFAULT_LIGAS_USC_UI_CONFIG,
  fetchLigasUscUiConfig,
} from "@/lib/ligasUscUiService";
import { withTenantSlug } from "@/lib/tenantRouting";

type LeaguePublicTab = "overview" | "membros" | "agenda" | "loja";

type LeagueStoreProduct = {
  id: string;
  nome?: string;
  img?: string;
  preco?: number;
  categoria?: string;
  tagLabel?: string;
};

const getLeagueImage = (league?: LeagueRecord | null) =>
  league?.foto?.trim() || resolveLeagueLogoSrc(league, "/placeholder_liga.png");

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
  isInternalLeagueEvent(event) ? "Evento interno" : "Aberto ao publico";

const getEventBadge = (value: string) => {
  const parsedMs = parseEventDateTimeMs(value, "00:00");
  if (parsedMs === null) {
    return { day: value.trim().slice(0, 2) || "--", month: value.trim().slice(3, 8) || "DATA" };
  }
  const parsed = new Date(parsedMs);
  return {
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(parsed),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(parsed).replace(".", "").toUpperCase(),
  };
};

const formatProductPrice = (value: unknown): string => {
  const price = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(price);
};

export function LeaguePublicDetailClient({
  leagueId,
  activeTab,
}: {
  leagueId: string;
  activeTab: LeaguePublicTab;
}) {
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const cleanLeagueId = typeof leagueId === "string" ? leagueId.trim() : "";
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";

  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [uiConfig, setUiConfig] = useState(DEFAULT_LIGAS_USC_UI_CONFIG);
  const [leagueProducts, setLeagueProducts] = useState<LeagueStoreProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [requestRole, setRequestRole] = useState<string>(DEFAULT_LEAGUE_ROLE);
  const [submittingMemberRequest, setSubmittingMemberRequest] = useState(false);

  const tenantPath = (path: string) => (cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path);

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
        if (mounted) setLeague(nextLeague);
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
  }, [cleanLeagueId, tenantId]);

  useEffect(() => {
    let mounted = true;
    const leagueProductId = league?.id?.trim() || "";
    if (!leagueProductId || activeTab !== "loja") {
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
        setLeagueProducts(products as unknown as LeagueStoreProduct[]);
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
  }, [activeTab, league?.id, tenantId]);

  useEffect(() => {
    let mounted = true;

    const loadUiConfig = async () => {
      try {
        const nextConfig = await fetchLigasUscUiConfig({
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setUiConfig(nextConfig);
      } catch (error: unknown) {
        console.error(error);
        if (!mounted) return;
        setUiConfig(DEFAULT_LIGAS_USC_UI_CONFIG);
      }
    };

    void loadUiConfig();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

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
  const publicAgendaEvents = useMemo(
    () => sortedEvents.filter((event) => !isInternalLeagueEvent(event)),
    [sortedEvents]
  );
  const internalAgendaEvents = useMemo(
    () => (isOfficialMember ? sortedEvents.filter(isInternalLeagueEvent) : []),
    [isOfficialMember, sortedEvents]
  );
  const visibleAgendaCount = publicAgendaEvents.length + internalAgendaEvents.length;

  useEffect(() => {
    if (!currentMemberRequest) return;
    setRequestRole(resolveLeagueRoleLabel(currentMemberRequest.requestedRole));
  }, [currentMemberRequest]);

  const handleLike = async () => {
    if (!user || !league) return;
    const wasLiked = likedIds.includes(league.id);
    const optimisticDelta = wasLiked ? -1 : 1;
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
      if (result.isLiked !== !wasLiked) {
        const actualDelta = result.isLiked ? 1 : -1;
        const correction = actualDelta - optimisticDelta;
        if (correction !== 0) {
          setLeague((current) =>
            current
              ? { ...current, likes: Math.max(0, (current.likes || 0) + correction) }
              : current
          );
        }
      }
      if (result.isLiked) {
        void logActivity(user.uid, user.nome || "Atleta", "LIKE", "Ligas", `Curtiu a liga ${league.sigla || league.nome}`);
      }
    } catch (error: unknown) {
      console.error(error);
      setLikedIds((current) => (wasLiked ? [...current, league.id] : current.filter((entry) => entry !== league.id)));
      setLeague((current) =>
        current ? { ...current, likes: Math.max(0, (current.likes || 0) + (wasLiked ? 1 : -1)) } : current
      );
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
      const nextIds = await toggleUserLeagueFollow({
        leagueId: league.id,
        userId: user.uid,
        currentlyFollowing: isFollowing,
        tenantId: tenantId || undefined,
      });
      setFollowedIds(nextIds);
      const isFollowingNow = nextIds.includes(league.id);
      void logActivity(
        user.uid,
        user.nome || "Atleta",
        isFollowingNow ? "FOLLOW" : "UNFOLLOW",
        "Ligas",
        `${isFollowingNow ? "Seguiu" : "Parou de seguir"} a liga ${league.sigla || league.nome}`
      );
    } catch (error: unknown) {
      console.error(error);
      setFollowedIds(previousIds);
    }
  };

  const handleSubmitMemberRequest = async () => {
    if (!user?.uid || !league || submittingMemberRequest) return;
    if (isOfficialMember) {
      addToast("Você já faz parte desta liga.", "info");
      return;
    }
    if (currentMemberRequest) {
      addToast("Sua solicitação já está pendente de análise.", "info");
      return;
    }

    setSubmittingMemberRequest(true);
    try {
      const createdRequest = await submitLeagueMemberRequest({
        leagueId: league.id,
        requestedRole: requestRole,
      });

      setLeague((current) =>
        current
          ? {
              ...current,
              memberRequests: [
                ...(current.memberRequests || []).filter(
                  (entry) => entry.userId.trim() !== createdRequest.userId.trim()
                ),
                createdRequest,
              ],
            }
          : current
      );
      setRequestRole(resolveLeagueRoleLabel(createdRequest.requestedRole));
      addToast("Solicitação enviada para a gestão da liga.", "success");
      void logActivity(
        user.uid,
        user.nome || "Atleta",
        "CREATE",
        "ligas_config",
        `Solicitou entrada na liga ${league.sigla || league.nome} como ${createdRequest.requestedRole}`
      );
    } catch (error: unknown) {
      console.error(error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao enviar solicitação para a liga.";
      addToast(message, "error");
    } finally {
      setSubmittingMemberRequest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4">
          <Loader2 className="animate-spin text-emerald-400" size={18} />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">Carregando liga</span>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">{"Liga n\u00e3o encontrada"}</p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight text-white">{"Essa p\u00e1gina n\u00e3o est\u00e1 dispon\u00edvel"}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{"A liga pode ter sido removida ou ainda n\u00e3o estar vis\u00edvel neste tenant."}</p>
          <Link href={tenantPath("/ligas_usc")} className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20">
            <ArrowLeft size={14} />
            {"Voltar para ligas"}
          </Link>
        </div>
      </div>
    );
  }

  const overviewHref = tenantPath(`/ligas_usc/${league.id}`);
  const membersHref = tenantPath(`/ligas_usc/${league.id}/membros`);
  const agendaHref = tenantPath(`/ligas_usc/${league.id}/agenda`);
  const storeTabHref = tenantPath(`/ligas_usc/${league.id}/loja`);
  const storeHref = tenantPath("/loja");
  const eventsFeedHref = tenantPath("/eventos");
  const imageSrc = getLeagueImage(league);

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="relative h-[300px] sm:h-[360px]">
          <Image src={imageSrc} alt={league.nome} fill sizes="100vw" priority className="object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2),rgba(5,5,5,0.92))]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_left,rgba(52,211,153,0.2),transparent_32%)]" />
        </div>

        <div className="relative z-10 -mt-24 px-6 pb-6">
          <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-[#050505]/88 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={tenantPath("/ligas_usc")} className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 hover:bg-zinc-900">
                <ArrowLeft size={14} />
                Voltar
              </Link>
              <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{uiConfig.rotuloCard || DEFAULT_LIGAS_USC_UI_CONFIG.rotuloCard}</span>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-200">{league.sigla || league.nome}</span>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="relative h-24 w-24 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/40 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                  <Image src={imageSrc} alt={league.nome} fill sizes="96px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400">{"Ecossistema acad\u00eamico"}</p>
                  <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">{league.nome}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">{league.descricao || "Liga oficial com p\u00e1gina pr\u00f3pria para mostrar membros, agenda e identidade visual."}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">{league.sigla || "Liga"}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">{league.membersCount ?? sortedMembers.length} membros</span>
                    {presidentName ? <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Presidente: {presidentName}</span> : null}
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
                <button type="button" onClick={() => void handleLike()} disabled={!user} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLiked ? "border-red-500/30 bg-red-500/10 text-red-100" : "border-white/10 bg-white/5 text-zinc-100 hover:border-red-500/30 hover:bg-red-500/10"}`}>
                  <div className="flex items-center justify-between">
                    <Heart size={18} className={isLiked ? "fill-current" : ""} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isLiked ? "Curtida" : "Curtir"}</span>
                  </div>
                </button>
                <button type="button" onClick={() => void handleFollow()} disabled={!user} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isFollowing ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-white/5 text-zinc-100 hover:border-emerald-500/30 hover:bg-emerald-500/10"}`}>
                  <div className="flex items-center justify-between">
                    <Users size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isFollowing ? "Seguindo" : "Seguir"}</span>
                  </div>
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-200">
                    Participacao na liga
                  </p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/90">
                    {isOfficialMember
                      ? "Seu perfil ja esta na equipe oficial desta liga."
                      : currentMemberRequest
                        ? `Solicitação enviada como ${resolveLeagueRoleLabel(currentMemberRequest.requestedRole)}. A diretoria pode aprovar e ajustar o cargo na gestão da liga.`
                        : "Escolha o cargo desejado e envie sua solicitação para a diretoria analisar."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={requestRole}
                    onChange={(event) => setRequestRole(resolveLeagueRoleLabel(event.target.value))}
                    disabled={!user || isOfficialMember || Boolean(currentMemberRequest) || submittingMemberRequest}
                    className="rounded-full border border-emerald-500/20 bg-[#050505]/80 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-100 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-emerald-50 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingMemberRequest ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                    {isOfficialMember
                      ? "Você já está na liga"
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
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">Bizu da liga</p>
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
            { href: overviewHref, label: "Vis\u00e3o geral", tab: "overview" as const },
            { href: membersHref, label: "Membros", tab: "membros" as const },
            { href: agendaHref, label: "Agenda", tab: "agenda" as const },
            { href: storeTabHref, label: "Loja", tab: "loja" as const },
          ].map((item) => (
            <Link key={item.href} href={item.href} className={`flex min-h-[76px] items-center justify-center rounded-[1.5rem] border px-5 py-4 text-center text-[12px] font-black uppercase tracking-[0.24em] transition ${activeTab === item.tab ? "border-emerald-500/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(6,182,212,0.14))] text-emerald-200 shadow-[0_20px_40px_rgba(16,185,129,0.12)]" : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <section className="space-y-6">
            {false ? (
              <article className="rounded-[2rem] border border-emerald-500/20 bg-[linear-gradient(180deg,rgba(10,24,20,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-200">
                    <Lightbulb size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">Visão geral</p>
                    <h2 className="mt-2 text-2xl font-black text-white">O que a liga faz</h2>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {overviewHighlights.map((entry, index) => (
                    <div key={`${entry}-${index}`} className="rounded-[1.25rem] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold leading-6 text-emerald-50">
                      {entry}
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
            <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200"><Lightbulb size={18} /></div><div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Visao geral da liga</p><h2 className="mt-2 text-2xl font-black text-white">O que a liga faz</h2></div></div>
              <div className="mt-5 space-y-3">
                {overviewHighlights.length > 0 ? overviewHighlights.map((entry, index) => (
                  <div key={`${entry}-${index}`} className="rounded-[1.5rem] border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm font-semibold leading-6 text-cyan-50">
                    {entry}
                  </div>
                )) : <p className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-500">A liga ainda não publicou a visão geral.</p>}
              </div>
              <Link href={eventsFeedHref} className="mt-5 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200 hover:bg-cyan-500/20">Ver eventos publicados</Link>
            </article>
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
                  <article className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 hover:border-emerald-500/30">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-300 opacity-80" />
                    <div className="flex items-start gap-4"><div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-black/40"><Image src={member.foto || "/logo.png"} alt={member.nome} fill sizes="64px" className="object-cover" /></div><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">{member.cargo}</p><h3 className="mt-2 truncate text-lg font-black text-white">{member.nome}</h3><p className="mt-2 text-sm text-zinc-400">{"Membro oficial da liga nesta gest\u00e3o."}</p></div></div>
                  </article>
                );
                return href ? <Link key={`${member.id}-${member.nome}`} href={href}>{card}</Link> : <div key={`${member.id}-${member.nome}`}>{card}</div>;
              })}
              {sortedMembers.length === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">{"Essa liga ainda n\u00e3o publicou os membros oficiais."}</p> : null}
            </div>
          </section>
        ) : activeTab === "agenda" ? (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Agenda oficial</p>
              <h2 className="mt-3 text-2xl font-black text-white">{"Eventos, encontros e convoca\u00e7\u00f5es"}</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{"Tudo que a liga publicou para a comunidade acompanhar em um s\u00f3 lugar."}</p>
            </div>
            {[
              { title: "Aberto ao publico", events: publicAgendaEvents },
              { title: "Evento interno", events: internalAgendaEvents },
            ].map((section) => (
              <div key={section.title} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-zinc-300">{section.title}</h3>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black text-zinc-400">{section.events.length}</span>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {section.events.map((event) => {
                    const badge = getEventBadge(event.data || "");
                    const href = event.linkEvento?.startsWith("/") ? tenantPath(event.linkEvento) : event.linkEvento || "";
                    const internal = isInternalLeagueEvent(event);
                    const card = (
                      <article className={`relative overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 ${
                        internal
                          ? "border-amber-500/20 bg-[linear-gradient(180deg,rgba(30,23,11,0.96),rgba(10,10,10,0.98))] hover:border-amber-400/30"
                          : "border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] hover:border-cyan-400/30"
                      }`}>
                        <div className="flex gap-4"><div className={`flex w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl border px-3 py-4 text-center ${internal ? "border-amber-500/20 bg-amber-500/10" : "border-cyan-500/20 bg-cyan-500/10"}`}><span className="text-2xl font-black text-white">{badge.day}</span><span className={`text-[10px] font-black uppercase tracking-[0.24em] ${internal ? "text-amber-200" : "text-cyan-200"}`}>{badge.month}</span></div><div className="min-w-0 flex-1"><p className={`text-[10px] font-black uppercase tracking-[0.24em] ${internal ? "text-amber-300" : "text-cyan-300"}`}>{getVisibilityLabel(event)}</p><h3 className="mt-2 text-xl font-black text-white">{event.titulo}</h3><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase text-zinc-300">{event.hora ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{event.hora}</span> : null}{event.local ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{event.local}</span> : null}</div><p className="mt-4 text-sm leading-6 text-zinc-400">{event.descricao || "Evento publicado pela liga sem descricao adicional."}</p></div></div>
                      </article>
                    );
                    return href ? <Link key={event.id || event.titulo} href={href}>{card}</Link> : <div key={event.id || event.titulo}>{card}</div>;
                  })}
                  {section.events.length === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">{section.title === "Evento interno" && !isOfficialMember ? "Eventos internos aparecem somente para membros da liga." : "Nenhum evento nessa categoria."}</p> : null}
                </div>
              </div>
            ))}
            {visibleAgendaCount === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">{"A agenda da liga ainda esta vazia."}</p> : null}
          </section>
        ) : (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">
                    Loja da liga
                  </p>
                  <h2 className="mt-3 text-2xl font-black text-white">Produtos da {league.sigla || league.nome}</h2>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Os cards mostram os produtos vinculados à liga. Ao abrir qualquer item, você vai para a loja do tenant.
                  </p>
                </div>
                <Link href={storeHref} className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20">
                  <ShoppingBag size={16} />
                  Loja
                </Link>
              </div>
            </div>

            {loadingProducts ? (
              <div className="flex items-center gap-3 rounded-[1.75rem] border border-zinc-800 bg-zinc-950/70 p-5 text-sm font-bold text-zinc-400">
                <Loader2 size={18} className="animate-spin text-emerald-400" />
                Carregando produtos
              </div>
            ) : leagueProducts.length === 0 ? (
              <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">
                Nenhum produto da liga foi encontrado na loja.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {leagueProducts.map((product) => {
                  const image = product.img?.trim() || imageSrc;
                  return (
                    <Link key={product.id} href={storeHref}>
                      <article className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 hover:border-emerald-500/30">
                        <div className="relative aspect-[4/3] bg-black">
                          <Image src={image} alt={product.nome || "Produto da liga"} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" />
                          {product.tagLabel ? (
                            <span className="absolute left-3 top-3 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-100">
                              {product.tagLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="p-5">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">
                            {product.categoria || "Produto"}
                          </p>
                          <h3 className="mt-2 line-clamp-2 min-h-[3.5rem] text-xl font-black text-white">
                            {product.nome || "Produto da liga"}
                          </h3>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <p className="text-lg font-black text-emerald-300">{formatProductPrice(product.preco)}</p>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase text-zinc-300">
                              Abrir loja
                            </span>
                          </div>
                        </div>
                      </article>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
