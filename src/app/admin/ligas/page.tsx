"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  ArrowLeft, Plus, Edit, Edit3, Trash2, X, Search, 
  Shield, Key, UploadCloud, Eye, EyeOff, 
  Loader2, Calendar, UserPlus, MonitorPlay
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "../../../context/ToastContext";
import { useAuth } from "../../../context/AuthContext";
import { useTenantTheme } from "../../../context/TenantThemeContext";
import {
  deleteLeagueConfig,
  fetchLeagueUsers,
  fetchLeagues,
  saveLeagueConfig,
  setLeagueVisibility,
  uploadLeagueImageToStorage,
  type LeagueRecord,
  type LeagueUserRecord,
} from "../../../lib/leaguesService";
import { resolveLeagueLogoSrc } from "../../../lib/leagueMedia";
import {
  DEFAULT_LEAGUE_ROLE,
  LEAGUE_ROLE_OPTIONS,
  resolveLeagueRoleLabel,
} from "../../../lib/leagueRoles";

// --- TIPAGEM ---
interface Member { 
    id: string; 
    nome: string; 
    cargo: string; 
    foto: string; 
    linkPerfil?: string; 
}

interface Lote { 
    id: number; 
    nome: string; 
    preco: string; 
    status: "ativo" | "encerrado" | "agendado"; 
}

interface LeagueEvent { 
    id: string; 
    titulo: string; 
    data: string; 
    hora: string; 
    local: string; 
    tipo: string; 
    destaque: string; 
    imagem: string; 
    imagePositionY: number;
    lotes: Lote[]; 
    descricao: string; 
    linkEvento?: string; 
    globalEventId?: string;
    pollQuestion?: string; 
}

type Liga = LeagueRecord;
type UserData = LeagueUserRecord;

const getLeagueLogoSrc = (liga?: Partial<Liga> | null) =>
  resolveLeagueLogoSrc(liga);

