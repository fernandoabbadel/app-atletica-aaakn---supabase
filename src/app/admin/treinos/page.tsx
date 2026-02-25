"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  ArrowLeft, Plus, Edit, Trash2, 
  Dumbbell, Image as ImageIcon, CheckCircle, X, 
  AlertTriangle, ChevronDown, Save, 
  Trophy, Users, Search, Download, Ban, LayoutDashboard, List, Loader2, Filter, ArrowUpDown, CalendarRange, User, Crown, UserCheck, ExternalLink
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "../../../context/ToastContext";
import { uploadImage } from "../../../lib/upload";
import { isFirebasePermissionError } from "../../../lib/firebaseErrors";
import {
    addUserToChamada,
    createRecurringTreinos,
    deleteChamadaEntry,
    deleteTreino,
    fetchTreinoChamada,
    fetchTreinoDashboardMetrics,
    fetchTreinoRsvps,
    fetchTreinoSettings,
    fetchTreinosAdminList,
    fetchUserDirectory,
    saveTreinoSettings,
    toggleTreinoStatus,
    type TreinoDashboardMetrics,
    type TreinoRecord,
    type TreinoRsvpRecord,
    type TreinoUserDirectoryItem,
    upsertChamadaPresence,
    updateChamadaStatus,
    upsertTreino
} from "../../../lib/treinosService";

// --- TIPAGEM ---
type UserBase = TreinoUserDirectoryItem;

interface AlunoChamada {
    id: string; 
    userId: string;
    nome: string;
    avatar: string;
    turma: string;
    status: "presente" | "falta" | "justificado" | "inscrito"; 
    origem: "app" | "manual";
    pagamento?: "pago" | "pendente";
}

type RSVP = TreinoRsvpRecord;
type Treino = TreinoRecord;

interface RankingItem {
    userId: string;
    nome: string;
    avatar: string;
    turma: string;
    count: number;
}

interface VergonhaItem {
    id: string;
    nome: string;
    avatar: string;
    turma: string;
    treinoData: string;
    treinoMod: string;
}

const FERIADOS = ["2026-10-12", "2026-11-02", "2026-11-15", "2026-12-25"];

const DIAS_SEMANA = [
    { label: "Domingo", val: 0 },
    { label: "Segunda-feira", val: 1 },
    { label: "Terça-feira", val: 2 },
    { label: "Quarta-feira", val: 3 },
    { label: "Quinta-feira", val: 4 },
    { label: "Sexta-feira", val: 5 },
    { label: "Sábado", val: 6 },
];

const getResponsibleColor = (id: string = "") => {
    const gradients = ["from-purple-600 to-blue-600", "from-pink-600 to-rose-600", "from-emerald-600 to-teal-600", "from-orange-500 to-amber-600", "from-indigo-600 to-violet-600"];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return gradients[Math.abs(hash) % gradients.length];
};

