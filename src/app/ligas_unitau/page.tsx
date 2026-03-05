// src/app/ligas_unitau/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { 
  Heart, X, Calendar, 
  Lightbulb, Trophy, ArrowLeft, Users, Loader2, Brain, CheckCircle2, RotateCcw 
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "../../context/AuthContext";
import { logActivity } from "../../lib/logger"; 
import {
  LEAGUE_QUIZ_PROFILES,
  type LeagueQuizProfile,
} from "../../constants/leagueQuizProfiles";
import {
  addLeagueQuizHistory,
  changeLeagueLikeCount,
  fetchLeagueById,
  fetchLeagueSummaries,
  type LeagueRecord,
} from "../../lib/leaguesService";

// --- 1. INTERFACES (Fim dos 'any') ---

interface League extends LeagueRecord {
    matchPercent?: number; 
    matchScore?: number;
}

const normalizeLeagueText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const splitLeagueTokens = (value: string): string[] =>
  normalizeLeagueText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const KEYWORD_SYNONYMS: Record<string, string[]> = {
  clinica: ["consultorio", "diagnostico"],
  familia: ["comunidade", "prevencao", "vinculo"],
  emergencia: ["urgencia", "trauma", "intensiva"],
  cardio: ["coracao", "cardiologia"],
  neuro: ["neurologia", "neurocirurgia"],
  gineco: ["ginecologia", "obstetricia", "mulheres"],
  ortopedia: ["ossos", "esportiva", "atletas"],
  endocrino: ["hormonios", "metabolismo"],
  psiquiatria: ["saude mental", "cerebro"],
  onco: ["oncologia", "cancer"],
  legal: ["forense", "pericia", "etica"],
  oftalmo: ["oftalmologia", "detalhe"],
  urologia: ["rins", "nefro"],
  cirurgia: ["manual", "centro cirurgico", "laparoscopia", "robotica"],
  pediatria: ["neonatologia", "criancas"],
};

const expandLeagueKeyword = (keyword: string): string[] => {
  const base = normalizeLeagueText(keyword);
  if (!base) return [];

  const synonyms = KEYWORD_SYNONYMS[base] ?? [];
  return Array.from(new Set([base, ...synonyms.map((item) => normalizeLeagueText(item))]));
};

const resolveLeagueProfile = (league: League): LeagueQuizProfile | null => {
  const leagueName = normalizeLeagueText(league.nome || "");
  const leagueSigla = normalizeLeagueText(league.sigla || "");

  for (const profile of LEAGUE_QUIZ_PROFILES) {
    const profileSigla = normalizeLeagueText(profile.sigla || "");
    if (profileSigla && leagueSigla && profileSigla === leagueSigla) {
      return profile;
    }
  }

  for (const profile of LEAGUE_QUIZ_PROFILES) {
    const profileName = normalizeLeagueText(profile.nome);
    const aliases = (profile.aliases ?? []).map((item) => normalizeLeagueText(item));
    const hasNameMatch =
      (profileName && (leagueName.includes(profileName) || profileName.includes(leagueName))) ||
      aliases.some((alias) => alias && leagueName.includes(alias));

    if (hasNameMatch) {
      return profile;
    }
  }

  return null;
};

