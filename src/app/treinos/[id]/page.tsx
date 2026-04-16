"use client";

import React, { useState, useEffect, useMemo } from "react";
import { 
  ArrowLeft, MapPin, Clock, User, Trophy, Users, CheckCircle, 
  Share2, XCircle, Calendar, Crown, Navigation, UserX, QrCode, X
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchTreinoById,
  fetchTreinoChamada,
  fetchTreinoRsvps,
  setTreinoRsvp
} from "../../../lib/treinosNativeService";
import { getTurmaImage } from "../../../constants/turmaImages";
import { resolveEffectiveAccessRole } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

// --- TIPAGENS (O Escudo do Código) ---
interface TreinoData {
  id: string;
  modalidade: string;
  diaSemana: string;
  dia?: string;
  horario: string;
  local: string;
  descricao?: string;
  imagem?: string;
  treinador?: string;
  treinadorId?: string;
  treinadorAvatar?: string;
  confirmados?: string[];
}

interface RSVPData {
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "not_going";
}

interface ChamadaData {
  userId: string;
  status: "presente" | "falta";
}

interface AlunoLista {
  userId: string;
  nome: string;
  turma: string;
  avatar: string;
  statusVisual: "confirmado" | "presente" | "falta";
}

const TREINO_HISTORICO_ALLOWED_ROLES = new Set([
  "master",
  "admin",
  "admin_geral",
  "admin_gestor",
  "admin_treino",
  "treinador",
  "coach",
]);

const isTreinoPast = (dia?: string): boolean => {
  if (!dia) return false;
  const endOfDay = new Date(`${dia}T23:59:59`);
  if (Number.isNaN(endOfDay.getTime())) return false;
  return endOfDay.getTime() < Date.now();
};

