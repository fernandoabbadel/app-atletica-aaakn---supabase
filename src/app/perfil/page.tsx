"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  ArrowLeft, MapPin, Edit3, Instagram, MessageCircle, Ghost, Fish, Share2, ShieldCheck, Loader2, 
  X, PawPrint, Users, Lock, Heart, UserCheck,
  Trophy, Calendar, Dumbbell, LayoutList,
  ChevronRight, Clock, CheckCircle, Camera
} from "lucide-react";

import { useAuth } from "../../context/AuthContext"; 
import { useToast } from "../../context/ToastContext";
import {
  fetchFollowCounts,
  fetchFollowList,
  fetchOwnProfileBundle,
  saveProfileImageUrl,
  updateProfileFields,
  uploadProfileImage
} from "../../lib/profileService";
import { validateImageFile } from "../../lib/upload";
import Link from "next/link";
import Image from "next/image";
import { getTurmaImage } from "../../constants/turmaImages";
import { resolvePlanIcon, resolvePlanTextClass, resolveUserPlanIcon } from "../../constants/planVisuals";

// ============================================================================
// 🦈 1. INTERFACES & TIPAGEM (ID 906)
// ============================================================================

interface PostPerfil {
  id: string;
  texto: string;
  imagem?: string;
  createdAt?: unknown;
  likes: string[];
  comentarios?: number;
}

interface EventoPerfil {
  id: string;
  titulo: string;
  data: string;
  local: string;
  imagem: string;
  imagePositionY?: number;
}

interface TreinoPerfil {
  id: string;
  modalidade: string;
  dia?: string;
  horario?: string;
  imagem?: string;
  local?: string;
}

interface LigaPerfil {
  id: string;
  nome: string;
  sigla: string;
  foto?: string;
  logo?: string;
  logoBase64?: string;
}

interface UserProfile {
  uid: string;
  nome: string;
  apelido?: string;
  foto?: string;
  capa?: string; 
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
  [key: string]: string | number | boolean | undefined | null | object | string[];
}

interface FollowData {
    uid: string;
    nome: string;
    foto: string;
    turma: string;
}

// ============================================================================
// 🦈 HELPERS E CONSTANTES
// ============================================================================

const SPORTS_LIST = [
    "Futebol", "Futsal", "Volei", "Basquete", "Handebol", "Rugby", 
    "Tenis", "Beach Tennis", "Natacao", "Surf", "Skate", "Taco", 
    "Futevolei", "Altinha", "Canoagem", "Crossfit", "Academia", "Corrida"
];

const LOADING_PHRASES = [
    "Calibrando o Estetoscópio... 🩺",
    "Preparando o Bisturi... 🔪",
    "Misturando os Reagentes... 🧪",
    "Chamando o Residente... 📢",
    "Aferindo a Pressão... ❤️"
];

const getSportInfo = (sport: string) => {
    const map: Record<string, { emoji: string, label: string, color: string }> = {
        "futebol": { emoji: "⚽", label: "Futebol", color: "bg-green-500/20 text-green-400" },
        "futsal": { emoji: "👟", label: "Futsal", color: "bg-emerald-500/20 text-emerald-400" },
        "rugby": { emoji: "🏉", label: "Rugby", color: "bg-orange-500/20 text-orange-400" },
        "tenis": { emoji: "🎾", label: "Tênis", color: "bg-yellow-500/20 text-yellow-400" },
        "beach tennis": { emoji: "🏖️", label: "Beach Tennis", color: "bg-yellow-600/20 text-yellow-500" },
        "beach_tennis": { emoji: "🏖️", label: "Beach Tennis", color: "bg-yellow-600/20 text-yellow-500" },
        "natacao": { emoji: "🏊‍♂️", label: "Natação", color: "bg-cyan-500/20 text-cyan-400" },
        "surf": { emoji: "🏄‍♂️", label: "Surf", color: "bg-blue-500/20 text-blue-400" },
        "taco": { emoji: "🏏", label: "Taco", color: "bg-purple-500/20 text-purple-400" },
        "dog_walking": { emoji: "🐕", label: "Dog Walking", color: "bg-amber-800/20 text-amber-500" },
        "canoagem": { emoji: "🛶", label: "Canoagem", color: "bg-blue-800/20 text-blue-300" },
        "volei": { emoji: "🏐", label: "Vôlei", color: "bg-blue-400/20 text-blue-200" },
        "handebol": { emoji: "🤾", label: "Handebol", color: "bg-red-500/20 text-red-400" },
        "basquete": { emoji: "🏀", label: "Basquete", color: "bg-orange-600/20 text-orange-500" },
        "skate": { emoji: "🛹", label: "Skate", color: "bg-zinc-600/20 text-zinc-400" },
        "academia": { emoji: "💪", label: "Academia", color: "bg-zinc-500/20 text-zinc-300" },
        "corrida": { emoji: "🏃", label: "Corrida", color: "bg-emerald-400/20 text-emerald-300" },
    };
    return map[sport.toLowerCase().replace(" ", "_")] || { emoji: "🏅", label: sport, color: "bg-zinc-800 text-zinc-400" };
};

