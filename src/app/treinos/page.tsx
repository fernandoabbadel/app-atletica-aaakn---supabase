"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowLeft, MapPin, Clock, ChevronLeft, ChevronRight, Dumbbell, Calendar as CalendarIcon, AlertCircle, CheckCircle, Users, Trophy } from "lucide-react";
import Link from "next/link";
// 🦈 Removido useRouter não utilizado
import Image from "next/image"; // 🦈 Importado componente Image
import {
  fetchTreinoRsvps,
  fetchTreinosByDateRange,
  setTreinoRsvp
} from "../../lib/treinosService";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { getTurmaImage } from "../../constants/turmaImages";

// --- INTERFACES (FIM DOS ANY) ---
interface TreinoData {
  id: string;
  modalidade: string;
  horario: string;
  local: string;
  imagem?: string;
  dia: string;
  status?: string;
  confirmados?: string[];
}

interface RsvpData {
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "not_going";
}

interface TurmaStats {
  turma: string;
  count: number;
  img: string;
}

// --- 1. CONFIGURAÇÃO DE FERIADOS (UNITAU 2026) ---
const FERIADOS = [
    "2026-02-16", "2026-02-17", "2026-02-18",
    "2026-04-03", "2026-04-21",
    "2026-05-01", "2026-06-04",
    "2026-06-13", "2026-07-09",
    "2026-09-07", "2026-10-12",
    "2026-10-28", "2026-11-02", "2026-11-15", "2026-11-20",
    "2026-12-25"
];

// Helpers
const formatDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

