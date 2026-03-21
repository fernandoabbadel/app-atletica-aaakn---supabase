"use client";

import React, { useEffect, useMemo, useState } from "react";
import { 
  ArrowLeft, Calendar, MapPin, 
  Loader2, ArrowRight, Heart, Clock, Zap, Users, Search
} from "lucide-react";
import Link from "next/link";
import { OptimizedImage } from "@/app/components/shared/OptimizedImage";
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "../../context/ToastContext";
import { fetchEventsFeed, toggleEventLike } from "../../lib/eventsNativeService";
import { getTurmaImage } from "../../constants/turmaImages";
import { resolvePlanScopedPrice } from "../../lib/commerceCatalog";
import { withTenantSlug } from "@/lib/tenantRouting";
import { collectUserPlanScope } from "@/lib/userPlanScope";
// --- INTERFACES ---
export interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  data: string;
  hora: string;
  local: string;
  imagem?: string;
  imagePositionY?: number;
  tipo: string;
  destaque?: string;
  categoria?: string;
  status?: string;
  saleStatus?: 'ativo' | 'esgotado' | 'em_breve';
  sale_status?: 'ativo' | 'esgotado' | 'em_breve';
  isLowStock?: boolean;
  stats?: {
    confirmados: number;
    talvez: number;
    likes?: number;
  };
  lotes?: Array<{
    nome: string;
    preco: string;
    status: 'ativo' | 'esgotado' | 'em_breve';
    planPrices?: Array<{ planId?: string; planName?: string; price?: string | number }>;
  }>;
  likesList?: string[];
  topTurmas?: string[];
  interessados?: string[]; // Array de UIDs para controle
}

const getSaleStatusLabel = (status?: Evento["saleStatus"]): string => {
  if (status === "em_breve") return "Em-breve";
  if (status === "esgotado") return "Esgotado";
  return "Ativo";
};

const getSaleStatusClass = (status?: Evento["saleStatus"]): string => {
  if (status === "em_breve") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (status === "esgotado") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

interface EventosClientPageProps {
  initialEventos: Evento[];
}

// --- HELPER: PARSER DE DATA ---
const parseEventDate = (dateStr: string, timeStr: string = "00:00") => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const [hours, mins] = timeStr.split(':').map(Number);
        
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d, hours || 0, mins || 0);
        }

        if (dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
            const [d, m, y] = dateStr.split('/').map(Number);
            return new Date(y, m - 1, d, hours || 0, mins || 0);
        }

        const months: Record<string, number> = {
            'JAN': 0, 'FEV': 1, 'MAR': 2, 'ABR': 3, 'MAI': 4, 'JUN': 5,
            'JUL': 6, 'AGO': 7, 'SET': 8, 'OUT': 9, 'NOV': 10, 'DEZ': 11,
            'JANEIRO': 0, 'FEVEREIRO': 1, 'MARCO': 2, 'ABRIL': 3, 'MAIO': 4, 'JUNHO': 5,
            'JULHO': 6, 'AGOSTO': 7, 'SETEMBRO': 8, 'OUTUBRO': 9, 'NOVEMBRO': 10, 'DEZEMBRO': 11
        };
        const cleanDate = dateStr.toUpperCase().trim();
        const parts = cleanDate.split(' '); 
        
        if (parts.length >= 2) {
            const day = parseInt(parts[0]);
            // Busca parcial (ex: "NOV" em "NOVEMBRO")
            const monthStr = parts[1].substring(0, 3);
            const monthKey = Object.keys(months).find(m => m.startsWith(monthStr));
            
            if (monthKey && !isNaN(day)) {
                // Fix: "const" aqui pois a referencia do objeto nao muda, so suas propriedades
                const eventDate = new Date(currentYear, months[monthKey], day, hours || 0, mins || 0);
                // Se a data ja passou (ex: JAN sendo que estamos em DEZ), assume proximo ano
                if (eventDate < now && (now.getMonth() - months[monthKey]) > 6) {
                    eventDate.setFullYear(currentYear + 1);
                }
                return eventDate;
            }
        }
        return null;
    } catch {
        // Fix: removido argumento "e" nao usado
        return null;
    }
};

