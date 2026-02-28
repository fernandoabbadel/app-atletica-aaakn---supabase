"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, Loader2, Target, Users, Heart, 
  CheckCircle, ChevronRight, ChevronLeft, ShoppingBag, 
  Star, Crown, Wallet, Dumbbell, ExternalLink, MessageCircle, Lightbulb, MapPin,
  ScanBarcode, Crosshair
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext'; 
import Link from 'next/link';
import Image from 'next/image'; 
import { 
    fetchDashboardBundle,
    toggleDashboardEventLike,
    toggleDashboardProductLike,
    toggleDashboardPostLike,
    type DashboardEvent,
    type DashboardLiga,
    type DashboardPartner,
    type DashboardPost,
    type DashboardProduct,
    type DashboardTurmaStat,
} from '../../lib/dashboardPublicService';
import { getTurmaImage } from "../../constants/turmaImages";

// --- INTERFACES ESTRITAS ---

type Evento = DashboardEvent;
type Produto = DashboardProduct;
type Liga = DashboardLiga;
type Parceiro = DashboardPartner;
type PostComunidade = DashboardPost;

const WEEKLY_BIZU_ACTIVE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

interface UserData {
    uid: string;
    nome: string;
    foto: string;
    turma: string;
    level?: number;
    selos?: number;
}

type PartnerTier = 'ouro' | 'prata' | 'standard';

const parsePartnerTier = (partner: Parceiro): PartnerTier => {
    const candidate = `${partner.plano || ''}`.trim().toLowerCase();
    const fallback = `${partner.categoria || ''}`.trim().toLowerCase();
    const tierValue = candidate || fallback;

    if (tierValue === 'ouro') return 'ouro';
    if (tierValue === 'prata') return 'prata';
    return 'standard';
};

const getPartnerLogoSrc = (partner: Parceiro): string =>
    partner.imgLogo || partner.imgCapa || '/logo.png';

const getPartnerCoverSrc = (partner: Parceiro): string =>
    partner.imgCapa || partner.imgLogo || '/placeholder_liga.png';

// --- SUB-COMPONENTES PADRONIZADOS ---

const NavButton = ({ onClick, icon: Icon }: { onClick: () => void, icon: React.ElementType }) => (
    <button 
        onClick={onClick} 
        className="w-8 h-8 flex items-center justify-center bg-zinc-900 rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-emerald-500 hover:bg-zinc-800 transition-all shadow-md active:scale-95"
    >
        <Icon size={16}/>
    </button>
);

interface SectionHeaderProps {
    title: string;
    icon: React.ElementType;
    link?: string;
    onPrev?: () => void;
    onNext?: () => void;
    colorClass?: string;
}

const SectionHeader = ({ title, icon: Icon, link, onPrev, onNext, colorClass = "text-emerald-500" }: SectionHeaderProps) => (
    <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-sm font-black uppercase tracking-widest mb-0 flex items-center gap-2 text-white">
            <Icon size={18} className={colorClass}/> {title}
        </h2>
        <div className="flex items-center gap-3">
            {link && (
                <Link href={link} className={`text-[10px] font-bold text-zinc-500 hover:${colorClass.replace('text-', 'text-hover-')} uppercase transition flex items-center gap-1`}>
                    Ver todos <ExternalLink size={10}/>
                </Link>
            )}
            {(onPrev || onNext) && (
                <div className="flex gap-2">
                    {onPrev && <NavButton onClick={onPrev} icon={ChevronLeft} />}
                    {onNext && <NavButton onClick={onNext} icon={ChevronRight} />}
                </div>
            )}
        </div>
    </div>
);