const QUESTIONS = [
    { id: 1, text: "Qual cenário faz seus olhos brilharem?", options: [{ label: "Centro Cirúrgico", keywords: ["Trauma", "Cirurgia", "Plástica", "Ortopedia"] }, { label: "Emergência", keywords: ["Emergência", "Urgência", "Trauma", "Intensiva"] }, { label: "Consultório", keywords: ["Clínica", "Endocrino", "Dermato", "Gastro"] }, { label: "Comunidade", keywords: ["Família", "Comunidade", "Pediatria", "Gineco"] }, { label: "Laboratório", keywords: ["Patologia", "Radiologia", "Genética"] }] },
    { id: 2, text: "Com qual público você tem mais afinidade?", options: [{ label: "Crianças", keywords: ["Pediatria", "Neonatologia"] }, { label: "Mulheres", keywords: ["Gineco", "Obstetrícia"] }, { label: "Adultos", keywords: ["Geriatria", "Clínica", "Cardio"] }, { label: "Graves", keywords: ["Intensiva", "Anestesiologia", "Trauma"] }, { label: "Atletas", keywords: ["Esportiva", "Ortopedia"] }] },
    { id: 3, text: "Qual sistema te fascina?", options: [{ label: "Cérebro", keywords: ["Neuro", "Psiquiatria"] }, { label: "Coração", keywords: ["Cardio", "Pneumo"] }, { label: "Ossos", keywords: ["Ortopedia", "Plástica"] }, { label: "Hormônios", keywords: ["Gastro", "Endocrino"] }, { label: "Rins", keywords: ["Nefro", "Urologia"] }] },
    { id: 4, text: "Estilo de prática?", options: [{ label: "Manual", keywords: ["Cirurgia", "Trauma"] }, { label: "Raciocínio", keywords: ["Clínica", "Infecto"] }, { label: "Prevenção", keywords: ["Família", "Pediatria"] }, { label: "Tecnologia", keywords: ["Radiologia", "Cardio"] }, { label: "Gestão", keywords: ["Legal", "Trabalho"] }] },
    { id: 5, text: "Impacto desejado?", options: [{ label: "Salvar vidas", keywords: ["Emergência", "Trauma"] }, { label: "Paciência", keywords: ["Psiquiatria", "Geriatria"] }, { label: "Detalhe", keywords: ["Plástica", "Oftalmo"] }, { label: "Curiosidade", keywords: ["Genética", "Patologia"] }, { label: "Vínculo", keywords: ["Família", "Onco"] }] }
];