// --- COMPONENTE: RANKING DE TURMAS (RSVP) ---
function EventClassRanking({ event }: { event: Evento }) {
  const totalConfirmados = event.stats?.confirmados || 0;
  const rankingTurmas = (event.topTurmas || [])
    .slice(0, 3)
    .map((turma) => ({
      turma,
      img: getTurmaImage(turma, "https://github.com/shadcn.png"),
    }));

  if (totalConfirmados === 0)
    return (
      <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase bg-black/20 px-3 py-2 rounded-xl border border-dashed border-zinc-800 w-full justify-center">
        <Users size={12} /> Seja o primeiro a ir!
      </div>
    );

  return (
    <div className="flex items-center gap-3 bg-zinc-950/50 p-2 rounded-xl border border-zinc-800">
      {rankingTurmas.length > 0 && (
        <div className="flex -space-x-2">
          {rankingTurmas.map((r, i) => (
            <div
              key={r.turma}
              className="relative w-8 h-8 rounded-full border-2 border-zinc-900 overflow-hidden"
              style={{ zIndex: 30 - i * 10 }}
            >
              <OptimizedImage
                src={r.img}
                alt={`Avatar ${r.turma}`}
                fill
                sizes="32px"
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-[9px] font-bold text-zinc-400 uppercase">Presenca</span>
        <span className="text-xs font-black text-emerald-400">+{totalConfirmados} confirmados</span>
      </div>
    </div>
  );
}
// --- COMPONENTE: CONTADOR ---
function EventCountdown({ targetDate, targetTime }: { targetDate: string, targetTime: string }) {
  const [timeLeft, setTimeLeft] = useState("CALCULANDO...");

  useEffect(() => {
    const calculateTime = () => {
        if (!targetDate) return "EM BREVE";
        
        const eventDate = parseEventDate(targetDate, targetTime);
        if (!eventDate) return targetDate; // Fallback se nao conseguir parsear

        const now = new Date();
        const diff = eventDate.getTime() - now.getTime();
        
        if (diff < 0) return "HOJE!";
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        if (days > 0) return `FALTAM ${days} DIAS`;
        return `FALTAM ${hours} HORAS`;
    };
    
    setTimeLeft(calculateTime());
    const interval = setInterval(() => setTimeLeft(calculateTime()), 60000);
    return () => clearInterval(interval);
  }, [targetDate, targetTime]);

  return (
    <div className="flex items-center gap-1 text-[10px] font-black bg-black/60 backdrop-blur-md text-white px-3 py-1.5 rounded-full border border-white/10 shadow-lg animate-in fade-in">
      <Clock size={12} className="text-emerald-500" />
      <span className="tracking-wide">{timeLeft}</span>
    </div>
  );
}

// --- COMPONENTE: CARD DO EVENTO ---
function EventCard({
  ev,
  userId,
  userPlanNames,
  userPlanIds,
  onLikeError,
  tenantId,
  tenantSlug,
  imagePriority = false,
}: {
  ev: Evento;
  userId?: string;
  userPlanNames: string[];
  userPlanIds: string[];
  onLikeError: (message: string) => void;
  tenantId?: string;
  tenantSlug?: string;
  imagePriority?: boolean;
}) {
  const [liked, setLiked] = useState(Boolean(userId && ev.likesList?.includes(userId)));
  const [likesCount, setLikesCount] = useState(ev.stats?.likes || 0);
  const saleStatus = ev.saleStatus || ev.sale_status || "ativo";

  useEffect(() => {
    setLiked(Boolean(userId && ev.likesList?.includes(userId)));
    setLikesCount(ev.stats?.likes || 0);
  }, [userId, ev.likesList, ev.stats?.likes]);

  const loteAtivo = ev.lotes?.find((l) => l.status === 'ativo');
  const precoDisplay = loteAtivo
    ? `R$ ${resolvePlanScopedPrice({
        basePrice: Number.parseFloat(String(loteAtivo.preco || "0").replace(",", ".")) || 0,
        entries: Array.isArray(loteAtivo.planPrices)
          ? loteAtivo.planPrices.map((entry) => ({
              planId: String(entry.planId || ""),
              planName: String(entry.planName || ""),
              price:
                typeof entry.price === "number"
                  ? entry.price
                  : Number.parseFloat(String(entry.price || "0").replace(",", ".")) || 0,
            }))
          : [],
        userPlanIds,
        userPlanNames,
      }).toFixed(2).replace(".", ",")}`
    : (saleStatus === "em_breve" ? "Em breve" : ev.lotes && ev.lotes.length > 0 ? "Esgotado" : "Em breve");

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) {
      onLikeError("Faca login para curtir eventos.");
      return;
    }

    const previousLiked = liked;
    const previousCount = likesCount;
    const nextLiked = !liked;

    setLiked(nextLiked);
    setLikesCount((prev) => (nextLiked ? prev + 1 : Math.max(0, prev - 1)));

    try {
      await toggleEventLike({
        eventId: ev.id,
        userId,
        currentlyLiked: previousLiked,
        tenantId,
      });
    } catch (error: unknown) {
      console.error(error);
      setLiked(previousLiked);
      setLikesCount(previousCount);
      onLikeError("Nao foi possivel atualizar a curtida agora.");
    }
  };

  return (
    <Link
      href={tenantSlug ? withTenantSlug(tenantSlug, `/eventos/${ev.id}`) : `/eventos/${ev.id}`}
      className="group h-full"
    >
      <div className="flex flex-col h-full w-full bg-zinc-900 border border-zinc-800 rounded-[24px] overflow-hidden hover:border-emerald-500/50 hover:shadow-2xl hover:shadow-emerald-900/20 transition-all duration-300">
        
        {/* 1. IMAGEM */}
        <div className="relative h-56 w-full shrink-0 overflow-hidden">
            <OptimizedImage 
                src={ev.imagem || "https://placehold.co/600x400/111/333?text=Evento"} 
                alt={ev.titulo}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                priority={imagePriority}
                className="object-cover transition-transform duration-700 group-hover:scale-105 opacity-80 group-hover:opacity-100"
                style={{ objectPosition: `50% ${ev.imagePositionY || 50}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />
            
            {/* Badges */}
            <div className="absolute top-3 left-3 flex gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase backdrop-blur-md shadow-lg ${ev.tipo === 'Liga' ? 'bg-blue-600 text-white' : 'bg-emerald-500 text-black'}`}>
                    {ev.tipo}
                </span>
                <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase backdrop-blur-md shadow-lg ${getSaleStatusClass(saleStatus)}`}>
                    {getSaleStatusLabel(saleStatus)}
                </span>
                {ev.destaque && (
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-yellow-500 text-black shadow-lg flex items-center gap-1">
                        <Zap size={10} fill="black"/> {ev.destaque}
                    </span>
                )}
            </div>

            {/* Contador */}
            <div className="absolute bottom-3 right-3">
                <EventCountdown targetDate={ev.data} targetTime={ev.hora} />
            </div>
        </div>

        {/* 2. CONTEUDO */}
        <div className="flex flex-col flex-1 p-5 gap-4">
            
            {/* Titulo */}
            <div>
                <h2 className="text-xl font-black italic uppercase leading-tight text-white mb-2 line-clamp-2">
                    {ev.titulo}
                </h2>
                <div className="flex flex-wrap gap-3 text-xs font-bold text-zinc-400 uppercase">
                    <span className="flex items-center gap-1.5"><Calendar size={14} className="text-emerald-500"/> {ev.data}</span>
                    <span className="flex items-center gap-1.5"><Clock size={14} className="text-emerald-500"/> {ev.hora}</span>
                    <span className="flex items-center gap-1.5"><MapPin size={14} className="text-emerald-500"/> {ev.local}</span>
                </div>
            </div>

            {/* Ranking (RSVP) */}
            <EventClassRanking event={ev} />

            {/* Footer do Card */}
            <div className="mt-auto pt-4 border-t border-zinc-800 flex items-center justify-between">
                
                {/* Preco */}
                <div>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">A partir de</p>
                    <p className={`text-lg font-black ${loteAtivo ? 'text-white' : 'text-zinc-600'}`}>{precoDisplay}</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* BOTAO DE LIKE */}
                    <button 
                        onClick={handleLike}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-full border transition-all ${liked ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white'}`}
                    >
                        <Heart size={16} className={liked ? "fill-current" : ""} />
                        <span className="text-xs font-black">{likesCount}</span>
                    </button>

                    {/* Seta de Ir */}
                    <div className="bg-white text-black p-2.5 rounded-full group-hover:bg-emerald-500 transition-colors shadow-lg">
                        <ArrowRight size={18}/>
                    </div>
                </div>
            </div>
        </div>

      </div>
    </Link>
  );
}

// --- PAGINA PRINCIPAL ---
export default function EventosClientPage({ initialEventos }: EventosClientPageProps) {
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const [eventos, setEventos] = useState<Evento[]>(initialEventos);
  const [loading, setLoading] = useState(initialEventos.length === 0);
  const [filter, setFilter] = useState("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const { userPlanNames, userPlanIds } = useMemo(() => collectUserPlanScope(user), [user]);

  useEffect(() => {
    if (initialEventos.length > 0) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadEvents = async () => {
      try {
        const rows = await fetchEventsFeed({
          maxResults: 24,
          forceRefresh: false,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setEventos(rows as unknown as Evento[]);
      } catch (error: unknown) {
        console.error("Erro eventos:", error);
        if (mounted) addToast("Erro ao carregar eventos.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadEvents();
    return () => {
      mounted = false;
    };
  }, [addToast, initialEventos.length, tenantId]);

  const activeEvents = eventos.filter((event) => {
    const status = String(event.status || "ativo").toLowerCase().trim();
    if (status !== "ativo") return false;

    const parsedDate = parseEventDate(event.data, event.hora);
    if (!parsedDate) return true;
    return parsedDate.getTime() >= Date.now();
  });

  const categoryFilteredEvents =
    filter === "Todos"
      ? activeEvents
      : activeEvents.filter((event) => event.tipo === filter || event.categoria === filter);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredEvents =
    normalizedSearch.length === 0
      ? categoryFilteredEvents
      : categoryFilteredEvents.filter((event) => {
          const haystack = [
            event.titulo,
            event.local,
            event.tipo,
            event.categoria || "",
            event.destaque || "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedSearch);
        });

  if (loading) return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-emerald-500 gap-3">
          <Loader2 className="animate-spin w-10 h-10"/>
          <p className="text-xs font-black tracking-widest uppercase">Carregando Agenda...</p>
      </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 font-sans pb-32">
      
      {/* HEADER */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
            <Link href={tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard"} className="bg-zinc-900 p-3 rounded-full hover:bg-zinc-800 transition border border-zinc-800">
                <ArrowLeft size={20} className="text-zinc-400"/>
            </Link>
            <div>
                <h1 className="text-3xl font-black uppercase tracking-tighter italic">Agenda<span className="text-emerald-500">Eventos</span></h1>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Proximos Eventos</p>
            </div>
        </div>
      </header>

      {/* FILTROS */}
      <div className="relative mb-4">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar evento por nome, local ou tipo..."
              className="w-full bg-zinc-900 border border-zinc-800 text-sm text-white rounded-xl py-3 pl-11 pr-4 outline-none focus:border-emerald-500 transition"
          />
      </div>

      <div className="flex gap-3 mb-8 overflow-x-auto pb-2 custom-scrollbar">
          {["Todos", "Festa", "Esporte", "Liga"].map(f => (
              <button 
                  key={f} 
                  onClick={() => setFilter(f)} 
                  className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase transition whitespace-nowrap border ${filter === f ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700'}`}
              >
                  {f}
              </button>
          ))}
      </div>

      {/* GRID RESPONSIVO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
          {filteredEvents.map((ev, index) => (
              <EventCard
                key={ev.id}
                ev={ev}
                userId={user?.uid}
                userPlanNames={userPlanNames}
                userPlanIds={userPlanIds}
                onLikeError={(message) => addToast(message, "error")}
                tenantId={tenantId || undefined}
                tenantSlug={tenantSlug || undefined}
                imagePriority={index < 2}
              />
          ))}

          {/* Estado Vazio */}
          {filteredEvents.length === 0 && (
              <div className="col-span-full text-center py-20 border-2 border-dashed border-zinc-800 rounded-[32px] bg-zinc-900/30 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center border border-zinc-800">
                      <Calendar size={32} className="text-zinc-600"/>
                  </div>
                  <div>
                      <p className="text-zinc-300 font-bold uppercase">Nada por aqui...</p>
                      <p className="text-zinc-600 text-xs mt-1">
                        Nenhum evento ativo encontrado para este filtro/pesquisa.
                      </p>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
}


