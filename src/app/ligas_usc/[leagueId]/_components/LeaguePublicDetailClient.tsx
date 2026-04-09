"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Heart, Lightbulb, Loader2, MapPin, Users } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "@/lib/logger";
import {
  changeLeagueLikeCount,
  fetchLeagueById,
  resolveFollowedLeagueIdsFromUserExtra,
  toggleUserLeagueFollow,
  type LeagueRecord,
} from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { resolveLeagueRoleLabel, sortLeagueMembersByRole } from "@/lib/leagueRoles";
import { withTenantSlug } from "@/lib/tenantRouting";

type LeaguePublicTab = "overview" | "membros" | "agenda";

const getLeagueImage = (league?: LeagueRecord | null) =>
  league?.foto?.trim() || resolveLeagueLogoSrc(league, "/placeholder_liga.png");

const sortEvents = (events: LeagueRecord["eventos"]) =>
  [...events].sort((left, right) => {
    const leftDate = Date.parse(`${left.data || ""}T${left.hora || "00:00"}`);
    const rightDate = Date.parse(`${right.data || ""}T${right.hora || "00:00"}`);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
      return leftDate - rightDate;
    }
    return (left.titulo || "").localeCompare(right.titulo || "", "pt-BR");
  });

const getEventBadge = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { day: value.trim().slice(0, 2) || "--", month: value.trim().slice(3, 8) || "DATA" };
  }
  return {
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(parsed),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(parsed).replace(".", "").toUpperCase(),
  };
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
  const cleanLeagueId = typeof leagueId === "string" ? leagueId.trim() : "";
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";

  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [followedIds, setFollowedIds] = useState<string[]>([]);

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
    setFollowedIds(resolveFollowedLeagueIdsFromUserExtra(user?.extra, tenantId));
  }, [tenantId, user?.extra]);

  const sortedMembers = useMemo(
    () =>
      sortLeagueMembersByRole(league?.membros || []).map((member) => ({
        ...member,
        cargo: resolveLeagueRoleLabel(member.cargo),
      })),
    [league]
  );
  const sortedEvents = useMemo(() => sortEvents(league?.eventos || []), [league]);
  const isLiked = Boolean(league && likedIds.includes(league.id));
  const isFollowing = Boolean(league && followedIds.includes(league.id));

  const handleLike = async () => {
    if (!user || !league) return;
    const wasLiked = likedIds.includes(league.id);
    setLikedIds((current) => (wasLiked ? current.filter((entry) => entry !== league.id) : [...current, league.id]));
    setLeague((current) =>
      current ? { ...current, likes: Math.max(0, (current.likes || 0) + (wasLiked ? -1 : 1)) } : current
    );

    try {
      await changeLeagueLikeCount({
        id: league.id,
        delta: wasLiked ? -1 : 1,
        actorUserId: user.uid,
        tenantId: tenantId || undefined,
      });
      if (!wasLiked) {
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
    const nextFollowing = !isFollowing;
    const previousIds = followedIds;
    const nextIds = nextFollowing
      ? Array.from(new Set([...previousIds, league.id]))
      : previousIds.filter((entry) => entry !== league.id);
    setFollowedIds(nextIds);

    try {
      await toggleUserLeagueFollow({
        leagueId: league.id,
        userId: user.uid,
        currentlyFollowing: isFollowing,
        tenantId: tenantId || undefined,
      });
      void logActivity(
        user.uid,
        user.nome || "Atleta",
        nextFollowing ? "FOLLOW" : "UNFOLLOW",
        "Ligas",
        `${nextFollowing ? "Seguiu" : "Parou de seguir"} a liga ${league.sigla || league.nome}`
      );
    } catch (error: unknown) {
      console.error(error);
      setFollowedIds(previousIds);
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
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Liga USC</span>
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
                    {league.presidente ? <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Presidente: {league.presidente}</span> : null}
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
                  <p className="mt-3 text-2xl font-black text-white">{sortedEvents.length}</p>
                </div>
                <button type="button" onClick={() => void handleLike()} disabled={!user} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLiked ? "border-red-500/30 bg-red-500/10 text-red-100" : "border-white/10 bg-white/5 text-zinc-100 hover:border-red-500/30 hover:bg-red-500/10"}`}>
                  <div className="flex items-center justify-between">
                    <Heart size={18} className={isLiked ? "fill-current" : ""} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isLiked ? "Curtida" : "Curtir"}</span>
                  </div>
                  <p className="mt-4 text-sm font-bold">{user ? "Mostrar que voc\u00ea curtiu a liga" : "Entre para curtir"}</p>
                </button>
                <button type="button" onClick={() => void handleFollow()} disabled={!user} className={`rounded-[1.5rem] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isFollowing ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-white/5 text-zinc-100 hover:border-emerald-500/30 hover:bg-emerald-500/10"}`}>
                  <div className="flex items-center justify-between">
                    <Users size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em]">{isFollowing ? "Seguindo" : "Seguir"}</span>
                  </div>
                  <p className="mt-4 text-sm font-bold">{user ? "Receber novidades da liga" : "Entre para seguir"}</p>
                </button>
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
        <nav className="flex flex-wrap gap-3">
          {[
            { href: overviewHref, label: "Vis\u00e3o geral", tab: "overview" as const },
            { href: membersHref, label: "Membros", tab: "membros" as const },
            { href: agendaHref, label: "Agenda", tab: "agenda" as const },
          ].map((item) => (
            <Link key={item.href} href={item.href} className={`rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition ${activeTab === item.tab ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:bg-zinc-900 hover:text-white"}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="space-y-6">
              <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,22,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Sobre a liga</p>
                <h2 className="mt-3 text-2xl font-black text-white">Identidade, vibe e proposta</h2>
                <p className="mt-4 text-sm leading-7 text-zinc-300">{league.descricao || "Essa liga ainda n\u00e3o publicou um texto de apresenta\u00e7\u00e3o completo."}</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Sigla</p><p className="mt-3 text-xl font-black text-white">{league.sigla || "Liga"}</p></div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Membros</p><p className="mt-3 text-xl font-black text-white">{league.membersCount ?? sortedMembers.length}</p></div>
                </div>
              </article>

              <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,22,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Membros em destaque</p><h2 className="mt-3 text-2xl font-black text-white">{"Lideran\u00e7as da liga"}</h2></div>
                  <Link href={membersHref} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 hover:bg-white/10">Ver todos</Link>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {sortedMembers.slice(0, 4).map((member) => (
                    <div key={`${member.id}-${member.nome}`} className="flex items-center gap-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/10 bg-black/40"><Image src={member.foto || "/logo.png"} alt={member.nome} fill sizes="48px" className="object-cover" /></div>
                      <div className="min-w-0"><p className="truncate text-sm font-black text-white">{member.nome}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">{member.cargo}</p></div>
                    </div>
                  ))}
                  {sortedMembers.length === 0 ? <p className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-500">Nenhum membro oficial publicado.</p> : null}
                </div>
              </article>
            </section>

            <section className="space-y-6">
              <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
                <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200"><CalendarDays size={18} /></div><div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Agenda da liga</p><h2 className="mt-2 text-2xl font-black text-white">{"O que vem por a\u00ed"}</h2></div></div>
                <div className="mt-5 space-y-3">
                  {sortedEvents.slice(0, 3).map((event) => (
                    <div key={event.id || event.titulo} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-black text-white">{event.titulo}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{event.data ? <span>{event.data}</span> : null}{event.hora ? <span>{event.hora}</span> : null}{event.local ? <span>{event.local}</span> : null}</div>
                    </div>
                  ))}
                  {sortedEvents.length === 0 ? <p className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-500">Nenhum evento publicado no momento.</p> : null}
                </div>
                <Link href={agendaHref} className="mt-5 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200 hover:bg-cyan-500/20">Abrir agenda completa</Link>
              </article>
            </section>
          </div>
        ) : activeTab === "membros" ? (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,22,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Membros oficiais</p>
              <h2 className="mt-3 text-2xl font-black text-white">{"Ordem de import\u00e2ncia da gest\u00e3o"}</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{"Presidente, vice-presid\u00eancia, secretaria, tesouraria, diretoria e membros."}</p>
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
        ) : (
          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,24,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Agenda oficial</p>
              <h2 className="mt-3 text-2xl font-black text-white">{"Eventos, encontros e convoca\u00e7\u00f5es"}</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{"Tudo que a liga publicou para a comunidade acompanhar em um s\u00f3 lugar."}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {sortedEvents.map((event) => {
                const badge = getEventBadge(event.data || "");
                const href = event.linkEvento?.startsWith("/") ? tenantPath(event.linkEvento) : event.linkEvento || "";
                const card = (
                  <article className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(10,10,10,0.98))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 hover:border-cyan-400/30">
                    <div className="flex gap-4"><div className="flex w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-4 text-center"><span className="text-2xl font-black text-white">{badge.day}</span><span className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">{badge.month}</span></div><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Agenda oficial</p><h3 className="mt-2 text-xl font-black text-white">{event.titulo}</h3><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase text-zinc-300">{event.hora ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{event.hora}</span> : null}{event.local ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{event.local}</span> : null}</div><p className="mt-4 text-sm leading-6 text-zinc-400">{event.descricao || "Evento publicado pela liga sem descri\u00e7\u00e3o adicional."}</p></div></div>
                  </article>
                );
                return href ? <Link key={event.id || event.titulo} href={href}>{card}</Link> : <div key={event.id || event.titulo}>{card}</div>;
              })}
              {sortedEvents.length === 0 ? <p className="rounded-[1.75rem] border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center text-sm text-zinc-500">{"A agenda da liga ainda est\u00e1 vazia."}</p> : null}
            </div>
          </section>
        )}

        <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,22,0.96),rgba(10,10,10,0.98))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"><Users size={12} />Membros</div><p className="mt-3 text-xl font-black text-white">{league.membersCount ?? sortedMembers.length}</p></div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"><CalendarDays size={12} />Agenda</div><p className="mt-3 text-xl font-black text-white">{sortedEvents.length}</p></div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"><MapPin size={12} />Sigla</div><p className="mt-3 text-xl font-black text-white">{league.sigla || "-"}</p></div>
          </div>
        </section>
      </main>
    </div>
  );
}
