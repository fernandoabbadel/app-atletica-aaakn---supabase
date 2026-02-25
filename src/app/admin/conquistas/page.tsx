"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft, LayoutDashboard, Trophy, Medal, Plus, Edit2, Trash2, Target,
  Zap, Award, Crown, History, Power, PowerOff, Flame, 
  Fish, Swords, Skull, Rocket, Star, Heart, RefreshCw, Gem, Search, Loader2
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "../../../context/ToastContext";
import { ACHIEVEMENTS_CATALOG } from "../../../lib/achievements";
import {
  deleteAchievementConfig,
  deletePatenteConfig,
  fetchAchievementsConfig,
  fetchAchievementsLogs,
  fetchPatentesConfig,
  fetchXpRanking,
  saveAchievementConfig,
  savePatenteConfig,
  seedPatentesConfig,
  toggleAchievementActive,
  type AchievementConfigRecord,
  type AchievementLogRecord,
  type PatenteConfigRecord,
  type UserRankingRecord,
} from "../../../lib/achievementsService";

// --- INTERFACES (O Escudo do Código) ---
type AchievementConfig = AchievementConfigRecord;

type LogData = AchievementLogRecord;

type UserRank = UserRankingRecord;

type PatenteConfig = PatenteConfigRecord;

interface ColorStyle {
  bg: string;
  border: string;
}

// --- DADOS PADRÃO ---
const DEFAULT_PATENTES: PatenteConfig[] = [
    { id: "p1", titulo: "Plâncton", minXp: 0, cor: "text-zinc-400", iconName: "Fish" },
    { id: "p2", titulo: "Peixe Palhaço", minXp: 500, cor: "text-orange-400", iconName: "Fish" },
    { id: "p3", titulo: "Barracuda", minXp: 2000, cor: "text-blue-400", iconName: "Swords" },
    { id: "p4", titulo: "Tubarão Martelo", minXp: 5000, cor: "text-purple-400", iconName: "Fish" },
    { id: "p5", titulo: "Tubarão Branco", minXp: 15000, cor: "text-emerald-400", iconName: "Fish" },
    { id: "p6", titulo: "MEGALODON", minXp: 50000, cor: "text-red-600", iconName: "Crown" },
];

const DEFAULT_ACHIEVEMENTS: AchievementConfig[] = ACHIEVEMENTS_CATALOG.map((item) => ({
  ...item,
  active: true,
  repeatable: false,
}));

const ICON_OPTIONS = [
    { label: "Peixe", value: "Fish", icon: <Fish/> },
    { label: "Espadas", value: "Swords", icon: <Swords/> },
    { label: "Coroa", value: "Crown", icon: <Crown/> },
    { label: "Caveira", value: "Skull", icon: <Skull/> },
    { label: "Foguete", value: "Rocket", icon: <Rocket/> },
    { label: "Estrela", value: "Star", icon: <Star/> },
    { label: "Raio", value: "Zap", icon: <Zap/> },
    { label: "Troféu", value: "Trophy", icon: <Trophy/> },
    { label: "Medalha", value: "Medal", icon: <Medal/> },
    { label: "Coração", value: "Heart", icon: <Heart/> },
    { label: "Diamante", value: "Gem", icon: <Gem/> },
];