// --- 2. CARD DE TREINO SUPERCHARGED ---
function TreinoCard({ treino }: { treino: TreinoData }) {
    const { user } = useAuth();
    const { addToast } = useToast();
    // 🦈 Router removido pois não era usado (navegação via Link)
    
    const [userRsvp, setUserRsvp] = useState<"going" | "not_going" | null>(null);
    const [rsvpsLocal, setRsvpsLocal] = useState<RsvpData[]>([]);
    const [stats, setStats] = useState({ 
        confirmados: 0, 
        avatares: [] as string[], 
        turmas: [] as TurmaStats[] 
    });
    const [loadingAction, setLoadingAction] = useState(false);

    const applyRsvps = useCallback((rows: RsvpData[]) => {
        setRsvpsLocal(rows);

        if (user) {
            const me = rows.find((r) => r.userId === user.uid);
            setUserRsvp(me ? me.status : null);
        } else {
            setUserRsvp(null);
        }

        const goingRows = rows.filter((r) => r.status === "going");
        const avatares = goingRows.map((r) => r.userAvatar).slice(0, 4);

        const counts: Record<string, number> = {};
        goingRows.forEach((r) => {
            if (r.userTurma) {
                const t = r.userTurma.toUpperCase();
                counts[t] = (counts[t] || 0) + 1;
            }
        });

        const ranking = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([turma, count]) => ({
                turma,
                count,
                img: getTurmaImage(turma, "https://github.com/shadcn.png"),
            }));

        setStats({ confirmados: goingRows.length, avatares, turmas: ranking });
    }, [user]);

    useEffect(() => {
        let mounted = true;

        const loadRsvps = async () => {
            try {
                const rows = await fetchTreinoRsvps(treino.id, { maxResults: 180, forceRefresh: false });
                if (!mounted) return;
                applyRsvps(rows as RsvpData[]);
            } catch (error: unknown) {
                console.error(error);
                if (mounted) {
                    applyRsvps([]);
                }
            }
        };

        void loadRsvps();
        return () => {
            mounted = false;
        };
    }, [treino.id, user?.uid, applyRsvps]);

    const handleRSVP = async (e: React.MouseEvent, status: "going" | "not_going") => {
        e.preventDefault(); 
        e.stopPropagation();

        if (!user) return addToast("Faça login!", "error");
        if (loadingAction) return;
        setLoadingAction(true);

        try {
            await setTreinoRsvp({
                treinoId: treino.id,
                userId: user.uid,
                userName: user.nome || "Atleta",
                userAvatar: user.foto || "",
                userTurma: user.turma || "Geral",
                status,
            });

            const next = status === "not_going"
                ? rsvpsLocal.filter((row) => row.userId !== user.uid)
                : [
                    ...rsvpsLocal.filter((row) => row.userId !== user.uid),
                    {
                        userId: user.uid,
                        userName: user.nome || "Atleta",
                        userAvatar: user.foto || "",
                        userTurma: user.turma || "Geral",
                        status: "going",
                    } as RsvpData,
                ];
            applyRsvps(next);

            if (status === 'going') {
                 addToast("Bora treinar! 💪", "success");
            } else {
                 addToast("Inscrição cancelada.", "info");
            }
        } catch (error) { 
            console.error(error); 
            addToast("Erro ao atualizar.", "error"); 
        } finally { 
            setLoadingAction(false); 
        }
    };

    const getColors = () => {
        const m = treino.modalidade.toLowerCase();
        if (m.includes("volei") || m.includes("vôlei")) return { 
            gradient: "from-yellow-500/40 via-black/80 to-black",
            badge: "bg-yellow-500 text-black border-yellow-400",
            text: "text-yellow-400"
        };
        if (m.includes("hand")) return {
            gradient: "from-blue-600/40 via-black/80 to-black",
            badge: "bg-blue-600 text-white border-blue-500",
            text: "text-blue-400"
        };
        if (m.includes("bateria")) return {
            gradient: "from-purple-600/40 via-black/80 to-black",
            badge: "bg-purple-600 text-white border-purple-500",
            text: "text-purple-400"
        };
        return {
            gradient: "from-emerald-600/40 via-black/80 to-black",
            badge: "bg-emerald-600 text-white border-emerald-500",
            text: "text-emerald-400"
        };
    };

    const theme = getColors();

    return (
        <Link href={`/treinos/${treino.id}`} className="block w-full">
            <div className="relative w-full min-h-[320px] rounded-[2.5rem] overflow-hidden border border-zinc-800 bg-[#09090b] group shadow-2xl hover:shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-all duration-500 hover:-translate-y-1">
                
                {/* 1. IMAGEM DE CAPA (EXPANDIDA E VISÍVEL) */}
                <div className="absolute inset-0 z-0 h-full w-full">
                    <Image 
                        src={treino.imagem || "https://placehold.co/800x600/111/333"} 
                        alt={`Capa do treino de ${treino.modalidade}`}
                        fill
                        unoptimized // 🦈 Para evitar erro de host externo
                        className="object-cover opacity-60 group-hover:opacity-80 group-hover:scale-105 transition duration-1000" 
                    />
                    <div className={`absolute inset-0 bg-gradient-to-b ${theme.gradient}`}></div>
                </div>

                {/* 2. CONTEÚDO SUPERIOR */}
                <div className="absolute top-0 left-0 w-full p-6 z-10 flex justify-between items-start">
                    <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest backdrop-blur-md border shadow-lg ${theme.badge}`}>
                        {treino.modalidade}
                    </div>
                    
                    {/* Contador Flutuante */}
                    <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                        <Users size={14} className="text-white"/>
                        <span className="text-xs font-bold text-white">{stats.confirmados}</span>
                    </div>
                </div>

                {/* 3. CONTEÚDO INFERIOR */}
                <div className="absolute bottom-0 left-0 w-full p-6 z-10 flex flex-col gap-6">
                    
                    {/* Título e Info */}
                    <div>
                        <h3 className="text-5xl font-black text-white italic uppercase tracking-tighter leading-[0.9] drop-shadow-xl mb-3">
                            {treino.modalidade}
                        </h3>
                        <div className="flex items-center gap-4 text-zinc-300 font-bold uppercase text-xs tracking-wider">
                            <span className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-lg border border-white/5"><Clock size={14} className={theme.text}/> {treino.horario}</span>
                            <span className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-lg border border-white/5"><MapPin size={14} className={theme.text}/> {treino.local}</span>
                        </div>
                    </div>

                    {/* Área de Ação e Social Proof */}
                    <div className="flex flex-col xl:flex-row items-end justify-between gap-4 pt-4 border-t border-white/10">
                        
                        {/* Esquerda: Quem vai + Turmas */}
                        <div className="flex flex-col gap-3 w-full xl:w-auto">
                            {/* Ranking de Turmas (Destaque Maior) */}
                            <div className="flex flex-wrap gap-2">
                                {stats.turmas.length > 0 ? stats.turmas.map((t, i) => (
                                    <div key={i} className="flex items-center gap-2 bg-black/50 backdrop-blur-md pl-1 pr-3 py-1 rounded-full border border-white/10">
                                        <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden border border-zinc-500 shrink-0 relative">
                                            {t.img ? (
                                                <Image 
                                                    src={t.img} 
                                                    alt={`Logo ${t.turma}`}
                                                    fill
                                                    className="object-cover"
                                                    unoptimized
                                                />
                                            ) : (
                                                <span className="text-[9px] flex items-center justify-center h-full text-white font-bold">{t.turma}</span>
                                            )}
                                        </div>
                                        <span className="text-xs font-black text-white tracking-tight">{t.turma} <span className={theme.text}>+{t.count}</span></span>
                                    </div>
                                )) : (
                                    <span className="text-zinc-500 text-[10px] font-bold uppercase flex items-center gap-1"><Trophy size={12}/> Seja a primeira turma!</span>
                                )}
                            </div>

                            {/* Avatares Pequenos */}
                            <div className="flex -space-x-2 pl-1">
                                {stats.avatares.map((src, i) => (
                                    <div key={i} className="w-6 h-6 rounded-full border border-black bg-zinc-800 overflow-hidden opacity-80 relative">
                                        <Image 
                                            src={src} 
                                            alt={`Avatar participante ${i}`}
                                            fill
                                            className="object-cover"
                                            unoptimized
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Direita: Botões de Decisão */}
                        <div className="flex gap-2 w-full xl:w-auto">
                            <button 
                                onClick={(e) => handleRSVP(e, 'not_going')}
                                className="flex-1 xl:flex-none h-12 px-5 rounded-2xl border border-red-500/20 text-red-500 hover:bg-red-500/10 font-black text-[10px] uppercase tracking-widest transition-colors backdrop-blur-sm"
                            >
                                Não Vou
                            </button>
                            <button 
                                onClick={(e) => handleRSVP(e, 'going')}
                                disabled={loadingAction}
                                className={`flex-1 xl:flex-none h-12 px-8 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 ${userRsvp === 'going' ? 'bg-emerald-500 text-black shadow-emerald-500/30' : 'bg-white text-black hover:bg-zinc-200'}`}
                            >
                                {loadingAction ? <span className="animate-spin">⌛</span> : userRsvp === 'going' ? <><CheckCircle size={16}/> Confirmado</> : "Eu Vou!"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Link>
    );
}

// --- 3. PÁGINA PRINCIPAL ---
export default function TreinosPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [treinosDoMes, setTreinosDoMes] = useState<TreinoData[]>([]);
  const [loading, setLoading] = useState(true);

  // Buscar Treinos
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startOfMonth = formatDateString(new Date(year, month, 1));
    const endOfMonth = formatDateString(new Date(year, month + 1, 0));

    const loadTreinos = async () => {
      setLoading(true);
      try {
        const lista = await fetchTreinosByDateRange({
          startDate: startOfMonth,
          endDate: endOfMonth,
          maxResults: 220,
          forceRefresh: false,
        });
        setTreinosDoMes(lista as TreinoData[]);
      } catch (error: unknown) {
        console.error(error);
        setTreinosDoMes([]);
      } finally {
        setLoading(false);
      }
    };

    void loadTreinos();
  }, [currentDate]);

  // Calendário
  const calendarDays = useMemo(() => {
      const daysInMonth = getDaysInMonth(currentDate);
      const firstDayIndex = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
      
      // Interface local para o calendário
      type CalendarItem = {
          day: number | null;
          dateStr?: string;
          treinos?: TreinoData[];
          isHoliday?: boolean;
          tooltip?: string;
      }

      const days: CalendarItem[] = [];
      for (let i = 0; i < firstDayIndex; i++) days.push({ day: null });
      
      for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = formatDateString(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
          const treinosDia = treinosDoMes.filter((t) => t.dia === dateStr && t.status !== 'cancelado');
          const isHoliday = FERIADOS.includes(dateStr);
          const tooltip = isHoliday ? "Feriado" : treinosDia.map((t) => `${t.modalidade}`).join(', ');
          days.push({ day: i, dateStr, treinos: treinosDia, isHoliday, tooltip });
      }
      return days;
  }, [currentDate, treinosDoMes]);

  // Lista Filtrada
  const treinosSelecionados = useMemo(() => {
      const targetStr = formatDateString(new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay));
      return treinosDoMes.filter((t) => t.dia === targetStr && t.status !== 'cancelado');
  }, [treinosDoMes, selectedDay, currentDate]);

  const isSelectedDateHoliday = FERIADOS.includes(formatDateString(new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay)));
  const monthLabel = currentDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32 selection:bg-emerald-500/30">
      
      <header className="fixed top-0 left-0 w-full z-30 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="p-4 flex items-center justify-between max-w-lg mx-auto">
            <Link href="/" className="p-2 -ml-2 text-zinc-400 hover:text-white transition rounded-full hover:bg-white/10 group"><ArrowLeft size={24}/></Link>
            <h1 className="font-black text-lg uppercase tracking-widest text-white italic">Agenda Tubarão 🦈</h1>
            <div className="w-8"></div>
        </div>
      </header>
      <div className="h-20"></div>

      {/* Calendário */}
      <div className="p-4 bg-zinc-900/30 border-b border-white/5 max-w-lg mx-auto rounded-b-3xl mb-8">
        <div className="flex justify-between items-center mb-6 px-2">
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1))}><ChevronLeft size={20} className="text-zinc-400 hover:text-white"/></button>
          <span className="text-xs font-black uppercase tracking-[0.2em] text-white">{monthLabel}</span>
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1))}><ChevronRight size={20} className="text-zinc-400 hover:text-white"/></button>
        </div>
        <div className="grid grid-cols-7 gap-y-4 gap-x-2 text-center">
          {WEEKDAYS.map((d, i) => <span key={i} className="text-[10px] font-bold text-zinc-600 uppercase mb-1">{d}</span>)}
          {calendarDays.map((item, idx) => {
            if (!item.day) return <div key={idx}></div>;
            const isSelected = selectedDay === item.day;
            return (
              <button key={idx} onClick={() => setSelectedDay(item.day!)} title={item.tooltip} className={`relative w-9 h-10 mx-auto flex flex-col items-center justify-center rounded-xl transition-all duration-300 group ${isSelected ? "bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)] scale-110 z-10 font-black" : item.isHoliday ? "bg-red-500/10 text-red-500 border border-red-500/30" : "bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}>
                <span className="text-xs">{item.day}</span>
                <div className="flex gap-0.5 mt-1 absolute bottom-1.5 px-1">{item.treinos && item.treinos.slice(0, 3).map((t, i) => <div key={i} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-black' : 'bg-emerald-500'} shadow-sm`}></div>)}</div>
                {item.isHoliday && !item.treinos?.length && <div className="absolute top-0 right-0 -mt-1 -mr-1"><AlertCircle size={8} className="text-red-500 fill-red-900/50"/></div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de Treinos */}
      <main className="p-4 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <CalendarIcon size={14} className="text-emerald-500"/> {selectedDay} DE {currentDate.toLocaleString('pt-BR', { month: 'long' }).toUpperCase()}
            </h2>
            {isSelectedDateHoliday && <span className="text-[9px] font-black text-red-500 uppercase bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20 flex items-center gap-1"><AlertCircle size={12}/> Feriado</span>}
        </div>

        {loading ? <div className="text-center py-20 text-zinc-600 animate-pulse text-xs font-bold uppercase">Carregando grade...</div> : 
         treinosSelecionados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-zinc-800 rounded-[2rem] bg-zinc-900/20"><Dumbbell className="text-zinc-700 mb-2" size={32}/><p className="text-zinc-500 text-xs font-bold uppercase">Sem treino</p></div>
        ) : (
            <div className="grid gap-10">
                {treinosSelecionados.map((treino) => <TreinoCard key={treino.id} treino={treino} />)}
            </div>
        )}
      </main>
    </div>
  );
}