export default function AdminTreinosPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'grade'>('dashboard');

  // Dados
  const [treinos, setTreinos] = useState<Treino[]>([]);
  const [allUsers, setAllUsers] = useState<UserBase[]>([]);
  const [modalidades, setModalidades] = useState<string[]>([]);
  
  // Stats
  const [rankings, setRankings] = useState<Record<string, RankingItem[]>>({});
  const [listaVergonha, setListaVergonha] = useState<VergonhaItem[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Modais
  const [showModal, setShowModal] = useState(false);
  const [showNovaModalidade, setShowNovaModalidade] = useState(false);
  const [showRankingModal, setShowRankingModal] = useState<string | null>(null);
  const [novaModalidadeNome, setNovaModalidadeNome] = useState("");
  
  // Edição
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Tabela Expandida
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  
  // FUSÃO DE LISTAS
  const [chamadaReal, setChamadaReal] = useState<AlunoChamada[]>([]);
  const [rsvpsAtuais, setRsvpsAtuais] = useState<RSVP[]>([]);
  
  // Filtros
  const [filtroModalidade, setFiltroModalidade] = useState("Todas");
  const [ordemData, setOrdemData] = useState<'asc' | 'desc'>('desc');

  // Buscas
  const [buscaAluno, setBuscaAluno] = useState("");
  const [resultadoBusca, setResultadoBusca] = useState<UserBase[]>([]);
  const [buscaTreinador, setBuscaTreinador] = useState("");
  const [resultadoTreinador, setResultadoTreinador] = useState<UserBase[]>([]);

  // Form
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recurrenceDate, setRecurrenceDate] = useState("");

  const [novoTreino, setNovoTreino] = useState<Partial<Treino>>({
    modalidade: "Futsal", 
    diaSemana: "Segunda-feira", 
    dia: "", 
    horario: "", 
    local: "", 
    treinador: "", 
    descricao: "", 
    imagem: "", 
    ordemDia: 1, 
    status: "ativo"
  });

  const loadTreinos = useCallback(async (forceRefresh = false) => {
      try {
          const lista = await fetchTreinosAdminList({ maxResults: 220, forceRefresh });
          setTreinos(lista);
      } catch (error: unknown) {
          if (!isFirebasePermissionError(error)) {
            console.error(error);
          }
          addToast("Erro ao carregar treinos.", "error");
      }
  }, [addToast]);

  const loadUsers = useCallback(async (forceRefresh = false) => {
      try {
          const users = await fetchUserDirectory({ maxResults: 420, forceRefresh });
          setAllUsers(users);
      } catch (error: unknown) {
          if (!isFirebasePermissionError(error)) {
            console.error(error);
          }
          addToast("Erro ao carregar usuarios.", "error");
      }
  }, [addToast]);

  const loadExpandedData = useCallback(async (treinoId: string, forceRefresh = false) => {
      const [chamada, rsvps] = await Promise.all([
          fetchTreinoChamada(treinoId, { maxResults: 220, forceRefresh }),
          fetchTreinoRsvps(treinoId, { maxResults: 220, forceRefresh }),
      ]);
      setChamadaReal(chamada as AlunoChamada[]);
      setRsvpsAtuais(rsvps as RSVP[]);
  }, []);

  // --- 1. LOADERS ---
  useEffect(() => {
      const fetchMods = async () => {
          try {
              const mods = await fetchTreinoSettings();
              setModalidades(mods);
              setNovoTreino(prev => ({...prev, modalidade: mods[0] || "Futsal"}));
          } catch (error: unknown) {
              if (!isFirebasePermissionError(error)) {
                console.error(error);
              }
              setModalidades(["Futsal", "Volei"]); 
              setNovoTreino(prev => ({...prev, modalidade: "Futsal"}));
          }
      };
      void fetchMods();
  }, []);

  useEffect(() => {
      void loadTreinos();
  }, [loadTreinos]);

  useEffect(() => {
      void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
      if (!expandedRow) {
          setChamadaReal([]);
          setRsvpsAtuais([]);
          return;
      }
      const fetchRowData = async () => {
          try {
              await loadExpandedData(expandedRow, true);
          } catch (error: unknown) {
              if (!isFirebasePermissionError(error)) {
                console.error(error);
              }
              addToast("Erro ao carregar chamada.", "error");
          }
      };
      void fetchRowData();
  }, [expandedRow, loadExpandedData, addToast]);

  // 🦈 LISTA UNIFICADA
  const listaChamadaUnificada = useMemo(() => {
      const lista = [...chamadaReal];
      rsvpsAtuais.forEach(rsvp => {
          if (rsvp.status === 'going' && !lista.some(c => c.userId === rsvp.userId)) {
              lista.push({
                  id: rsvp.userId,
                  userId: rsvp.userId,
                  nome: rsvp.userName,
                  avatar: rsvp.userAvatar,
                  turma: rsvp.userTurma,
                  status: 'inscrito',
                  origem: 'app'
              });
          }
      });
      return lista.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [chamadaReal, rsvpsAtuais]);

  // --- 2. BUSCAS INTELIGENTES ---
  useEffect(() => {
      if (!buscaAluno.trim()) { setResultadoBusca([]); return; }
      const term = buscaAluno.toLowerCase();
      const hits = allUsers.filter(u => (u.nome && u.nome.toLowerCase().includes(term))).slice(0, 5);
      setResultadoBusca(hits);
  }, [buscaAluno, allUsers]);

  useEffect(() => {
      if (!buscaTreinador.trim()) { setResultadoTreinador([]); return; }
      const term = buscaTreinador.toLowerCase();
      const hits = allUsers.filter(u => (u.nome && u.nome.toLowerCase().includes(term))).slice(0, 5);
      setResultadoTreinador(hits);
  }, [buscaTreinador, allUsers]);

  // --- 3. DASHBOARD ---
  useEffect(() => {
      if (activeTab !== 'dashboard') return;
      const calculateStats = async () => {
          setLoadingStats(true);
          try {
              const metrics: TreinoDashboardMetrics = await fetchTreinoDashboardMetrics({
                  treinos,
                  maxRankingTreinos: 20,
                  maxGhostTreinos: 5,
                  formatDate: (d: string) => d ? d.split('-').reverse().join('/') : "-"
              });
              setRankings(metrics.rankings as Record<string, RankingItem[]>);
              setListaVergonha(metrics.listaVergonha as VergonhaItem[]);
          } catch (error) { console.error("Stats error", error); }
          finally { setLoadingStats(false); }
      };
      if (treinos.length > 0) {
          void calculateStats();
      }
  }, [activeTab, treinos]);

  // --- 4. FILTROS ---
  const treinosProcessados = useMemo(() => {
      let lista = [...treinos];
      if (filtroModalidade !== 'Todas') lista = lista.filter(t => t.modalidade === filtroModalidade);
      lista.sort((a, b) => {
          const dateA = new Date(a.dia).getTime();
          const dateB = new Date(b.dia).getTime();
          return ordemData === 'asc' ? dateA - dateB : dateB - dateA;
      });
      return lista;
  }, [treinos, filtroModalidade, ordemData]);

  // --- ACTIONS ---

  const handleCriarModalidade = async () => {
      if(!novaModalidadeNome.trim()) return;
      if(modalidades.includes(novaModalidadeNome)) return addToast("Já existe!", "error");
      const novas = [...modalidades, novaModalidadeNome];
      try {
          await saveTreinoSettings(novas);
          setModalidades(novas); setNovaModalidadeNome(""); setShowNovaModalidade(false);
          addToast("Modalidade criada!", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao salvar modalidade.", "error");
      }
  };

  const handleOpenCreate = () => {
      const modPadrao = modalidades.length > 0 ? modalidades[0] : "Futsal";
      setNovoTreino({ modalidade: modPadrao, diaSemana: "Segunda-feira", dia: "", horario: "", local: "", treinador: "", descricao: "", imagem: "", ordemDia: 1, status: "ativo" });
      setEditingId(null); setIsEditing(false); setShowModal(true);
  };

  const handleOpenEdit = (treino: Treino) => {
      setNovoTreino({ ...treino }); setEditingId(treino.id); setIsEditing(true); setShowModal(true);
  };

  const handleSelectTreinador = (user: UserBase) => {
      setNovoTreino(prev => ({ ...prev, treinador: user.nome, treinadorId: user.uid, treinadorAvatar: user.foto }));
      setBuscaTreinador(""); setResultadoTreinador([]);
  };

  const handleSave = async () => {
    if (!novoTreino.modalidade || !novoTreino.dia) return addToast("Dados incompletos!", "error");
    const diaObj = new Date(novoTreino.dia + "T12:00:00");
    const basePayload = { ...novoTreino, diaSemana: DIAS_SEMANA[diaObj.getDay()].label, ordemDia: DIAS_SEMANA[diaObj.getDay()].val };
    try {
        if (isEditing && editingId) {
            await upsertTreino({ id: editingId, data: basePayload });
            addToast("Atualizado!", "success");
        } else {
            if (recurrenceDate) {
                const result = await createRecurringTreinos({
                    data: basePayload,
                    startDate: novoTreino.dia,
                    endDate: recurrenceDate,
                });
                addToast(`${result.count} treinos criados!`, "success");
            } else {
                await upsertTreino({ data: basePayload });
                addToast("Criado!", "success");
            }
        }
        await loadTreinos(true);
        setShowModal(false); setRecurrenceDate("");
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao salvar.", "error");
    }
  };

  const handleTogglePresenca = async (aluno: AlunoChamada) => {
      if(!expandedRow) return;
      try {
          if (aluno.status === 'inscrito') {
              await upsertChamadaPresence({
                  treinoId: expandedRow,
                  userId: aluno.userId,
                  nome: aluno.nome,
                  turma: aluno.turma,
                  avatar: aluno.avatar,
                  origem: "app",
                  status: "presente"
              });
          } else {
              const novoStatus = aluno.status === "presente" ? "falta" : "presente";
              await updateChamadaStatus({
                  treinoId: expandedRow,
                  chamadaId: aluno.id,
                  status: novoStatus
              });
          }
          await loadExpandedData(expandedRow, true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar presenca.", "error");
      }
  };

  const handleAddUserToChamada = async (user: UserBase) => {
      if(!expandedRow) return;
      if (chamadaReal.some(a => a.userId === user.uid)) return addToast("Já na lista.", "info");
      try {
          await addUserToChamada({ treinoId: expandedRow, user });
          await loadExpandedData(expandedRow, true);
          addToast("Adicionado!", "success"); setBuscaAluno(""); setResultadoBusca([]);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao adicionar aluno.", "error");
      }
  };

  const handleDeleteAluno = async (alunoId: string) => {
      if(!expandedRow) return;
      if(confirm("Remover da lista oficial?")) {
          try {
              await deleteChamadaEntry({ treinoId: expandedRow, chamadaId: alunoId });
              await loadExpandedData(expandedRow, true);
          } catch (error: unknown) {
              console.error(error);
              addToast("Erro ao remover da chamada.", "error");
          }
      }
  }

  const handleToggleStatusTreino = async (treino: Treino) => {
      const novo = treino.status === 'ativo' ? 'cancelado' : 'ativo';
      try {
          await toggleTreinoStatus({ treinoId: treino.id, status: novo });
          await loadTreinos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar status.", "error");
      }
  };

  const handleDeleteTreino = async (id: string) => {
      if(confirm("Apagar tudo?")) {
          try {
              await deleteTreino(id);
              if (expandedRow === id) {
                  setExpandedRow(null);
                  setChamadaReal([]);
                  setRsvpsAtuais([]);
              }
              await loadTreinos(true);
          } catch (error: unknown) {
              console.error(error);
              addToast("Erro ao apagar treino.", "error");
          }
      }
  };

  const handleExportCSV = () => {
      if(!chamadaReal.length) return addToast("Lista vazia.", "info");
      const headers = ["Nome", "Turma", "Status", "Origem"];
      const rows = chamadaReal.map(a => [a.nome, a.turma, a.status, a.origem]);
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "chamada.csv");
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setUploading(true);
        const { url } = await uploadImage(file, "treinos");
        if (url) setNovoTreino(prev => ({ ...prev, imagem: url }));
        setUploading(false);
    }
  };

  const formatDate = (d: string) => d ? d.split('-').reverse().join('/') : "-";
  const isFeriado = (d: string) => FERIADOS.includes(d);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 flex justify-between items-center">
        <div className="flex items-center gap-3">
            <Link href="/admin" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400" /></Link>
            <h1 className="text-lg font-black uppercase tracking-tighter">Gestão Treinos</h1>
        </div>
        <div className="flex gap-2">
            {activeTab === 'grade' && (
                <>
                    <button onClick={() => setShowNovaModalidade(true)} className="bg-zinc-800 text-zinc-300 px-4 py-2 rounded-xl text-xs font-bold uppercase hover:bg-zinc-700 flex items-center gap-2 border border-zinc-700">
                        <Trophy size={14}/> Add Esporte
                    </button>
                    <button onClick={handleOpenCreate} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-emerald-500 shadow-lg">
                        <Plus size={16} /> Novo Treino
                    </button>
                </>
            )}
        </div>
      </header>

      <div className="px-6 pt-4">
          <div className="flex gap-6 border-b border-zinc-800">
              <button onClick={() => setActiveTab('dashboard')} className={`pb-3 text-xs font-bold uppercase flex items-center gap-2 transition ${activeTab === 'dashboard' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-white'}`}>
                  <LayoutDashboard size={14}/> Dashboard
              </button>
              <button onClick={() => setActiveTab('grade')} className={`pb-3 text-xs font-bold uppercase flex items-center gap-2 transition ${activeTab === 'grade' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-white'}`}>
                  <List size={14}/> Grade & Chamada
              </button>
          </div>
      </div>

      <main className="p-6">
        {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-300">
                {loadingStats && <div className="text-emerald-500 flex items-center gap-2 text-xs font-bold uppercase"><Loader2 className="animate-spin" size={14}/> Calculando Rankings...</div>}
                
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Rankings por Esporte</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {modalidades.map((mod) => {
                        const ranking = rankings[mod] || [];
                        const topPlayer = ranking[0];
                        return (
                            <div key={mod} onClick={() => setShowRankingModal(mod)} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 relative group overflow-hidden cursor-pointer hover:border-emerald-500/50 transition shadow-lg">
                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition"><Trophy size={64}/></div>
                                <h3 className="text-lg font-black text-white uppercase italic">{mod}</h3>
                                <div className="mt-4 flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden relative">
                                        {topPlayer ? <Image src={topPlayer.avatar} alt="Top Player" fill className="object-cover" unoptimized/> : <Users size={18} className="text-zinc-600"/>}
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-zinc-500 uppercase font-bold">MVP</p>
                                        <p className="text-sm font-bold text-white">{topPlayer ? `${topPlayer.nome.split(' ')[0]} (${topPlayer.count})` : "Sem dados"}</p>
                                    </div>
                                </div>
                                <div className="mt-3 text-[10px] text-emerald-500 font-bold uppercase text-right group-hover:underline">Ver Ranking &rarr;</div>
                            </div>
                        )
                    })}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
                        <div className="p-4 border-b border-zinc-800 bg-red-900/10 flex items-center gap-2">
                            <Ban size={18} className="text-red-500"/>
                            <h3 className="font-bold text-red-500 uppercase text-sm">Lista da Vergonha (Ghosting)</h3>
                        </div>
                        <div className="p-4 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                            {listaVergonha.map((item, i) => (
                                <div key={i} className="flex justify-between items-center p-3 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/30 transition rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="relative w-8 h-8 rounded-full overflow-hidden grayscale">
                                            <Image src={item.avatar || "https://github.com/shadcn.png"} alt="Ghost" fill className="object-cover" unoptimized/>
                                        </div>
                                        <div><p className="font-bold text-white text-sm">{item.nome}</p><p className="text-xs text-zinc-500">{item.treinoMod} • {item.treinoData}</p></div>
                                    </div>
                                    <span className="text-[9px] bg-red-500/20 text-red-400 px-2 py-1 rounded uppercase font-bold">Faltou</span>
                                </div>
                            ))}
                            {listaVergonha.length === 0 && !loadingStats && <p className="text-emerald-500 text-xs italic text-center py-4">Nenhum furo registrado recentemente! 🎉</p>}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'grade' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center bg-zinc-900 p-2 rounded-xl border border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-zinc-500 ml-2"/>
                        <select className="bg-zinc-950 text-xs text-white p-2 rounded-lg border border-zinc-700 outline-none" value={filtroModalidade} onChange={(e) => setFiltroModalidade(e.target.value)}>
                            <option className="bg-zinc-950" value="Todas">Todas Modalidades</option>
                            {modalidades.map(m => <option className="bg-zinc-950" key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <button onClick={() => setOrdemData(ordemData === 'asc' ? 'desc' : 'asc')} className="text-xs text-zinc-400 font-bold uppercase hover:text-white px-3 py-1 flex items-center gap-1">
                        <ArrowUpDown size={14}/> {ordemData === 'asc' ? 'Mais Antigos' : 'Mais Recentes'}
                    </button>
                </div>

                <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-zinc-950/50 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
                                <tr><th className="p-4">Data</th><th className="p-4">Modalidade</th><th className="p-4">Local</th><th className="p-4 text-center">Status</th><th className="p-4 text-right">Ações</th></tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800 text-sm">
                                {treinosProcessados.map((treino) => {
                                    const expanded = expandedRow === treino.id;
                                    const isHoliday = isFeriado(treino.dia);
                                    return (
                                        <React.Fragment key={treino.id}>
                                            <tr className={`transition-colors ${expanded ? 'bg-zinc-800/30' : 'hover:bg-zinc-800/20'} ${treino.status === 'cancelado' ? 'opacity-50 grayscale' : ''}`}>
                                                <td className="p-4">
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-white flex items-center gap-2">
                                                            {formatDate(treino.dia)}
                                                            {isHoliday && <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-black flex items-center gap-1 animate-pulse"><AlertTriangle size={10}/> FERIADO</span>}
                                                        </span>
                                                        <span className="text-xs text-zinc-500">{treino.diaSemana} • {treino.horario}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4 font-bold flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 overflow-hidden shrink-0 relative">
                                                        {treino.imagem ? <Image src={treino.imagem} alt={treino.modalidade} fill className="object-cover" unoptimized/> : <Dumbbell className="p-1 text-zinc-600"/>}
                                                    </div>
                                                    {treino.modalidade}
                                                </td>
                                                <td className="p-4 text-zinc-400 text-xs">{treino.local}</td>
                                                <td className="p-4 text-center"><button onClick={() => handleToggleStatusTreino(treino)} className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${treino.status === 'ativo' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>{treino.status}</button></td>
                                                <td className="p-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Link href={`/admin/treinos/lista/${treino.id}`} className="p-2 rounded-lg transition bg-zinc-800 text-zinc-400 hover:text-white" title="Abrir lista de presenca">
                                                            <ChevronDown size={16}/>
                                                        </Link>
                                                        <button onClick={() => handleOpenEdit(treino)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white"><Edit size={16}/></button>
                                                        <button onClick={() => handleDeleteTreino(treino.id)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-500"><Trash2 size={16}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {expanded && (
                                                <tr className="bg-black/20 shadow-inner">
                                                    <td colSpan={5} className="p-0">
                                                        <div className="p-4 border-l-4 border-emerald-500 bg-zinc-900/50">
                                                            
                                                            {/* RESPONSÁVEL CARD */}
                                                            {treino.treinador && (
                                                                <div className={`mb-4 p-3 rounded-xl bg-gradient-to-r ${getResponsibleColor(treino.treinadorId)} border border-white/10 flex items-center gap-4 shadow-lg w-fit`}>
                                                                        <div className="relative">
                                                                            <div className="w-12 h-12 rounded-full border-2 border-white/20 bg-black/30 overflow-hidden flex items-center justify-center relative">
                                                                                {treino.treinadorAvatar ? <Image src={treino.treinadorAvatar} alt="Treinador" fill className="object-cover" unoptimized/> : <Crown size={20} className="text-white"/>}
                                                                            </div>
                                                                            <div className="absolute -bottom-1 -right-1 bg-white text-black p-0.5 rounded-full"><Crown size={10} fill="black"/></div>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[9px] font-black uppercase text-white/80 tracking-widest">Treinador Responsável</p>
                                                                            <p className="text-sm font-bold text-white">{treino.treinador}</p>
                                                                        </div>
                                                                </div>
                                                            )}

                                                            <div className="flex justify-between items-center mb-4">
                                                                <h3 className="font-bold text-white text-sm uppercase flex items-center gap-2"><CheckCircle size={16} className="text-emerald-500"/> Lista de Presença ({listaChamadaUnificada.length})</h3>
                                                                <div className="flex gap-2 items-center">
                                                                        <div className="relative">
                                                                            <div className="flex items-center bg-zinc-950 border border-zinc-700 rounded-lg px-2">
                                                                                <Search size={14} className="text-zinc-500"/>
                                                                                <input type="text" placeholder="Adicionar aluno..." className="bg-transparent border-none text-xs text-white focus:ring-0 p-2 w-48 outline-none" value={buscaAluno} onChange={e => setBuscaAluno(e.target.value)} />
                                                                            </div>
                                                                            {resultadoBusca.length > 0 && (
                                                                                <div className="absolute top-full left-0 w-full bg-zinc-900 border border-zinc-700 rounded-lg mt-1 shadow-xl z-50 overflow-hidden">
                                                                                    {resultadoBusca.map(u => (
                                                                                        <button key={u.uid} onClick={() => handleAddUserToChamada(u)} className="w-full text-left p-2 hover:bg-zinc-800 flex items-center gap-2 border-b border-zinc-800/50 last:border-0 text-xs text-white">
                                                                                            <div className="w-5 h-5 rounded-full relative overflow-hidden">
                                                                                                <Image src={u.foto || "https://github.com/shadcn.png"} alt={u.nome} fill className="object-cover" unoptimized/>
                                                                                            </div>
                                                                                            <span>{u.nome}</span>
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <button onClick={handleExportCSV} className="bg-zinc-800 hover:bg-zinc-700 text-white p-2 rounded-lg" title="CSV"><Download size={16}/></button>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* 🦈 LISTA UNIFICADA (CLIQUE SEPARADO) */}
                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                                                {listaChamadaUnificada.map(aluno => (
                                                                    <div 
                                                                        key={aluno.id} 
                                                                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer select-none ${aluno.status === 'inscrito' ? 'bg-yellow-500/10 border-yellow-500/30' : aluno.status === 'presente' ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-red-900/10 border-red-500/20 opacity-60'}`}
                                                                        onClick={() => handleTogglePresenca(aluno)} // CLIQUE GERAL (TOGGLE)
                                                                    >
                                                                        <div className="flex items-center gap-2 w-full">
                                                                            <div className="w-6 h-6 rounded-full border border-white/10 relative overflow-hidden">
                                                                                <Image src={aluno.avatar || "https://github.com/shadcn.png"} alt={aluno.nome} fill className="object-cover" unoptimized/>
                                                                            </div>
                                                                            <div className="flex flex-col">
                                                                                <div className="flex items-center gap-2">
                                                                                    <p className="text-xs font-bold text-white">{aluno.nome}</p>
                                                                                    {/* 🦈 LINK DE PERFIL COM STOP PROPAGATION */}
                                                                                    <Link 
                                                                                        href={`/admin/usuarios/${aluno.userId}`} 
                                                                                        onClick={(e) => e.stopPropagation()} 
                                                                                        className="text-zinc-500 hover:text-emerald-400 transition p-1"
                                                                                        title="Ver Perfil"
                                                                                    >
                                                                                        <ExternalLink size={12}/>
                                                                                    </Link>
                                                                                </div>
                                                                                <div className="flex items-center gap-1">
                                                                                    <span className="text-[9px] text-zinc-500">{aluno.turma}</span>
                                                                                    {aluno.status === 'inscrito' && <span className="text-[8px] bg-yellow-500 text-black px-1 rounded font-bold uppercase">Inscrito (App)</span>}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        
                                                                        <div className="flex items-center gap-2">
                                                                            {/* Botão de Check/X Dependendo do status */}
                                                                            <button onClick={() => handleTogglePresenca(aluno)} title="Confirmar Presença/Falta">
                                                                                {aluno.status === 'presente' ? <CheckCircle size={16} className="text-emerald-500"/> 
                                                                                    : aluno.status === 'inscrito' ? <UserCheck size={16} className="text-yellow-500 animate-pulse"/> 
                                                                                    : <X size={16} className="text-red-500"/>}
                                                                            </button>
                                                                            {/* Deletar */}
                                                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteAluno(aluno.id || aluno.userId); }} className="text-zinc-600 hover:text-red-500 p-1"><Trash2 size={14}/></button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {listaChamadaUnificada.length === 0 && <div className="col-span-full text-center py-4 text-zinc-500 text-xs italic">Nenhum aluno na lista ainda.</div>}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}
      </main>

      {/* MODAIS (Ranking, Create, etc - Mantidos iguais) */}
      {showRankingModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" onClick={() => setShowRankingModal(null)}>
              <div className="bg-zinc-900 w-full max-w-md rounded-2xl border border-zinc-800 p-6 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="font-bold text-white text-lg flex items-center gap-2"><Trophy className="text-yellow-500" size={20}/> Ranking: {showRankingModal}</h2>
                      <button onClick={() => setShowRankingModal(null)}><X size={20}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      {rankings[showRankingModal]?.map((item, idx) => (
                          <div key={item.userId} className="flex items-center gap-3 p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                              <span className={`text-lg font-black w-6 text-center ${idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-zinc-300' : idx === 2 ? 'text-orange-700' : 'text-zinc-600'}`}>{idx + 1}</span>
                              <div className="w-8 h-8 rounded-full bg-zinc-800 relative overflow-hidden">
                                <Image src={item.avatar} alt={item.nome} fill className="object-cover" unoptimized/>
                              </div>
                              <div className="flex-1"><p className="text-sm font-bold text-white">{item.nome}</p><p className="text-[10px] text-zinc-500">{item.turma}</p></div>
                              <div className="bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded text-xs font-bold">{item.count}xp</div>
                          </div>
                      ))}
                      {!rankings[showRankingModal] && <p className="text-center text-zinc-500">Sem dados.</p>}
                  </div>
              </div>
          </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 w-full max-w-lg rounded-2xl border border-zinc-800 p-6 space-y-4">
            <h2 className="font-bold text-white text-lg flex items-center gap-2"><Dumbbell size={20} className="text-emerald-500"/> {isEditing ? "Editar" : "Novo"} Treino</h2>
            <div className="flex gap-4">
                <div onClick={() => fileInputRef.current?.click()} className="w-24 h-24 border-2 border-dashed border-zinc-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-emerald-500 transition bg-black/20 shrink-0 relative group overflow-hidden">
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>
                    {novoTreino.imagem ? <Image src={novoTreino.imagem} alt="Capa Treino" fill className="object-cover" unoptimized/> : (uploading ? <Loader2 className="animate-spin text-emerald-500"/> : <ImageIcon className="text-zinc-600"/>)}
                </div>
                <div className="flex-1 space-y-3">
                    <select className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none" value={novoTreino.modalidade} onChange={(e) => setNovoTreino({ ...novoTreino, modalidade: e.target.value })}>
                        {modalidades.map(m => <option className="bg-zinc-900" key={m} value={m}>{m}</option>)}
                    </select>
                    
                    <div className="relative">
                        <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-xl p-3">
                            <User size={16} className="text-zinc-500 mr-2"/>
                            <input 
                                type="text" 
                                placeholder="Buscar Responsável..." 
                                className="bg-transparent text-sm text-white outline-none w-full"
                                value={novoTreino.treinador || buscaTreinador}
                                onChange={e => {
                                    setBuscaTreinador(e.target.value);
                                    if(novoTreino.treinador && e.target.value !== novoTreino.treinador) {
                                        setNovoTreino(prev => ({...prev, treinador: "", treinadorId: "", treinadorAvatar: ""}));
                                    }
                                }}
                            />
                            {novoTreino.treinador && <CheckCircle size={16} className="text-emerald-500"/>}
                        </div>
                        {resultadoTreinador.length > 0 && !novoTreino.treinador && (
                            <div className="absolute top-full left-0 w-full bg-zinc-900 border border-zinc-700 rounded-lg mt-1 shadow-xl z-50 overflow-hidden">
                                {resultadoTreinador.map(u => (
                                    <button key={u.uid} onClick={() => handleSelectTreinador(u)} className="w-full text-left p-2 hover:bg-zinc-800 flex items-center gap-2 border-b border-zinc-800/50 last:border-0 text-xs text-white">
                                        <div className="w-5 h-5 rounded-full relative overflow-hidden">
                                            <Image src={u.foto || "https://github.com/shadcn.png"} alt={u.nome} fill className="object-cover" unoptimized/>
                                        </div>
                                        <span>{u.nome}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            {/* 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 */}
            {/* 🦈 CAMPO DE DESCRIÇÃO ADICIONADO AQUI 🦈 */}
            <textarea
                placeholder="Descrição do Treino (Opcional - Ex: Trazer colete, Foco em defesa)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none h-20 resize-none"
                value={novoTreino.descricao || ""}
                onChange={(e) => setNovoTreino({ ...novoTreino, descricao: e.target.value })}
            />
            {/* 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 🦈 */}

            <div className="grid grid-cols-2 gap-3">
                <input type="date" className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none" value={novoTreino.dia} onChange={(e) => setNovoTreino({ ...novoTreino, dia: e.target.value })} />
                <input type="text" placeholder="20:00" className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none" value={novoTreino.horario} onChange={(e) => setNovoTreino({ ...novoTreino, horario: e.target.value })} />
            </div>
            <input type="text" placeholder="Local" className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none" value={novoTreino.local} onChange={(e) => setNovoTreino({ ...novoTreino, local: e.target.value })} />
            {!isEditing && (
                <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center gap-3">
                    <CalendarRange size={16} className="text-zinc-500"/>
                    <span className="text-xs text-zinc-400">Repetir até:</span>
                    <input type="date" className="bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-xs text-white outline-none" value={recurrenceDate} onChange={e => setRecurrenceDate(e.target.value)} />
                </div>
            )}
            <div className="flex gap-3 pt-2 border-t border-zinc-800">
              <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-800 transition">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500 shadow-lg transition flex items-center justify-center gap-2"><Save size={16}/> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {showNovaModalidade && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4">
              <div className="bg-zinc-900 w-full max-w-sm rounded-2xl border border-zinc-800 p-6 space-y-4">
                  <h2 className="font-bold text-white text-lg">Criar Esporte</h2>
                  <input type="text" placeholder="Nome (ex: Natação)" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white outline-none" value={novaModalidadeNome} onChange={e => setNovaModalidadeNome(e.target.value)} />
                  <div className="flex gap-2">
                      <button onClick={() => setShowNovaModalidade(false)} className="flex-1 py-3 text-zinc-500 text-xs uppercase font-bold hover:text-white">Cancelar</button>
                      <button onClick={handleCriarModalidade} className="flex-1 bg-emerald-600 text-white rounded-xl py-3 text-xs font-bold uppercase hover:bg-emerald-500">Criar</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
