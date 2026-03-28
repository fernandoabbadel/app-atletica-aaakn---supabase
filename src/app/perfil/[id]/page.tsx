// ARQUIVO: src/app/perfil/[id]/page.tsx

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { 
  ArrowLeft, MapPin, Edit3, Instagram, MessageCircle, Ghost, Fish, Share2, ShieldCheck, Loader2, 
  UserPlus, UserCheck, X, PawPrint, Users, Lock, Heart,
  Calendar, Clock, CheckCircle, EyeOff, Store
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext"; 
import { useToast } from "../../../context/ToastContext";
import { useTenantTheme } from "../../../context/TenantThemeContext";
import {
  fetchFollowList,
  fetchPublicProfileBundle,
  toggleFollowProfile
} from "../../../lib/profilePublicService";
import { getBackendErrorCode } from "@/lib/backendErrors";
import Link from "next/link";
import { getTurmaImage } from "../../../constants/turmaImages";
import { resolvePlanIcon, resolvePlanTheme, resolveUserPlanIcon } from "../../../constants/planVisuals";
import { withTenantSlug } from "../../../lib/tenantRouting";

// --- TIPAGEM ---

// Interfaces auxiliares para remover 'any'
interface PostItem {
  id: string;
  texto?: string;
  likesCount?: number;
  comentarios?: number;
  createdAt?: unknown;
  userId?: string;
}

interface EventItem {
  id: string;
  titulo: string;
  data?: string;
  imagem?: string;
  imagePositionY?: number;
}

interface TreinoItem {
  id: string;
  modalidade: string;
  imagem?: string;
  dia?: string;
  horario?: string;
  local?: string;
}

interface LigaItem {
  id: string;
  sigla?: string;
  foto?: string;
  logo?: string;
}

interface UserProfile {
  uid: string;
  nome: string;
  apelido?: string;
  foto?: string;
  turma?: string;
  bio?: string;
  cidadeOrigem?: string;
  dataNascimento?: string;
  instagram?: string;
  whatsappPublico?: boolean;
  idadePublica?: boolean;
  relacionamentoPublico?: boolean;
  telefone?: string;
  esportes?: string[];
  role?: string;
  tenant_role?: string;
  status?: string; 
  
  plano?: string;        
  plano_cor?: string; 
  plano_icon?: string;
  
  patente?: string;
  patente_icon?: string;
  patente_cor?: string;
  tier?: 'bicho' | 'atleta' | 'lenda'; 
  
  level?: number;
  xp?: number;
  pets?: string;
  statusRelacionamento?: string;
  stats?: {
    arenaWins?: number;
    arenaLosses?: number;
    followersCount?: number;
    followingCount?: number;
    [key: string]: number | undefined;
  };
  
  [key: string]: unknown; // Substituído any por unknown para segurança
}

interface FollowData {
    uid: string;
    nome: string;
    foto: string;
    turma: string;
}

const getSportInfo = (sport: string) => {
    const map: Record<string, { emoji: string, label: string, color: string }> = {
        "futebol": { emoji: "⚽", label: "Futebol", color: "bg-green-500/20 text-green-400" },
        "futsal": { emoji: "👟", label: "Futsal", color: "bg-emerald-500/20 text-emerald-400" },
        "rugby": { emoji: "🏉", label: "Rugby", color: "bg-orange-500/20 text-orange-400" },
        "tenis": { emoji: "🎾", label: "Tênis", color: "bg-yellow-500/20 text-yellow-400" },
        "beach_tennis": { emoji: "🏖️", label: "Beach Tennis", color: "bg-yellow-600/20 text-yellow-500" },
        "natacao": { emoji: "🏊‍♂️", label: "Natação", color: "bg-cyan-500/20 text-cyan-400" },
        "surf": { emoji: "🏄‍♂️", label: "Surf", color: "bg-blue-500/20 text-blue-400" },
        "taco": { emoji: "🏏", label: "Taco", color: "bg-purple-500/20 text-purple-400" },
        "dog_walking": { emoji: "🐕", label: "Dog Walking", color: "bg-amber-800/20 text-amber-500" },
        "canoagem": { emoji: "🛶", label: "Canoagem", color: "bg-blue-800/20 text-blue-300" },
        "volei": { emoji: "🏐", label: "Vôlei", color: "bg-blue-400/20 text-blue-200" },
        "handebol": { emoji: "🤾", label: "Handebol", color: "bg-red-500/20 text-red-400" },
    };
    return map[sport.toLowerCase()] || { emoji: "🏅", label: sport, color: "bg-zinc-800 text-zinc-400" };
};

// --- COMPONENTES VISUAIS ---

const LevelBadge = ({
  xp,
  patente,
  patenteIcon,
  patenteCor,
}: {
  xp: number;
  patente?: string;
  patenteIcon?: string;
  patenteCor?: string;
}) => {
    const IconComp = resolvePlanIcon(patenteIcon || "fish", Fish);
    const colorClass =
      typeof patenteCor === "string" && patenteCor.trim().startsWith("text-")
        ? patenteCor
        : "text-zinc-500";
    let borderClass = "border-zinc-700";
    if (colorClass.includes("orange")) borderClass = "border-orange-500/50";
    else if (colorClass.includes("red")) borderClass = "border-red-500/50";
    else if (colorClass.includes("emerald")) borderClass = "border-emerald-500/50";
    else if (colorClass.includes("blue")) borderClass = "border-blue-500/50";
    else if (colorClass.includes("yellow")) borderClass = "border-yellow-500/50";

    return (
        <div title={`${patente || "Plankton"} • ${xp} XP`} className={`relative group cursor-help p-3 rounded-full bg-zinc-900 border ${borderClass} shadow-lg transition-transform hover:scale-110`}>
            <IconComp size={20} className={colorClass} />
        </div>
    );
};
const PlanBadge = ({ nome, cor, iconName }: { nome?: string, cor?: string, iconName?: string }) => {
    const IconComponent = resolveUserPlanIcon(iconName, nome, Ghost);
    const title = nome || "Plano atual";
    const theme = resolvePlanTheme(cor);

    return (
        <div className={`relative group cursor-help p-3 rounded-full border shadow-lg transition-transform hover:scale-110 ${theme.badgeClass}`}>
            <IconComponent size={20} className="animate-pulse-slow" />
            <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-3 py-2 bg-black/95 text-white text-[10px] font-bold rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-zinc-800 pointer-events-none z-50 shadow-2xl">
                <span className="uppercase tracking-wider">Plano {title}</span>
                <div className="w-2 h-2 bg-black border-r border-b border-zinc-800 absolute -bottom-1 left-1/2 -translate-x-1/2 rotate-45"></div>
            </div>
        </div>
    );
};

export default function PerfilPublicoPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileHidden, setProfileHidden] = useState(false);
  
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followersList, setFollowersList] = useState<FollowData[]>([]);
  const [followingList, setFollowingList] = useState<FollowData[]>([]);
  
  const [activeModal, setActiveModal] = useState<'followers' | 'following' | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'eventos' | 'treinos' | 'ligas'>('posts');
  const tabs: Array<typeof activeTab> = ['posts', 'eventos', 'treinos', 'ligas'];

  const [recentPosts, setRecentPosts] = useState<PostItem[]>([]);
  const [myEvents, setMyEvents] = useState<EventItem[]>([]);
  const [myTreinos, setMyTreinos] = useState<TreinoItem[]>([]);
  const [myLigas, setMyLigas] = useState<LigaItem[]>([]);

  // Verifica se sou eu mesmo
  const isOwnProfile = user?.uid === params.id;
  const tenantPath = useCallback(
    (path: string): string =>
      tenantSlug.trim() ? withTenantSlug(tenantSlug, path) : path,
    [tenantSlug]
  );

  useEffect(() => {
    if (!params.id) return;
    const uid = params.id as string;
    const effectiveTenantId =
      activeTenantId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");

    const fetchProfile = async () => {
        try {
            const bundle = await fetchPublicProfileBundle(uid, user?.uid, {
              forceRefresh: true,
              tenantId: effectiveTenantId || undefined,
            });
            if (bundle?.profile) {
                const data = bundle.profile as UserProfile;

                // ðŸ¦ˆ VERIFICAÃ‡ÃƒO DE CONTA DESATIVADA 
                if ((data.role === 'inactive' || data.status === 'paused') && !isOwnProfile) {
                    setProfileHidden(true);
                    setLoading(false);
                    return; 
                }

                setProfile(data);
                
                // Seguidores
                setFollowersCount(bundle.followersCount);
                setFollowingCount(bundle.followingCount);

                setIsFollowing(bundle.isFollowing);

                setRecentPosts((bundle.posts as PostItem[]).slice(0, 5));
                setMyEvents((bundle.events as EventItem[]).slice(0, 5));

                setMyLigas((bundle.ligas as LigaItem[]).slice(0, 5));

                setMyTreinos((bundle.treinos as TreinoItem[]).slice(0, 5));

            } else {
                addToast("Usuário não encontrado.", "error");
                router.push(tenantPath("/dashboard"));
            }
        } catch (error: unknown) { console.error(error); } 
        finally { setLoading(false); }
    };
    void fetchProfile();
  }, [params.id, user, activeTenantId, isOwnProfile, addToast, router, tenantPath]); // ðŸ¦ˆ Dependências adicionadas

  const handleFollow = async () => {
      if (!user || !profile) return;
      try {
          const result = await toggleFollowProfile({
              viewerUid: user.uid,
              targetUid: profile.uid,
              currentlyFollowing: isFollowing,
              tenantId: activeTenantId || user?.tenant_id || undefined,
              viewerData: {
                  uid: user.uid,
                  nome: user.nome || "Atleta",
                  foto: user.foto || "",
                  turma: user.turma || "Geral",
              },
              targetData: {
                  uid: profile.uid,
                  nome: profile.nome,
                  foto: profile.foto || "",
                  turma: profile.turma || "Geral",
              },
          });
          setIsFollowing(result.isFollowing);
          setFollowersCount(result.followersCount);
          if (user.uid === profile.uid) {
              setFollowingCount(result.followingCount);
          }
          addToast(result.isFollowing ? "Seguindo!" : "Deixou de seguir.", result.isFollowing ? "success" : "info");
      } catch (error: unknown) {
          console.error(error);
          const code = getBackendErrorCode(error)?.toLowerCase() || "";
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (
            code.includes("functions/not-found") ||
            code.includes("functions/unavailable") ||
            code.includes("functions/internal") ||
            code.includes("functions/unknown") ||
            message.includes("cors") ||
            message.includes("preflight")
          ) {
            addToast("Follow indisponivel no backend. Publique as Functions.", "error");
          } else if (code.includes("permission-denied")) {
            addToast("Sem permissao para seguir esse perfil.", "error");
          } else {
            addToast("Erro ao seguir.", "error");
          }
      }
  };

  const handleOpenList = async (type: 'followers' | 'following') => {
      if (!profile) return;
      setActiveModal(type);
      try {
          const list = await fetchFollowList(profile.uid, type, {
              maxResults: 80,
              forceRefresh: false,
              tenantId: activeTenantId || user?.tenant_id || undefined,
          });
          if (type === 'followers') {
              setFollowersList(list);
          } else {
              setFollowingList(list);
          }
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao carregar lista.", "error");
      }
  };

  const formatPostDate = (value: unknown): string => {
      if (!value) return "Hoje";
      if (value instanceof Date) return value.toLocaleDateString("pt-BR");
      if (typeof value === "string" || typeof value === "number") {
          const parsed = new Date(value);
          return Number.isNaN(parsed.getTime()) ? "Hoje" : parsed.toLocaleDateString("pt-BR");
      }
      if (typeof value === "object" && value !== null) {
          const toDate = (value as { toDate?: unknown }).toDate;
          if (typeof toDate === "function") {
              const parsed = toDate.call(value) as Date;
              if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
                  return parsed.toLocaleDateString("pt-BR");
              }
          }
      }
      return "Hoje";
  };

  if (loading) return <div className="h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={40}/></div>;

  // ðŸ¦ˆ TELA DE PERFIL OCULTO
  if (profileHidden) {
      return (
          <div className="min-h-screen bg-[#050505] text-zinc-500 font-sans flex flex-col items-center justify-center p-6 text-center">
              <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-black border border-zinc-800 animate-pulse">
                  <Ghost size={40} className="text-zinc-700"/>
              </div>
              <h1 className="text-2xl font-black text-zinc-400 uppercase tracking-tighter mb-2">Perfil indisponivel</h1>
              <p className="text-sm font-medium text-zinc-600 max-w-xs mb-8">
                  Esta conta foi desativada temporariamente pelo usuário e está inacessível no momento.
              </p>
              <button onClick={() => router.back()} className="px-8 py-3 bg-zinc-900 border border-zinc-800 rounded-full text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:border-zinc-600 transition flex items-center gap-2">
                  <ArrowLeft size={14}/> Voltar
              </button>
          </div>
      );
  }

  if (!profile) return null;

  const getIdade = () => { if (profile.dataNascimento) { const birth = new Date(profile.dataNascimento); const today = new Date(); let age = today.getFullYear() - birth.getFullYear(); if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--; return age; } return null; };
  const showAge = isOwnProfile || profile.idadePublica;
  const showWhatsapp = isOwnProfile || profile.whatsappPublico;
  const showRelacionamento = isOwnProfile || profile.relacionamentoPublico;
  const turmaImage = getTurmaImage(profile.turma);
  const badgeProps = { nome: profile.plano, cor: profile.plano_cor, iconName: profile.plano_icon };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24">
      {/* CAPA + FOTO */}
      <div className="relative">
        <div className="h-48 w-full bg-zinc-900 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/20 via-[#050505]/50 to-[#050505] z-10"></div>
            {/* ðŸ¦ˆ Correção de Imagem: Capa */}
            <Image 
                src={turmaImage} 
                alt="Capa da Turma"
                fill
                sizes="100vw"
                className="object-cover opacity-60 blur-[2px]"
                priority
            />
            <button onClick={() => router.back()} className="absolute top-6 left-6 z-20 p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 hover:bg-white hover:text-black transition"><ArrowLeft size={20}/></button>
        </div>
        
        <div className="px-6 relative z-20 -mt-16 flex flex-col items-center">
            
            <div className="relative mb-3 group">
                {/* ðŸ¦ˆ Correção de Imagem: Avatar */}
                <div className={`relative h-32 w-32 rounded-full p-1 shadow-brand-strong ${profile.status === 'paused' ? 'bg-gradient-to-tr from-zinc-600 via-zinc-800 to-zinc-900 grayscale opacity-80' : 'bg-brand-gradient'}`}>
                    <div className="w-full h-full rounded-full overflow-hidden relative border-4 border-[#050505]">
                        <Image 
                            src={profile.foto || "https://github.com/shadcn.png"} 
                            alt={profile.nome}
                            width={128}
                            height={128}
                            className="object-cover w-full h-full"
                            
                        />
                    </div>
                </div>
                {/* ðŸ¦ˆ Correção de Imagem: Badge da Turma Pequena */}
                <div className="absolute bottom-0 right-0 z-30 h-10 w-10 overflow-hidden rounded-full border-[3px] border-[#050505] bg-zinc-950 shadow-brand">
                    <Image 
                        src={turmaImage} 
                        alt="Badge Turma"
                        width={40}
                        height={40}
                        className="h-full w-full object-cover"
                    />
                </div>
            </div>

            <div className="text-center space-y-1 mb-4">
                <h1 className="text-2xl font-black text-white uppercase italic tracking-tighter flex items-center justify-center gap-2">
                    {profile.apelido || profile.nome.split(" ")[0]}
                    {(profile.role === 'master' || String(profile.role || '').includes('admin')) && <ShieldCheck size={18} className="text-red-500" />}
                    {profile.role !== 'master' && !String(profile.role || '').includes('admin') && profile.tenant_role === 'mini_vendor' && <Store size={18} className="text-blue-400" />}
                </h1>
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{profile.nome}</p>
                
                {profile.status === 'paused' && isOwnProfile && (
                    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-red-900/30 border border-red-500/30 rounded-full text-[10px] font-bold text-red-400 uppercase tracking-wide">
                        <EyeOff size={10} /> Perfil Oculto (Conta Pausada)
                    </div>
                )}

                <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="bg-zinc-800 border border-zinc-700 px-3 py-1 rounded-full text-[10px] font-black uppercase text-zinc-300">{profile.turma || "Sem Turma"}</span>
                    {showAge && getIdade() !== null && (<div className="relative group/age"><span className="bg-zinc-800 border border-zinc-700 px-3 py-1 rounded-full text-[10px] font-black uppercase text-zinc-300 flex items-center gap-1">{getIdade()} Anos{!profile.idadePublica && <Lock size={8} className="text-zinc-500"/>}</span></div>)}
                </div>
            </div>
            
            <div className="flex items-center gap-6 mb-6 justify-center w-full">
                <PlanBadge nome={badgeProps.nome} cor={badgeProps.cor} iconName={badgeProps.iconName} />

                {isOwnProfile ? (
                    <Link href={tenantPath("/cadastro")} className="px-8 py-2 bg-zinc-800 rounded-full text-xs font-bold uppercase border border-zinc-700 hover:bg-zinc-700 hover:border-emerald-500 transition shadow-lg flex items-center gap-2"><Edit3 size={14}/> Editar Perfil</Link>
                ) : (
                    <button onClick={handleFollow} className={`px-8 py-2 rounded-full text-xs font-bold uppercase border transition shadow-lg flex items-center gap-2 ${isFollowing ? 'bg-zinc-900 border-zinc-700 text-zinc-400' : 'bg-emerald-600 border-emerald-500 text-white hover:scale-105'}`}>{isFollowing ? <UserCheck size={14}/> : <UserPlus size={14}/>} {isFollowing ? "Seguindo" : "Seguir"}</button>
                )}
                
                <LevelBadge
                  xp={profile.xp || 0}
                  patente={profile.patente}
                  patenteIcon={profile.patente_icon}
                  patenteCor={profile.patente_cor}
                />
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-8">
                <button onClick={() => handleOpenList('followers')} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center hover:bg-zinc-800 transition active:scale-95"><span className="text-xl font-black text-white">{followersCount}</span><span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Seguidores</span></button>
                <button onClick={() => handleOpenList('following')} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center hover:bg-zinc-800 transition active:scale-95"><span className="text-xl font-black text-white">{followingCount}</span><span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Seguindo</span></button>
                <div className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center"><span className="text-xl font-black text-white">{profile.xp || 0}</span><span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">XP Total</span></div>
            </div>

            {profile.bio && <div className="w-full max-w-sm bg-zinc-900/30 border border-zinc-800/50 p-4 rounded-2xl mb-6 backdrop-blur-sm"><p className="text-sm text-zinc-300 text-center italic leading-relaxed">&quot;{profile.bio}&quot;</p></div>}
            
            <div className="flex gap-3 mb-8 justify-center w-full">
                {profile.instagram && <a href={`https://instagram.com/${profile.instagram.replace('@','')}`} target="_blank" rel="noreferrer" className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg hover:scale-110 transition hover:shadow-purple-500/20"><Instagram size={24}/></a>}
                <div className="relative">
                    {showWhatsapp ? (
                          <a href={`https://wa.me/55${profile.telefone?.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-lg hover:scale-110 transition hover:shadow-green-500/20"><MessageCircle size={24}/></a>
                    ) : (
                          <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center text-zinc-600 border border-zinc-800 cursor-not-allowed"><Lock size={20}/></div>
                    )}
                    {profile.whatsappPublico === false && isOwnProfile && <div className="absolute -top-1 -right-1 bg-zinc-900 rounded-full p-0.5 border border-zinc-700"><Lock size={10} className="text-zinc-400"/></div>}
                </div>
                <button className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700 hover:text-white hover:border-zinc-500 transition"><Share2 size={22}/></button>
            </div>

            {/* ABAS */}
            <div className="w-full max-w-sm">
                <div className="flex justify-between border-b border-zinc-800 mb-4 overflow-x-auto">
                    {tabs.map((tab) => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === tab ? 'border-emerald-500 text-emerald-500' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{tab}</button>
                    ))}
                </div>

                <div className="min-h-[200px]">
                    {/* POSTS */}
                    {activeTab === 'posts' && (
                        recentPosts.length > 0 ? (
                            <div className="space-y-2 animate-in fade-in">{recentPosts.map(p => (<div key={p.id} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-xl"><p className="text-xs text-zinc-300 truncate mb-1">&quot;{p.texto}&quot;</p><div className="flex justify-between items-center text-[10px] text-zinc-500"><div className="flex items-center gap-2"><span className="flex items-center gap-1"><Heart size={10}/> {p.likesCount || 0}</span><span className="flex items-center gap-1"><MessageCircle size={10}/> {p.comentarios || 0}</span></div><span>{formatPostDate(p.createdAt)}</span></div></div>))}<div className="text-center pt-2"><Link href={tenantPath("/comunidade")} className="text-[10px] text-emerald-500 font-bold hover:underline">Ver Mais na Comunidade</Link></div></div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum post recente.</div>
                    )}

                    {/* EVENTOS */}
                    {activeTab === 'eventos' && (
                        myEvents.length > 0 ? (
                            <div className="grid grid-cols-2 gap-3 animate-in fade-in">{myEvents.map(e => (<Link href={tenantPath(`/eventos/${e.id}`)} key={e.id} className="group flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition-all shadow-lg hover:shadow-emerald-500/10"><div className="h-28 w-full bg-zinc-800 relative overflow-hidden"><Image src={e.imagem || "https://placehold.co/600x400/111/333?text=Evento"} alt={e.titulo} fill sizes="(max-width: 768px) 50vw, 220px" className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500" style={{ objectPosition: `50% ${e.imagePositionY || 50}%` }}/><div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent"/><div className="absolute bottom-2 left-2 right-2"><p className="text-[10px] font-black text-white uppercase truncate drop-shadow-md">{e.titulo}</p></div></div><div className="p-2 flex items-center justify-between bg-zinc-950"><div className="flex items-center gap-1 text-[9px] text-zinc-400 font-bold uppercase"><Calendar size={10} className="text-emerald-500"/><span>{e.data || "Data à definir"}</span></div><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]"></div></div></Link>))}</div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum evento marcado.</div>
                    )}

                    {/* LIGAS */}
                    {activeTab === 'ligas' && (
                        myLigas.length > 0 ? (
                            <div className="grid grid-cols-3 gap-4 animate-in fade-in">
                                {myLigas.map(l => (
                                    <Link href={tenantPath("/ligas_usc")} key={l.id} className="flex flex-col items-center gap-2 group">
                                        <div className="w-24 h-24 rounded-full bg-black border-2 border-zinc-800 p-0.5 group-hover:border-emerald-500 group-hover:scale-105 transition-all shadow-lg">
                                            <div className="w-full h-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center relative">
                                                {l.logo || l.foto ? (
                                                    <Image src={l.logo || l.foto || ""} alt={l.sigla || "Liga"} fill sizes="96px" className="object-cover" />
                                                ) : (
                                                    <Users size={32} className="text-zinc-500"/>
                                                )}
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-bold text-zinc-400 group-hover:text-white uppercase tracking-wider text-center line-clamp-1 w-full">{l.sigla || "Liga"}</span>
                                    </Link>
                                ))}
                            </div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Não participa de ligas.</div>
                    )}

                    {/* TREINOS */}
                    {activeTab === 'treinos' && (
                        myTreinos.length > 0 ? (
                             <div className="grid gap-3 animate-in fade-in">
                                {myTreinos.map(t => (
                                    <Link href={tenantPath(`/treinos/${t.id}`)} key={t.id} className="group flex items-center bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition-all shadow-lg h-24">
                                            <div className="w-24 h-full bg-zinc-800 relative overflow-hidden shrink-0">
                                                 <Image src={t.imagem || "https://placehold.co/400x400/111/333?text=Treino"} alt={t.modalidade} fill sizes="96px" className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"/>
                                                 <div className="absolute inset-0 bg-gradient-to-r from-transparent to-zinc-900"/>
                                            </div>
                                            <div className="flex-1 p-3 flex flex-col justify-center">
                                                <div className="flex justify-between items-start mb-1">
                                                    <p className="text-sm font-black text-white uppercase truncate">{t.modalidade}</p>
                                                    <div className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-1"><CheckCircle size={8}/> Eu Vou</div>
                                                </div>
                                                <div className="flex flex-col gap-1 text-[10px] text-zinc-400 font-bold uppercase">
                                                    <span className="flex items-center gap-1.5"><Calendar size={10} className="text-emerald-500"/> {t.dia}</span>
                                                    <span className="flex items-center gap-1.5"><Clock size={10} className="text-emerald-500"/> {t.horario}</span>
                                                    <span className="flex items-center gap-1.5"><MapPin size={10} className="text-emerald-500"/> {t.local}</span>
                                                </div>
                                            </div>
                                    </Link>
                                ))}
                             </div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum treino confirmado.</div>
                    )}
                </div>
            </div>

            {/* FICHA TÉCNICA */}
            <div className="w-full max-w-sm mt-8 border-t border-zinc-800 pt-6">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest pl-2 border-l-2 border-zinc-500 mb-3">Ficha Técnica</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><MapPin size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Origem</p><p className="text-xs font-bold text-white">{profile.cidadeOrigem || "N/A"}</p></div></div>
                    <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><Heart size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Status</p><div className="flex items-center gap-1"><p className="text-xs font-bold text-white uppercase truncate max-w-[80px]">{showRelacionamento ? (profile.statusRelacionamento || "N/A") : "Privado"}</p>{!showRelacionamento && !isOwnProfile && <Lock size={10} className="text-zinc-600"/>}{profile.relacionamentoPublico === false && isOwnProfile && <Lock size={10} className="text-zinc-500"/>}</div></div></div>
                    {profile.pets && (<div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3 col-span-2"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><PawPrint size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Mascote</p><p className="text-xs font-bold text-white uppercase">{profile.pets}</p></div></div>)}
                </div>
                {profile.esportes && profile.esportes.length > 0 && (
                    <div className="pt-4"><h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest pl-2 border-l-2 border-blue-500 mb-3">Modalidades</h3><div className="flex flex-wrap gap-2">{profile.esportes.map((sport, i) => { const info = getSportInfo(sport); return <span key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide border border-white/5 shadow-sm ${info.color}`}><span className="text-sm">{info.emoji}</span> {info.label}</span>; })}</div></div>
                )}
            </div>
        </div>
      </div>
      {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-950 w-full max-w-sm rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                      <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">{activeModal === 'followers' ? <Users size={16} className="text-emerald-500"/> : <UserCheck size={16} className="text-blue-500"/>} {activeModal === 'followers' ? `Seguidores (${followersCount})` : `Seguindo (${followingCount})`}</h3>
                      <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-500 hover:text-white"><X size={20}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {(activeModal === 'followers' ? followersList : followingList).length === 0 ? <div className="text-center py-10 text-zinc-600"><Ghost size={32} className="mx-auto mb-2 opacity-50"/><p className="text-xs">Nada por aqui.</p></div> : (activeModal === 'followers' ? followersList : followingList).map(f => (<Link href={tenantPath(`/perfil/${f.uid}`)} key={f.uid} onClick={() => setActiveModal(null)} className="flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-900 transition border border-transparent hover:border-zinc-800"><div className="w-10 h-10 rounded-full bg-black overflow-hidden border border-zinc-700 relative"><Image src={f.foto || "https://github.com/shadcn.png"} alt={f.nome} fill sizes="40px" className="object-cover" /></div><div><p className="text-sm font-bold text-white">{f.nome}</p><p className="text-[10px] text-zinc-500 font-bold uppercase">{f.turma || "Bicho"}</p></div></Link>))}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}