export default function LigasUnitauPage() {
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [loadingSelectedLeague, setLoadingSelectedLeague] = useState(false);
  const [likedLeagues, setLikedLeagues] = useState<string[]>([]);
  const [isJoined, setIsJoined] = useState(false); 

  // Quiz
  const [quizStep, setQuizStep] = useState(0);
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [allKeywords, setAllKeywords] = useState<string[]>([]);
  const [topMatches, setTopMatches] = useState<League[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadLeagues = async () => {
      setLoading(true);
      try {
        const data = await fetchLeagueSummaries({
          orderByField: "likes",
          orderDirection: "desc",
          maxResults: 60,
        });
        if (!mounted) return;
        setLeagues(data as League[]);
      } catch (error: unknown) {
        console.error(error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadLeagues();
    return () => {
      mounted = false;
    };
  }, []);

  const openLeagueDetails = async (league: League): Promise<void> => {
      setSelectedLeague(league);
      setLoadingSelectedLeague(true);
      try {
          const fullLeague = await fetchLeagueById(league.id, { forceRefresh: true });
          if (fullLeague) {
              setSelectedLeague(fullLeague as League);
          }
      } catch (error: unknown) {
          console.error(error);
      } finally {
          setLoadingSelectedLeague(false);
      }
  };

  const handleLike = async (e: React.MouseEvent, leagueId: string) => {
      e.stopPropagation();
      if (!user) return;
      
      const isLiked = likedLeagues.includes(leagueId);
      setLikedLeagues(prev => isLiked ? prev.filter(id => id !== leagueId) : [...prev, leagueId]);
      setLeagues((prev) =>
        prev
          .map((league) =>
            league.id === leagueId
              ? { ...league, likes: Math.max(0, (league.likes || 0) + (isLiked ? -1 : 1)) }
              : league
          )
          .sort((a, b) => (b.likes || 0) - (a.likes || 0))
      );

      try {
        await changeLeagueLikeCount({
          id: leagueId,
          delta: isLiked ? -1 : 1,
          actorUserId: user.uid,
        });
      } catch (error: unknown) {
        console.error(error);
      }

      // --- CORREÇÃO DO LOG ---
      if (!isLiked) {
          logActivity(
              user.uid,
              user.nome || "Atleta", // Argumento 2: Nome
              "LIKE",                // Argumento 3: Ação (Agora válida no ActionType)
              "Ligas",               // Argumento 4: Recurso
              `Curtiu a liga ${leagueId}` // Argumento 5: Detalhes
          );
      }
  };

  const toggleOption = (keywords: string[], label: string) => {
      if (selectedOptions.includes(label)) setSelectedOptions(prev => prev.filter(o => o !== label));
      else if (selectedOptions.length < 3) setSelectedOptions(prev => [...prev, label]);
  };

  const handleNextStep = () => {
      const stepKeywords: string[] = [];
      QUESTIONS[quizStep].options.forEach(opt => { if (selectedOptions.includes(opt.label)) stepKeywords.push(...opt.keywords); });
      const newKw = [...allKeywords, ...stepKeywords]; 
      setAllKeywords(newKw); 
      setSelectedOptions([]);
      
      if (quizStep < QUESTIONS.length - 1) {
          setQuizStep(prev => prev + 1); 
      } else {
          calculateMatches(newKw);
      }
  };

  const calculateMatches = async (finalKeywords: string[]) => {
      const keywordWeight = new Map<string, number>();
      finalKeywords.forEach((keyword) => {
          const normalized = normalizeLeagueText(keyword);
          if (!normalized) return;
          keywordWeight.set(normalized, (keywordWeight.get(normalized) ?? 0) + 1);
      });

      const totalWeight = Array.from(keywordWeight.values()).reduce((sum, value) => sum + value, 0);

      const scored = leagues
        .map((league) => {
          const profile = resolveLeagueProfile(league);
          const leagueText = normalizeLeagueText(
            `${league.nome || ""} ${league.sigla || ""} ${league.descricao || ""}`
          );

          const profileKeywords = new Set<string>();
          if (profile) {
            [profile.nome, profile.sigla || "", ...(profile.aliases ?? []), ...profile.keywords]
              .flatMap((entry) => splitLeagueTokens(entry))
              .forEach((token) => {
                profileKeywords.add(token);
              });
          }

          splitLeagueTokens(leagueText).forEach((token) => {
            profileKeywords.add(token);
          });

          const profileKeywordsArray = Array.from(profileKeywords);
          let score = 0;

          keywordWeight.forEach((weight, selectedKeyword) => {
            const expanded = expandLeagueKeyword(selectedKeyword);

            const matchedByProfile = expanded.some((candidate) =>
              profileKeywordsArray.some(
                (profileKeyword) =>
                  profileKeyword.includes(candidate) || candidate.includes(profileKeyword)
              )
            );

            const matchedByText = expanded.some((candidate) => leagueText.includes(candidate));

            if (matchedByProfile || matchedByText) {
              score += weight;
            }
          });

          const percent = totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
          return {
            ...league,
            matchScore: score,
            matchPercent: Math.max(0, Math.min(100, percent)),
          };
        })
        .sort((left, right) => {
          const percentDiff = (right.matchPercent || 0) - (left.matchPercent || 0);
          if (percentDiff !== 0) return percentDiff;
          const scoreDiff = (right.matchScore || 0) - (left.matchScore || 0);
          if (scoreDiff !== 0) return scoreDiff;
          return (right.likes || 0) - (left.likes || 0);
        });

      setTopMatches(scored);
      setShowQuizResult(true);

      const topPositive = scored.find((item) => (item.matchScore || 0) > 0);
      const topMatchName = topPositive?.nome || "Nenhum";

      if (user) {
          try {
              await addLeagueQuizHistory({
                  userId: user.uid,
                  topMatch: topMatchName,
                  keywords: finalKeywords,
              });
          } catch (error: unknown) {
              console.error("Falha ao gravar histórico do quiz:", error);
          }

          logActivity(
              user.uid,
              user.nome || "Atleta",
              "QUIZ",
              "Oráculo",
              `Realizou o quiz. Top Match: ${topMatchName}`
          );
      }
  };

  const getRankStyle = (i: number) => i === 0 ? "border-yellow-500 shadow-yellow-500/20" : i === 1 ? "border-zinc-400" : i === 2 ? "border-orange-700" : "border-zinc-800";
  
  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 font-sans pb-24">
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
            <Link href="/dashboard" className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400"/></Link>
            <div><h1 className="text-2xl font-black uppercase flex items-center gap-2">Ligas <span className="text-emerald-500">Unitau</span></h1><p className="text-[10px] font-bold text-zinc-500 uppercase">Ecossistema Acadêmico</p></div>
        </div>
        <Link href="/ligas" className="bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-800 transition">Gerenciar</Link>
      </header>

      {loading ? (
        <div className="h-60 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-emerald-500 mb-2 w-8 h-8"/>
            <p className="text-xs uppercase font-bold text-zinc-500">Carregando Ligas...</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* QUIZ SECTION */}
        <div className={`bg-gradient-to-br from-indigo-900/40 via-zinc-900 to-zinc-900 border border-indigo-500/30 rounded-3xl p-6 min-h-[350px] ${showQuizResult ? 'col-span-1 md:col-span-2' : ''}`}>
            {!showQuizResult ? (
                <>
                    <div className="mb-4"><span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1"><Brain size={12}/> Oráculo</span><h3 className="text-lg font-black italic">{QUESTIONS[quizStep].text}</h3><p className="text-[10px] text-zinc-500">Selecione até 3 opções:</p></div>
                    <div className="space-y-2">{QUESTIONS[quizStep].options.map((opt, i) => (<button key={i} onClick={() => toggleOption(opt.keywords, opt.label)} className={`w-full text-left px-4 py-3 rounded-xl border text-xs font-bold transition flex justify-between ${selectedOptions.includes(opt.label) ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/50' : 'bg-black/40 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>{opt.label} {selectedOptions.includes(opt.label) && <CheckCircle2 size={14}/>}</button>))}</div>
                    <div className="mt-6 flex justify-between items-center"><div className="flex gap-1">{QUESTIONS.map((_, i) => <div key={i} className={`h-1 w-6 rounded-full transition-all ${i <= quizStep ? 'bg-indigo-500' : 'bg-zinc-800'}`}/>)}</div><button onClick={handleNextStep} disabled={selectedOptions.length === 0} className="bg-white hover:bg-zinc-200 text-indigo-900 px-6 py-2 rounded-xl text-xs font-black uppercase disabled:opacity-50 transition shadow-lg">Próxima</button></div>
                </>
            ) : (
                <div className="space-y-4 animate-in fade-in">
                    <div className="flex justify-between items-center"><h2 className="text-xl font-black italic flex items-center gap-2"><Trophy className="text-yellow-500"/> Compatibilidade por Liga</h2><button onClick={() => {setQuizStep(0); setShowQuizResult(false); setSelectedOptions([]); setAllKeywords([]); setTopMatches([]);}} className="text-xs text-zinc-500 hover:text-white flex items-center gap-1"><RotateCcw size={12}/> Refazer</button></div>
                    {topMatches.length > 0 && topMatches.every((league) => (league.matchPercent || 0) === 0) && (
                      <p className="text-xs text-zinc-500 italic">Nenhuma liga teve compatibilidade acima de 0% com este perfil.</p>
                    )}
                    {topMatches.length === 0 ? <p className="text-xs text-zinc-500 italic">Nenhuma liga cadastrada para comparar.</p> : topMatches.map((l, i) => (
                        <div key={l.id} onClick={() => { void openLeagueDetails(l); }} className="flex items-center gap-4 bg-black/40 p-3 rounded-xl border border-indigo-500/30 cursor-pointer hover:bg-indigo-900/20 transition group">
                            <span className="font-black text-lg text-indigo-800 w-6 text-center group-hover:text-indigo-500">{i+1}</span>
                            <Image
                              src={l.logoBase64 || "https://github.com/shadcn.png"}
                              alt={l.nome}
                              width={48}
                              height={48}
                              className="w-12 h-12 rounded-full object-cover border border-indigo-500/20"
                              
                            />
                            <div className="flex-1"><h4 className="font-bold text-sm text-white">{l.nome}</h4><div className="w-full bg-zinc-800 h-1.5 rounded-full mt-1 overflow-hidden"><div className="h-full bg-indigo-500 transition-all duration-1000" style={{width: `${l.matchPercent}%`}}/></div></div>
                            <span className="text-xs font-black text-indigo-400">{l.matchPercent}%</span>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* LISTA DE LIGAS */}
        {leagues.map((l, i) => (
            <div key={l.id} onClick={() => { void openLeagueDetails(l); }} className={`relative rounded-3xl p-1 border transition hover:scale-[1.02] cursor-pointer flex flex-col h-[320px] shadow-2xl ${getRankStyle(i)}`}>
                <div className="h-40 w-full bg-black rounded-t-[20px] overflow-hidden relative shrink-0">
                    <Image
                      src={l.logoBase64 || "https://github.com/shadcn.png"}
                      alt={l.nome}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-cover opacity-60 transition duration-500 hover:opacity-80"
                      
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050505] to-transparent"/>
                    <div className="absolute bottom-2 left-4"><h2 className="text-3xl font-black italic uppercase tracking-tighter text-white drop-shadow-md">{l.sigla}</h2></div>
                </div>
                <div className="p-4 bg-[#050505] rounded-b-[20px] flex-1 flex flex-col justify-between">
                    <p className="text-xs text-zinc-500 line-clamp-3 leading-relaxed">{l.descricao || "Sem descrição disponível."}</p>
                    <div className="flex justify-between items-center border-t border-zinc-800 pt-3 mt-auto">
                        <div className="flex items-center gap-1 text-zinc-400"><Users size={14} className="text-emerald-500"/><span className="text-[10px] font-bold uppercase">Membros: {l.membrosIds?.length || l.membros?.length || 0}</span></div>
                        <button onClick={(e) => handleLike(e, l.id)} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-red-500 hover:border-red-500/50 transition active:scale-95"><Heart size={14} className={likedLeagues.includes(l.id) ? "fill-current text-red-500" : ""}/><span className="text-xs font-black">{l.likes || 0}</span></button>
                    </div>
                </div>
            </div>
        ))}
      </div>
      )}

      {/* MODAL DETALHES */}
      {selectedLeague && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto animate-in zoom-in-95">
              <div className="bg-zinc-950 w-full max-w-2xl rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl relative flex flex-col max-h-[90vh]">
                  <button onClick={() => setSelectedLeague(null)} className="absolute top-4 right-4 z-20 p-2 bg-black/50 rounded-full hover:bg-red-500 text-white transition"><X size={20}/></button>
                  
                  {/* Banner Modal */}
                  <div className="h-40 bg-zinc-900 relative shrink-0">
                      <Image
                        src={selectedLeague.logoBase64 || "https://github.com/shadcn.png"}
                        alt="Logo"
                        fill
                        sizes="(max-width: 768px) 100vw, 672px"
                        className="object-cover opacity-50"
                        
                      />
                      <div className="absolute bottom-4 left-6">
                          <h1 className="text-4xl font-black italic text-white drop-shadow-lg">{selectedLeague.sigla}</h1>
                          <p className="text-sm font-bold text-emerald-500 uppercase tracking-widest">{selectedLeague.nome}</p>
                      </div>
                  </div>

                  <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                      {loadingSelectedLeague && (
                          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex items-center gap-2 text-zinc-400 text-xs">
                              <Loader2 size={14} className="animate-spin text-emerald-500" />
                              Carregando detalhes da liga...
                          </div>
                      )}

                      {/* BIZU */}
                      {selectedLeague.bizu && (
                          <div className="bg-yellow-900/10 border-l-4 border-yellow-500 p-4 rounded-r-xl">
                              <h3 className="text-xs font-black text-yellow-500 uppercase flex gap-2 mb-1"><Lightbulb size={14}/> Bizu da Liga</h3>
                              <p className="text-sm italic text-zinc-300">&quot;{selectedLeague.bizu}&quot;</p>
                          </div>
                      )}

                      {/* DESCRIÇÃO */}
                      <div><h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-1 mb-2">Sobre</h3><p className="text-sm text-zinc-300 leading-relaxed">{selectedLeague.descricao || "Nenhuma descrição informada."}</p></div>
                      
                      {/* MEMBROS */}
                      {selectedLeague.membros && selectedLeague.membros.length > 0 && (
                          <div>
                              <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-1 mb-3">Diretoria ({selectedLeague.membros.length})</h3>
                              <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                                  {selectedLeague.membros.map((m, i) => (
                                      <Link key={i} href={m.linkPerfil || "#"} className="flex flex-col items-center min-w-[80px] group">
                                          <div className="w-14 h-14 rounded-full border border-zinc-700 overflow-hidden group-hover:border-emerald-500 transition">
                                              <Image
                                                src={m.foto || "https://github.com/shadcn.png"}
                                                alt={m.nome}
                                                width={56}
                                                height={56}
                                                className="w-full h-full object-cover"
                                                
                                              />
                                          </div>
                                          <p className="text-[10px] font-bold mt-2 text-center truncate w-full text-zinc-300 group-hover:text-white">{m.nome}</p>
                                          <p className="text-[9px] text-emerald-500 uppercase font-bold">{m.cargo}</p>
                                      </Link>
                                  ))}
                              </div>
                          </div>
                      )}

                      {/* EVENTOS */}
                      <div>
                          <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-1 mb-3">Agenda</h3>
                          {selectedLeague.eventos && selectedLeague.eventos.length > 0 ? (
                              <div className="space-y-2">
                                  {selectedLeague.eventos.map((ev, i) => (
                                      <Link key={i} href={ev.linkEvento || "#"} className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center gap-4 hover:border-emerald-500 transition group">
                                          <div className="bg-emerald-900/30 text-emerald-500 p-2 rounded-lg group-hover:scale-110 transition"><Calendar size={20}/></div>
                                          <div><h4 className="font-bold text-sm text-white group-hover:text-emerald-400">{ev.titulo}</h4><p className="text-xs text-zinc-400">{ev.data} • {ev.local}</p></div>
                                      </Link>
                                  ))}
                              </div>
                          ) : (
                              <p className="text-xs text-zinc-600 italic border border-dashed border-zinc-800 p-3 rounded-lg text-center">Sem eventos programados.</p>
                          )}
                      </div>
                  </div>
                  
                  {/* FOOTER */}
                  <div className="p-4 border-t border-zinc-800 bg-zinc-900 flex justify-between items-center shrink-0">
                      <span className="text-xs font-bold text-zinc-500 flex gap-2 items-center"><Heart size={14} className="text-red-500 fill-red-500"/> {selectedLeague.likes || 0} Curtidas</span>
                      <button onClick={() => { 
                          const action = isJoined ? "UNFOLLOW" : "FOLLOW";
                          setIsJoined(!isJoined); 
                          // --- CORREÇÃO DO LOG ---
                          logActivity(
                              user?.uid || 'guest', 
                              user?.nome || 'Atleta',
                              action,
                              "Ligas",
                              `${isJoined ? 'Deixou de seguir' : 'Seguiu'} a liga ${selectedLeague.sigla}`
                          ); 
                      }} className={`px-6 py-3 rounded-xl text-xs font-black uppercase transition shadow-lg ${isJoined ? 'bg-zinc-800 text-zinc-400 hover:bg-red-500/10 hover:text-red-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}>
                          {isJoined ? "Seguindo" : "Seguir Liga"}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