export default function TreinoDetalhesPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSlug } = useTenantTheme();

  const [treino, setTreino] = useState<TreinoData | null>(null);
  const [rsvps, setRsvps] = useState<RSVPData[]>([]);
  const [chamadaAdmin, setChamadaAdmin] = useState<ChamadaData[]>([]); 
  
  const [loading, setLoading] = useState(true);
  const [userRsvp, setUserRsvp] = useState<"going" | "not_going" | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [showPresenceQr, setShowPresenceQr] = useState(false);

  // 1. CARREGAR DADOS (TREINO + RSVPS + CHAMADA OFICIAL)
  const treinoId = typeof params.id === "string" ? params.id : "";
  const userId = user?.uid ?? null;
  const userRole = resolveEffectiveAccessRole(user);
  const canAccessExpiredTreino = TREINO_HISTORICO_ALLOWED_ROLES.has(userRole);

  useEffect(() => {
      if (!treinoId) return;

      const loadData = async () => {
          setLoading(true);
          try {
              const [treinoDoc, listaRsvp, listaChamada] = await Promise.all([
                  fetchTreinoById(treinoId, { forceRefresh: false, tenantId: tenantId || undefined }),
                  fetchTreinoRsvps(treinoId, { maxResults: 220, forceRefresh: false, tenantId: tenantId || undefined }),
                  fetchTreinoChamada(treinoId, { maxResults: 220, forceRefresh: false, tenantId: tenantId || undefined }),
              ]);

              if (!treinoDoc) {
                  addToast("Treino nao encontrado.", "error");
                  router.push(tenantSlug ? withTenantSlug(tenantSlug, "/treinos") : "/treinos");
                  return;
              }
              if (isTreinoPast(treinoDoc.dia) && !canAccessExpiredTreino) {
                  addToast("Treino encerrado. Consulte a agenda atual.", "info");
                  router.replace(tenantSlug ? withTenantSlug(tenantSlug, "/treinos") : "/treinos");
                  return;
              }

              setTreino(treinoDoc as TreinoData);
              setRsvps(listaRsvp as RSVPData[]);
              setChamadaAdmin(
                  listaChamada.map((row) => ({
                      userId: row.userId,
                      status: row.status === "falta" ? "falta" : "presente",
                  }))
              );

              if (userId) {
                  const me = listaRsvp.find((p) => p.userId === userId);
                  setUserRsvp(me ? me.status : null);
              } else {
                  setUserRsvp(null);
              }
          } catch (error: unknown) {
              console.error(error);
              addToast("Erro ao carregar treino.", "error");
          } finally {
              setLoading(false);
          }
      };

      void loadData();
  }, [treinoId, userId, canAccessExpiredTreino, router, addToast, tenantId, tenantSlug]);

  // 2. FUSÃO INTELIGENTE DAS LISTAS (RSVP + ADMIN)
  const listaFinal = useMemo(() => {
      const map = new Map<string, AlunoLista>();

      // Passo 1: Adiciona quem marcou "Eu Vou"
      rsvps.forEach(r => {
          if (r.status === 'going') {
              map.set(r.userId, { 
                  userId: r.userId,
                  nome: r.userName, 
                  turma: r.userTurma, 
                  avatar: r.userAvatar,
                  statusVisual: 'confirmado' 
              });
          }
      });

      // Passo 2: Sobrescreve com a Lista Oficial do Admin
      chamadaAdmin.forEach(c => {
          const existing = map.get(c.userId);
          // Se já existe, atualiza status. Se não (veio do além/admin manual), cria.
          // Para simplificar, assumimos que se o admin marcou, ele tem os dados ou pegamos do RSVP antigo se existir
          if (existing) {
             map.set(c.userId, { ...existing, statusVisual: c.status });
          } 
          // Nota: Se o admin marcar alguém que não deu RSVP, precisariamos buscar os dados do usuário (nome/foto)
          // Aqui focamos na fusão simples onde o RSVP geralmente existe antes.
      });

      return Array.from(map.values()).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [rsvps, chamadaAdmin]);

  // 3. CÁLCULO DO RANKING DE TURMAS
  const rankingTurmas = useMemo(() => {
      const counts: Record<string, number> = {};
      listaFinal.forEach(aluno => {
          if (aluno.statusVisual !== 'falta' && aluno.turma) {
              const t = aluno.turma.toUpperCase();
              counts[t] = (counts[t] || 0) + 1;
          }
      });
      return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([turma, count]) => ({
            turma,
            count,
            imagem: getTurmaImage(turma, "https://github.com/shadcn.png"),
          }));
  }, [listaFinal]);

  // 🦈 4. AÇÃO DE RSVP CORRIGIDA PARA ATUALIZAR PERFIL 🦈
  const handleRSVP = async (status: "going" | "not_going") => {
      if (!user || !treino) return addToast("Faça login para confirmar!", "error");
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
              tenantId: tenantId || undefined,
          });

          const treinoAtualizado = await fetchTreinoById(treino.id, {
            forceRefresh: false,
            tenantId: tenantId || undefined,
          });
          const [listaRsvp, listaChamada] = await Promise.all([
              fetchTreinoRsvps(treino.id, { maxResults: 220, forceRefresh: false, tenantId: tenantId || undefined }),
              fetchTreinoChamada(treino.id, { maxResults: 220, forceRefresh: false, tenantId: tenantId || undefined }),
          ]);

          if (treinoAtualizado) {
              setTreino(treinoAtualizado as TreinoData);
          }
          setRsvps(listaRsvp as RSVPData[]);
          setChamadaAdmin(
              listaChamada.map((row) => ({
                  userId: row.userId,
                  status: row.status === "falta" ? "falta" : "presente",
              }))
          );

          const me = listaRsvp.find((p) => p.userId === user.uid);
          setUserRsvp(me ? me.status : null);

          addToast(status === 'going' ? "Presença confirmada! 💪" : "Inscrição removida.", "success");
      } catch (error) {
          console.error(error);
          addToast("Erro ao atualizar.", "error");
      } finally {
          setLoadingAction(false);
      }
  };

  const getTheme = () => {
      if (!treino) return {};
      const m = treino.modalidade.toLowerCase();
      if (m.includes("volei")) return { text: "text-yellow-400", badge: "bg-yellow-500 border-yellow-400 text-black", gradient: "from-yellow-900/40" };
      if (m.includes("hand")) return { text: "text-blue-400", badge: "bg-blue-600 border-blue-500 text-white", gradient: "from-blue-900/40" };
      return { text: "text-emerald-400", badge: "bg-emerald-600 border-emerald-500 text-white", gradient: "from-emerald-900/40" };
  };

  const getMapsLink = () => {
      if (!treino?.local) return "#";
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(treino.local)}`;
  };

  const presenceQrPayload = useMemo(() => {
      if (!treino || !user?.uid) return "";
      return JSON.stringify({
          t: "treino-presenca",
          v: 1,
          tid: treino.id,
          ten: tenantId || "",
          uid: user.uid,
          n: user.nome || "Atleta",
          tu: user.turma || "Geral",
          av: user.foto || "",
          ts: Date.now(),
      });
  }, [tenantId, treino, user?.foto, user?.nome, user?.turma, user?.uid]);

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><div className="w-10 h-10 border-4 border-emerald-500 rounded-full animate-spin border-t-transparent"></div></div>;
  if (!treino) return null;

  const theme = getTheme();
  const confirmadosCount = rsvps.filter((row) => row.status === "going").length;
  const presentesCount = chamadaAdmin.filter((row) => row.status === "presente").length;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32 selection:bg-emerald-500/30">
      
      {/* --- HERO SECTION --- */}
      <div className="relative h-[65vh] w-full">
        <div className="absolute inset-0 bg-black">
            {/* 🦈 Image Otimizado */}
            <Image 
                src={treino.imagem || "https://placehold.co/800x600/111/333?text=TREINO"} 
                alt={treino.modalidade}
                fill
                className="object-cover opacity-60"
                
            />
            <div className={`absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/30 to-transparent z-10`}></div>
        </div>

        <Link href={tenantSlug ? withTenantSlug(tenantSlug, "/treinos") : "/treinos"} className="absolute top-6 left-6 z-20 bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 hover:bg-white hover:text-black transition">
            <ArrowLeft size={24} />
        </Link>
        <button className="absolute top-6 right-6 z-20 bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 hover:bg-emerald-500 transition">
            <Share2 size={24} />
        </button>

        {/* RANKING FLUTUANTE */}
        <div className="absolute bottom-40 right-6 z-20 flex flex-col gap-2 items-end">
            {rankingTurmas.map((t, i) => (
                <div key={t.turma} className="flex items-center gap-3 bg-black/60 backdrop-blur-md pl-1.5 pr-4 py-1.5 rounded-full border border-white/10 animate-in slide-in-from-right duration-700 shadow-xl" style={{ animationDelay: `${i * 100}ms` }}>
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden border border-zinc-500 shrink-0 relative">
                        {t.imagem ? <Image src={t.imagem} alt={t.turma} fill className="object-cover" /> : <span className="text-xs font-black">{t.turma}</span>}
                    </div>
                    <div className="flex flex-col items-end leading-none">
                        <span className="text-[9px] font-bold text-zinc-400 uppercase">Dominando</span>
                        <span className={`font-black text-sm ${theme.text}`}>+{t.count}</span>
                    </div>
                </div>
            ))}
        </div>

        {/* INFO PRINCIPAL */}
        <div className="absolute bottom-0 left-0 w-full p-6 z-20 flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest backdrop-blur-md border shadow-lg ${theme.badge}`}>
                    {treino.modalidade}
                </span>
                <span className="bg-white/10 backdrop-blur-md text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                    <Users size={12}/> {confirmadosCount} Atletas
                </span>
                <span className="bg-white/10 backdrop-blur-md text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                    <CheckCircle size={12}/> {presentesCount} Presentes
                </span>
            </div>
            
            <h1 className="text-5xl md:text-6xl font-black italic uppercase tracking-tighter leading-none text-white drop-shadow-2xl">
                {treino.modalidade}
            </h1>
            
            <div className="flex flex-wrap gap-4 text-xs font-bold text-zinc-300 uppercase tracking-wide mt-2">
                <div className="flex items-center gap-2 bg-black/40 px-4 py-2 rounded-xl border border-white/10 backdrop-blur-sm">
                    <Calendar size={16} className={theme.text} /> {treino.diaSemana}, {treino.dia ? treino.dia.split('-').reverse().slice(0,2).join('/') : ''}
                </div>
                <div className="flex items-center gap-2 bg-black/40 px-4 py-2 rounded-xl border border-white/10 backdrop-blur-sm">
                    <Clock size={16} className={theme.text} /> {treino.horario}
                </div>
            </div>
        </div>
      </div>

      {/* --- CARD DE CONTEÚDO --- */}
      <div className="relative z-30 -mt-8 bg-[#050505] rounded-t-[2.5rem] border-t border-white/10 shadow-[0_-10px_50px_rgba(0,0,0,0.5)] p-6 space-y-8 min-h-[50vh]">
        
        {/* 1. BOTÕES DE DECISÃO */}
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-2 rounded-2xl shadow-inner flex gap-2">
            <button 
                onClick={() => handleRSVP('not_going')}
                className="flex-1 py-4 rounded-xl border border-transparent hover:border-red-500/30 hover:bg-red-500/10 text-zinc-500 hover:text-red-500 font-bold text-xs uppercase transition-all"
            >
                <span className="flex flex-col items-center gap-1"><XCircle size={20}/> Não Vou</span>
            </button>
            <button 
                onClick={() => handleRSVP('going')}
                disabled={loadingAction}
                className={`flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest shadow-lg flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${userRsvp === 'going' ? 'bg-emerald-500 text-black shadow-emerald-500/30' : 'bg-white text-black hover:bg-zinc-200'}`}
            >
                {loadingAction ? <span className="animate-spin">⌛</span> : userRsvp === 'going' ? <><CheckCircle size={24}/> Confirmado</> : "Confirmar Presença"}
            </button>
        </div>

        <button
            type="button"
            onClick={() => {
                if (!user?.uid) {
                    addToast("Faca login para abrir seu QR de presenca.", "info");
                    return;
                }
                setShowPresenceQr(true);
            }}
            className="w-full rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm font-black uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-500/15 flex items-center justify-center gap-2"
        >
            <QrCode size={20} /> Abrir QR de presenca
        </button>

        {/* 2. RESPONSÁVEL & DESCRIÇÃO */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
                <h2 className="text-sm font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Trophy size={16} className={theme.text} /> O Treino
                </h2>
                <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800">
                    <p className="text-zinc-300 text-sm leading-relaxed">{treino.descricao || "Sem descrição informada."}</p>
                </div>
                
                {/* Localização com Botão Maps */}
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center border border-zinc-700">
                            <MapPin size={18} className={theme.text} />
                        </div>
                        <div>
                            <p className="text-zinc-500 text-[10px] font-bold uppercase">Localização</p>
                            <p className="text-white font-bold text-sm">{treino.local}</p>
                        </div>
                    </div>
                    <a href={getMapsLink()} target="_blank" rel="noopener noreferrer" className="bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-bold uppercase px-3 py-2 rounded-xl flex items-center gap-2 transition">
                        Abrir <Navigation size={12}/>
                    </a>
                </div>
            </div>

            {/* Card Responsável Clicável */}
            <Link href={treino.treinadorId ? `/perfil/${treino.treinadorId}` : "#"} className="block group">
                <div className="bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center gap-3 relative overflow-hidden group-hover:border-zinc-600 transition">
                    <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${theme.gradient} to-transparent`}></div>
                    <div className="w-20 h-20 rounded-full border-4 border-[#050505] shadow-xl overflow-hidden relative group-hover:scale-105 transition duration-300">
                        {treino.treinadorAvatar ? <Image src={treino.treinadorAvatar} alt="Treinador" fill className="object-cover" /> : <User size={32} className="text-zinc-600 m-auto"/>}
                        <div className="absolute bottom-0 right-0 bg-emerald-500 p-1 rounded-full border-2 border-black"><Crown size={12} className="text-black"/></div>
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1">Responsável</p>
                        <p className="text-lg font-black text-white">{treino.treinador || "Equipe responsavel"}</p>
                        <span className={`text-xs font-bold ${theme.text} mt-1 block group-hover:underline`}>Ver Perfil</span>
                    </div>
                </div>
            </Link>
        </div>

        {/* 3. LISTA DE QUEM VAI (INTEGRADA E COLORIDA) */}
        <section className="space-y-4 pt-4 border-t border-white/5">
            <h2 className="text-sm font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Users size={16} className={theme.text} /> Lista de Presença
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {listaFinal.map((pessoa, idx) => {
                    let statusColor = "border-zinc-800/50 bg-zinc-900/50"; 
                    let icon = null;

                    if (pessoa.statusVisual === 'presente') {
                        statusColor = "border-emerald-500/20 bg-emerald-900/10"; 
                        icon = <CheckCircle size={14} className="text-emerald-500"/>;
                    } else if (pessoa.statusVisual === 'falta') {
                        statusColor = "border-red-500/20 bg-red-900/10 opacity-60"; 
                        icon = <UserX size={14} className="text-red-500"/>;
                    }

                    return (
                        <Link href={`/perfil/${pessoa.userId}`} key={idx}>
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition hover:bg-white/5 ${statusColor}`}>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full border border-zinc-700 overflow-hidden relative">
                                        <Image src={pessoa.avatar || "https://github.com/shadcn.png"} alt={pessoa.nome} fill className="object-cover" />
                                    </div>
                                    <div>
                                        <p className={`text-sm font-bold ${pessoa.statusVisual === 'falta' ? 'text-zinc-500 line-through' : 'text-white'}`}>{pessoa.nome}</p>
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
                                            {pessoa.turma}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    {icon}
                                    <span className={`text-[8px] uppercase font-black tracking-widest mt-1 ${
                                        pessoa.statusVisual === 'presente' ? 'text-emerald-500' : 
                                        pessoa.statusVisual === 'falta' ? 'text-red-500' : 'text-zinc-500'
                                    }`}>
                                        {pessoa.statusVisual === 'presente' ? 'Presente' : 
                                         pessoa.statusVisual === 'falta' ? 'Faltou' : 'Inscrito'}
                                    </span>
                                </div>
                            </div>
                        </Link>
                    );
                })}
                
                {listaFinal.length === 0 && (
                    <div className="col-span-full py-8 text-center border border-dashed border-zinc-800 rounded-xl">
                        <p className="text-zinc-600 text-xs font-bold uppercase">Nenhum confirmado ainda. Seja o primeiro!</p>
                    </div>
                )}
            </div>
        </section>

      </div>

      {showPresenceQr && presenceQrPayload ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-5"
          onClick={() => setShowPresenceQr(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-emerald-500/30 bg-zinc-950 p-6 text-center shadow-[0_0_50px_rgba(16,185,129,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400">
                  QR do treino
                </p>
                <h2 className="mt-1 text-lg font-black uppercase text-white">
                  {treino.modalidade}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPresenceQr(false)}
                className="rounded-full border border-zinc-700 bg-black p-2 text-zinc-300"
                aria-label="Fechar QR"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mx-auto inline-flex rounded-3xl bg-white p-4">
              <QRCodeSVG value={presenceQrPayload} size={230} includeMargin />
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-left">
              <p className="text-sm font-black text-white">{user?.nome || "Atleta"}</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-zinc-500">
                {user?.turma || "Geral"} - {treino.dia || "-"} - {treino.horario || "-"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

