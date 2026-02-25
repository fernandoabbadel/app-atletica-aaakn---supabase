// src/app/eventos/[id]/page.tsx
"use client";
import Image from "next/image";
import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  ArrowLeft, Calendar, MapPin, Share2, Ticket, Clock,
  Users, CheckCircle, HelpCircle, XCircle,
  Loader2, Crown, MessageCircle,
  Heart, Send, Trash2, ShieldAlert, Star,
  Ghost, Zap, Gem, Trophy, ShoppingBag, Fish, Swords,
  ChevronLeft, ChevronRight, Flag, Medal, Skull, Rocket, Phone, X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { db } from "@/lib/backend";
import {
  cancelEventTicketRequest,
  fetchEventDetailsBundle,
} from "../../../lib/eventsService";
import { getTurmaImage } from "../../../constants/turmaImages";
import { 
  doc, collection, runTransaction, serverTimestamp, 
  increment, addDoc, updateDoc, arrayUnion, arrayRemove, deleteDoc,
  Timestamp
} from "@/lib/supa/firestore";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";

// --- INTERFACES ---
interface Lote {
  id: string | number; 
  nome: string;
  preco: string;
  status: 'ativo' | 'esgotado' | 'em_breve';
}

interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  data: string;
  hora: string;
  local: string;
  imagem?: string;
  imagePositionY?: number;
  tipo: string;
  isLowStock?: boolean;
  stats?: {
    confirmados: number;
    talvez: number;
    likes?: number;
  };
  lotes?: Lote[];
  // ID 12: Dados financeiros locais do evento
  pixChave?: string;
  pixBanco?: string;
  pixTitular?: string;
  contatoComprovante?: string;
}

interface PedidoIngresso {
    id: string;
    loteNome: string;
    quantidade: number;
    valorTotal: string;
    status: string;
}

interface Rsvp {
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: 'going' | 'maybe';
  timestamp?: Timestamp | null;
}

interface Comentario {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  userPlanoCor?: string;
  userPlanoIcon?: string;
  userPatente?: string; 
  role?: string;
  likes: string[];
  reports: string[];
  hidden: boolean;
  createdAt: Timestamp | null;
}

interface EnqueteOption {
  text: string;
  votes: number;
  creatorId?: string;
  creatorName?: string;
  creatorAvatar?: string;
  votesByTurma?: Record<string, number>;
}

interface Enquete {
  id: string;
  question: string;
  options: EnqueteOption[];
  voters: string[];
  userVotes?: Record<string, number[]>;
  createdAt: Timestamp | null;
}

interface PatenteConfig {
    titulo: string;
    minXp: number;
    cor: string;
    iconName: string;
}

// --- CONFIGURACAO DE ICONES ---
const ICON_COMPONENTS: Record<string, React.ElementType> = {
    Fish, Swords, Crown, Skull, Rocket,
    Star, Zap, Trophy, Medal, Heart,
    Ghost, Gem, ShoppingBag
};

const DEFAULT_PATENTES: PatenteConfig[] = [
    { titulo: "Pl�ncton", minXp: 0, cor: "text-zinc-400", iconName: "Fish" },
    { titulo: "Peixe Palha�o", minXp: 500, cor: "text-orange-400", iconName: "Fish" },
    { titulo: "Barracuda", minXp: 2000, cor: "text-blue-400", iconName: "Swords" },
    { titulo: "Tubar�o Martelo", minXp: 5000, cor: "text-purple-400", iconName: "Fish" },
    { titulo: "Tubar�o Branco", minXp: 15000, cor: "text-emerald-400", iconName: "Fish" },
    { titulo: "MEGALODON", minXp: 50000, cor: "text-red-600", iconName: "Crown" },
];

const PLAN_COLORS: Record<string, string> = {
    yellow: "text-yellow-400", emerald: "text-emerald-400", purple: "text-purple-400",
    blue: "text-blue-400", red: "text-red-500", zinc: "text-zinc-400"
};

const COMMENT_MAX_CHARS = 280;
const POLL_OPTION_MAX_CHARS = 40;
const POLL_OPTION_MAX_COUNT = 10;

const parseEventDate = (dateStr: string, timeStr: string = "00:00") => {
    try {
        const [hours, mins] = timeStr.split(':').map(Number);
        
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d, hours || 0, mins || 0);
        }
        return null;
    } catch {
        return null;
    }
};