const PATENTE_COLOR_MAP: Record<string, ColorStyle> = {
  "text-zinc-400": { bg: "bg-zinc-500/10", border: "border-zinc-500/30" },
  "text-orange-400": { bg: "bg-orange-500/10", border: "border-orange-500/30" },
  "text-blue-400": { bg: "bg-blue-500/10", border: "border-blue-500/30" },
  "text-purple-400": { bg: "bg-purple-500/10", border: "border-purple-500/30" },
  "text-emerald-400": { bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  "text-red-600": { bg: "bg-red-500/10", border: "border-red-500/30" },
};

const withPatenteStyles = (patente: PatenteConfig): PatenteConfig => {
  const styles = PATENTE_COLOR_MAP[patente.cor] ?? PATENTE_COLOR_MAP["text-zinc-400"];
  return { ...patente, ...styles };
};

export default function AdminConquistasPage() {
  const { addToast } = useToast();
  
  const [activeTab, setActiveTab] = useState<"dashboard" | "conquistas" | "historico" | "patentes">("dashboard");
  const [activeCat, setActiveCat] = useState<string>("Todas");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // 🦈 Estados Tipados
  const [achievements, setAchievements] = useState<AchievementConfig[]>([]);
  const [logs, setLogs] = useState<LogData[]>([]);
  const [usersRanking, setUsersRanking] = useState<UserRank[]>([]);
  const [patentes, setPatentes] = useState<PatenteConfig[]>([]);

  // Estados de Edição
  const [editingAch, setEditingAch] = useState<AchievementConfig | null>(null);
  const [editingPatente, setEditingPatente] = useState<PatenteConfig | null>(null);
  const loadData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const [achievementsData, logsData, rankingData, patentesData] = await Promise.all([
        fetchAchievementsConfig({ maxResults: 220, forceRefresh }),
        fetchAchievementsLogs({ maxResults: 50, forceRefresh }),
        fetchXpRanking({ maxResults: 10, forceRefresh }),
        fetchPatentesConfig({ maxResults: 40, forceRefresh }),
      ]);

      setAchievements(
        achievementsData.length > 0
          ? achievementsData
          : DEFAULT_ACHIEVEMENTS
      );
      setLogs(logsData);
      setUsersRanking(rankingData);
      setPatentes(
        patentesData.length > 0
          ? patentesData
          : DEFAULT_PATENTES.map(withPatenteStyles)
      );
    } catch (error: unknown) {
      console.error(error);
      setAchievements(DEFAULT_ACHIEVEMENTS);
      setPatentes(DEFAULT_PATENTES.map(withPatenteStyles));
      addToast("Erro ao carregar dados de conquistas.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // CARREGAR DADOS
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // FILTRAGEM
  const filteredAchievements = useMemo(() => {
    return achievements.filter(a => {
      const matchSearch = a.titulo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = activeCat === "Todas" || a.cat === activeCat;
      return matchSearch && matchCat;
    });
  }, [achievements, searchTerm, activeCat]);

  // --- AÇÕES CONQUISTAS ---

  const handleCreateAch = () => {
      setEditingAch({
          id: Date.now().toString(),
          titulo: "",
          desc: "",
          xp: 100,
          target: 1,
          statKey: "loginCount",
          cat: "Social",
          iconName: "Star",
          active: true,
          repeatable: false
      });
  };

  const handleSaveAch = async () => {
    if (!editingAch) return;
    try {
      await saveAchievementConfig(editingAch);
      setAchievements((prev) => {
        const exists = prev.some((item) => item.id === editingAch.id);
        const next = exists
          ? prev.map((item) => (item.id === editingAch.id ? editingAch : item))
          : [...prev, editingAch];
        return next.sort(
          (left, right) =>
            left.cat.localeCompare(right.cat, "pt-BR") ||
            left.titulo.localeCompare(right.titulo, "pt-BR")
        );
      });
      setEditingAch(null);
      addToast("Conquista salva!", "success");
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao salvar.", "error");
    }
  };

  const handleDeleteAch = async (id: string) => {
      if(!confirm("Deletar conquista?")) return;
      try {
          await deleteAchievementConfig(id);
          setAchievements((prev) => prev.filter((item) => item.id !== id));
          addToast("Deletada.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao deletar conquista.", "error");
      }
  };

  const toggleMissionStatus = async (ach: AchievementConfig) => {
    try {
      const nextStatus = !ach.active;
      await toggleAchievementActive({ id: ach.id, active: nextStatus });
      setAchievements((prev) =>
        prev.map((item) =>
          item.id === ach.id ? { ...item, active: nextStatus } : item
        )
      );
      addToast("Status atualizado.", "info");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro.", "error");
    }
  };

  // --- AÇÕES PATENTES ---

  const handleCreatePatente = () => {
      setEditingPatente({
          id: Date.now().toString(),
          titulo: "",
          minXp: 0,
          cor: "text-zinc-400",
          iconName: "Fish"
      });
  };

  const handleSeedPatentes = async () => {
      if (!confirm("Isso vai restaurar as patentes originais. Continuar?")) return;
      setLoading(true);
      try {
          const seededPatentes = DEFAULT_PATENTES.map(withPatenteStyles);
          await seedPatentesConfig(seededPatentes);
          setPatentes(seededPatentes);
          addToast("Patentes Restauradas!", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao restaurar.", "error");
      } finally {
          setLoading(false);
      }
  };

  const handleSavePatente = async () => {
      if(!editingPatente) return;
      try {
          const payload = withPatenteStyles(editingPatente);
          await savePatenteConfig(payload);
          setPatentes((prev) => {
            const exists = prev.some((item) => item.id === payload.id);
            const next = exists
              ? prev.map((item) => (item.id === payload.id ? payload : item))
              : [...prev, payload];
            return next.sort((left, right) => left.minXp - right.minXp);
          });
          setEditingPatente(null);
          addToast("Patente salva!", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao salvar.", "error");
      }
  };

  const handleDeletePatente = async (id: string) => {
      if(!confirm("Deletar patente?")) return;
      try {
          await deletePatenteConfig(id);
          setPatentes((prev) => prev.filter((item) => item.id !== id));
          addToast("Patente removida.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao remover patente.", "error");
      }
  };

  const getCatColor = (cat: string) => {
    switch(cat) {
      case "Gym": return "text-emerald-400 border-emerald-500/20 bg-emerald-500/5";
      case "Social": return "text-blue-400 border-blue-500/20 bg-blue-500/5";
      case "Games": return "text-purple-400 border-purple-500/20 bg-purple-500/5";
      case "Loja": return "text-yellow-400 border-yellow-500/20 bg-yellow-500/5";
      default: return "text-zinc-400 border-zinc-700 bg-zinc-800/20";
    }
  };

  if (loading) return <div className="h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500"/></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20 selection:bg-emerald-500">
      
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 flex flex-col md:flex-row justify-between gap-4 items-center">
        <div className="flex items-center gap-3 w-full md:w-auto">
            <Link href="/admin" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition border border-zinc-800"><ArrowLeft size={20} className="text-zinc-400" /></Link>
            <div><h1 className="text-lg font-black text-white uppercase tracking-tighter">Engenharia de Conquistas</h1><p className="text-[10px] text-zinc-500">Controle de Recompensas e XP</p></div>
        </div>
        
        <button onClick={handleCreateAch} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 rounded-xl text-xs font-bold uppercase shadow-lg flex items-center gap-2 transition hover:scale-105">
            <Plus size={16}/> Nova Conquista
        </button>
      </header>

      <div className="px-6 pt-4 space-y-4">
          <div className="flex border-b border-zinc-800 gap-6 overflow-x-auto no-scrollbar">
              <button onClick={() => setActiveTab("dashboard")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'dashboard' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><LayoutDashboard size={16}/> Hall da Fama</button>
              <button onClick={() => setActiveTab("conquistas")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'conquistas' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><Trophy size={16}/> Catálogo</button>
              <button onClick={() => setActiveTab("patentes")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'patentes' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><Medal size={16}/> Patentes</button>
              <button onClick={() => setActiveTab("historico")} className={`pb-3 text-sm font-bold uppercase transition border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'historico' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}><History size={16}/> Logs</button>
          </div>

          {/* Barra de Pesquisa */}
          {activeTab === 'conquistas' && (
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"/>
                <input 
                    type="text" 
                    placeholder="Buscar conquista..." 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-full pl-9 pr-4 py-2 text-xs focus:border-emerald-500 outline-none transition"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
          )}
      </div>

      <main className="p-6 space-y-6">
        
        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
                <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                    <h3 className="font-black uppercase text-white mb-6 flex items-center gap-2 text-sm"><Crown className="text-yellow-500"/> Top 10 Tubarões</h3>
                    <div className="space-y-4">
                        {usersRanking.map((u, i) => (
                            <div key={u.id} className="flex items-center justify-between p-3 bg-black/40 rounded-2xl border border-zinc-800">
                                <div className="flex items-center gap-4">
                                    <span className="font-black text-zinc-700 w-4">#{i+1}</span>
                                    <div className="w-10 h-10 rounded-full border-2 border-zinc-800 overflow-hidden relative">
                                        <Image src={u.foto || "https://github.com/shadcn.png"} alt={u.nome} fill className="object-cover" unoptimized/>
                                    </div>
                                    <div><p className="font-bold text-sm text-white">{u.nome}</p><p className="text-[10px] text-zinc-500 uppercase">{u.turma} • XP: {u.xp}</p></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 text-center"><Flame size={40} className="text-orange-500 mx-auto mb-2"/><p className="text-4xl font-black text-white">{logs.length}</p><p className="text-[10px] text-zinc-500 uppercase font-bold mt-1">Troféus Hoje</p></div>
                </div>
            </div>
        )}

        {/* CATÁLOGO DE CONQUISTAS */}
        {activeTab === 'conquistas' && (
             <div className="space-y-6 animate-in fade-in">
                 <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                    {["Todas", "Social", "Gym", "Games", "Loja", "Eventos"].map(cat => (
                        <button key={cat} onClick={() => setActiveCat(cat)} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase transition border ${activeCat === cat ? 'bg-emerald-500 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>{cat}</button>
                    ))}
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {filteredAchievements.map(item => (
                         <div key={item.id} className={`bg-zinc-900 border p-5 rounded-[2rem] transition relative group ${!item.active ? 'opacity-40 grayscale border-zinc-800' : 'border-zinc-800 hover:border-emerald-500/40'}`}>
                             <div className="flex items-start gap-4">
                                 <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 ${getCatColor(item.cat)}`}>
                                     {ICON_OPTIONS.find(i => i.value === item.iconName)?.icon || <Award/>}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                     <div className="flex justify-between items-start">
                                         <h4 className="font-black text-white text-base uppercase italic">{item.titulo}</h4>
                                         <div className="flex gap-1">
                                             <button onClick={() => setEditingAch(item)} className="p-2 bg-zinc-800 rounded-lg text-zinc-500 hover:text-white"><Edit2 size={12}/></button>
                                             <button onClick={() => toggleMissionStatus(item)} className={`p-2 rounded-lg ${!item.active ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{!item.active ? <PowerOff size={12}/> : <Power size={12}/>}</button>
                                             <button onClick={() => handleDeleteAch(item.id)} className="p-2 bg-zinc-800 rounded-lg text-zinc-500 hover:text-red-500"><Trash2 size={12}/></button>
                                         </div>
                                     </div>
                                     <p className="text-xs text-zinc-500 mt-1">{item.desc}</p>
                                     <div className="flex items-center gap-3 mt-4">
                                         <span className="text-[10px] font-black px-2 py-1 bg-black rounded-lg border border-zinc-800 text-yellow-500">+{item.xp} XP</span>
                                         <span className="text-[10px] font-black px-2 py-1 bg-black rounded-lg border border-zinc-800 text-emerald-500"><Target size={10} className="inline mr-1"/> {item.target}</span>
                                     </div>
                                 </div>
                             </div>
                         </div>
                     ))}
                 </div>
             </div>
        )}

        {/* ABA PATENTES */}
        {activeTab === 'patentes' && (
            <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                    <div>
                        <h3 className="font-bold text-white uppercase">Níveis de Patente</h3>
                        <p className="text-xs text-zinc-500">Defina os limites de XP e identidade visual.</p>
                    </div>
                    <div className="flex gap-2">
                         {/* BOTÃO DE RESTAURAR PADRÕES */}
                         <button onClick={handleSeedPatentes} className="bg-zinc-800 text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 border border-zinc-700">
                            <RefreshCw size={14}/> Restaurar Padrões
                         </button>
                         <button onClick={handleCreatePatente} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2">
                            <Plus size={14}/> Nova Patente
                         </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {patentes.map((p) => {
                         const iconComp = ICON_OPTIONS.find(i => i.value === p.iconName)?.icon || <Fish/>;
                         return (
                            <div key={p.id} className="bg-zinc-900 border border-zinc-800 p-5 rounded-3xl flex flex-col items-center text-center relative group hover:border-zinc-700 transition">
                                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                                    <button onClick={() => setEditingPatente(p)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white"><Edit2 size={12}/></button>
                                    <button onClick={() => handleDeletePatente(p.id)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-500"><Trash2 size={12}/></button>
                                </div>
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 ${p.bg || 'bg-zinc-800'} ${p.text || p.cor}`}>
                                    {React.cloneElement(iconComp as React.ReactElement<{ size?: number; className?: string }>, { size: 32 })}
                                </div>
                                <h4 className={`text-lg font-black uppercase italic ${p.cor}`}>{p.titulo}</h4>
                                <p className="text-xs text-zinc-500 font-mono mt-1">Requer {p.minXp} XP</p>
                            </div>
                         );
                    })}
                    {patentes.length === 0 && (
                        <div className="col-span-full text-center py-12 text-zinc-500">
                            Nenhuma patente encontrada. Clique em &quot;Restaurar Padrões&quot; para iniciar.
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* LOGS */}
        {activeTab === 'historico' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                 <p className="text-zinc-500 text-center text-xs">Histórico de desbloqueios recentes.</p>
                 <div className="mt-4 space-y-2">
                     {logs.map(log => (
                         <div key={log.id} className="text-xs text-zinc-400 border-b border-zinc-800 pb-2">
                             <span className="text-white font-bold">{log.userName}</span> ganhou <span className="text-emerald-500">{log.achievementTitle}</span>
                         </div>
                     ))}
                 </div>
            </div>
        )}

      </main>

      {/* MODAL CONQUISTA */}
      {editingAch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
               <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-8 space-y-6">
                   <h3 className="font-black text-white uppercase text-lg">Editar/Criar Conquista</h3>
                   <div className="space-y-4">
                       <input type="text" className="input-admin w-full" placeholder="Título" value={editingAch.titulo} onChange={e => setEditingAch({...editingAch, titulo: e.target.value})}/>
                       <textarea className="input-admin w-full min-h-[80px]" placeholder="Descrição" value={editingAch.desc} onChange={e => setEditingAch({...editingAch, desc: e.target.value})}/>
                       <div className="grid grid-cols-2 gap-4">
                           <input type="number" placeholder="XP" className="input-admin w-full" value={editingAch.xp} onChange={e => setEditingAch({...editingAch, xp: Number(e.target.value)})}/>
                           <input type="number" placeholder="Meta" className="input-admin w-full" value={editingAch.target} onChange={e => setEditingAch({...editingAch, target: Number(e.target.value)})}/>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">Categoria</label>
                               <select className="input-admin w-full" value={editingAch.cat} onChange={e => setEditingAch({...editingAch, cat: e.target.value})}>
                                   {["Gym", "Social", "Games", "Loja", "Eventos"].map(c => <option key={c} value={c}>{c}</option>)}
                               </select>
                           </div>
                           <div>
                               <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">Ícone</label>
                               <select className="input-admin w-full" value={editingAch.iconName} onChange={e => setEditingAch({...editingAch, iconName: e.target.value})}>
                                   {ICON_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                               </select>
                           </div>
                       </div>
                       <div>
                           <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">ID da Estatística (UserStats)</label>
                           <input type="text" className="input-admin w-full text-xs font-mono text-yellow-500" placeholder="ex: loginCount, storeSpent" value={editingAch.statKey} onChange={e => setEditingAch({...editingAch, statKey: e.target.value})}/>
                       </div>
                   </div>
                   <div className="flex gap-2">
                       <button onClick={() => setEditingAch(null)} className="flex-1 py-3 text-zinc-500 font-bold uppercase text-xs border border-zinc-700 rounded-xl">Cancelar</button>
                       <button onClick={handleSaveAch} className="flex-1 py-3 bg-emerald-600 rounded-xl text-black font-black uppercase text-xs">Salvar</button>
                   </div>
               </div>
          </div>
      )}

      {/* MODAL PATENTE */}
      {editingPatente && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
               <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-8 space-y-6">
                   <h3 className="font-black text-white uppercase text-lg">Configurar Patente</h3>
                   <div className="space-y-4">
                       <div>
                           <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">Nome da Patente</label>
                           <input type="text" className="input-admin w-full" value={editingPatente.titulo} onChange={e => setEditingPatente({...editingPatente, titulo: e.target.value})}/>
                       </div>
                       <div>
                           <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">XP Mínimo</label>
                           <input type="number" className="input-admin w-full" value={editingPatente.minXp} onChange={e => setEditingPatente({...editingPatente, minXp: Number(e.target.value)})}/>
                       </div>
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">Cor (Texto)</label>
                               <select className="input-admin w-full" value={editingPatente.cor} onChange={e => setEditingPatente({...editingPatente, cor: e.target.value})}>
                                   <option value="text-zinc-400">Cinza</option>
                                   <option value="text-orange-400">Laranja</option>
                                   <option value="text-blue-400">Azul</option>
                                   <option value="text-purple-400">Roxo</option>
                                   <option value="text-emerald-400">Verde</option>
                                   <option value="text-red-600">Vermelho</option>
                               </select>
                           </div>
                           <div>
                               <label className="text-[9px] text-zinc-500 uppercase font-bold block mb-1">Ícone</label>
                               <select className="input-admin w-full" value={editingPatente.iconName} onChange={e => setEditingPatente({...editingPatente, iconName: e.target.value})}>
                                   {ICON_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                               </select>
                           </div>
                       </div>
                   </div>
                   <div className="flex gap-2">
                       <button onClick={() => setEditingPatente(null)} className="flex-1 py-3 text-zinc-500 font-bold uppercase text-xs border border-zinc-700 rounded-xl">Cancelar</button>
                       <button onClick={handleSavePatente} className="flex-1 py-3 bg-emerald-600 rounded-xl text-black font-black uppercase text-xs">Salvar</button>
                   </div>
               </div>
          </div>
      )}

      <style jsx global>{`
        .input-admin { background: #000; border: 1px solid #27272a; border-radius: 1rem; padding: 1rem; color: white; outline: none; transition: all 0.2s; font-size: 0.875rem; }
        .input-admin:focus { border-color: #10b981; box-shadow: 0 0 15px rgba(16,185,129,0.1); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
      `}</style>
    </div>
  );
}