// --- COMPONENTE: CARD EVENTO ---
const EventCardItem = ({ evt, userId, onToggleLike }: { evt: Evento, userId: string, onToggleLike: (id: string, state: boolean) => void }) => {
  const isLiked = evt.likesList?.includes(userId);
  const isGoing = evt.participantes?.includes(userId);

  return (
    <div className="bg-zinc-900 min-w-full rounded-3xl overflow-hidden border border-zinc-800 flex flex-col snap-center relative h-[450px]">
      <Link href={`/eventos/${evt.id}`} className="relative h-64 w-full bg-black block group">
        {evt.imagem ? (
            <Image 
                src={evt.imagem} 
                alt={evt.titulo}
                fill
                className="object-cover opacity-80 group-hover:opacity-100 transition duration-500" 
                style={{ objectPosition: `50% ${evt.imagePositionY || 50}%` }} 
                
            />
        ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-700"><Calendar size={48}/></div>
        )}
        <span className="absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase bg-black/60 backdrop-blur-md border border-white/10 shadow-xl z-10">{evt.tipo || 'Geral'}</span>
      </Link>
      
      <div className="p-6 flex flex-col justify-between flex-1 bg-gradient-to-b from-zinc-900 to-black">
        <div>
            <h3 className="font-black text-2xl text-white italic uppercase leading-tight line-clamp-2">{evt.titulo}</h3>
            <div className="flex gap-4 mt-3 text-zinc-400 font-bold text-xs">
                <p className="flex items-center gap-1.5"><Calendar size={14} className="text-emerald-500"/> {evt.data}</p>
                {evt.local && <p className="flex items-center gap-1.5"><MapPin size={14} className="text-emerald-500"/> {evt.local}</p>}
            </div>
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <button 
                onClick={(e) => { e.preventDefault(); onToggleLike(evt.id, isLiked); }} 
                className={`flex items-center gap-2 font-bold text-xs transition ${isLiked ? 'text-red-500' : 'text-zinc-500 hover:text-white'}`}
            >
                <Heart size={20} className={isLiked ? 'fill-current' : ''}/> {evt.likesList?.length || 0}
            </button>
            
            <Link href={`/eventos/${evt.id}`} className={`px-6 py-3 rounded-xl font-black text-xs uppercase border transition flex items-center gap-2 shadow-lg ${isGoing ? 'bg-emerald-500 text-black border-emerald-500' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-emerald-500 hover:text-white'}`}>
                {isGoing && <CheckCircle size={14}/>} {isGoing ? 'Confirmado' : 'Ver Detalhes'}
            </Link>
        </div>
      </div>
    </div>
  );
};