// ============================================================================
// 🦈 SUB-COMPONENTES
// ============================================================================

// 🦈 PROFILE BADGES
const ProfileBadges = ({ userData }: { userData: UserProfile }) => {
    const isAdmin = userData?.role?.includes('admin') || userData?.role === 'master';
    const normalizeIcon = (value: string | undefined) =>
      String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const planIconName = normalizeIcon(userData?.plano_icon || "ghost");
    const patentIconName = normalizeIcon(userData?.patente_icon || "fish");
    const planColorClass = resolvePlanTextClass(userData?.plano_cor || "zinc");
    const patentColorClass = resolvePlanTextClass(userData?.patente_cor || "zinc");
    const PlanIcon = resolveUserPlanIcon(userData?.plano_icon, userData?.plano, Ghost);
    const PatentIcon = resolvePlanIcon(userData?.patente_icon || "fish", Fish);

    return (
        <div className="flex items-center gap-5 bg-black/40 px-6 py-3 rounded-full border border-white/5 backdrop-blur-sm shadow-xl">
            {isAdmin && <div title="Admin" className="cursor-help transform hover:scale-110 transition-transform"><ShieldCheck size={24} className="text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]" /></div>}
            <div title={`Plano: ${userData.plano || "Visitante"}`} className={`cursor-help transform hover:scale-110 transition-transform ${planColorClass}`}><PlanIcon size={24} className="drop-shadow-sm" /></div>
            {planIconName !== patentIconName && <div className="w-px h-6 bg-zinc-700/50"></div>}
            {planIconName !== patentIconName && (<div title={`Patente: ${userData.patente || "Novato"}`} className={`cursor-help transform hover:scale-110 transition-transform ${patentColorClass}`}><PatentIcon size={28} className="drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]" /></div>)}
        </div>
    );
};

// ============================================================================
// 🦈 PÁGINA PRINCIPAL
// ============================================================================