export default function AdminLigasPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId } = useTenantTheme();
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Controle de Modal e Edição
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'membros' | 'eventos' | 'shark'>('info');
  const tabs: Array<typeof activeTab> = ['info', 'membros', 'eventos', 'shark'];
  
  // Estado para visualização de senha
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  // Busca de Usuários
  const [searchUserModal, setSearchUserModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [allUsers, setAllUsers] = useState<UserData[]>([]);

  // Form State Principal
  const [formData, setFormData] = useState<Partial<Liga>>({
    nome: "", sigla: "", presidente: "", descricao: "", senha: "", foto: "", visivel: false, ativa: false,
    membros: [], eventos: [], perguntas: [], bizu: "", likes: 0
  });

  // Estado Evento
  const [eventModal, setEventModal] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<LeagueEvent>>({});
  const [editingEventIdx, setEditingEventIdx] = useState<number | null>(null);
  const formLogoSrc = getLeagueLogoSrc(formData);

  const loadLigas = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchLeagues({
        orderByField: "nome",
        orderDirection: "asc",
        maxResults: 40,
        forceRefresh,
        tenantId: tenantId || undefined,
      });
      setLigas(data);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar ligas.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, tenantId]);

  // 1. BUSCAR LIGAS
  useEffect(() => {
    void loadLigas();
  }, [loadLigas]);

  // 2. BUSCAR USUÁRIOS
  useEffect(() => {
    if (!searchUserModal) return;
    let mounted = true;
    const loadUsers = async () => {
      try {
        const users = await fetchLeagueUsers({ maxResults: 120, tenantId: tenantId || undefined });
        if (!mounted) return;
        setAllUsers(users);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar usuários.", "error");
      }
    };
    void loadUsers();
    return () => {
      mounted = false;
    };
  }, [addToast, searchUserModal, tenantId]);

  // --- AÇÕES ---

  const handleOpenCreate = () => {
    setFormData({ 
        nome: "", sigla: "", presidente: "", descricao: "", senha: "", foto: "", visivel: false, ativa: false,
        membros: [], eventos: [], perguntas: [], bizu: "", likes: 0 
    });
    setIsEditing(false);
    setShowModal(true);
    setActiveTab('info');
  };

  const handleOpenEdit = (liga: Liga) => {
    setFormData(liga);
    setEditingId(liga.id);
    setIsEditing(true);
    setShowModal(true);
    setActiveTab('info');
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta Liga?")) return;
    try {
      await deleteLeagueConfig(id, { tenantId: tenantId || undefined });
      setLigas((prev) => prev.filter((item) => item.id !== id));
      addToast("Liga removida com sucesso.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao remover.", "error");
    }
  };

  // --- FUNÇÃO: TOGGLE VISIBILIDADE DASHBOARD ---
  const toggleVisibility = async (liga: Liga) => {
      const novoStatus = !liga.visivel;
      try {
          await setLeagueVisibility({
            id: liga.id,
            visivel: novoStatus,
            tenantId: tenantId || undefined,
          });
          setLigas((prev) =>
            prev.map((item) =>
              item.id === liga.id ? { ...item, visivel: novoStatus } : item
            )
          );
          addToast(novoStatus ? "Liga visível no Dashboard! 📱" : "Liga ocultada do Dashboard.", novoStatus ? "success" : "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar visibilidade.", "error");
      }
  };

  const handleSave = async () => {
    if (!formData.nome || !formData.senha) return addToast("Nome e Senha são obrigatórios!", "error");

    setLoading(true);
    try {
      const result = await saveLeagueConfig({
        id: isEditing ? editingId || undefined : undefined,
        data: formData,
        actorUserId: user?.uid,
        tenantId: tenantId || undefined,
      });
      await loadLigas(true);
      setShowModal(false);
      addToast(isEditing ? "Liga atualizada!" : `Liga criada! (${result.id.slice(0, 6)}...)`, "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || uploading) {
      input.value = "";
      return;
    }

    setUploading(true);
    try {
      const imageUrl = await uploadLeagueImageToStorage({
        file,
        kind: "logo",
        leagueId: editingId || undefined,
      });

      setFormData((prev) => ({
        ...prev,
        foto: imageUrl,
        logoUrl: imageUrl,
      }));
      addToast("Logo enviada com sucesso.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar logo.", "error");
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const togglePasswordVisibility = (id: string) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // --- GESTÃO DE MEMBROS ---
  const addMemberFromSearch = (u: UserData) => {
      const newMember: Member = { 
          id: u.id, 
          nome: u.nome || "Sem Nome", 
          cargo: DEFAULT_LEAGUE_ROLE, 
          foto: u.foto || "", 
          linkPerfil: `/perfil/${u.id}` 
      };
      setFormData(prev => ({ ...prev, membros: [...(prev.membros || []), newMember] }));
      setSearchUserModal(false);
      addToast("Membro adicionado.", "success");
  };

  const removeMember = (idx: number) => {
      setFormData(prev => ({ ...prev, membros: prev.membros?.filter((_, i) => i !== idx) }));
  };

  const updateMemberCargo = (idx: number, val: string) => {
      const novos = [...(formData.membros || [])];
      novos[idx].cargo = resolveLeagueRoleLabel(val);
      setFormData({ ...formData, membros: novos });
  };

  // --- GESTÃO DE EVENTOS ---
  const handleOpenEventModal = (idx: number | null) => {
      if (idx !== null && formData.eventos) {
          setCurrentEvent(formData.eventos[idx]);
          setEditingEventIdx(idx);
      } else {
          setCurrentEvent({ 
              id: Date.now().toString(), titulo: "", data: "", hora: "", local: "", 
              tipo: "Festa", destaque: "", imagem: "", imagePositionY: 50, 
              lotes: [], descricao: "", pollQuestion: "" 
          });
          setEditingEventIdx(null);
      }
      setEventModal(true);
  };

  const saveEventLocal = () => {
      if (!currentEvent.titulo) return addToast("Título obrigatório!", "error");
      const novosEventos = [...(formData.eventos || [])];
      const eventoSalvo = currentEvent as LeagueEvent;
      
      if (editingEventIdx !== null) {
          novosEventos[editingEventIdx] = eventoSalvo;
      } else {
          novosEventos.push(eventoSalvo);
      }
      setFormData({ ...formData, eventos: novosEventos });
      setEventModal(false);
  };

  // --- GESTÃO SHARK ROUND (PERGUNTAS) ---
  const addQuestion = () => setFormData(prev => ({...prev, perguntas: [...(prev.perguntas||[]), { id: Date.now().toString(), texto: "", alternativas: ["","","",""], correta: 0 }]}));
  
  const updateQuestion = (idx: number, field: string, val: string | number) => {
      const novas = [...(formData.perguntas || [])];
      if(field === 'texto') novas[idx].texto = String(val); 
      else if(field === 'correta') novas[idx].correta = Number(val); 
      else {
          const altIdx = parseInt(field.split('-')[1]); 
          novas[idx].alternativas[altIdx] = String(val);
      }
      setFormData({ ...formData, perguntas: novas });
  };

  const removeQuestion = (idx: number) => setFormData(prev => ({...prev, perguntas: prev.perguntas?.filter((_, i) => i !== idx)}));

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" /></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32">
      {/* HEADER */}
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition">
            <ArrowLeft size={20} className="text-zinc-400" />
          </Link>
          <h1 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-2">
            <Shield size={20} className="text-emerald-500"/> Gestão de Ligas
          </h1>
        </div>
        <button onClick={handleOpenCreate} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20">
          <Plus size={16} /> Nova Liga
        </button>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* LISTA DE LIGAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ligas.map(liga => (
            <div key={liga.id} className={`bg-zinc-900 border rounded-2xl p-5 flex flex-col gap-4 group transition relative overflow-hidden ${liga.visivel ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'border-zinc-800 opacity-90'}`}>
              
              {/* Badge de Visibilidade */}
              {liga.visivel && (
                  <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[9px] font-bold px-2 py-1 rounded-bl-xl uppercase flex items-center gap-1">
                      <MonitorPlay size={10}/> No Dashboard
                  </div>
              )}

              <div className="flex items-start justify-between mt-2">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full overflow-hidden border-2 ${liga.visivel ? 'border-emerald-500' : 'border-zinc-800'} relative`}>
                    <Image 
                      src={getLeagueLogoSrc(liga) || "https://github.com/shadcn.png"} 
                      alt={liga.nome}
                      fill
                      className="object-cover"
                      
                    />
                  </div>
                  <div>
                    <h3 className="font-bold text-white uppercase text-sm truncate w-32" title={liga.nome}>{liga.nome}</h3>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">{liga.sigla}</p>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex gap-2 border-t border-zinc-800 pt-3 mt-1">
                  {/* Botão de Visibilidade */}
                  <button 
                    onClick={() => toggleVisibility(liga)} 
                    className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition ${liga.visivel ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' : 'bg-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-700'}`}
                    title={liga.visivel ? "Ocultar do Dashboard" : "Mostrar no Dashboard"}
                  >
                      {liga.visivel ? <Eye size={16}/> : <EyeOff size={16}/>}
                      <span className="text-[10px] font-bold uppercase">{liga.visivel ? "Visível" : "Oculto"}</span>
                  </button>

                  <button onClick={() => handleOpenEdit(liga)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition"><Edit size={16}/></button>
                  <button onClick={() => handleDelete(liga.id)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-500 transition"><Trash2 size={16}/></button>
              </div>

              {/* Senha */}
              <div className="flex justify-between items-center bg-black/30 p-2 rounded-lg border border-zinc-800/50">
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <Key size={10}/>
                    <span className="font-mono tracking-wider">
                        {showPassword[liga.id] ? liga.senha : "••••••"}
                    </span>
                </div>
                <button onClick={() => togglePasswordVisibility(liga.id)} className="text-zinc-600 hover:text-zinc-300">
                    {showPassword[liga.id] ? <EyeOff size={12}/> : <Eye size={12}/>}
                </button>
              </div>

            </div>
          ))}
        </div>
      </main>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-zinc-950 w-full max-w-2xl rounded-2xl border border-zinc-800 p-6 space-y-4 animate-in zoom-in-95 my-10">
            <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold text-white text-lg">{isEditing ? "Editar Liga" : "Nova Liga"}</h2>
                <button onClick={() => setShowModal(false)}><X size={20} className="text-zinc-500 hover:text-white"/></button>
            </div>

            <div className="flex border-b border-zinc-800 mb-4 overflow-x-auto">
                {tabs.map(tab => (
                    <button 
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 text-xs font-bold uppercase border-b-2 transition ${activeTab === tab ? 'text-emerald-500 border-emerald-500' : 'text-zinc-500 border-transparent hover:text-white'}`}
                    >
                        {tab === 'info' ? 'Informações' : tab}
                    </button>
                ))}
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                {activeTab === 'info' && (
                    <div className="space-y-3">
                        <div className="flex justify-center mb-4">
                            <label className="relative w-24 h-24 rounded-full bg-zinc-900 border-2 border-dashed border-zinc-700 flex items-center justify-center cursor-pointer hover:border-emerald-500 overflow-hidden group">
                                {formLogoSrc ? <Image src={formLogoSrc} alt="Logo" fill className="object-cover" /> : <UploadCloud className="text-zinc-500 group-hover:text-emerald-500"/>}
                                <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={handleUpload}/>
                                {uploading && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500"/></div>}
                            </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <input type="text" placeholder="Nome da Liga" className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none" value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})}/>
                            <input type="text" placeholder="Sigla" className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none uppercase" value={formData.sigla} onChange={e => setFormData({...formData, sigla: e.target.value})}/>
                        </div>
                        
                        {/* CHECKBOX VISIBILIDADE NO DASHBOARD */}
                        <div className="flex items-center gap-2 bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                            <input 
                                type="checkbox" 
                                id="visivelDash" 
                                checked={formData.visivel} 
                                onChange={e => setFormData({...formData, visivel: e.target.checked})}
                                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                            />
                            <label htmlFor="visivelDash" className="text-sm text-white cursor-pointer select-none font-bold flex items-center gap-2">
                                <MonitorPlay size={14} className="text-emerald-500"/> Mostrar no App/Dashboard
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <input type="text" placeholder="Presidente" className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none" value={formData.presidente} onChange={e => setFormData({...formData, presidente: e.target.value})}/>
                            <input type="text" placeholder="Senha de Acesso" className="w-full bg-zinc-900 border border-emerald-500/30 p-3 rounded-xl text-sm text-white outline-none" value={formData.senha} onChange={e => setFormData({...formData, senha: e.target.value})}/>
                        </div>
                        <textarea rows={3} placeholder="Descrição..." className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none resize-none" value={formData.descricao} onChange={e => setFormData({...formData, descricao: e.target.value})}/>
                        <input type="text" placeholder="Destaque da Semana" className="w-full bg-zinc-900 border border-yellow-500/30 p-3 rounded-xl text-sm text-white outline-none" value={formData.bizu} onChange={e => setFormData({...formData, bizu: e.target.value})}/>
                    </div>
                )}

                {activeTab === 'membros' && (
                    <div className="space-y-3">
                        <button onClick={() => setSearchUserModal(true)} className="w-full py-3 border border-dashed border-zinc-700 rounded-xl text-zinc-500 text-xs font-bold uppercase hover:border-emerald-500 hover:text-emerald-500 transition flex justify-center items-center gap-2"><UserPlus size={16}/> Adicionar Membro</button>
                        {formData.membros?.map((m, idx) => (
                            <div key={idx} className="flex items-center gap-3 bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                                <div className="w-10 h-10 rounded-full overflow-hidden relative">
                                    <Image src={m.foto || "https://github.com/shadcn.png"} alt={m.nome} fill className="object-cover" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-white">{m.nome}</p>
                                    <select
                                      value={resolveLeagueRoleLabel(m.cargo)}
                                      onChange={e => updateMemberCargo(idx, e.target.value)}
                                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-black/40 px-2 py-2 text-xs font-bold uppercase text-emerald-400 outline-none focus:border-emerald-500"
                                    >
                                      {LEAGUE_ROLE_OPTIONS.map((role) => (
                                        <option key={role} value={role} className="bg-zinc-950 text-white">
                                          {role}
                                        </option>
                                      ))}
                                    </select>
                                </div>
                                <button onClick={() => removeMember(idx)} className="text-zinc-600 hover:text-red-500"><Trash2 size={16}/></button>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'eventos' && (
                    <div className="space-y-3">
                        <button onClick={() => handleOpenEventModal(null)} className="w-full py-3 border border-dashed border-zinc-700 rounded-xl text-zinc-500 text-xs font-bold uppercase hover:border-emerald-500 hover:text-emerald-500 transition flex justify-center items-center gap-2"><Calendar size={16}/> Adicionar Evento</button>
                        {formData.eventos?.map((ev, idx) => {
                            const eventImage = ev.imagem || formLogoSrc;

                            return (
                                <div key={idx} className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 relative flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                                    <button onClick={() => setFormData({...formData, eventos: formData.eventos?.filter((_, i) => i !== idx)})} className="absolute top-3 right-3 text-zinc-600 hover:text-red-500 transition"><Trash2 size={14}/></button>
                                    {eventImage ? (
                                        <div className="relative w-full sm:w-16 h-28 sm:h-16 rounded-lg overflow-hidden bg-black shrink-0">
                                            <Image src={eventImage} alt={ev.titulo} fill className="object-cover" />
                                        </div>
                                    ) : (
                                        <div className="w-full sm:w-16 h-28 sm:h-16 rounded-lg bg-black shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-white text-sm mb-1 truncate pr-8">{ev.titulo}</h4>
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400 font-bold uppercase">
                                            <span>{ev.data || "Data a definir"}{ev.hora ? ` - ${ev.hora}` : ""}</span>
                                            <span className="text-zinc-600">•</span>
                                            <span>{ev.local || "Local a definir"}</span>
                                        </div>
                                        <div className="flex gap-3 mt-3">
                                            <button onClick={() => handleOpenEventModal(idx)} className="text-[10px] text-emerald-500 hover:underline flex items-center gap-1 font-bold uppercase tracking-wide">
                                                <Edit3 size={10}/> Editar Evento
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {(!formData.eventos || formData.eventos.length === 0) && (
                            <div className="text-center py-8 text-zinc-600 text-xs">Nenhum evento criado.</div>
                        )}
                    </div>
                )}

                {activeTab === 'shark' && (
                    <div className="space-y-3">
                        <div className="flex justify-between items-center"><h3 className="text-xs font-bold text-zinc-500 uppercase">Banco de Questões ({formData.perguntas?.length}/10)</h3><button onClick={addQuestion} className="text-emerald-500 text-xs font-bold hover:underline">+ Adicionar</button></div>
                        {formData.perguntas?.map((p, idx) => (
                            <div key={idx} className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 space-y-2 relative group">
                                <button onClick={() => removeQuestion(idx)} className="absolute top-2 right-2 text-zinc-600 hover:text-red-500"><Trash2 size={14}/></button>
                                <input type="text" value={p.texto} onChange={e => updateQuestion(idx, 'texto', e.target.value)} className="w-full bg-transparent border-b border-zinc-700 text-sm text-white outline-none pb-1" placeholder="Pergunta..."/>
                                {p.alternativas.map((alt, aIdx) => (
                                    <div key={aIdx} className="flex items-center gap-2">
                                        <input type="radio" name={`q-${idx}`} checked={p.correta === aIdx} onChange={() => updateQuestion(idx, 'correta', aIdx)} className="accent-emerald-500"/>
                                        <input type="text" value={alt} onChange={e => updateQuestion(idx, `alt-${aIdx}`, e.target.value)} className="flex-1 bg-black rounded p-1 text-xs border border-zinc-800 text-zinc-300" placeholder={`Opção ${aIdx+1}`}/>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex gap-3 pt-2">
                <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-xl border border-zinc-800 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-900">Cancelar</button>
                <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500 shadow-lg">Salvar Tudo</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SEARCH USER (Mantido) */}
      {searchUserModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 w-full max-w-md rounded-2xl border border-zinc-800 p-6 shadow-2xl relative animate-in zoom-in-95">
                <button onClick={() => setSearchUserModal(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><X size={20}/></button>
                <h3 className="text-sm font-bold text-white uppercase mb-4 flex items-center gap-2"><Search size={16} className="text-emerald-500"/> Buscar Aluno</h3>
                <input type="text" placeholder="Digite o nome..." className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white mb-4 outline-none focus:border-emerald-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {allUsers.filter(u => u.nome?.toLowerCase().includes(searchTerm.toLowerCase())).map(u => (
                        <div key={u.id} className="flex items-center justify-between p-3 bg-black/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition" onClick={() => addMemberFromSearch(u)}>
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full overflow-hidden relative">
                                    <Image src={u.foto || "https://github.com/shadcn.png"} alt={u.nome || "User"} fill className="object-cover" />
                                </div>
                                <div><p className="text-xs font-bold text-white">{u.nome}</p><p className="text-[10px] text-zinc-500">{u.turma || "Sem turma"}</p></div>
                            </div>
                            <Plus size={14} className="text-emerald-500"/>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      )}

      {/* MODAL EVENTO (Mantido) */}
      {eventModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
              <div className="bg-zinc-950 w-full max-w-md rounded-2xl border border-zinc-800 p-6 space-y-3 animate-in zoom-in-95">
                  <h3 className="text-white font-bold">Editar Evento</h3>
                  <input type="text" placeholder="Título" value={currentEvent.titulo} onChange={e => setCurrentEvent({...currentEvent, titulo: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-white"/>
                  <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="Data" value={currentEvent.data} onChange={e => setCurrentEvent({...currentEvent, data: e.target.value})} className="bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-white"/>
                      <input type="text" placeholder="Hora" value={currentEvent.hora} onChange={e => setCurrentEvent({...currentEvent, hora: e.target.value})} className="bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-white"/>
                  </div>
                  <input type="text" placeholder="Local" value={currentEvent.local} onChange={e => setCurrentEvent({...currentEvent, local: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-white"/>
                  <textarea placeholder="Descrição" value={currentEvent.descricao} onChange={e => setCurrentEvent({...currentEvent, descricao: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded-lg text-sm text-white h-20 resize-none"/>
                  <div className="flex gap-2 pt-2">
                      <button onClick={() => setEventModal(false)} className="flex-1 py-2 border border-zinc-700 rounded-lg text-xs text-zinc-400">Cancelar</button>
                      <button onClick={saveEventLocal} className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Salvar Evento</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