// --- COMPONENTE: CARD PRODUTO COM CONTADOR DE TURMAS ---
const ProductCard = ({ prod, userId, onToggleLike, turmaStats }: { prod: Produto, userId: string, onToggleLike: (id: string, state: boolean) => void, turmaStats: DashboardTurmaStat[] }) => {
    const isLiked = prod.likes?.includes(userId);
    const likeCount = prod.likes?.length || 0;

    return (
        <div className="bg-zinc-900 min-w-full rounded-3xl overflow-hidden border border-zinc-800 flex flex-col h-[450px] snap-center group relative">
            <Link href={`/loja/${prod.id}`} className="h-64 bg-black relative block overflow-hidden">
                <Image 
                    src={prod.img} 
                    alt={prod.nome}
                    fill
                    className="object-cover group-hover:scale-105 transition duration-500" 
                    
                />
            </Link>
            
            <div className="p-6 flex flex-col justify-between flex-1 bg-gradient-to-b from-zinc-900 to-black">
                <div>
                    <h3 className="font-black text-2xl uppercase text-white leading-tight line-clamp-2">{prod.nome}</h3>
                    <p className="text-purple-400 font-black text-xl mt-2">R$ {Number(prod.preco).toFixed(2)}</p>
                </div>
                
                <div className="flex flex-col gap-3 pt-4 border-t border-white/5">
                    {/* Linha 1: Botões */}
                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-3">
                            <button 
                                onClick={(e) => { 
                                    e.preventDefault(); 
                                    e.stopPropagation(); 
                                    onToggleLike(prod.id, isLiked); 
                                }} 
                                className={`p-2 rounded-full border transition active:scale-90 ${isLiked ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'}`}
                            >
                                <Heart size={20} className={isLiked ? 'fill-current' : ''}/>
                            </button>
                            <span className="text-xs font-bold text-zinc-500">{likeCount}</span>
                        </div>
                        <Link href={`/loja/${prod.id}`} className="px-5 py-2.5 rounded-xl font-black text-xs uppercase border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500 hover:text-white transition">
                            Comprar
                        </Link>
                    </div>

                    {/* Linha 2: Contador de Turmas (NOVO) */}
                    {turmaStats.length > 0 && (
                        <div className="flex items-center gap-2">
                            {turmaStats.map((st, i) => (
                                <div key={i} className="flex items-center bg-zinc-800/50 rounded-full pr-2 border border-zinc-700/50 p-0.5">
                                    <div className="w-5 h-5 rounded-full overflow-hidden border border-zinc-600 bg-black relative">
                                          <Image 
                                              src={getTurmaImage(`T${st.turma}`)} 
                                              alt={`T${st.turma}`}
                                              fill
                                              className="object-cover"
                                              
                                           />
                                    </div>
                                    <span className="text-[9px] font-bold text-zinc-400 ml-1.5">+{st.count}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();

  const [events, setEvents] = useState<Evento[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [mensagens, setMensagens] = useState<PostComunidade[]>([]);
  const [treinos, setTreinos] = useState<string[]>([]);
  const [productTurmaStats, setProductTurmaStats] = useState<Record<string, DashboardTurmaStat[]>>({});
  
  // 🦈 State para o contador de Caça
  const [totalCaca, setTotalCaca] = useState(0);
  // 🦈 State para o total de Alunos (Y)
  const [totalAlunos, setTotalAlunos] = useState(0);

  const [loadingData, setLoadingData] = useState(true);
  const [loadingLike, setLoadingLike] = useState(false);

  // Refs com Tipagem Correta para scroll
  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const productsScrollRef = useRef<HTMLDivElement | null>(null);
  const ligasScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      try {
        const data = await fetchDashboardBundle();
        if (!active) return;

        setEvents(data.events);
        setProdutos(data.produtos);
        setParceiros(data.parceiros);
        setLigas(data.ligas);
        setMensagens(data.mensagens);
        setTreinos(data.treinos);
        setTotalCaca(data.totalCaca);
        setTotalAlunos(data.totalAlunos);
        setProductTurmaStats(data.productTurmaStats);
      } catch (error: unknown) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        if (active) {
          setLoadingData(false);
        }
      }
    };

    void loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const scroll = (ref: React.RefObject<HTMLDivElement | null>, dir: 'left' | 'right') => { 
      if (ref.current) {
          ref.current.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' }); 
      }
  };
  
  // Handlers com protecao
  const toggleLocalLikeList = (list: string[], uid: string, currentlyLiked: boolean): string[] => {
    if (currentlyLiked) {
      return list.filter((entry) => entry !== uid);
    }
    if (list.includes(uid)) return list;
    return [...list, uid];
  };

  const handleEventLike = async (id: string, state: boolean) => {
    if (!user || loadingLike) return;
    setLoadingLike(true);
    try {
      await toggleDashboardEventLike({
        eventId: id,
        userId: user.uid,
        currentlyLiked: state,
      });
      setEvents((prev) =>
        prev.map((evt) =>
          evt.id === id
            ? { ...evt, likesList: toggleLocalLikeList(evt.likesList || [], user.uid, state) }
            : evt
        )
      );
    } finally {
      setLoadingLike(false);
    }
  };

  const handleProductLike = async (id: string, state: boolean) => {
    if (!user || loadingLike) return;
    setLoadingLike(true);
    try {
      await toggleDashboardProductLike({
        productId: id,
        userId: user.uid,
        currentlyLiked: state,
      });
      setProdutos((prev) =>
        prev.map((prod) =>
          prod.id === id
            ? { ...prod, likes: toggleLocalLikeList(prod.likes || [], user.uid, state) }
            : prod
        )
      );
      setProductTurmaStats((prev) => ({
        ...prev,
        [id]: [],
      }));
    } finally {
      setLoadingLike(false);
    }
  };

  const handleMessageLike = async (id: string, currentLikes: string[]) => {
    if (!user || loadingLike) return;
    setLoadingLike(true);
    try {
      const isLiked = currentLikes?.includes(user.uid);
      await toggleDashboardPostLike({
        postId: id,
        userId: user.uid,
        currentlyLiked: isLiked,
      });
      setMensagens((prev) =>
        prev.map((msg) =>
          msg.id === id
            ? { ...msg, likes: toggleLocalLikeList(msg.likes || [], user.uid, isLiked) }
            : msg
        )
      );
    } finally {
      setLoadingLike(false);
    }
  };

  const toDateValue = (value: unknown): Date | null => {
    if (value instanceof Date) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed);
      return null;
    }
    if (typeof value === "object" && value !== null) {
      const toDate = (value as { toDate?: unknown }).toDate;
      if (typeof toDate === "function") {
        const parsed = toDate.call(value) as Date;
        if (parsed instanceof Date) return parsed;
      }
    }
    return null;
  };

  const formatTime = (value: unknown) => {
    const date = toDateValue(value);
    if (!date) return "";
    const diff = Math.floor((Date.now() - date.getTime()) / 60000);
    return diff < 60 ? `${diff}min` : `${Math.floor(diff / 60)}h`;
  };
  const parceirosOuro = parceiros.filter((p) => parsePartnerTier(p) === 'ouro');
  const parceirosPrata = parceiros.filter((p) => parsePartnerTier(p) === 'prata');
  const parceirosStandard = parceiros.filter((p) => parsePartnerTier(p) === 'standard');
  const getLigaBizuAtivo = (liga: Liga): string | null => {
    const bizu = (liga.bizu || "").trim();
    if (!bizu) return null;
    const referenceDate = toDateValue(liga.updatedAt ?? liga.createdAt);
    if (!referenceDate) return null;
    const ageMs = Date.now() - referenceDate.getTime();
    if (ageMs < 0 || ageMs > WEEKLY_BIZU_ACTIVE_WINDOW_MS) return null;
    return bizu;
  };
  const ligasNoDashboard = ligas.filter((l) => l.visivel === true);

  if (loading || loadingData) return <div className="h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500 w-10 h-10" /></div>;

  const userData = user as unknown as UserData; 

  return (
    <div className="flex flex-col gap-8 p-5 pb-32 max-w-md mx-auto w-full bg-[#050505] min-h-screen text-white font-sans selection:bg-emerald-500">
      
      {/* HEADER */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tighter uppercase italic">Fala, {userData?.nome?.split(' ')[0]}! 🦈</h1>
          <p className="text-zinc-500 text-xs font-bold tracking-wide">Pronto para dominar?</p>
        </div>
        <Link href="/perfil">
            <div className="h-12 w-12 rounded-full bg-zinc-900 border-2 border-emerald-500 p-0.5 overflow-hidden shadow-[0_0_15px_rgba(16,185,129,0.3)] relative">
                <Image 
                    src={userData?.foto || "https://github.com/shadcn.png"} 
                    alt="Perfil" 
                    fill
                    className="rounded-full object-cover" 
                    
                />
            </div>
        </Link>
      </div>

      {/* 0. PARCEIROS PREMIUM (OURO/PRATA) */}
      {(parceirosOuro.length > 0 || parceirosPrata.length > 0) && (
        <div className="space-y-4">
          <SectionHeader title="Parceiros Premium" icon={Crown} link="/parceiros" colorClass="text-yellow-500" />

          {parceirosOuro.length > 0 && (
            <div className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-4 pb-2">
              {parceirosOuro.map((p) => (
                <Link
                  href={`/parceiros/${p.id}`}
                  key={p.id}
                  className="min-w-full h-[450px] bg-zinc-900 rounded-3xl overflow-hidden border border-yellow-500/30 relative group snap-center active:scale-[0.99] transition"
                >
                  <div className="absolute inset-0">
                    <Image
                      src={getPartnerCoverSrc(p)}
                      alt={p.nome}
                      fill
                      className="object-cover opacity-35 group-hover:opacity-50 transition"
                      
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/65 to-black" />
                  </div>
                  <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-black/60 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-yellow-300">
                    <Crown size={12} className="fill-yellow-400 text-yellow-400" />
                    Parceiro Ouro
                  </div>
                  <div className="relative z-10 h-full flex flex-col justify-end p-6">
                    <div className="w-24 h-24 rounded-2xl bg-black/70 border border-yellow-500/30 overflow-hidden mb-4 relative shadow-[0_0_20px_rgba(234,179,8,0.15)]">
                      <Image src={getPartnerLogoSrc(p)} alt={p.nome} fill className="object-cover"  />
                    </div>
                    <h3 className="text-2xl font-black uppercase italic text-white leading-tight">{p.nome}</h3>
                    <p className="text-xs font-bold uppercase tracking-widest text-yellow-300/80 mt-2">
                      Benefícios em destaque para a base
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {parceirosPrata.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-[2rem] p-5">
              <div className="mb-4 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">
                <Star size={12} className="text-zinc-300 fill-zinc-300" />
                Parceiros Prata
              </div>
              <div className="flex overflow-x-auto gap-4 scrollbar-hide snap-x pb-2">
                {parceirosPrata.map((p) => (
                  <Link
                    href={`/parceiros/${p.id}`}
                    key={p.id}
                    className="min-w-[150px] h-44 bg-black rounded-2xl flex flex-col items-center justify-center gap-4 snap-start group active:scale-95 transition relative overflow-hidden border border-zinc-700 hover:border-zinc-500"
                  >
                    <div className="absolute inset-0">
                      <Image src={getPartnerCoverSrc(p)} alt="Capa" fill className="object-cover opacity-25 group-hover:opacity-40 transition"  />
                      <div className="absolute inset-0 bg-black/50" />
                    </div>
                    <div className="w-20 h-20 bg-black rounded-full border-2 border-zinc-500/80 flex items-center justify-center overflow-hidden shadow-2xl relative z-10 group-hover:scale-110 transition">
                      <Image src={getPartnerLogoSrc(p)} alt={p.nome} fill className="object-cover"  />
                    </div>
                    <div className="text-center relative z-10 px-2 w-full">
                      <h4 className="text-xs font-bold text-white truncate">{p.nome}</h4>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1. CARTEIRINHA */}
      <Link href="/carteirinha" className="relative h-40 w-full overflow-hidden rounded-3xl bg-zinc-900 border border-zinc-800 active:scale-95 transition group shadow-2xl block">
          <Image 
            src={getTurmaImage(userData?.turma)} 
            alt="Carteira BG"
            fill
            className="object-cover opacity-40 group-hover:opacity-50 transition transform group-hover:scale-105 duration-700" 
            
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent p-6 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-2">
                  <Wallet size={16} className="text-emerald-500"/>
                  <span className="text-[10px] font-bold uppercase text-emerald-500 bg-emerald-900/30 px-2 py-0.5 rounded border border-emerald-500/20">Sócio Ativo</span>
              </div>
              <h2 className="text-2xl font-black italic uppercase text-white drop-shadow-lg">Carteirinha</h2>
              <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest mt-1">Turma {userData?.turma || "Geral"}</p>
          </div>
      </Link>

      {/* 2. SHARK ROUND (COM FAIXA "EM BREVE") & TREINOS */}
      <div className="grid grid-cols-2 gap-4">
          <Link href="/sharkround" className="bg-emerald-600 rounded-3xl p-5 h-44 flex flex-col justify-between active:scale-95 transition relative overflow-hidden group shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              {/* ID 03: FAIXA EM BREVE */}
              <div className="absolute top-3 -right-8 w-32 bg-orange-500 text-black text-[9px] font-black uppercase text-center py-1 rotate-45 border-2 border-black z-20 shadow-lg">
                  Em Breve
              </div>
              
              <div className="absolute right-0 top-0 w-24 h-24 bg-white/10 rounded-full blur-xl -mr-6 -mt-6"></div>
              <Target size={32} className="text-black relative z-10" />
              <h3 className="font-black text-black text-xl uppercase italic leading-none relative z-10 drop-shadow-md">Shark<br/>Round</h3>
          </Link>
          
          <Link href="/treinos" className="bg-zinc-900 rounded-3xl h-44 overflow-hidden relative active:scale-95 transition border border-zinc-800 group shadow-lg">
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-30 group-hover:opacity-50 transition">
                  {treinos.length > 0 ? treinos.map((img, i) => (
                    <div key={i} className="relative w-full h-full border-[0.5px] border-black">
                        <Image src={img} alt="Treino" fill className="object-cover" />
                    </div>
                  )) : (
                      <>
                        <div className="bg-zinc-800 w-full h-full"></div><div className="bg-zinc-700 w-full h-full"></div>
                        <div className="bg-zinc-700 w-full h-full"></div><div className="bg-zinc-800 w-full h-full"></div>
                      </>
                  )}
              </div>
              <div className="absolute inset-0 flex flex-col justify-end p-5 bg-gradient-to-t from-black via-black/20 to-transparent">
                  <Dumbbell size={24} className="text-orange-500 mb-1 drop-shadow-md"/>
                  <h3 className="font-black text-white uppercase italic text-xl">Treinos</h3>
              </div>
          </Link>
      </div>

      {/* 🦈 3. ID 01 & 02: CAÇA AOS CALOUROS (ATUALIZADO PARA X/Y) */}
      <Link href="/album" className="relative h-40 w-full overflow-hidden rounded-3xl bg-black border border-emerald-900/50 block group active:scale-95 transition-all shadow-[0_0_30px_rgba(16,185,129,0.1)]">
            {/* Efeitos de Fundo (Sonar) */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-black to-black opacity-80"></div>
            
            {/* Radar Animation Ping */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] border border-emerald-500/10 rounded-full animate-[ping_3s_linear_infinite]"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100%] h-[100%] border border-emerald-500/20 rounded-full animate-[ping_3s_linear_infinite_1s]"></div>

            {/* Grid Tático */}
            <div className="absolute inset-0 opacity-10 [background-size:16px_16px] [background-image:linear-gradient(to_right,rgba(16,185,129,0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,185,129,0.09)_1px,transparent_1px)]"></div>

            <div className="absolute inset-0 flex flex-col justify-between p-6 z-10">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                        <h3 className="text-emerald-500 font-black uppercase italic text-xl flex items-center gap-2 drop-shadow-md">
                            <Crosshair size={20} className="animate-spin-slow-reverse"/> Caça aos Calouros
                        </h3>
                        <p className="text-zinc-500 text-[10px] font-bold tracking-[0.2em] uppercase mt-1">Status: Em Operação</p>
                    </div>
                    <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20 animate-pulse">
                        <ScanBarcode className="text-emerald-500" size={20}/>
                    </div>
                </div>

                <div className="flex items-end justify-between">
                    <div>
                        {/* ID 02: CONTADOR X/Y - ENCONTRADOS */}
                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-black text-emerald-400 tracking-tighter drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]">
                                {totalCaca}
                            </span>
                            <span className="text-2xl font-black text-zinc-600">/</span>
                            <span className="text-2xl font-black text-zinc-500">
                                {totalAlunos}
                            </span>
                        </div>
                        <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider block mt-0.5">Encontrados</span>
                    </div>
                    <div className="flex items-center gap-1 text-emerald-500 text-[10px] font-bold uppercase tracking-wider bg-emerald-950/50 px-3 py-1.5 rounded-full border border-emerald-900">
                        Ver Ranking <ChevronRight size={10}/>
                    </div>
                </div>
            </div>
      </Link>

      {/* 4. CARROSSEL EVENTOS (Padronizado) */}
      {events.length > 0 && (
          <div className="relative group/car">
              <SectionHeader 
                  title="Eventos" 
                  icon={Calendar} 
                  link="/eventos" 
                  colorClass="text-emerald-500"
                  onPrev={() => scroll(eventsScrollRef, 'left')} 
                  onNext={() => scroll(eventsScrollRef, 'right')} 
              />
              <div ref={eventsScrollRef} className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-4 pb-4">
                  {events.map(evt => <EventCardItem key={evt.id} evt={evt} userId={userData?.uid} onToggleLike={handleEventLike} />)}
              </div>
          </div>
      )}

      {/* --- BIZU DAS LIGAS (Reels + Letreiro) --- */}
      {ligasNoDashboard.length > 0 && (
          <div className="space-y-4">
               <SectionHeader 
                  title="Ligas Acadêmicas" 
                  icon={Users} 
                  link="/ligas_unitau" 
                  colorClass="text-yellow-500"
                  onPrev={() => scroll(ligasScrollRef, 'left')} 
                  onNext={() => scroll(ligasScrollRef, 'right')} 
               />
               
               <div className="relative group/ligas">
                   <div ref={ligasScrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide snap-x px-1 py-2">
                       {ligasNoDashboard.map(liga => {
                           const bizuAtivo = getLigaBizuAtivo(liga);
                           const textoCard = (bizuAtivo || liga.descricao || "Liga acadêmica em destaque.").trim();
                           return (
                           <Link href={`/ligas_unitau`} key={liga.id} className="min-w-[160px] flex flex-col items-center gap-4 snap-start group cursor-pointer relative bg-gradient-to-b from-zinc-900 to-black p-5 rounded-[24px] border border-zinc-800 hover:border-yellow-500/50 transition-all shadow-xl active:scale-95">
                               
                               <div className="relative w-24 h-24">
                                   <div className="absolute inset-0 rounded-full border-2 border-dashed border-yellow-500/50 animate-spin-slow pointer-events-none"></div>
                                   <div className="w-full h-full rounded-full bg-zinc-950 p-1.5 relative z-10 overflow-hidden shadow-lg group-hover:scale-105 transition">
                                       <Image 
                                            src={liga.foto || liga.logoBase64 || liga.logo || "/placeholder_liga.png"} 
                                            alt={liga.nome}
                                            fill
                                            className="rounded-full object-cover"
                                            
                                       />
                                   </div>
                                   {bizuAtivo && (
                                       <div className="absolute -bottom-1 -right-1 bg-yellow-500 text-black p-1.5 rounded-full z-20 border-2 border-black">
                                           <Lightbulb size={12} fill="black"/>
                                       </div>
                                   )}
                               </div>
                               
                               <div className="text-center w-full overflow-hidden">
                                   <span className="text-[11px] font-black text-emerald-500 uppercase tracking-widest block mb-2 group-hover:text-yellow-500 transition">{liga.sigla}</span>
                                   
                                   <div className="w-full bg-zinc-900/50 py-2 px-3 rounded-lg border border-zinc-800/50 relative overflow-hidden">
                                       {bizuAtivo ? (
                                           <div className="w-full overflow-hidden whitespace-nowrap">
                                               <p className="text-[10px] text-zinc-300 italic inline-block animate-marquee pl-[100%] leading-relaxed">
                                                   &quot;{textoCard}&quot;
                                               </p>
                                           </div>
                                       ) : (
                                           <p className="text-[10px] text-zinc-400 leading-relaxed line-clamp-2">
                                               {textoCard}
                                           </p>
                                       )}
                                   </div>
                               </div>
                           </Link>
                           );
                       })}
                   </div>
               </div>
          </div>
      )}

      {/* 5. LOJA (Tamanho igual Eventos + Contador Turmas) */}
      <div className="relative group/car">
          <SectionHeader 
              title="Lojinha" 
              icon={ShoppingBag} 
              link="/loja" 
              colorClass="text-purple-500"
              onPrev={produtos.length > 0 ? () => scroll(productsScrollRef, 'left') : undefined} 
              onNext={produtos.length > 0 ? () => scroll(productsScrollRef, 'right') : undefined} 
          />
          {produtos.length > 0 ? (
            <div ref={productsScrollRef} className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-4 pb-4">
                {produtos.map(p => <ProductCard key={p.id} prod={p} userId={userData?.uid} onToggleLike={handleProductLike} turmaStats={productTurmaStats[p.id] || []} />)}
            </div>
          ) : (
            <Link
              href="/loja"
              className="block rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/70 p-6 active:scale-[0.99] transition"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-black uppercase tracking-wide text-white">Sem produtos no momento</p>
                  <p className="text-xs text-zinc-500 mt-2">Clique para abrir a lojinha e acompanhar quando entrar novidade.</p>
                </div>
                <div className="w-12 h-12 rounded-2xl border border-purple-500/30 bg-purple-500/10 flex items-center justify-center text-purple-400">
                  <ShoppingBag size={20} />
                </div>
              </div>
            </Link>
          )}
      </div>

      {/* 6. PARCEIROS STANDARD (Logo Aumentado) */}
      {parceirosStandard.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-[2rem] p-6 relative overflow-hidden">
               <SectionHeader title="Parceiros Standard" icon={Users} link="/parceiros" colorClass="text-zinc-500"/>
               <div className="flex overflow-x-auto gap-4 scrollbar-hide snap-x relative z-10 pb-2">
                   {parceirosStandard.map((p) => (
                       <Link href={`/parceiros/${p.id}`} key={p.id} className="min-w-[150px] h-44 bg-black rounded-2xl flex flex-col items-center justify-center gap-4 snap-start group active:scale-95 transition relative overflow-hidden border border-zinc-800 hover:border-zinc-600">
                           <div className="absolute inset-0">
                               <Image src={getPartnerCoverSrc(p)} alt="Capa" fill className="object-cover opacity-30 group-hover:opacity-50 transition" />
                               <div className="absolute inset-0 bg-black/40"/>
                           </div>
                           <div className="w-20 h-20 bg-black rounded-full border-2 border-zinc-600 flex items-center justify-center overflow-hidden shadow-2xl relative z-10 group-hover:scale-110 transition">
                               <Image src={getPartnerLogoSrc(p)} alt="Logo" fill className="object-cover" />
                           </div>
                           <div className="text-center relative z-10 px-2 w-full">
                               <h4 className="text-xs font-bold text-white truncate">{p.nome}</h4>
                           </div>
                       </Link>
                   ))}
               </div>
          </div>
      )}

      {/* 7. COMUNIDADE (Posts) */}
      <div className="space-y-4">
          <SectionHeader title="Comunidade" icon={MessageCircle} link="/comunidade" colorClass="text-zinc-500"/>
          {mensagens.length > 0 ? mensagens.slice(0, 2).map((msg) => {
              const userLikedMsg = msg.likes?.includes(userData?.uid);
              return (
              <div key={msg.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden relative group">
                    <Link href="/comunidade" className="absolute inset-0 z-0"/>
                    
                    <div className="p-4 flex gap-4 items-start relative z-0">
                      <div className="w-10 h-10 rounded-full bg-black border border-zinc-700 relative overflow-hidden">
                        <Image 
                            src={msg.avatar || "https://github.com/shadcn.png"} 
                            alt="Avatar"
                            fill
                            className="object-cover"
                            
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between w-full gap-2 mb-1">
                              <span className="text-sm font-bold text-white truncate">{msg.userName}</span>
                              <span className="text-[10px] text-zinc-500 whitespace-nowrap">{formatTime(msg.createdAt)}</span>
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{msg.texto}</p>
                      </div>
                    </div>

                    <div className="px-4 pb-3 flex justify-end relative z-10">
                        <button 
                           onClick={(e) => { e.preventDefault(); handleMessageLike(msg.id, msg.likes); }}
                           className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full transition ${userLikedMsg ? 'text-red-500 bg-red-500/10' : 'text-zinc-500 hover:bg-zinc-800'}`}
                        >
                            <Heart size={12} className={userLikedMsg ? 'fill-current' : ''}/> {msg.likes?.length || 0}
                        </button>
                    </div>
              </div>
          )}) : (
              <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-zinc-600 text-xs italic">Nenhuma mensagem recente.</p>
              </div>
          )}
      </div>

      <div className="h-6"></div>
      
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        
        @keyframes shine {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .animate-shine {
          animation: shine 4s linear infinite;
        }
        @keyframes spin-slow {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
            animation: spin-slow 10s linear infinite;
        }
        .animate-spin-slow-reverse {
            animation: spin-slow 10s linear infinite reverse;
        }
        @keyframes marquee {
            0% { transform: translateX(0); }
            100% { transform: translateX(-100%); }
        }
        .animate-marquee {
            animation: marquee 8s linear infinite;
        }
      `}</style>
    </div>
  );
}
