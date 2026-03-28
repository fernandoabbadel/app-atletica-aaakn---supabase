"use client";

import React, { useEffect, useState } from "react";
import {
  MapPin,
  Heart,
  CheckCircle,
  HelpCircle,
  Loader2,
  Users,
} from "lucide-react";
import Image from "next/image";
import { useAuth } from "../../../context/AuthContext";
import { useTenantTheme } from "../../../context/TenantThemeContext";
import { useToast } from "../../../context/ToastContext";
import {
  fetchEventCardState,
  setEventRsvp,
  toggleEventLike,
  type EventRsvpStatus,
} from "../../../lib/eventCardService";

interface Lote {
  nome: string;
  status: string;
}

interface EventStats {
  likes?: number;
  confirmados?: number;
  talvez?: number;
}

interface EventData {
  id: string;
  titulo: string;
  local: string;
  data: string;
  imagem?: string;
  tipo: string;
  viewerHasLiked?: boolean;
  lotes?: Lote[];
  stats?: EventStats;
}

interface EventCardProps {
  evento: EventData;
}

const applyConfirmedDelta = (
  current: number,
  fromStatus: EventRsvpStatus | null,
  toStatus: EventRsvpStatus | null
): number => {
  let next = current;
  if (fromStatus === "going") next -= 1;
  if (toStatus === "going") next += 1;
  return Math.max(0, next);
};

