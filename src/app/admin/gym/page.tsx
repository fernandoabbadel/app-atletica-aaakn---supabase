"use client";

import React, { useState, useMemo, useRef } from "react";
import { 
  ArrowLeft, Plus, Trophy, Calendar, Trash2, Medal, 
  ShieldAlert, CheckCircle2, XCircle, Dumbbell, Settings, 
  LayoutDashboard, AlertTriangle, Edit, BarChart3, PieChart,
  X, ChevronDown, Undo2, ExternalLink, UploadCloud, Eye, Flag, Clock
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "../../../context/ToastContext";
import { compressImageFile } from "../../../lib/imageCompression";
import { validateImageFile } from "../../../lib/upload";

// --- TIPAGEM ---

interface Campeonato {
    id: number;
    titulo: string;
    inicio: string;
    fim: string;
    regras: string;
    status: "ativo" | "agendado" | "encerrado";
    inscritos: number;
    xpBonus: number;
    fotoCapa?: string;
}

interface ItemModeracao {
    id: number;
    usuario: string;
    usuarioHandle: string;
    turma: string; 
    foto: string;
    modalidade: string;
    data: string;
    tipo: "validacao" | "denuncia";
    status: "pendente" | "aprovado" | "rejeitado" | "punido";
    motivoDenuncia?: string;
    campeonatoId: number;
}

interface TipoTreino {
    id: number;
    nome: string;
    xp: number;
    icon: string;
    count: number;
}

interface RankingTurma {
    id: string;
    nome: string;
    logo: string;
    xpTotal: number;
    treinosValidos: number;
}

interface UsuarioRanking {
    pos: number;
    nome: string;
    handle: string;
    xp: number;
    avatar: string;
}

// Interface para o objeto agrupado do Wall of Shame
interface ShameProfile {
    usuario: string;
    usuarioHandle: string;
    foto: string;
    count: number;
    treinos: ItemModeracao[];
}

// --- DADOS MOCKADOS ---

const CHAMPS_MOCK: Campeonato[] = [
  { 
      id: 1, 
      titulo: "Rei do Supino 2026", 
      inicio: "01/10", 
      fim: "30/10", 
      regras: "Postar foto do peso e vídeo da execução.", 
      status: "ativo", 
      inscritos: 120, 
      xpBonus: 500, 
      fotoCapa: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800" 
  },
  { 
      id: 2, 
      titulo: "Intermed Challenge", 
      inicio: "01/11", 
      fim: "30/11", 
      regras: "Foco total nos treinos aeróbicos.", 
      status: "agendado", 
      inscritos: 45, 
      xpBonus: 1000, 
      fotoCapa: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800" 
  },
];

const TREINOS_MOCK: TipoTreino[] = [
    { id: 1, nome: "Musculação", xp: 50, icon: "💪", count: 450 },
    { id: 2, nome: "Crossfit", xp: 60, icon: "🏋️", count: 320 },
    { id: 3, nome: "Cardio", xp: 40, icon: "🏃", count: 210 },
    { id: 4, nome: "Natação", xp: 70, icon: "🏊", count: 80 },
    { id: 5, nome: "Futevôlei", xp: 55, icon: "⚽", count: 120 },
    { id: 6, nome: "Luta", xp: 65, icon: "🥊", count: 90 },
    { id: 7, nome: "Dança", xp: 45, icon: "💃", count: 40 },
];

const MODERACAO_MOCK: ItemModeracao[] = [
    { id: 101, campeonatoId: 1, usuario: "João Calouro", usuarioHandle: "joao", turma: "T7", foto: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=500&q=80", modalidade: "Musculação", data: "Hoje, 10:00", tipo: "denuncia", status: "pendente", motivoDenuncia: "Foto repetida." },
    { id: 102, campeonatoId: 1, usuario: "Maria Silva", usuarioHandle: "maria", turma: "T5", foto: "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=500&q=80", modalidade: "Crossfit", data: "Ontem, 22:00", tipo: "validacao", status: "pendente" },
    
    // Itens Punidos (Wall of Shame)
    { id: 103, campeonatoId: 1, usuario: "Pedro H.", usuarioHandle: "pedro", turma: "T4", foto: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=500&q=80", modalidade: "Cardio", data: "05/10, 06:00", tipo: "denuncia", status: "punido", motivoDenuncia: "Não é foto de treino." },
    { id: 104, campeonatoId: 1, usuario: "Pedro H.", usuarioHandle: "pedro", turma: "T4", foto: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=500", modalidade: "Dança", data: "06/10, 19:00", tipo: "denuncia", status: "punido", motivoDenuncia: "Foto escura." },
    
    { id: 201, campeonatoId: 2, usuario: "Lucas Lima", usuarioHandle: "lucas", turma: "T6", foto: "https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?w=500", modalidade: "Natação", data: "Hoje, 07:00", tipo: "denuncia", status: "pendente", motivoDenuncia: "Foto da internet" },
];

const RANKING_TURMAS_MOCK: RankingTurma[] = [
    { id: "T5", nome: "Turma V", logo: "/turma5.jpeg", xpTotal: 15400, treinosValidos: 320 },
    { id: "T7", nome: "Turma VII", logo: "/turma7.jpeg", xpTotal: 12100, treinosValidos: 240 },
    { id: "T4", nome: "Turma IV", logo: "/turma4.jpeg", xpTotal: 9800, treinosValidos: 190 },
    { id: "T6", nome: "Turma VI", logo: "/turma6.jpeg", xpTotal: 8500, treinosValidos: 150 },
];

const RANKING_USUARIOS_MOCK: UsuarioRanking[] = [
    { pos: 1, nome: "Ana Clara", handle: "ana", xp: 1250, avatar: "https://i.pravatar.cc/150?u=ana" },
    { pos: 2, nome: "João Silva", handle: "joao", xp: 1100, avatar: "https://i.pravatar.cc/150?u=joao" },
    { pos: 3, nome: "Maria S.", handle: "maria", xp: 980, avatar: "https://i.pravatar.cc/150?u=maria" },
    { pos: 4, nome: "Pedro H.", handle: "pedro", xp: 950, avatar: "https://i.pravatar.cc/150?u=pedro" },
    { pos: 5, nome: "Lucas L.", handle: "lucas", xp: 800, avatar: "https://i.pravatar.cc/150?u=lucas" },
    { pos: 6, nome: "Bia M.", handle: "bia", xp: 750, avatar: "https://i.pravatar.cc/150?u=bia" },
    { pos: 7, nome: "Carlos D.", handle: "carlos", xp: 720, avatar: "https://i.pravatar.cc/150?u=carlos" },
    { pos: 8, nome: "Fernanda", handle: "nanda", xp: 690, avatar: "https://i.pravatar.cc/150?u=fernanda" },
    { pos: 9, nome: "Gabriel", handle: "gabriel", xp: 650, avatar: "https://i.pravatar.cc/150?u=gabriel" },
    { pos: 10, nome: "Juliana", handle: "ju", xp: 600, avatar: "https://i.pravatar.cc/150?u=ju" },
];

const DIAS_SEMANA = [
    { dia: "Seg", val: 85 }, { dia: "Ter", val: 92 }, { dia: "Qua", val: 100 }, 
    { dia: "Qui", val: 75 }, { dia: "Sex", val: 60 }, { dia: "Sáb", val: 30 }, { dia: "Dom", val: 15 }
];

// --- COMPONENTE SEMICIRCULO ---
const SemiCircleChart = ({ value, total }: { value: number, total: number }) => {
    const percentage = (value / total) * 100;
    const radius = 40;
    const circumference = Math.PI * radius; 
    const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;

    return (
        <div className="relative w-40 h-24 flex items-end justify-center overflow-hidden">
            <svg viewBox="0 0 100 50" className="w-full h-full">
                <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#27272a" strokeWidth="10" />
                <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#10b981" strokeWidth="10" strokeDasharray={strokeDasharray} className="transition-all duration-1000 ease-out" />
            </svg>
            <div className="absolute bottom-0 text-center mb-1">
                <span className="text-2xl font-black text-white">{value}</span>
                <span className="text-[9px] block text-zinc-500 uppercase">Participantes</span>
            </div>
        </div>
    );
};

export default function AdminGymPage() {
  const { addToast } = useToast();
  
  // --- ESTADOS GLOBAIS ---
  const [selectedChampId, setSelectedChampId] = useState<number>(CHAMPS_MOCK[0].id);
  const [activeTab, setActiveTab] = useState<"dashboard" | "champs" | "moderacao" | "config">("dashboard");
  
  // --- DADOS ---
  const [champs, setChamps] = useState<Campeonato[]>(CHAMPS_MOCK);
  const [itensModeracao, setItensModeracao] = useState<ItemModeracao[]>(MODERACAO_MOCK);
  const [tiposTreino, setTiposTreino] = useState<TipoTreino[]>(TREINOS_MOCK);
  
  // --- FILTROS MODERAÇÃO ---
  const [subTabModeracao, setSubTabModeracao] = useState<"pendentes" | "arquivados">("pendentes");
  const [filtroTipoModeracao, setFiltroTipoModeracao] = useState<"todos" | "denuncia" | "validacao">("denuncia");

  // --- MODAIS ---
  const [showModalChamp, setShowModalChamp] = useState(false);
  const [showModalTreino, setShowModalTreino] = useState(false);
  
  // Modal de Imagem (Lightbox)
  const [showModalImage, setShowModalImage] = useState<ItemModeracao | null>(null); 
  
  // Modal Wall of Shame (Dossiê)
  const [selectedShameProfile, setSelectedShameProfile] = useState<ShameProfile | null>(null);
  
  // Forms & Refs
  const [editingChamp, setEditingChamp] = useState<Partial<Campeonato>>({});
  const [novoTreino, setNovoTreino] = useState({ nome: "", xp: 50, icon: "🔥" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- HELPERS E FILTROS ---
  const selectedChamp = champs.find(c => c.id === selectedChampId) || champs[0];

  const itensDoCampeonato = useMemo(() => itensModeracao.filter(i => i.campeonatoId === selectedChampId), [itensModeracao, selectedChampId]);
  const itensPendentes = itensDoCampeonato.filter(i => i.status === "pendente");
  const itensArquivados = itensDoCampeonato.filter(i => i.status !== "pendente");

  // Wall of Shame (Agrupado por HANDLE)
  const wallOfShameList = useMemo(() => {
      const punidos = itensDoCampeonato.filter(i => i.status === "punido");
      const grouped = punidos.reduce((acc, item) => {
          if (!acc[item.usuarioHandle]) {
              acc[item.usuarioHandle] = { 
                  usuario: item.usuario,
                  usuarioHandle: item.usuarioHandle,
                  foto: item.foto, 
                  count: 0, 
                  treinos: [] 
              };
          }
          acc[item.usuarioHandle].count++;
          acc[item.usuarioHandle].treinos.push(item);
          return acc;
      }, {} as Record<string, ShameProfile>);
      
      return Object.values(grouped).sort((a, b) => b.count - a.count);
  }, [itensDoCampeonato]);

  // --- AÇÕES MODERAÇÃO ---
  const handleResolucao = (id: number, novoStatus: "aprovado" | "rejeitado" | "punido" | "pendente") => {
      setItensModeracao(prev => prev.map(item => item.id === id ? { ...item, status: novoStatus } : item));
      if (novoStatus === "punido") addToast("Denúncia ACATADA. Pontos removidos.", "success");
      if (novoStatus === "aprovado") addToast("Treino validado!", "success");
      if (novoStatus === "pendente") addToast("Decisão desfeita. Item retornou para análise.", "info");
      setShowModalImage(null);
  };

  // --- AÇÕES CAMPEONATO ---
  const handleSaveChamp = () => {
      if (!editingChamp.titulo) { addToast("Título obrigatório!", "error"); return; }
      
      const payload = {
          ...editingChamp,
          fotoCapa: editingChamp.fotoCapa || "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800"
      };

      if (editingChamp.id) {
          setChamps(prev => prev.map(c => c.id === editingChamp.id ? { ...c, ...payload } as Campeonato : c));
          addToast("Campeonato atualizado!", "success");
      } else {
          setChamps([...champs, { id: Date.now(), ...payload, inscritos: 0 } as Campeonato]);
          addToast("Campeonato criado!", "success");
      }
      setShowModalChamp(false);
  };

  const handleDeleteChamp = (id: number) => {
      if (confirm("ATENÇÃO: Excluir o campeonato apagará todo o histórico dele. Confirmar?")) {
          setChamps(prev => prev.filter(c => c.id !== id));
          if(selectedChampId === id && champs.length > 1) setSelectedChampId(champs[0].id);
          addToast("Campeonato excluído.", "info");
      }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
        addToast(validationError, "error");
        return;
    }

    try {
        const compressedFile = await compressImageFile(file, {
            maxWidth: 1280,
            maxHeight: 1280,
            quality: 0.8,
        });
        const reader = new FileReader();
        reader.readAsDataURL(compressedFile);
        reader.onload = (ev) => setEditingChamp({ ...editingChamp, fotoCapa: ev.target?.result as string });
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao processar imagem.", "error");
    }
  };

  // --- AÇÕES CONFIG TREINO ---
  const handleSaveTreino = () => {
      if(!novoTreino.nome) { addToast("Nome obrigatório!", "error"); return; }
      setTiposTreino([...tiposTreino, { id: Date.now(), ...novoTreino, count: 0 }]);
      setShowModalTreino(false);
      setNovoTreino({ nome: "", xp: 50, icon: "🔥" });
      addToast("Modalidade adicionada!", "success");
  };

  const handleUpdateXP = (id: number, val: number) => {
      setTiposTreino(prev => prev.map(t => t.id === id ? { ...t, xp: val } : t));
  }

  const handleDeleteTreino = (id: number) => {
      if(confirm("Remover esta modalidade?")) {
          setTiposTreino(prev => prev.filter(t => t.id !== id));
          addToast("Modalidade removida.", "info");
      }
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      
      {/* HEADER + SELETOR */}
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
                <Link href="/admin" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400" /></Link>
                <div>
                    <h1 className="text-lg font-black text-white uppercase tracking-tighter leading-none">Gestão Gym</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Campeonato Atual:</span>
                        <div className="relative group">
                            <button className="flex items-center gap-1 text-xs font-bold text-emerald-500 hover:text-emerald-400 uppercase bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                                {selectedChamp?.titulo || "Selecione"} <ChevronDown size={12}/>
                            </button>
                            <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl hidden group-hover:block z-50 overflow-hidden">
                                {champs.map(c => (
                                    <button key={c.id} onClick={() => setSelectedChampId(c.id)} className="w-full text-left px-4 py-3 text-xs hover:bg-zinc-800 border-b border-zinc-800/50 text-zinc-300 hover:text-white flex justify-between">
                                        <span className="truncate">{c.titulo}</span>
                                        {c.id === selectedChampId && <CheckCircle2 size={12} className="text-emerald-500 shrink-0"/>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex gap-2">
                {activeTab === 'champs' && <button onClick={() => { setEditingChamp({}); setShowModalChamp(true); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20"><Plus size={16} /> Novo Champ</button>}
                {activeTab === 'config' && <button onClick={() => setShowModalTreino(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20"><Plus size={16} /> Nova Modalidade</button>}
            </div>
        </div>
      </header>

      {/* TABS */}
      <div className="px-6 pt-4 overflow-x-auto">
          <div className="flex border-b border-zinc-800 gap-6 min-w-max">
              <button onClick={() => setActiveTab("dashboard")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 ${activeTab === 'dashboard' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><LayoutDashboard size={16}/> Visão Geral</button>
              <button onClick={() => setActiveTab("moderacao")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 ${activeTab === 'moderacao' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><ShieldAlert size={16}/> Moderação {itensPendentes.length > 0 && <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">{itensPendentes.length}</span>}</button>
              <button onClick={() => setActiveTab("champs")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 ${activeTab === 'champs' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><Trophy size={16}/> Campeonatos</button>
              <button onClick={() => setActiveTab("config")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 ${activeTab === 'config' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><Settings size={16}/> Configs</button>
          </div>
      </div>

      <main className="p-6 space-y-6">
        
        {/* --- 1. DASHBOARD --- */}
        {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* COLUNA 1: PARTICIPAÇÃO & WALL OF SHAME */}
                    <div className="space-y-6">
                        <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 flex flex-col items-center">
                            <h3 className="text-sm font-bold text-white mb-4 w-full flex items-center gap-2"><PieChart size={16} className="text-emerald-500"/> Engajamento</h3>
                            <SemiCircleChart value={selectedChamp?.inscritos || 0} total={500} />
                            <div className="mt-4 flex gap-4 text-xs text-zinc-500"><span>Total Base: <strong>500</strong></span><span>Inscritos: <strong className="text-white">{selectedChamp?.inscritos || 0}</strong></span></div>
                        </div>
                        
                        <div className="bg-red-950/10 p-6 rounded-3xl border border-red-900/30">
                            <h3 className="text-sm font-bold text-red-500 mb-4 flex items-center gap-2"><AlertTriangle size={16}/> Wall of Shame</h3>
                            <div className="space-y-3">
                                {wallOfShameList.slice(0,3).map((profile, i) => (
                                    <div 
                                        key={i} 
                                        className="flex items-center gap-3 p-3 bg-red-900/10 rounded-xl border border-red-900/20 group hover:bg-red-900/30 transition cursor-pointer"
                                        onClick={() => setSelectedShameProfile(profile)}
                                    >
                                        <div className="font-black text-red-700 w-4">#{i+1}</div>
                                        <div className="w-8 h-8 rounded-full border border-red-500/30 overflow-hidden bg-zinc-900 relative">
                                            <Image src={profile.foto} alt={profile.usuario} fill className="object-cover" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-xs font-bold text-red-200 group-hover:underline">{profile.usuario}</p>
                                            <p className="text-[9px] text-red-400/60">Ver dossiê completo</p>
                                        </div>
                                        <div className="text-xs font-black text-red-500">{profile.count}x</div>
                                    </div>
                                ))}
                                {wallOfShameList.length === 0 && <p className="text-xs text-red-400/50 text-center py-4">Nenhum punido neste campeonato.</p>}
                            </div>
                        </div>
                    </div>

                    {/* COLUNA 2: RANKING TURMAS */}
                    <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800">
                        <h3 className="text-sm font-bold text-white mb-6 flex items-center gap-2"><BarChart3 size={16} className="text-emerald-500"/> Pontuação por Turma</h3>
                        <div className="space-y-4">
                            {RANKING_TURMAS_MOCK.map((turma) => (
                                <div key={turma.id} className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-black border border-zinc-700 overflow-hidden shrink-0 relative">
                                        <Image src={turma.logo} alt={turma.nome} fill className="object-cover" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="font-bold text-white">{turma.nome}</span>
                                            <div className="flex gap-3 text-[10px]"><span className="text-emerald-400 font-bold">{turma.xpTotal} XP</span><span className="text-zinc-500">{turma.treinosValidos} treinos</span></div>
                                        </div>
                                        <div className="h-1.5 bg-black rounded-full overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${(turma.xpTotal / 20000) * 100}%` }}></div></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* COLUNA 3: TREINOS SEMANA + TOP 10 RANKING */}
                    <div className="space-y-6">
                        <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800">
                            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Calendar size={16} className="text-blue-500"/> Pico Semanal</h3>
                            <div className="flex items-end gap-2 h-24">
                                {DIAS_SEMANA.map(d => (
                                    <div key={d.dia} className="flex-1 flex flex-col items-center gap-1 group">
                                        <div className="w-full bg-zinc-800 rounded-t-lg relative overflow-hidden transition-all group-hover:bg-zinc-700" style={{ height: `${d.val}%` }}><div className="absolute bottom-0 w-full h-1 bg-emerald-500"></div></div>
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase">{d.dia}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800">
                            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Trophy size={16} className="text-yellow-500"/> Top 10 Atletas</h3>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                                {RANKING_USUARIOS_MOCK.map((user) => (
                                    <Link href={`/perfil/${user.handle}`} key={user.pos} className="flex items-center justify-between p-2 rounded-lg hover:bg-black/30 transition group">
                                        <div className="flex items-center gap-3">
                                            <span className={`text-sm font-black w-4 ${user.pos <= 3 ? 'text-yellow-500' : 'text-zinc-600'}`}>{user.pos}</span>
                                            <div className="w-6 h-6 rounded-full overflow-hidden border border-zinc-700 relative">
                                                <Image src={user.avatar} alt={user.nome} fill className="object-cover" />
                                            </div>
                                            <span className="text-xs font-bold text-zinc-300 group-hover:text-white transition">{user.nome}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-emerald-500">{user.xp} XP</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- 2. MODERAÇÃO --- */}
        {activeTab === 'moderacao' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-800 pb-2">
                    <div className="flex gap-4">
                        <button onClick={() => setSubTabModeracao("pendentes")} className={`text-xs font-bold uppercase pb-2 px-2 transition ${subTabModeracao === 'pendentes' ? 'text-white border-b-2 border-emerald-500' : 'text-zinc-500'}`}>Pendentes ({itensPendentes.length})</button>
                        <button onClick={() => setSubTabModeracao("arquivados")} className={`text-xs font-bold uppercase pb-2 px-2 transition ${subTabModeracao === 'arquivados' ? 'text-white border-b-2 border-emerald-500' : 'text-zinc-500'}`}>Arquivados ({itensArquivados.length})</button>
                    </div>
                    {/* 🦈 Filtro de Tipo (Usa a variável setFiltroTipoModeracao) */}
                    <div className="flex bg-zinc-900 rounded-lg p-1 gap-1">
                        <button onClick={() => setFiltroTipoModeracao("todos")} className={`text-[10px] font-bold uppercase px-3 py-1 rounded transition ${filtroTipoModeracao === 'todos' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>Todos</button>
                        <button onClick={() => setFiltroTipoModeracao("denuncia")} className={`text-[10px] font-bold uppercase px-3 py-1 rounded transition ${filtroTipoModeracao === 'denuncia' ? 'bg-red-500/20 text-red-500' : 'text-zinc-500 hover:text-red-400'}`}>Denúncias</button>
                        <button onClick={() => setFiltroTipoModeracao("validacao")} className={`text-[10px] font-bold uppercase px-3 py-1 rounded transition ${filtroTipoModeracao === 'validacao' ? 'bg-emerald-500/20 text-emerald-500' : 'text-zinc-500 hover:text-emerald-400'}`}>Validações</button>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(subTabModeracao === 'pendentes' ? itensPendentes : itensArquivados)
                        .filter(i => filtroTipoModeracao === 'todos' || i.tipo === filtroTipoModeracao)
                        .map(item => (
                        <div key={item.id} className={`bg-zinc-900 rounded-2xl border overflow-hidden flex flex-col ${item.tipo === 'denuncia' ? 'border-red-500 shadow-md' : 'border-zinc-800'}`}>
                            <div className="p-3 flex justify-between items-center border-b bg-black/40 border-zinc-800">
                                <Link href={`/perfil/${item.usuarioHandle}`} className="flex items-center gap-2 group">
                                    <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden relative">
                                        <Image src={item.foto} alt="Avatar" fill className="object-cover" />
                                    </div>
                                    <div><span className="text-xs font-bold text-white block group-hover:text-emerald-400 transition">{item.usuario}</span><span className="text-[9px] text-zinc-500 uppercase">{item.turma}</span></div>
                                </Link>
                                <span className="text-[9px] text-zinc-500">{item.data}</span>
                            </div>
                            <div className="relative h-56 bg-black group cursor-zoom-in" onClick={() => setShowModalImage(item)}>
                                <Image src={item.foto} alt="Treino" fill className="object-cover opacity-90 group-hover:opacity-100 transition" />
                                {item.status !== 'pendente' && <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm z-10"><span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${item.status === 'punido' || item.status === 'rejeitado' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-black'}`}>{item.status}</span></div>}
                                {item.motivoDenuncia && <div className="absolute bottom-0 left-0 w-full bg-red-900/90 backdrop-blur-md p-2 border-t border-red-500/50 z-10"><p className="text-[10px] text-red-200 font-bold uppercase mb-1">Motivo:</p><p className="text-xs text-white truncate">&quot;{item.motivoDenuncia}&quot;</p></div>}
                            </div>
                            <div className="p-3 flex gap-2 mt-auto border-t border-white/5">
                                {item.status === 'pendente' ? (
                                    item.tipo === 'denuncia' ? (
                                        <><button onClick={() => handleResolucao(item.id, "aprovado")} className="flex-1 bg-zinc-800 hover:text-white py-3 rounded-xl text-xs font-bold uppercase">Absolver</button><button onClick={() => handleResolucao(item.id, "punido")} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl text-xs font-bold uppercase shadow-lg">Punir</button></>
                                    ) : (
                                        <><button onClick={() => handleResolucao(item.id, "rejeitado")} className="flex-1 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white py-3 rounded-xl text-xs font-bold uppercase transition border border-red-500/20"><XCircle size={16}/></button><button onClick={() => handleResolucao(item.id, "aprovado")} className="flex-[3] bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl text-xs font-bold uppercase shadow-lg flex items-center justify-center gap-2"><CheckCircle2 size={16}/> Validar</button></>
                                    )
                                ) : (
                                    <button onClick={() => handleResolucao(item.id, "pendente")} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-2"><Undo2 size={14}/> Desfazer</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* --- 3. CAMPEONATOS --- */}
        {activeTab === 'champs' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                {champs.map(champ => (
                    <div key={champ.id} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
                        {champ.fotoCapa && <div className="absolute inset-0 z-0 opacity-10"><Image src={champ.fotoCapa} alt="Bg" fill className="object-cover" /></div>}
                        <div className="flex items-start gap-4 relative z-10">
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-black shadow-lg shrink-0 ${champ.status === 'ativo' ? 'bg-emerald-500' : 'bg-zinc-700 text-zinc-400'}`}><Trophy size={24} /></div>
                            <div>
                                <h3 className="font-bold text-white text-base flex items-center gap-2">{champ.titulo} {champ.status === 'ativo' && <span className="bg-emerald-500/20 text-emerald-500 text-[9px] px-2 py-0.5 rounded font-black uppercase">Ativo</span>}</h3>
                                <p className="text-zinc-400 text-xs line-clamp-1 mb-2">{champ.regras}</p>
                                <div className="flex items-center gap-4 text-zinc-500 text-[10px] font-bold uppercase"><span className="flex items-center gap-1"><Calendar size={12} /> {champ.inicio} - {champ.fim}</span><span className="flex items-center gap-1"><Medal size={12} /> {champ.inscritos} Inscritos</span></div>
                            </div>
                        </div>
                        <div className="flex gap-2 relative z-10">
                            <button onClick={() => { setEditingChamp(champ); setShowModalChamp(true); }} className="p-3 bg-black/40 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition border border-zinc-800"><Edit size={18}/></button>
                            <button onClick={() => handleDeleteChamp(champ.id)} className="p-3 bg-black/40 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 rounded-xl transition border border-zinc-800 hover:border-red-500/30"><Trash2 size={18}/></button>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* --- 4. CONFIGS (MODALIDADES) --- */}
        {activeTab === 'config' && (
            <div className="bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="p-4 bg-black/40 border-b border-zinc-800 flex justify-between items-center"><h3 className="font-bold text-white flex items-center gap-2"><Settings size={18} className="text-emerald-500"/> Modalidades Ativas</h3></div>
                <div className="divide-y divide-zinc-800">
                    {tiposTreino.map(tipo => (
                        <div key={tipo.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/30 transition">
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-xl border border-zinc-700">{tipo.icon}</div><span className="font-bold text-white text-sm">{tipo.nome}</span></div>
                            <div className="flex items-center gap-2"><label className="text-[10px] text-zinc-500 uppercase font-bold mr-2">XP</label><input type="number" className="bg-black border border-zinc-700 text-white w-16 text-center rounded-lg py-1 text-sm focus:border-emerald-500 outline-none font-bold" value={tipo.xp} onChange={(e) => handleUpdateXP(tipo.id, Number(e.target.value))}/></div>
                            <button onClick={() => handleDeleteTreino(tipo.id)} className="text-zinc-600 hover:text-red-500"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
            </div>
        )}

      </main>

      {/* --- MODAIS --- */}

      {/* 1. MODAL IMAGEM EXPANDIDA (DESIGN "PERFECT CARD" - VERSÃO ADMIN) */}
      {showModalImage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
              <div className="absolute inset-0" onClick={() => setShowModalImage(null)}></div>
              <button onClick={() => setShowModalImage(null)} className="absolute top-4 right-4 p-2 bg-zinc-800 rounded-full text-white hover:bg-zinc-700 z-50"><X size={24}/></button>
              
              <div className="w-full max-w-5xl bg-[#09090b] border border-zinc-800 rounded-[2rem] overflow-hidden flex flex-col md:flex-row shadow-2xl relative z-10 max-h-[90vh]">
                  
                  {/* COLUNA ESQUERDA: FOTO */}
                  <div className="md:w-[60%] bg-black relative flex items-center justify-center h-64 md:h-auto">
                      <Image src={showModalImage.foto} alt="Prova" fill className="object-cover" />
                      
                      {/* Badge de Status (Admin) */}
                      <div className={`absolute top-6 left-6 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wide flex items-center gap-2 shadow-lg z-10 ${
                          showModalImage.tipo === 'denuncia' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                      }`}>
                          {showModalImage.tipo === 'denuncia' ? <><AlertTriangle size={14}/> Denúncia</> : <><Clock size={14}/> Análise</>}
                      </div>
                  </div>

                  {/* COLUNA DIREITA: ADMIN TOOLS */}
                  <div className="md:w-[40%] flex flex-col bg-[#09090b]">
                      
                      {/* Header Usuário */}
                      <div className="p-6 border-b border-zinc-800/50 flex items-center gap-4">
                          <Link href={`/perfil/${showModalImage.usuarioHandle}`} className="group relative w-12 h-12">
                            <div className="absolute inset-0 rounded-full p-0.5 border border-zinc-700 group-hover:border-[#10b981] transition overflow-hidden">
                                <Image src={showModalImage.foto} alt="Avatar" fill className="object-cover" />
                            </div>
                          </Link>
                          <div>
                              <Link href={`/perfil/${showModalImage.usuarioHandle}`}>
                                <h3 className="font-bold text-white text-base hover:text-[#10b981] transition">{showModalImage.usuario}</h3>
                              </Link>
                              <p className="text-xs text-zinc-500 font-medium">{showModalImage.turma} • {showModalImage.data}</p>
                          </div>
                      </div>

                      {/* Conteúdo Scrollável */}
                      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                          {/* Detalhes do Treino */}
                          <div>
                              <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-2">{showModalImage.modalidade}</h2>
                              <p className="text-sm text-zinc-400">Verifique se a foto corresponde à modalidade e se cumpre as regras do campeonato ativo.</p>
                          </div>

                          {/* Área de Alerta (Se for Denúncia) */}
                          {showModalImage.tipo === 'denuncia' && showModalImage.motivoDenuncia && (
                              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl">
                                  <h4 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                      <Flag size={12}/> Motivo da Denúncia
                                  </h4>
                                  <p className="text-sm text-white font-medium">&quot;{showModalImage.motivoDenuncia}&quot;</p>
                              </div>
                          )}

                          {/* Histórico/Contexto (Simulado) */}
                          <div className="space-y-2">
                              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Histórico Recente</h4>
                              <div className="flex items-center gap-2 text-xs text-zinc-400">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Sem punições anteriores.
                              </div>
                          </div>
                      </div>

                      {/* Footer: Ações de Moderação */}
                      <div className="p-6 border-t border-zinc-800/50 bg-[#09090b] space-y-3">
                          {showModalImage.status === 'pendente' ? (
                              showModalImage.tipo === 'denuncia' ? (
                                  <div className="grid grid-cols-2 gap-3">
                                      <button onClick={() => handleResolucao(showModalImage.id, "aprovado")} className="py-4 rounded-xl border border-zinc-700 text-zinc-300 font-bold uppercase hover:bg-zinc-800 hover:text-white transition">
                                          Absolver
                                      </button>
                                      <button onClick={() => handleResolucao(showModalImage.id, "punido")} className="py-4 rounded-xl bg-red-600 text-white font-black uppercase hover:bg-red-500 shadow-lg shadow-red-900/20 transition flex items-center justify-center gap-2">
                                          <Trash2 size={18}/> Punir
                                      </button>
                                  </div>
                              ) : (
                                  <div className="grid grid-cols-4 gap-3">
                                      <button onClick={() => handleResolucao(showModalImage.id, "rejeitado")} className="col-span-1 py-4 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-red-900/30 hover:text-red-500 transition flex items-center justify-center border border-zinc-700 hover:border-red-500/50">
                                          <XCircle size={20}/>
                                      </button>
                                      <button onClick={() => handleResolucao(showModalImage.id, "aprovado")} className="col-span-3 py-4 rounded-xl bg-[#10b981] text-black font-black uppercase hover:bg-emerald-400 shadow-lg shadow-emerald-900/20 transition flex items-center justify-center gap-2">
                                          <CheckCircle2 size={20}/> Validar Treino
                                      </button>
                                  </div>
                              )
                          ) : (
                              <button onClick={() => handleResolucao(showModalImage.id, "pendente")} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-4 rounded-xl text-xs font-bold uppercase transition flex items-center justify-center gap-2">
                                  <Undo2 size={16}/> Desfazer Decisão ({showModalImage.status})
                              </button>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* 2. MODAL WALL OF SHAME (DOSSIÊ COMPLETO) */}
      {selectedShameProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
              <div className="bg-zinc-900 w-full max-w-lg rounded-3xl border border-red-900/30 p-6 max-h-[80vh] flex flex-col">
                  <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-black text-red-500 flex items-center gap-2 uppercase italic"><AlertTriangle/> Dossiê: {selectedShameProfile.usuario}</h2><button onClick={() => setSelectedShameProfile(null)}><X size={24} className="text-zinc-500 hover:text-white"/></button></div>
                  <div className="overflow-y-auto space-y-3 pr-2">
                      {selectedShameProfile.treinos.map((item, i) => (
                          <div key={i} className="flex items-center gap-4 p-4 bg-black/40 rounded-2xl border border-zinc-800">
                              <div className="w-12 h-12 rounded-xl bg-zinc-800 overflow-hidden shrink-0 cursor-zoom-in group relative" onClick={() => setShowModalImage(item)}>
                                  <Image src={item.foto} alt="Prova" fill className="object-cover" />
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10"><Eye size={16}/></div>
                              </div>
                              <div className="flex-1">
                                  <p className="text-xs text-zinc-400 mb-1">{item.data} • {item.modalidade}</p>
                                  <p className="text-xs text-red-400 font-bold">&quot;{item.motivoDenuncia}&quot;</p>
                              </div>
                              <Link href={`/perfil/${item.usuarioHandle}`} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white"><ExternalLink size={16}/></Link>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* 3. MODAL CAMPEONATO (COM FOTO) */}
      {showModalChamp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-zinc-900 w-full max-w-md rounded-3xl border border-zinc-800 p-6 space-y-4">
                  <h2 className="font-bold text-white text-lg">{editingChamp.id ? 'Editar' : 'Novo'} Campeonato</h2>
                  <div onClick={() => fileInputRef.current?.click()} className="h-32 rounded-2xl border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-zinc-800/50 transition overflow-hidden relative">
                      {editingChamp.fotoCapa ? <Image src={editingChamp.fotoCapa} alt="Capa" fill className="object-cover" /> : <><UploadCloud size={24} className="text-zinc-500 mb-2 relative z-10"/><span className="text-xs text-zinc-500 font-bold uppercase relative z-10">Capa do Evento</span></>}
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </div>
                  <input type="text" placeholder="Título" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={editingChamp.titulo || ""} onChange={e => setEditingChamp({...editingChamp, titulo: e.target.value})} />
                  <div className="grid grid-cols-2 gap-3">
                      <input type="text" placeholder="Início" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={editingChamp.inicio || ""} onChange={e => setEditingChamp({...editingChamp, inicio: e.target.value})} />
                      <input type="text" placeholder="Fim" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={editingChamp.fim || ""} onChange={e => setEditingChamp({...editingChamp, fim: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                      <input type="number" placeholder="Bonus XP" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={editingChamp.xpBonus || ""} onChange={e => setEditingChamp({...editingChamp, xpBonus: Number(e.target.value)})} />
                      <select className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={editingChamp.status || "agendado"} onChange={e => setEditingChamp({...editingChamp, status: e.target.value as "ativo" | "agendado" | "encerrado"})}><option value="agendado">Agendado</option><option value="ativo">Ativo</option><option value="encerrado">Encerrado</option></select>
                  </div>
                  <textarea rows={3} placeholder="Regras..." className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none resize-none" value={editingChamp.regras || ""} onChange={e => setEditingChamp({...editingChamp, regras: e.target.value})}></textarea>
                  <div className="flex gap-2 pt-2"><button onClick={() => setShowModalChamp(false)} className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-800">Cancelar</button><button onClick={handleSaveChamp} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500">Salvar</button></div>
              </div>
          </div>
      )}

      {/* 4. MODAL NOVO TREINO */}
      {showModalTreino && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-zinc-900 w-full max-w-sm rounded-3xl border border-zinc-800 p-6 space-y-4">
                  <h2 className="font-bold text-white text-lg flex items-center gap-2"><Dumbbell className="text-emerald-500"/> Nova Modalidade</h2>
                  <div className="space-y-3">
                      <div><label className="text-[10px] text-zinc-500 font-bold uppercase block mb-1">Nome</label><input type="text" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={novoTreino.nome} onChange={e => setNovoTreino({...novoTreino, nome: e.target.value})} /></div>
                      <div className="grid grid-cols-2 gap-3">
                          <div><label className="text-[10px] text-zinc-500 font-bold uppercase block mb-1">XP</label><input type="number" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none w-full" value={novoTreino.xp} onChange={e => setNovoTreino({...novoTreino, xp: Number(e.target.value)})} /></div>
                          <div><label className="text-[10px] text-zinc-500 font-bold uppercase block mb-1">Emoji</label><input type="text" className="bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none w-full text-center" value={novoTreino.icon} onChange={e => setNovoTreino({...novoTreino, icon: e.target.value})} /></div>
                      </div>
                  </div>
                  <div className="flex gap-2 pt-2"><button onClick={() => setShowModalTreino(false)} className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-800">Cancelar</button><button onClick={handleSaveTreino} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500">Salvar</button></div>
              </div>
          </div>
      )}
    </div>
  );
}