function EventCountdown({ dateStr, timeStr }: { dateStr: string, timeStr: string }) {
  const [timeLeft, setTimeLeft] = useState<{d: number, h: number, m: number, s: number} | null>(null);
  const [status, setStatus] = useState("CALCULANDO...");

  useEffect(() => {
    const tick = () => {
        const target = parseEventDate(dateStr, timeStr);
        if (!target) {
            setStatus("DATA INDEFINIDA");
            return;
        }
        const now = new Date();
        const diff = target.getTime() - now.getTime();

        if (diff <= 0) {
            setStatus("ESTA ROLANDO!");
            setTimeLeft(null);
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        setTimeLeft({ d: days, h: hours, m: minutes, s: seconds });
        setStatus("");
    };
    
    tick();
    const interval = setInterval(tick, 1000); 
    return () => clearInterval(interval);
  }, [dateStr, timeStr]);

  if (status) return <div className="bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-emerald-500/50 shadow-[0_0_25px_rgba(16,185,129,0.4)] animate-pulse"><span className="text-sm font-black text-emerald-400 tracking-[0.2em]">{status}</span></div>;

  return (
    <div className="flex gap-3 bg-black/40 backdrop-blur-sm p-2 rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.d || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Dias</span></div>
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.h || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Hrs</span></div>
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.m || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Min</span></div>
        <div className="flex flex-col items-center justify-center bg-emerald-900/20 w-12 h-14 rounded-xl border border-emerald-500/30"><span className="text-xl font-black text-emerald-400 leading-none">{String(timeLeft?.s || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-emerald-600 uppercase tracking-wider mt-1">Seg</span></div>
    </div>
  );
}

// --- BADGES DO USUARIO ---
const UserBadges = ({ data, patentesConfig }: { data: Comentario, patentesConfig: PatenteConfig[] }) => {
    const isAdminUser = data.role === 'admin_geral' || data.role === 'master';
    const PlanIcon = ICON_COMPONENTS[data.userPlanoIcon || 'Ghost'] || Ghost;
    const planColor = PLAN_COLORS[data.userPlanoCor || 'zinc'];
    const patenteName = data.userPatente || "Pl�ncton";
    const patenteConfig = patentesConfig.find(p => p.titulo === patenteName) || patentesConfig[0] || DEFAULT_PATENTES[0];
    const PatenteIcon = ICON_COMPONENTS[patenteConfig.iconName] || Fish;
    const patenteColor = patenteConfig.cor || "text-zinc-400";

    return (
        <div className="flex items-center gap-1.5 ml-1">
            {isAdminUser && <span title="Admin"><ShieldAlert size={12} className="text-red-500 fill-red-500/20" /></span>}
            {data.userPlanoIcon && data.userPlanoIcon !== 'ghost' && <PlanIcon size={12} className={planColor} title="Plano VIP" />}
            <div title={`Patente: ${patenteConfig.titulo}`} className="flex items-center justify-center"><PatenteIcon size={12} className={patenteColor} /></div>
        </div>
    );
};

export default function DetalhesEventoPage() {
  const params = useParams();
  const { user, isAdmin } = useAuth(); 
  const { addToast } = useToast();
  
  const [evento, setEvento] = useState<Evento | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [enquetes, setEnquetes] = useState<Enquete[]>([]);
  const [patentesConfig, setPatentesConfig] = useState<PatenteConfig[]>(DEFAULT_PATENTES);
  const [loading, setLoading] = useState(true);
  const [userRsvp, setUserRsvp] = useState<string | null>(null);
  
  const [modalUsersType, setModalUsersType] = useState<"going" | "maybe" | null>(null);
  const [newComment, setNewComment] = useState("");
  const [newPollOption, setNewPollOption] = useState("");
  
  const [currentPollIndex, setCurrentPollIndex] = useState(0);

  // Novos estados para pedidos
  const [meusPedidos, setMeusPedidos] = useState<PedidoIngresso[]>([]);
  // Usando Record<string, unknown> para evitar 'any'
  const [globalFinanceiro, setGlobalFinanceiro] = useState<Record<string, unknown> | null>(null);
  const contatoFinanceiro = (() => {
      const telefones = globalFinanceiro?.telefones;
      if (typeof telefones === "string") return telefones;
      const whatsapp = globalFinanceiro?.whatsapp;
      if (typeof whatsapp === "string") return whatsapp;
      return undefined;
  })();

    const eventId = typeof params.id === "string" ? params.id : "";

  const refreshEventData = useCallback(
      async (withLoading = false) => {
          if (!eventId) {
              setLoading(false);
              return;
          }

          if (withLoading) setLoading(true);
          try {
              const bundle = await fetchEventDetailsBundle({
                  eventId,
                  userId: user?.uid || null,
                  rsvpsLimit: 600,
                  commentsLimit: 300,
                  pollsLimit: 60,
                  pedidosLimit: 60,
                  forceRefresh: false,
              });

              setEvento(bundle.evento as Evento | null);
              setRsvps(bundle.rsvps as unknown as Rsvp[]);
              setComentarios(bundle.comentarios as unknown as Comentario[]);
              setEnquetes(bundle.enquetes as unknown as Enquete[]);
              setPatentesConfig(
                  bundle.patentes.length > 0
                      ? (bundle.patentes as unknown as PatenteConfig[])
                      : DEFAULT_PATENTES
              );
              setGlobalFinanceiro(bundle.financeiro);
              setMeusPedidos(bundle.meusPedidos as unknown as PedidoIngresso[]);

              if (user) {
                  const me = (bundle.rsvps as unknown as Rsvp[]).find((p) => p.userId === user.uid);
                  setUserRsvp(me ? me.status : null);
              } else {
                  setUserRsvp(null);
              }
          } catch (error: unknown) {
              console.error(error);
              addToast("Erro ao carregar evento.", "error");
          } finally {
              setLoading(false);
          }
      },
      [eventId, user, addToast]
  );

  useEffect(() => {
      void refreshEventData(true);
  }, [refreshEventData]);

  // --- ACTIONS ---

  const handleCancelOrder = async (pedidoId: string) => {
      if (!confirm("Tem certeza que deseja cancelar este pedido?")) return;
      try {
          await cancelEventTicketRequest(pedidoId);
          addToast("Pedido cancelado.", "info");
          await refreshEventData();
      } catch {
          addToast("Erro ao cancelar.", "error");
      }
  };

  const handleRSVP = async (status: "going" | "maybe") => {
      if (!user || !evento) return addToast("Faca login para confirmar!", "error");
      try {
          await runTransaction(db, async (t) => {
              const ref = doc(db, "eventos", evento.id, "rsvps", user.uid);
              const eventRef = doc(db, "eventos", evento.id);
              
              const docSnap = await t.get(ref);
              const old = docSnap.exists() ? (docSnap.data() as Rsvp).status : null;

              if (old === status) {
                  t.delete(ref);
                  t.update(eventRef, { 
                      [`stats.${status === 'going' ? 'confirmados' : 'talvez'}`]: increment(-1),
                      interessados: arrayRemove(user.uid) 
                  });
              } else {
                  if (old) {
                      t.update(eventRef, { [`stats.${old === 'going' ? 'confirmados' : 'talvez'}`]: increment(-1) });
                  }
                  t.set(ref, {
                      userId: user.uid, status, userName: user.nome || "Anonimo", 
                      userAvatar: user.foto || "", userTurma: user.turma || "Geral", timestamp: serverTimestamp()
                  });
                  t.update(eventRef, { 
                      [`stats.${status === 'going' ? 'confirmados' : 'talvez'}`]: increment(1),
                      interessados: arrayUnion(user.uid) 
                  });
              }
          });
          addToast("Lista atualizada!", "success");
          await refreshEventData();
      } catch { addToast("Erro ao atualizar.", "error"); }
  };

  const handleSendComment = async () => {
      const commentText = newComment.trim().slice(0, COMMENT_MAX_CHARS);
      if (!commentText || !user || !evento) return;
      const newCommentData = {
          text: commentText, userId: user.uid, userName: user.nome || "Anonimo",
          userAvatar: user.foto || "", userTurma: user.turma || "Geral",
          userPlanoCor: user.plano_cor || "zinc", userPlanoIcon: user.plano_icon || "ghost",
          userPatente: user.patente || "Pl�ncton", role: user.role || 'user',
          createdAt: serverTimestamp(), likes: [], reports: [], hidden: false
      };
      try {
          await addDoc(collection(db, "eventos", evento.id, "comentarios"), newCommentData);
          await updateDoc(doc(db, "users", user.uid), { "stats.commentsCount": increment(1) });
          setNewComment("");
          addToast("Comentario enviado!", "success");
          await refreshEventData();
      } catch { addToast("Erro ao comentar.", "error"); }
  };

  const handleLikeComment = async (comId: string, currentLikes: string[], authorId: string) => {
      if (!user || !evento) return;
      const ref = doc(db, "eventos", evento.id, "comentarios", comId);
      const safeLikes = Array.isArray(currentLikes) ? currentLikes : [];
      const hasLiked = safeLikes.includes(user.uid);
      try {
          if (hasLiked) { await updateDoc(ref, { likes: arrayRemove(user.uid) }); } 
          else { await updateDoc(ref, { likes: arrayUnion(user.uid) }); }
          if (user.uid !== authorId) {
              const incrementVal = hasLiked ? -1 : 1;
              await updateDoc(doc(db, "users", authorId), { "stats.likesReceived": increment(incrementVal) });
              await updateDoc(doc(db, "users", user.uid), { "stats.likesGiven": increment(incrementVal) });
          }
          await refreshEventData();
      } catch (error) { console.error(error); }
  };

  const handleDeleteComment = async (comId: string) => {
      if (!evento || !confirm("Apagar este comentario?")) return;
      try {
          await deleteDoc(doc(db, "eventos", evento.id, "comentarios", comId));
          addToast("Comentario apagado.", "info");
          await refreshEventData();
      } catch {
          addToast("Erro ao apagar.", "error");
      }
  };

  const handleReportComment = async (comId: string) => {
      if (!user || !evento) return;
      await updateDoc(doc(db, "eventos", evento.id, "comentarios", comId), { reports: arrayUnion(user.uid) });
      addToast("Comentario denunciado.", "info");
      await refreshEventData();
  };

  const handleToggleHideComment = async (comId: string, currentStatus: boolean) => {
      if(!evento) return;
      await updateDoc(doc(db, "eventos", evento.id, "comentarios", comId), { hidden: !currentStatus });
      addToast(currentStatus ? "Comentario restaurado." : "Comentario ocultado.", "info");
      await refreshEventData();
  };

  const handleVotePoll = async (pollId: string, optionIndex: number) => {
      if (!user || !evento) return addToast("Login necessario.", "error");
      const pollRef = doc(db, "eventos", evento.id, "enquetes", pollId);
      try {
        await runTransaction(db, async (t) => {
            const pollDoc = await t.get(pollRef);
            if (!pollDoc.exists()) throw "Enquete nao existe";
            const data = pollDoc.data() as Enquete;
            const newOptions = [...data.options];
            const userVotes = data.userVotes || {}; 
            const myVotes = userVotes[user.uid] || [];
            if (myVotes.includes(optionIndex)) {
                newOptions[optionIndex].votes = Math.max(0, (newOptions[optionIndex].votes || 0) - 1);
                const userTurma = user.turma || "Geral";
                if(newOptions[optionIndex].votesByTurma && newOptions[optionIndex].votesByTurma![userTurma] > 0) { newOptions[optionIndex].votesByTurma![userTurma]--; }
                const newMyVotes = myVotes.filter(v => v !== optionIndex);
                userVotes[user.uid] = newMyVotes;
                t.update(pollRef, { options: newOptions, userVotes: userVotes });
            } else {
                if (myVotes.length >= 3) { throw "Voce ja escolheu 3 opcoes!"; }
                newOptions[optionIndex].votes = (newOptions[optionIndex].votes || 0) + 1;
                const userTurma = user.turma || "Geral";
                if(!newOptions[optionIndex].votesByTurma) newOptions[optionIndex].votesByTurma = {};
                newOptions[optionIndex].votesByTurma![userTurma] = (newOptions[optionIndex].votesByTurma![userTurma] || 0) + 1;
                userVotes[user.uid] = [...myVotes, optionIndex];
                t.update(pollRef, { options: newOptions, userVotes: userVotes, voters: arrayUnion(user.uid) });
            }
        });
        await refreshEventData();
      } catch (e: unknown) { 
        const errorMsg = typeof e === 'string' ? e : "Erro ao votar.";
        addToast(errorMsg, "error"); 
      }
  };

  const handleCreatePollOption = async (pollId: string) => {
      const cleanOptionText = newPollOption.trim().slice(0, POLL_OPTION_MAX_CHARS);
      if(!cleanOptionText || !user || !evento) return;

      const current = enquetes.find((poll) => poll.id === pollId);
      if (current && Array.isArray(current.options) && current.options.length >= POLL_OPTION_MAX_COUNT) {
          addToast(`Cada enquete aceita no maximo ${POLL_OPTION_MAX_COUNT} respostas.`, "error");
          return;
      }

      const optionAlreadyExists = Boolean(
          current?.options?.some(
              (option) => option.text.trim().toLowerCase() === cleanOptionText.toLowerCase()
          )
      );
      if (optionAlreadyExists) {
          addToast("Essa resposta ja existe na enquete.", "info");
          return;
      }

      const pollRef = doc(db, "eventos", evento.id, "enquetes", pollId);
      await updateDoc(pollRef, {
          options: arrayUnion({ 
              text: cleanOptionText, votes: 0, creatorId: user.uid, creatorName: user.nome?.split(" ")[0] || "Anonimo", creatorAvatar: user.foto || "", votesByTurma: {} 
          })
      });
      setNewPollOption("");
      addToast("Opcao adicionada!", "success");
      await refreshEventData();
  };

  const handleReportPoll = async (_pollId: string) => { if(!user) return; void _pollId; addToast("Enquete reportada a moderacao.", "info"); };
  const handleReportOption = async (_pollId: string, optionText: string) => { if(!user) return; void _pollId; addToast(`Opcao "${optionText}" denunciada.`, "info"); };

  const nextPoll = () => setCurrentPollIndex(prev => (prev + 1) % enquetes.length);
  const prevPoll = () => setCurrentPollIndex(prev => (prev - 1 + enquetes.length) % enquetes.length);
  const currentPoll = enquetes[currentPollIndex];

  const topTurmasPoll = useMemo(() => {
      if (!currentPoll) return [];
      const counts: Record<string, number> = {};
      currentPoll.options?.forEach((opt) => {
          if (opt.votesByTurma) {
              Object.entries(opt.votesByTurma).forEach(([turma, count]) => { counts[turma] = (counts[turma] || 0) + (count as number); });
          }
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  }, [currentPoll]);

  const sortedPollOptions = useMemo(() => {
      if (!currentPoll?.options) return [];
      return currentPoll.options
          .map((opt, originalIndex) => ({ opt, originalIndex }))
          .sort((left, right) => (right.opt.votes || 0) - (left.opt.votes || 0));
  }, [currentPoll]);

  const orderedComments = useMemo(() => {
      return [...comentarios].sort((left, right) => {
          const leftMs = left.createdAt?.toDate ? left.createdAt.toDate().getTime() : 0;
          const rightMs = right.createdAt?.toDate ? right.createdAt.toDate().getTime() : 0;
          return rightMs - leftMs;
      });
  }, [comentarios]);

  const handleShare = () => {
      if (evento && typeof navigator !== 'undefined' && navigator.share) {
          navigator.share({ title: evento.titulo, url: window.location.href });
      } else {
          navigator.clipboard.writeText(window.location.href);
          addToast("Link copiado!", "success");
      }
  };

  const modalUsers = useMemo(() => {
      if (!modalUsersType) return [];
      return rsvps.filter(r => r.status === modalUsersType);
  }, [rsvps, modalUsersType]);

  const rankingTurmas = useMemo(() => {
      const counts: Record<string, number> = {};
      rsvps.forEach(r => r.status === 'going' && (counts[(r.userTurma || "Geral").toUpperCase()] = (counts[(r.userTurma || "Geral").toUpperCase()] || 0) + 1));
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => ({
          turma: t,
          count: c,
          imagem: getTurmaImage(t, "https://github.com/shadcn.png"),
        }));
  }, [rsvps]);

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500 w-10 h-10"/></div>;
  if (!evento) return <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4"><XCircle size={40} className="text-red-500"/> <p>Evento nao encontrado.</p> <Link href="/eventos" className="text-emerald-500 underline">Voltar</Link></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-32 font-sans">
      
      {/* HERO IMAGE NEXT.JS */}
        <div className="relative w-full h-[56vh] min-h-[360px] max-h-[640px]">
            <Image 
                src={evento.imagem || "https://placehold.co/600x400/111/333"} 
                alt={`Capa do evento ${evento.titulo}`}
                fill
                sizes="100vw"
                priority
                className="object-cover" 
                style={{ objectPosition: `50% ${evento.imagePositionY || 50}%` }}
                unoptimized // Adicione isso para evitar erros de dominio externo
            />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/20 to-transparent"></div>
        
        <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-20">
            <Link href="/eventos" className="bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 text-white hover:bg-white hover:text-black transition">
                <ArrowLeft size={20} />
            </Link>
            <button onClick={handleShare} className="bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 text-white hover:bg-emerald-500 hover:text-black transition">
                <Share2 size={20} />
            </button>
        </div>

        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
            <EventCountdown dateStr={evento.data} timeStr={evento.hora} />
        </div>

      <div className="absolute bottom-24 right-6 z-20 flex flex-col items-end gap-2">
            {rankingTurmas.map((t) => (
                <div key={t.turma} className="flex items-center gap-2 bg-black/60 backdrop-blur-md pl-1 pr-3 py-1 rounded-full border border-white/10">
                    <Image 
                        src={t.imagem} 
                        alt={`Turma ${t.turma}`} 
                        width={24} 
                        height={24} 
                        className="rounded-full object-cover border border-zinc-500"
                    />
                    <span className="text-[10px] font-bold text-emerald-400">+{t.count}</span>
                </div>
            ))}
        </div>

        <div className="absolute bottom-0 left-0 p-6 w-full z-20">
            <span className="px-3 py-1 bg-emerald-500 text-black text-[10px] font-black uppercase rounded mb-2 inline-block">{evento.tipo}</span>
            <h1 className="text-3xl font-black italic uppercase leading-none text-white drop-shadow-xl mb-2">{evento.titulo}</h1>
            <div className="flex gap-4 text-xs font-bold text-zinc-300 uppercase">
                <span className="flex items-center gap-1"><Calendar size={12} className="text-emerald-500"/> {evento.data}</span>
                <span className="flex items-center gap-1"><MapPin size={12} className="text-emerald-500"/> {evento.local}</span>
            </div>
        </div>
      </div>

      {/* CONTEUDO */}
      <div className="relative z-30 -mt-6 bg-[#050505] rounded-t-[30px] border-t border-white/10 p-6 space-y-8">
        
        {evento.descricao && (
            <div className="space-y-2">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Sobre o Evento</h3>
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{evento.descricao}</p>
            </div>
        )}

        {evento.isLowStock && (
            <div className="bg-gradient-to-r from-yellow-600 to-yellow-400 p-0.5 rounded-2xl animate-pulse shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                <div className="bg-black rounded-[14px] p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Star className="text-yellow-400 fill-yellow-400" size={24}/>
                        <div>
                            <p className="text-yellow-400 font-black uppercase text-sm tracking-widest">Ultimas Vagas</p>
                            <p className="text-zinc-400 text-[10px]">O lote vai virar em breve!</p>
                        </div>
                    </div>
                    {/* Link para nova compra */}
                    {evento.lotes && evento.lotes.length > 0 && evento.lotes[0].status === 'ativo' && (
                          <Link href={`/eventos/compra?evento=${evento.id}&lote=${evento.lotes[0].id}`} className="bg-yellow-400 text-black font-black text-xs px-4 py-2 rounded-lg uppercase hover:bg-yellow-300">Garantir</Link>
                    )}
                </div>
            </div>
        )}

        <div className="grid grid-cols-2 gap-3">
            <button onClick={() => handleRSVP('going')} className={`py-4 rounded-xl flex flex-col items-center gap-1 transition border ${userRsvp === 'going' ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg' : 'bg-zinc-900 border-zinc-800'}`}>
                <CheckCircle size={20}/> <span className="text-xs font-black uppercase">Eu Vou</span>
            </button>
            <button onClick={() => handleRSVP('maybe')} className={`py-4 rounded-xl flex flex-col items-center gap-1 transition border ${userRsvp === 'maybe' ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg' : 'bg-zinc-900 border-zinc-800'}`}>
                <HelpCircle size={20}/> <span className="text-xs font-black uppercase">Talvez</span>
            </button>
        </div>

        <div className="flex justify-center gap-6 text-[10px] font-bold uppercase text-zinc-500">
            <button onClick={() => setModalUsersType('going')} className="hover:text-emerald-500 transition underline decoration-dashed underline-offset-4 flex items-center gap-1">
                <Users size={12}/> {evento.stats?.confirmados || 0} Confirmados
            </button>
            <button onClick={() => setModalUsersType('maybe')} className="hover:text-yellow-500 transition underline decoration-dashed underline-offset-4 flex items-center gap-1">
                <HelpCircle size={12}/> {evento.stats?.talvez || 0} Interessados
            </button>
        </div>

        <div className="space-y-3">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Ticket size={14} className="text-emerald-500"/> Ingressos</h3>
            {evento.lotes?.map((l, i) => (
                <div key={i} className={`flex justify-between items-center p-4 rounded-xl border ${l.status === 'ativo' ? 'bg-zinc-900 border-emerald-500/50' : 'bg-black border-zinc-800 opacity-50'}`}>
                    <div>
                        <p className="text-xs font-black text-white uppercase">{l.nome}</p>
                        <p className="text-emerald-400 font-bold">R$ {l.preco}</p>
                    </div>
                    {l.status === 'ativo' ? 
                        // ID 4: Link atualizado para a nova pagina de compra com query params
                        <Link 
                            href={`/eventos/compra?evento=${evento.id}&lote=${l.id}`} 
                            className="bg-white text-black px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-400 transition shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                        >
                            Comprar
                        </Link> 
                        : <span className="text-[10px] font-bold text-zinc-600 uppercase border border-zinc-800 px-3 py-1 rounded-lg">{l.status}</span>}
                </div>
            ))}
        </div>

        {/* ENQUETES CARROSSEL */}
        <div className="space-y-4 pt-4 border-t border-zinc-800">
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <MessageCircle size={14} className="text-purple-500"/> Enquete da Galera
                </h3>
                {enquetes.length > 1 && (
                    <div className="flex gap-2">
                        <button onClick={prevPoll} className="p-1 bg-zinc-900 rounded hover:bg-zinc-800 text-zinc-400"><ChevronLeft size={16}/></button>
                        <button onClick={nextPoll} className="p-1 bg-zinc-900 rounded hover:bg-zinc-800 text-zinc-400"><ChevronRight size={16}/></button>
                    </div>
                )}
            </div>

            {currentPoll ? (
                <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 space-y-3 relative overflow-hidden transition-all duration-300">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold text-sm text-white max-w-[80%]">{currentPoll.question || "Qual a boa?"}</h4>
                        <button onClick={() => handleReportPoll(currentPoll.id)} className="text-zinc-600 hover:text-yellow-500"><ShieldAlert size={14}/></button>
                    </div>
                    
             {topTurmasPoll.length > 0 && (
            <div className="flex gap-2 mb-2 items-center bg-black/20 p-2 rounded-lg border border-white/5">
                {topTurmasPoll.map(turma => (
                    <div key={turma} className="flex items-center gap-1">
                        <div className="relative w-5 h-5 rounded-full border border-zinc-700 overflow-hidden">
                            <Image 
                                src={getTurmaImage(turma, "https://github.com/shadcn.png")} 
                                alt={`Turma ${turma}`} 
                                fill
                                sizes="20px"
                                className="object-cover"
                            />
                        </div>
                        <span className="text-[9px] font-bold text-zinc-400">{turma}</span>
                    </div>
                ))}
            </div>
        )}

                    <div className="space-y-2">
                        {sortedPollOptions.map(({ opt, originalIndex }) => {
                            const totalVotes = currentPoll.options.reduce((acc, o) => acc + (o.votes || 0), 0);
                            const percent = totalVotes > 0 ? Math.round(((opt.votes || 0) / totalVotes) * 100) : 0;
                            const userVotedHere = currentPoll.userVotes?.[user?.uid || ""]?.includes(originalIndex);

                            return (
                                <div key={`${opt.text}-${originalIndex}`} className="relative group">
                                    <button 
                                        onClick={() => handleVotePoll(currentPoll.id, originalIndex)} 
                                        className={`w-full relative bg-black rounded overflow-hidden flex justify-between items-center h-10 text-xs hover:bg-zinc-800 transition ${userVotedHere ? 'border border-purple-500/50' : ''}`}
                                        title={`${opt.votes} votos`}
                                    >
                                        <div className={`absolute left-0 top-0 h-full transition-all duration-500 ${userVotedHere ? 'bg-purple-500/40' : 'bg-purple-500/20'}`} style={{ width: `${percent}%` }}></div>
                                        
                                     <div className="relative z-10 pl-3 flex items-center gap-2 max-w-[70%]">
            {opt.creatorAvatar && (
                <Image 
                    src={opt.creatorAvatar} 
                    alt="Criador" 
                    width={20}
                    height={20}
                    className="rounded-full border border-zinc-700 object-cover" 
                    title={`Criado por ${opt.creatorName}`}
                    unoptimized
                />
            )}
            <span className="truncate text-left flex items-center gap-1">
                {opt.text}
                {userVotedHere && <CheckCircle size={10} className="text-purple-400"/>}
            </span>
        </div>
                                        
                                        <span className="relative z-10 pr-3 text-zinc-500 font-bold group-hover:text-purple-400 flex items-center gap-1">
                                            {opt.votes} <span className="text-[8px] font-normal uppercase">Votos</span>
                                        </span>
                                    </button>
                                    
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleReportOption(currentPoll.id, opt.text); }}
                                        className="absolute right-[-20px] top-1/2 -translate-y-1/2 text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                        title="Reportar Opcao"
                                    >
                                        <Flag size={10}/>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    
                    <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-800/50">
                        <input 
                            value={newPollOption}
                            onChange={e => setNewPollOption(e.target.value)}
                            placeholder="Adicionar resposta..."
                            className="bg-transparent text-xs text-white border-b border-zinc-700 outline-none flex-1 py-1"
                            maxLength={POLL_OPTION_MAX_CHARS}
                        />
                        <button onClick={() => handleCreatePollOption(currentPoll.id)} className="text-[10px] bg-purple-500/10 text-purple-400 px-2 rounded uppercase font-bold hover:bg-purple-500 hover:text-white transition">Add</button>
                    </div>
                    <p className="text-[8px] text-zinc-600 mt-1 italic text-center">
                        * Maximo 3 escolhas por usuario e {POLL_OPTION_MAX_COUNT} respostas por enquete. ({newPollOption.length}/{POLL_OPTION_MAX_CHARS})
                    </p>
                </div>
            ) : (
                <p className="text-[10px] text-zinc-600 italic">Nenhuma enquete ativa no momento.</p>
            )}
        </div>

        {/* COMENTARIOS */}
        <div className="space-y-6 pt-4 border-t border-zinc-800">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Mural do Role</h3>
            
            <div className="flex gap-2">
                <input 
                    value={newComment} 
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Solta o verbo..." 
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 text-sm text-white outline-none focus:border-emerald-500 transition-colors"
                    maxLength={COMMENT_MAX_CHARS}
                />
                <button onClick={handleSendComment} className="bg-emerald-500 p-3 rounded-xl text-black hover:bg-emerald-400 shadow-lg shadow-emerald-900/20">
                    <Send size={18}/>
                </button>
            </div>
            <p className="text-[10px] text-zinc-500 -mt-3">Comentario: {newComment.length}/{COMMENT_MAX_CHARS}</p>

            <div className="space-y-4">
                {orderedComments.map((c) => {
                    const nameColorClass = PLAN_COLORS[c.userPlanoCor || 'zinc'] || "text-zinc-300";
                    const likesArray = Array.isArray(c.likes) ? c.likes : [];

                return (!c.hidden || isAdmin) && (
            <div key={c.id} className={`flex gap-3 ${c.hidden ? 'opacity-50 grayscale' : ''}`}>
                <Link href={`/perfil/${c.userId}`}>
                    <div className="relative group/avatar cursor-pointer">
                        <Image 
                            src={c.userAvatar || "https://github.com/shadcn.png"} 
                            alt={c.userName} 
                            width={40}
                            height={40}
                            className="rounded-full bg-zinc-800 object-cover border border-zinc-800 group-hover/avatar:border-emerald-500 transition-colors"
                        />
                    </div>
                </Link>
                            
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5">
                                            <p className={`text-xs font-black ${nameColorClass} flex items-center gap-1`}>
                                                {c.userName}
                                            </p>
                                            {/* ID 651: Nova logica de badge baseada na config global */}
                                            <UserBadges data={c} patentesConfig={patentesConfig} />
                                        </div>
                                        {/* ID 653: Foto da Turma + Nome */}
                                       <div className="flex items-center gap-1 mt-0.5 opacity-60">
            <Image 
                src={getTurmaImage(c.userTurma, "https://github.com/shadcn.png")} 
                alt="Turma"
                width={12}
                height={12}
                className="rounded-full object-cover border border-zinc-800"
            />
            <span className="text-[9px] text-zinc-300 font-mono">{c.userTurma || "Visitante"}</span>
        </div>
                                    </div>

                                    <div className="flex gap-2 text-zinc-500">
                                        <button onClick={() => handleLikeComment(c.id, c.likes || [], c.userId)} className={`flex items-center gap-1 hover:text-red-500 ${likesArray.includes(user?.uid || "") ? 'text-red-500' : ''}`}>
                                            <Heart size={12} className={likesArray.includes(user?.uid || "") ? "fill-current" : ""}/> 
                                            <span className="text-[9px]">{likesArray.length || 0}</span>
                                        </button>
                                        
                                        <button onClick={() => handleReportComment(c.id)} className="hover:text-yellow-500"><ShieldAlert size={12}/></button>
                                        
                                        {(user?.uid === c.userId || isAdmin) && (
                                            <button onClick={() => handleDeleteComment(c.id)} className="hover:text-red-500 transition-colors" title="Apagar">
                                                <Trash2 size={12}/>
                                            </button>
                                        )}

                                        {isAdmin && (
                                            <button onClick={() => handleToggleHideComment(c.id, c.hidden)} className="hover:text-red-500 opacity-50 hover:opacity-100">
                                                {c.hidden ? <CheckCircle size={12}/> : <div className="w-3 h-3 bg-zinc-700 rounded-full"></div>}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{c.text}</p>
                                {c.hidden && <span className="text-[9px] text-red-500 font-bold uppercase block mt-1 border border-red-900/30 bg-red-900/10 px-2 py-0.5 rounded w-fit">Oculto pelo Admin</span>}
                            </div>
                        </div>
                    );
                })}
                {orderedComments.length === 0 && <p className="text-center text-xs text-zinc-600 py-4">Seja o primeiro a comentar!</p>}
            </div>
        </div>

        {meusPedidos.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-zinc-800">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Ticket size={14} className="text-purple-500"/> Seus Pedidos</h3>
                {meusPedidos.map(pedido => (
                    <div key={pedido.id} className={`p-4 rounded-xl border flex flex-col gap-3 ${pedido.status === 'aprovado' ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-yellow-900/10 border-yellow-500/30'}`}>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-sm font-bold text-white">{pedido.quantidade}x {pedido.loteNome}</p>
                                <p className="text-xs text-zinc-400 font-mono">R$ {pedido.valorTotal}</p>
                            </div>
                            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded flex items-center gap-1 ${pedido.status === 'aprovado' ? 'bg-emerald-500 text-black' : 'bg-yellow-500 text-black'}`}>
                                {pedido.status === 'aprovado' ? <CheckCircle size={12}/> : <Clock size={12}/>}
                                {pedido.status === 'aprovado' ? 'Confirmado' : 'Aguardando Aprovacao'}
                            </span>
                        </div>

                        {pedido.status !== 'aprovado' && (
                            <div className="bg-black/40 p-3 rounded-lg border border-white/5 text-xs">
                                <p className="text-zinc-400 mb-1 flex items-center gap-1"><Phone size={12}/> Envie o comprovante para:</p>
                                <p className="text-white font-mono">
                                    {evento.contatoComprovante || contatoFinanceiro || "(Consulte a diretoria)"}
                                </p>
                            </div>
                        )}

                        {pedido.status !== 'aprovado' && (
                            <button onClick={() => handleCancelOrder(pedido.id)} className="text-xs text-red-500 hover:text-red-400 font-bold uppercase flex items-center gap-1 self-end">
                                <X size={12}/> Cancelar Pedido
                            </button>
                        )}
                    </div>
                ))}
            </div>
        )}

      </div>

      {modalUsersType && (
          <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-zinc-950 w-full max-w-sm rounded-3xl border border-zinc-800 max-h-[70vh] flex flex-col shadow-2xl">
                  <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 rounded-t-3xl">
                      <h3 className="font-bold text-white uppercase tracking-wider text-sm flex items-center gap-2">
                          {modalUsersType === 'going' ? <CheckCircle size={16} className="text-emerald-500"/> : <HelpCircle size={16} className="text-yellow-500"/>}
                          {modalUsersType === 'going' ? 'Confirmados' : 'Interessados'}
                      </h3>
                      <button onClick={() => setModalUsersType(null)} className="p-2 hover:bg-zinc-800 rounded-full transition"><XCircle size={20} className="text-zinc-500"/></button>
                  </div>
                  <div className="p-2 overflow-y-auto space-y-1 custom-scrollbar flex-1">
                      {modalUsers.map((u, i) => (
                          <Link key={i} href={`/perfil/${u.userId}`} className="flex items-center gap-3 p-3 hover:bg-zinc-900 rounded-2xl transition group">
                           <div className="relative">
            <Image 
                src={u.userAvatar || "https://github.com/shadcn.png"} 
                alt={u.userName} 
                width={40}
                height={40}
                className="rounded-full object-cover border-2 border-zinc-800 group-hover:border-emerald-500 transition-colors"
            />
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center text-[9px] font-black text-white border border-black">
                {u.userTurma || "?"}
            </div>
        </div>
                              <div className="flex-1">
                                  <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{u.userName}</p>
                                  <p className="text-[10px] text-zinc-500 uppercase font-bold">Ver Perfil</p>
                              </div>
                              <ArrowLeft size={16} className="rotate-180 text-zinc-700 group-hover:text-white transition-colors"/>
                          </Link>
                      ))}
                      {modalUsers.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-12 text-zinc-600 gap-2">
                              <Users size={32} className="opacity-20"/>
                              <p className="text-xs">Ninguem nesta lista ainda.</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}