export function EventCard({ evento }: EventCardProps) {
  const { user } = useAuth();
  const { tenantId: activeTenantId } = useTenantTheme();
  const { addToast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [userRsvp, setUserRsvp] = useState<EventRsvpStatus | null>(null);
  const [previewAvatars, setPreviewAvatars] = useState<string[]>([]);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(evento.stats?.likes || 0);
  const [confirmedCount, setConfirmedCount] = useState(
    evento.stats?.confirmados || 0
  );

  useEffect(() => {
    setIsLiked(Boolean(evento.viewerHasLiked));
    setLikesCount(evento.stats?.likes || 0);
    setConfirmedCount(evento.stats?.confirmados || 0);
  }, [evento.stats?.likes, evento.stats?.confirmados, evento.viewerHasLiked]);

  useEffect(() => {
    let isMounted = true;

    const loadCardState = async () => {
      try {
        const state = await fetchEventCardState({
          eventId: evento.id,
          userId: user?.uid || null,
          previewLimit: 4,
          tenantId: activeTenantId || user?.tenant_id || undefined,
        });

        if (!isMounted) return;
        setUserRsvp(state.userRsvp);
        setPreviewAvatars(state.previewAvatars);
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(error);
        }
      }
    };

    void loadCardState();

    return () => {
      isMounted = false;
    };
  }, [activeTenantId, evento.id, user?.tenant_id, user?.uid]);

  const loteAtivo = evento.lotes?.find((l) => l.status === "ativo");
  const [dia, mes] = evento.data ? evento.data.split(" ") : ["??", "???"];

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) return addToast("Faça login para curtir!", "info");

    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    setLikesCount((prev) => Math.max(0, prev + (nextLiked ? 1 : -1)));

    try {
      await toggleEventLike({
        eventId: evento.id,
        userId: user.uid,
        currentlyLiked: !nextLiked,
        tenantId: activeTenantId || user?.tenant_id || undefined,
      });
    } catch (error: unknown) {
      setIsLiked(!nextLiked);
      setLikesCount((prev) => Math.max(0, prev + (nextLiked ? -1 : 1)));
      if (error instanceof Error) {
        console.error(error);
      }
      addToast("Não foi possível atualizar a curtida.", "error");
    }
  };

  const handleRSVP = async (e: React.MouseEvent, status: EventRsvpStatus) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) return addToast("Login necessário!", "error");
    if (isLoading) return;

    const previousRsvp = userRsvp;
    const nextRsvp: EventRsvpStatus | null =
      previousRsvp === status ? null : status;

    setUserRsvp(nextRsvp);
    setConfirmedCount((prev) => applyConfirmedDelta(prev, previousRsvp, nextRsvp));
    setIsLoading(true);

    try {
      await setEventRsvp({
        eventId: evento.id,
        userId: user.uid,
        status,
        userName: user.nome || "Anônimo",
        userAvatar: user.foto || "",
        userTurma: user.turma || "Geral",
        tenantId: activeTenantId || user?.tenant_id || undefined,
      });

      const refreshedState = await fetchEventCardState({
        eventId: evento.id,
        userId: user.uid,
        previewLimit: 4,
        forceRefresh: false,
        tenantId: activeTenantId || user?.tenant_id || undefined,
      });

      setUserRsvp(refreshedState.userRsvp);
      setPreviewAvatars(refreshedState.previewAvatars);
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(error);
      }
      setUserRsvp(previousRsvp);
      setConfirmedCount((prev) => applyConfirmedDelta(prev, nextRsvp, previousRsvp));
      addToast("Erro ao atualizar.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[#09090b] rounded-[2rem] overflow-hidden border border-zinc-800 shadow-xl hover:border-zinc-600 transition-all duration-300 flex flex-col group h-full relative hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]">
      {/* IMAGEM */}
      <div className="relative h-64 w-full overflow-hidden">
        <Image
          src={evento.imagem || "https://placehold.co/600x400"}
          alt={evento.titulo}
          fill
          
          className="object-cover group-hover:scale-110 transition duration-700 ease-in-out"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-black/20 to-transparent"></div>

        {/* DATA GIGANTE */}
        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md rounded-2xl p-2 min-w-[60px] flex flex-col items-center border border-white/10 shadow-lg">
          <span className="text-3xl font-black text-white leading-none">{dia}</span>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
            {mes}
          </span>
        </div>

        {/* Lote Badge */}
        <span
          className={`absolute top-4 right-4 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border backdrop-blur-md shadow-lg ${
            loteAtivo
              ? "bg-emerald-500 text-black border-emerald-400 animate-pulse"
              : "bg-red-500/80 text-white border-red-500"
          }`}
        >
          {loteAtivo ? loteAtivo.nome : "Esgotado"}
        </span>

        {/* Info Categoria */}
        <div className="absolute bottom-4 left-4">
          <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-white/10 backdrop-blur-md border border-white/20 text-white">
            {evento.tipo}
          </span>
        </div>
      </div>

      {/* CONTEUDO */}
      <div className="p-5 flex flex-col gap-4 flex-1 -mt-2 relative z-10">
        <div>
          <h3 className="font-black text-2xl text-white italic uppercase leading-tight mb-2 line-clamp-2 drop-shadow-md group-hover:text-emerald-400 transition-colors">
            {evento.titulo}
          </h3>
          <p className="text-zinc-400 text-xs font-bold flex items-center gap-1.5 uppercase tracking-wide">
            <MapPin className="h-3 w-3 text-emerald-500" /> {evento.local}
          </p>
        </div>

        {/* --- QUEM VAI (AVATARES REAIS) --- */}
        <div className="flex items-center justify-between py-3 border-t border-zinc-800/50">
          <div className="flex items-center -space-x-2">
            {previewAvatars.length > 0 ? (
              previewAvatars.slice(0, 4).map((avatar, i) => (
                <div
                  key={i}
                  className="h-7 w-7 rounded-full border-2 border-[#09090b] z-10 relative overflow-hidden"
                >
                  <Image
                    src={avatar || "https://github.com/shadcn.png"}
                    fill
                    className="object-cover"
                    alt="Avatar Participante"
                    
                  />
                </div>
              ))
            ) : (
              <span className="text-[10px] text-zinc-600 italic">
                Seja o primeiro!
              </span>
            )}
            {confirmedCount > 4 && (
              <div className="h-7 w-7 rounded-full bg-zinc-800 border-2 border-[#09090b] flex items-center justify-center z-0">
                <span className="text-[8px] font-bold text-zinc-400">
                  +{confirmedCount - 4}
                </span>
              </div>
            )}
          </div>
          <div className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <Users size={12} className="text-emerald-600" /> {confirmedCount} Confirmados
          </div>
        </div>

        {/* --- BOTOES DE ACAO --- */}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 mt-auto">
          {/* LIKE */}
          <button
            onClick={handleLike}
            className={`h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-200 active:scale-90 ${
              isLiked
                ? "bg-red-500 text-white border-red-600 shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                : "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:text-white"
            }`}
            aria-label={`Curtir evento (${likesCount})`}
          >
            <Heart className={`h-5 w-5 ${isLiked ? "fill-current" : ""}`} />
          </button>

          {/* VOU */}
          <button
            onClick={(e) => handleRSVP(e, "going")}
            disabled={isLoading}
            className={`
                    relative overflow-hidden h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 border transition-all duration-300 active:scale-95 group/btn
                    ${
                      userRsvp === "going"
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-black border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400"
                    }
                `}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle
                className={`h-4 w-4 ${userRsvp === "going" ? "fill-black" : ""}`}
              />
            )}
            <span className="text-[10px] font-black uppercase tracking-widest z-10">
              Eu Vou
            </span>
            {userRsvp !== "going" && (
              <div className="absolute inset-0 bg-emerald-500/10 opacity-0 group-hover/btn:opacity-100 transition-opacity"></div>
            )}
          </button>

          {/* TALVEZ */}
          <button
            onClick={(e) => handleRSVP(e, "maybe")}
            disabled={isLoading}
            className={`
                    h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 border transition-all duration-300 active:scale-95
                    ${
                      userRsvp === "maybe"
                        ? "bg-gradient-to-br from-yellow-400 to-yellow-600 text-black border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)]"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-yellow-500/50 hover:text-yellow-400"
                    }
                `}
          >
            <HelpCircle
              className={`h-4 w-4 ${userRsvp === "maybe" ? "fill-black" : ""}`}
            />
            <span className="text-[10px] font-black uppercase tracking-widest">
              Talvez
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