export default function MeuPerfilPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPhrase, setLoadingPhrase] = useState(LOADING_PHRASES[0]);
  
  // States do Modal de Edição
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editCidade, setEditCidade] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPets, setEditPets] = useState("");
  const [editSports, setEditSports] = useState<string[]>([]);
  const [editWhatsappPublico, setEditWhatsappPublico] = useState(false);
  const [editIdadePublica, setEditIdadePublica] = useState(true);
  const [editRelacionamentoPublico, setEditRelacionamentoPublico] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followersList, setFollowersList] = useState<FollowData[]>([]);
  const [followingList, setFollowingList] = useState<FollowData[]>([]);
  const [activeModal, setActiveModal] = useState<'followers' | 'following' | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'eventos' | 'treinos' | 'ligas'>('posts');
  
  const [recentPosts, setRecentPosts] = useState<PostPerfil[]>([]);
  const [myEvents, setMyEvents] = useState<EventoPerfil[]>([]);
  const [myTreinos, setMyTreinos] = useState<TreinoPerfil[]>([]);
  const [myLigas, setMyLigas] = useState<LigaPerfil[]>([]);

  useEffect(() => {
      const interval = setInterval(() => {
          setLoadingPhrase(LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)]);
      }, 2000);
      return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/login"); return; }

    const statsRecord =
      typeof user.stats === "object" && user.stats !== null
        ? (user.stats as Record<string, unknown>)
        : null;
    const profileCompleteFlag = statsRecord?.profileComplete;
    const hasExplicitIncompleteFlag =
      typeof profileCompleteFlag === "number" &&
      Number.isFinite(profileCompleteFlag) &&
      profileCompleteFlag < 1;
    const hasMissingRequiredProfileField = [
      user.apelido,
      user.matricula,
      user.turma,
      user.telefone,
      user.dataNascimento,
      user.cidadeOrigem,
      user.estadoOrigem,
      user.foto,
    ].some((value) => String(value ?? "").trim().length === 0);

    if (
      String(user.role ?? "guest") === "guest" ||
      hasMissingRequiredProfileField ||
      hasExplicitIncompleteFlag
    ) {
      router.replace("/cadastro");
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
        try {
            const bundle = await fetchOwnProfileBundle(user.uid, { forceRefresh: true });
            if (bundle?.profile) {
                const data = bundle.profile as UserProfile;
                setProfile(data);
                
                setEditName(data.nome || "");
                setEditBio(data.bio || "");
                setEditInstagram(data.instagram || "");
                setEditCidade(data.cidadeOrigem || "");
                setEditStatus(data.statusRelacionamento || "Solteiro(a)");
                setEditPets(data.pets || "nenhum");
                setEditSports(data.esportes || []);
                setEditWhatsappPublico(data.whatsappPublico ?? false);
                setEditIdadePublica(data.idadePublica ?? true);
                setEditRelacionamentoPublico(data.relacionamentoPublico ?? true);
                
                setFollowersCount(bundle.followersCount);
                setFollowingCount(bundle.followingCount);

                void fetchFollowCounts(user.uid, { forceRefresh: true })
                    .then((counts) => {
                        setFollowersCount(counts.followersCount);
                        setFollowingCount(counts.followingCount);
                    })
                    .catch(() => {
                        // Mantem contador do bundle se count falhar.
                    });

                setRecentPosts((bundle.posts as PostPerfil[]).slice(0, 5));

                setMyEvents((bundle.events as EventoPerfil[]).slice(0, 5));

                setMyLigas((bundle.ligas as LigaPerfil[]).slice(0, 5));

                setMyTreinos((bundle.treinos as TreinoPerfil[]).slice(0, 5));

            } else {
                addToast("Cadastro pendente. Complete sua ficha para abrir o perfil.", "info");
                router.replace("/cadastro");
            }
        } catch (error: unknown) { console.error(error); } 
        finally { setLoading(false); }
    };
    void fetchProfile();
  }, [user, authLoading, router, addToast]);

  const handleOpenList = async (type: 'followers' | 'following') => {
      if (!profile || !user) return;
      setActiveModal(type);
      try {
          const list = await fetchFollowList(user.uid, type, {
              maxResults: 80,
              forceRefresh: false,
          });
          if(type === 'followers') {
              setFollowersList(list);
              setFollowersCount(list.length);
          } else {
              setFollowingList(list);
              setFollowingCount(list.length);
          }
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao carregar lista.", "error");
      }
  };

  const handleSaveProfile = async () => {
      if (!user || !profile) return;
      setSavingProfile(true);
      try {
          const updateData = {
              nome: editName,
              bio: editBio,
              instagram: editInstagram,
              cidadeOrigem: editCidade,
              statusRelacionamento: editStatus,
              pets: editPets,
              esportes: editSports,
              whatsappPublico: editWhatsappPublico,
              idadePublica: editIdadePublica,
              relacionamentoPublico: editRelacionamentoPublico
          };
          
          await updateProfileFields({
              uid: user.uid,
              ...updateData,
          });
          setProfile({ ...profile, ...updateData });
          setShowEditModal(false);
          addToast("Perfil atualizado com sucesso! 🦈", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao salvar perfil.", "error");
      } finally {
          setSavingProfile(false);
      }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'capa') => {
      const input = e.currentTarget;
      if (!input.files || !input.files[0] || !user || savingProfile) {
          input.value = "";
          return;
      }
      const file = input.files[0];
      
      const validationError = validateImageFile(file);
      if (validationError) {
          addToast(validationError, "error");
          input.value = "";
          return;
      }

      setSavingProfile(true);
      try {
          const url = await uploadProfileImage({
              uid: user.uid,
              file,
              kind: type,
          });
          
          const field = type === 'avatar' ? 'foto' : 'capa';
          await saveProfileImageUrl({ uid: user.uid, field, url });
          
          setProfile(prev => prev ? { ...prev, [field]: url } : null);
          addToast(`${type === 'avatar' ? 'Foto' : 'Capa'} atualizada!`, "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro no upload da imagem.", "error");
      } finally {
          setSavingProfile(false);
          input.value = "";
      }
  };

  const toggleSport = (sport: string) => {
      if (editSports.includes(sport)) {
          setEditSports(editSports.filter(s => s !== sport));
      } else {
          if (editSports.length >= 5) {
              addToast("Máximo de 5 esportes!", "info");
              return;
          }
          setEditSports([...editSports, sport]);
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

  if (loading || authLoading) return (
      <div className="h-screen bg-[#050505] flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-emerald-500" size={40}/>
          <p className="text-zinc-500 text-sm font-bold animate-pulse">{loadingPhrase}</p>
      </div>
  );
  
  if (!profile) return null;

  const getIdade = () => { if (profile.dataNascimento) { const birth = new Date(profile.dataNascimento); const today = new Date(); let age = today.getFullYear() - birth.getFullYear(); if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--; return age; } return null; };
  const isWhatsappPrivate = profile.whatsappPublico === false;
  const isAgePrivate = profile.idadePublica === false;
  const isRelationPrivate = profile.relacionamentoPublico === false;
  const turmaImage = getTurmaImage(profile.turma);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24">
      <div className="relative">
        {/* CAPA DO PERFIL */}
        <div className="h-48 w-full bg-zinc-900 overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/20 via-[#050505]/50 to-[#050505] z-10"></div>
            <Image 
                src={profile.capa || turmaImage} 
                alt="Capa"
                fill
                className="object-cover opacity-60 blur-[2px] group-hover:blur-0 transition duration-700"
                
                sizes="100vw"
                priority
            />
            <button onClick={() => router.push('/dashboard')} className="absolute top-6 left-6 z-20 p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 hover:bg-white hover:text-black transition"><ArrowLeft size={20}/></button>
            <input type="file" ref={coverInputRef} className="hidden" accept="image/png,image/jpeg,image/webp" disabled={savingProfile} onChange={(e) => handleImageUpload(e, 'capa')} />
        </div>

        <div className="px-6 relative z-20 -mt-20 flex flex-col items-center">
            
            {/* CONTAINER PRINCIPAL DO AVATAR E TURMA (ID 1021 e 1022) */}
            {/* O Tubarão fixou o tamanho aqui (w-40 h-40) para o posicionamento absoluto funcionar perfeitamente */}
            <div className="relative w-40 h-40 mb-4 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                
                {/* 1. Foto de Perfil */}
                <div className="w-full h-full rounded-full p-1 bg-gradient-to-tr from-emerald-500 via-zinc-800 to-zinc-900 shadow-[0_0_40px_rgba(16,185,129,0.3)] relative overflow-hidden">
                    <Image 
                        src={profile.foto || "https://github.com/shadcn.png"} 
                        alt="Foto Perfil"
                        fill
                        className="rounded-full object-cover border-4 border-[#050505]"
                        
                        sizes="(max-width: 768px) 160px, 160px"
                    />
                    {/* ID 1020/1023: Ícone de Upload VOLTOU, mas só aparece no HOVER */}
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <Camera size={32} className="text-white drop-shadow-md" />
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/png,image/jpeg,image/webp" disabled={savingProfile} onChange={(e) => handleImageUpload(e, 'avatar')} />
                </div>
                
                {/* 2. Logo da Turma (ID 1021 - Sobreposta CORRETAMENTE no canto inferior direito) */}
                {/* Está "absoluta" em relação ao pai de 160px (w-40), garantindo que fique na borda */}
                <div className="absolute bottom-0 right-0 w-14 h-14 bg-black rounded-full border-2 border-[#050505] flex items-center justify-center shadow-lg z-20 overflow-hidden">
                    <Image src={turmaImage} alt="Turma" fill className="object-cover"  sizes="56px"/>
                </div>
                
                {/* 🦈 REMOVIDO: Level Badge (Peixe Palhaço) - ID 1030 */}
            </div>

            <div className="text-center space-y-1 mb-4">
                <h1 className="text-2xl font-black text-white uppercase italic tracking-tighter flex items-center justify-center gap-2">
                    {profile.apelido || profile.nome.split(" ")[0]}
                    {profile.role === 'master' && <ShieldCheck size={18} className="text-red-500" />}
                </h1>
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{profile.nome}</p>
                <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="bg-zinc-800 border border-zinc-700 px-3 py-1 rounded-full text-[10px] font-black uppercase text-zinc-300">{profile.turma || "Sem Turma"}</span>
                    {getIdade() !== null && (
                        <div className="relative group/age">
                            <span className="bg-zinc-800 border border-zinc-700 px-3 py-1 rounded-full text-[10px] font-black uppercase text-zinc-300 flex items-center gap-1">
                                {getIdade()} Anos
                                {isAgePrivate && <Lock size={8} className="text-zinc-500" />}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="mb-6"><ProfileBadges userData={profile} /></div>

            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => setShowEditModal(true)} className="px-6 py-2 bg-zinc-800 rounded-full text-xs font-bold uppercase border border-zinc-700 hover:bg-zinc-700 hover:border-emerald-500 transition shadow-lg flex items-center gap-2">
                    <Edit3 size={14}/> Editar Perfil
                </button>
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-8">
                <button onClick={() => handleOpenList('followers')} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center hover:bg-zinc-800 transition active:scale-95">
                    <span className="text-xl font-black text-white">{followersCount}</span>
                    <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Seguidores</span>
                </button>
                <button onClick={() => handleOpenList('following')} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center hover:bg-zinc-800 transition active:scale-95">
                    <span className="text-xl font-black text-white">{followingCount}</span>
                    <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Seguindo</span>
                </button>
                <div className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-2xl flex flex-col items-center">
                    <span className="text-xl font-black text-white">{profile.xp || 0}</span>
                    <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">XP Total</span>
                </div>
            </div>

            {profile.bio && (
                <div className="w-full max-w-sm bg-zinc-900/30 border border-zinc-800/50 p-4 rounded-2xl mb-6 backdrop-blur-sm">
                    <p className="text-sm text-zinc-300 text-center italic leading-relaxed">&quot;{profile.bio}&quot;</p>
                </div>
            )}

            <div className="flex gap-3 mb-8 justify-center w-full">
                {profile.instagram && <a href={`https://instagram.com/${profile.instagram.replace('@','')}`} target="_blank" className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg hover:scale-110 transition hover:shadow-purple-500/20"><Instagram size={24}/></a>}
                {profile.telefone && (<div className="relative"><a href={`https://wa.me/55${profile.telefone.replace(/\D/g,'')}`} target="_blank" className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-lg hover:scale-110 transition hover:shadow-green-500/20"><MessageCircle size={24}/></a>{isWhatsappPrivate && <div className="absolute -top-1 -right-1 bg-zinc-900 rounded-full p-0.5 border border-zinc-700" title="Privado"><Lock size={10} className="text-zinc-400"/></div>}</div>)}
                <button className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700 hover:text-white hover:border-zinc-500 transition"><Share2 size={22}/></button>
            </div>

            <div className="w-full max-w-sm">
             <div className="flex justify-between border-b border-zinc-800 mb-4 overflow-x-auto no-scrollbar">
            {(['posts', 'eventos', 'treinos', 'ligas'] as const).map((tab) => (
                <button 
                    key={tab} 
                    onClick={() => setActiveTab(tab)} 
                    className={`
                        px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap flex items-center gap-2
                        ${activeTab === tab ? 'border-emerald-500 text-emerald-500' : 'border-transparent text-zinc-500 hover:text-zinc-300'}
                    `}
                >
                    {tab === 'posts' && <LayoutList size={14} />}
                    {tab === 'eventos' && <Calendar size={14} />}
                    {tab === 'treinos' && <Dumbbell size={14} />}
                    {tab === 'ligas' && <Trophy size={14} />}
                    
                    {tab}
                </button>
            ))}
        </div>
                <div className="min-h-[200px]">
                    {activeTab === 'posts' && (
                        recentPosts.length > 0 ? (
                            <div className="space-y-2 animate-in fade-in">{recentPosts.map(p => (<div key={p.id} className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-xl"><p className="text-xs text-zinc-300 truncate mb-1">&quot;{p.texto}&quot;</p><div className="flex justify-between items-center text-[10px] text-zinc-500"><div className="flex items-center gap-2"><span className="flex items-center gap-1"><Heart size={10}/> {p.likes?.length || 0}</span><span className="flex items-center gap-1"><MessageCircle size={10}/> {p.comentarios || 0}</span></div><span>{formatPostDate(p.createdAt)}</span></div></div>))}<div className="text-center pt-2"><Link href="/comunidade" className="text-[10px] text-emerald-500 font-bold hover:underline">Ver Mais na Comunidade</Link></div></div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum post recente.</div>
                    )}

                    {activeTab === 'eventos' && (
                        myEvents.length > 0 ? (
                            <div className="grid grid-cols-2 gap-3 animate-in fade-in">{myEvents.map(e => (<Link href={`/eventos/${e.id}`} key={e.id} className="group flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition-all shadow-lg hover:shadow-emerald-500/10"><div className="h-28 w-full bg-zinc-800 relative overflow-hidden"><Image src={e.imagem || "https://placehold.co/600x400/111/333?text=Evento"} alt={e.titulo} fill className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500" style={{ objectPosition: `50% ${e.imagePositionY || 50}%` }}  sizes="(max-width: 768px) 100vw, 50vw" /><div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent"/><div className="absolute bottom-2 left-2 right-2"><p className="text-[10px] font-black text-white uppercase truncate drop-shadow-md">{e.titulo}</p></div></div><div className="p-2 flex items-center justify-between bg-zinc-950"><div className="flex items-center gap-1 text-[9px] text-zinc-400 font-bold uppercase"><Calendar size={10} className="text-emerald-500"/><span>{e.data || "Data à definir"}</span></div><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]"></div></div></Link>))}</div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum evento marcado.</div>
                    )}

                    {activeTab === 'ligas' && (
                        myLigas.length > 0 ? (
                            <div className="grid grid-cols-3 gap-4 animate-in fade-in">
                                {myLigas.map(l => (
                                    <Link href="/ligas_unitau" key={l.id} className="flex flex-col items-center gap-2 group">
                                        <div className="w-24 h-24 rounded-full bg-black border-2 border-zinc-800 p-0.5 group-hover:border-emerald-500 group-hover:scale-105 transition-all shadow-lg">
                                            <div className="w-full h-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center relative">
                                                {l.logoBase64 ? (
                                                    <Image src={l.logoBase64} alt={l.nome} fill className="object-cover"  sizes="96px" />
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

                    {activeTab === 'treinos' && (
                        myTreinos.length > 0 ? (
                             <div className="grid gap-3 animate-in fade-in">
                                {myTreinos.map(t => (
                                    <Link href={`/treinos/${t.id}`} key={t.id} className="group flex items-center bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition-all shadow-lg h-24">
                                            <div className="w-24 h-full bg-zinc-800 relative overflow-hidden shrink-0">
                                                 <Image
                                                    src={t.imagem || "https://placehold.co/400x400/111/333?text=Treino"}
                                                    alt={t.modalidade}
                                                    fill
                                                    className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                                                    
                                                    sizes="96px"
                                                 />
                                                 <div className="absolute inset-0 bg-gradient-to-r from-transparent to-zinc-900"/>
                                            </div>
                                            <div className="flex-1 p-3 flex flex-col justify-center">
                                                <div className="flex justify-between items-start mb-1">
                                                    <p className="text-sm font-black text-white uppercase truncate">{t.modalidade}</p>
                                                    <div className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-1">
                                                        <CheckCircle size={8}/> Eu Vou
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 text-[10px] text-zinc-400 font-bold uppercase">
                                                    <span className="flex items-center gap-1.5"><Calendar size={10} className="text-emerald-500"/> {t.dia}</span>
                                                    <span className="flex items-center gap-1.5"><Clock size={10} className="text-emerald-500"/> {t.horario}</span>
                                                    <span className="flex items-center gap-1.5"><MapPin size={10} className="text-emerald-500"/> {t.local || "Local à definir"}</span>
                                                </div>
                                            </div>
                                    </Link>
                                ))}
                             </div>
                        ) : <div className="text-center text-zinc-600 text-xs py-4">Nenhum treino confirmado.</div>
                    )}
                </div>
            </div>

            <div className="w-full max-w-sm mt-8 border-t border-zinc-800 pt-6">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest pl-2 border-l-2 border-zinc-500 mb-3">Ficha Técnica</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><MapPin size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Origem</p><p className="text-xs font-bold text-white">{profile.cidadeOrigem || "N/A"}</p></div></div>
                    <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><Heart size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Status</p><div className="flex items-center gap-1"><p className="text-xs font-bold text-white uppercase">{profile.statusRelacionamento || "N/A"}</p>{isRelationPrivate && <span title="Privado"><Lock size={10} className="text-zinc-500"/></span>}</div></div></div>
                    {profile.pets && (<div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-3 col-span-2"><div className="p-2 bg-zinc-800 rounded-lg text-emerald-500"><PawPrint size={16}/></div><div><p className="text-[9px] text-zinc-500 uppercase font-bold">Mascote</p><p className="text-xs font-bold text-white uppercase">{profile.pets}</p></div></div>)}
                </div>
                {profile.esportes && profile.esportes.length > 0 && (
                    <div className="pt-4"><h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest pl-2 border-l-2 border-blue-500 mb-3">Modalidades</h3><div className="flex flex-wrap gap-2">{profile.esportes.map((sport, i) => { const info = getSportInfo(sport); return <span key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide border border-white/5 shadow-sm ${info.color}`}><span className="text-sm">{info.emoji}</span> {info.label}</span>; })}</div></div>
                )}
            </div>
        </div>
      </div>

      {showEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-950 w-full max-w-md rounded-[2rem] border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
                      <h2 className="text-lg font-black uppercase text-white flex items-center gap-2"><Edit3 size={18} className="text-emerald-500"/> Editar Perfil</h2>
                      <button onClick={() => setShowEditModal(false)} className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white"><X size={18}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                      {/* Form Fields */}
                      <div className="space-y-4">
                          <div>
                              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Nome Completo</label>
                              <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition" />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Bio (Frase)</label>
                              <textarea value={editBio} onChange={e => setEditBio(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition h-20 resize-none" />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                              <div>
                                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Instagram (@)</label>
                                  <input type="text" value={editInstagram} onChange={e => setEditInstagram(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition" />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Cidade</label>
                                  <input type="text" value={editCidade} onChange={e => setEditCidade(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition" />
                              </div>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Status de Relacionamento</label>
                              <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition">
                                  <option value="Solteiro(a)">Solteiro(a) 🔓</option>
                                  <option value="Namorando">Namorando ❤️</option>
                                  <option value="Casado(a)">Casado(a) 💍</option>
                                  <option value="Enrolado(a)">Enrolado(a) 🌀</option>
                              </select>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Tem Pets?</label>
                              <select value={editPets} onChange={e => setEditPets(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 outline-none transition">
                                  <option value="nenhum">Nenhum</option>
                                  <option value="cachorro">Cachorro 🐕</option>
                                  <option value="gato">Gato 🐈</option>
                                  <option value="ambos">Ambos (Zoo) 🐾</option>
                              </select>
                          </div>
                      </div>

                      {/* Esportes */}
                      <div>
                          <label className="text-xs font-bold text-zinc-500 uppercase ml-1 mb-2 block">Seus Esportes (Max 5)</label>
                          <div className="flex flex-wrap gap-2">
                              {SPORTS_LIST.map(sport => (
                                  <button key={sport} onClick={() => toggleSport(sport)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border transition ${editSports.includes(sport) ? "bg-emerald-500 border-emerald-500 text-black" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}>
                                      {sport}
                                  </button>
                              ))}
                          </div>
                      </div>

                      {/* Privacidade */}
                      <div className="space-y-3 bg-black/20 p-4 rounded-xl border border-zinc-800/50">
                          <label className="text-xs font-bold text-zinc-400 uppercase mb-2 block">Privacidade</label>
                          <div className="flex items-center justify-between">
                              <span className="text-sm text-zinc-300">Mostrar Idade</span>
                              <button onClick={() => setEditIdadePublica(!editIdadePublica)} className={`w-10 h-5 rounded-full relative transition ${editIdadePublica ? "bg-emerald-500" : "bg-zinc-700"}`}>
                                  <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${editIdadePublica ? "left-6" : "left-1"}`}></div>
                              </button>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-sm text-zinc-300">Mostrar Status</span>
                              <button onClick={() => setEditRelacionamentoPublico(!editRelacionamentoPublico)} className={`w-10 h-5 rounded-full relative transition ${editRelacionamentoPublico ? "bg-emerald-500" : "bg-zinc-700"}`}>
                                  <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${editRelacionamentoPublico ? "left-6" : "left-1"}`}></div>
                              </button>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-sm text-zinc-300">WhatsApp Público</span>
                              <button onClick={() => setEditWhatsappPublico(!editWhatsappPublico)} className={`w-10 h-5 rounded-full relative transition ${editWhatsappPublico ? "bg-emerald-500" : "bg-zinc-700"}`}>
                                  <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all ${editWhatsappPublico ? "left-6" : "left-1"}`}></div>
                              </button>
                          </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-zinc-800 bg-zinc-900/50">
                      <button onClick={handleSaveProfile} disabled={savingProfile} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2">
                          {savingProfile ? <Loader2 className="animate-spin"/> : <CheckCircle size={20}/>}
                          {savingProfile ? "Salvando..." : "Salvar Alterações"}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-950 w-full max-w-sm rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                      <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">{activeModal === 'followers' ? <Users size={16} className="text-emerald-500"/> : <UserCheck size={16} className="text-blue-500"/>} {activeModal === 'followers' ? `Seguidores (${followersList.length})` : `Seguindo (${followingList.length})`}</h3>
                      <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-500 hover:text-white"><X size={20}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {(activeModal === 'followers' ? followersList : followingList).length === 0 ? <div className="text-center py-10 text-zinc-600"><Ghost size={32} className="mx-auto mb-2 opacity-50"/><p className="text-xs">Nada por aqui.</p></div> : (activeModal === 'followers' ? followersList : followingList).map(f => (<Link href={`/perfil/${f.uid}`} key={f.uid} onClick={() => setActiveModal(null)} className="flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-900 transition border border-transparent hover:border-zinc-800"><div className="w-10 h-10 rounded-full bg-black overflow-hidden border border-zinc-700 relative"><Image src={f.foto || "https://github.com/shadcn.png"} alt={f.nome} fill sizes="40px" className="object-cover" /></div><div className="flex-1"><p className="text-sm font-bold text-white">{f.nome}</p><p className="text-[10px] text-zinc-500 font-bold uppercase">{f.turma || "Bicho"}</p></div><ChevronRight size={14} className="text-zinc-600"/></Link>))}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
