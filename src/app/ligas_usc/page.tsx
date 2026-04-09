// src/app/ligas_usc/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Heart, X, Calendar, 
  Lightbulb, Trophy, ArrowLeft, Users, Loader2, Brain, CheckCircle2, RotateCcw 
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "../../context/TenantThemeContext";
import { logActivity } from "../../lib/logger"; 
import {
  LEAGUE_QUIZ_PROFILES,
  type LeagueQuizProfile,
  type LeagueQuizQuestionKey,
} from "../../constants/leagueQuizProfiles";
import {
  addLeagueQuizHistory,
  changeLeagueLikeCount,
  fetchLeagueSummaries,
  LEAGUE_NAME_MAX_LENGTH,
  resolveFollowedLeagueIdsFromUserExtra,
  toggleUserLeagueFollow,
  type LeagueRecord,
} from "../../lib/leaguesService";
import { resolveLeagueLogoSrc } from "../../lib/leagueMedia";
import {
  DEFAULT_LIGAS_USC_UI_CONFIG,
  fetchLigasUscUiConfig,
} from "../../lib/ligasUscUiService";
import { withTenantSlug } from "../../lib/tenantRouting";

// --- 1. INTERFACES (Fim dos 'any') ---

interface League extends LeagueRecord {
    matchPercent?: number; 
    matchScore?: number;
}

interface QuizOption {
    label: string;
    keywords: string[];
}

interface QuizQuestion {
    id: number;
    key: LeagueQuizQuestionKey;
    text: string;
    options: QuizOption[];
}

type QuizAnswers = Partial<Record<LeagueQuizQuestionKey, string[]>>;
const QUIZ_DIRECT_MATCH_WEIGHT = 3;
const getLeagueLogoSrc = (league?: League | null): string =>
  resolveLeagueLogoSrc(league, "/placeholder_liga.png");

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

const clampLeagueCardName = (value: string): string => {
  const cleanValue = value.trim();
  if (cleanValue.length <= LEAGUE_NAME_MAX_LENGTH) return cleanValue;

  const slicedValue = cleanValue.slice(0, LEAGUE_NAME_MAX_LENGTH + 1);
  const lastSpaceIndex = slicedValue.lastIndexOf(" ");
  const cutIndex =
    lastSpaceIndex >= Math.floor(LEAGUE_NAME_MAX_LENGTH * 0.6)
      ? lastSpaceIndex
      : LEAGUE_NAME_MAX_LENGTH;

  return `${slicedValue.slice(0, cutIndex).trim()}...`;
};

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
  gastro: ["digestiva", "endoscopia"],
  simulacao: ["treinamento", "cenario"],
  militar: ["resgate", "estrategia"],
  anatomia: ["disseccao", "morfologia"],
  humanidades: ["social", "escuta"],
  otorrino: ["vias aereas", "ouvido", "garganta"],
  laparoscopia: ["robotica", "cirurgia"],
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

const QUESTIONS: QuizQuestion[] = [
    {
        id: 1,
        key: "scenario",
        text: "Qual cen\u00e1rio faz seus olhos brilharem?",
        options: [
            { label: "Centro Cir\u00fargico", keywords: ["trauma", "cirurgia", "laparoscopia", "robotica", "ortopedia"] },
            { label: "Emerg\u00eancia", keywords: ["emergencia", "urgencia", "trauma", "intensiva", "resgate"] },
            { label: "Consult\u00f3rio", keywords: ["clinica", "endocrino", "dermato", "gastro", "ambulatorio"] },
            { label: "Comunidade", keywords: ["familia", "comunidade", "pediatria", "gineco", "humanidades"] },
            { label: "Laborat\u00f3rio", keywords: ["patologia", "radiologia", "genetica", "anatomia", "simulacao"] },
        ],
    },
    {
        id: 2,
        key: "audience",
        text: "Com qual p\u00fablico voc\u00ea tem mais afinidade?",
        options: [
            { label: "Crian\u00e7as", keywords: ["pediatria", "neonatologia", "infancia"] },
            { label: "Mulheres", keywords: ["gineco", "obstetricia", "saude da mulher"] },
            { label: "Adultos", keywords: ["geriatria", "clinica", "cardio", "oncologia"] },
            { label: "Graves", keywords: ["intensiva", "anestesiologia", "trauma", "urgencia"] },
            { label: "Atletas", keywords: ["esportiva", "ortopedia", "performance"] },
        ],
    },
    {
        id: 3,
        key: "system",
        text: "Qual sistema te fascina?",
        options: [
            { label: "C\u00e9rebro", keywords: ["neuro", "psiquiatria", "neurologia"] },
            { label: "Cora\u00e7\u00e3o", keywords: ["cardio", "coracao", "cardiovascular"] },
            { label: "Ossos", keywords: ["ortopedia", "anatomia", "ossos"] },
            { label: "Horm\u00f4nios", keywords: ["gastro", "endocrino", "metabolismo", "obstetricia"] },
            { label: "Rins", keywords: ["nefro", "urologia", "rins"] },
        ],
    },
    {
        id: 4,
        key: "style",
        text: "Qual \u00e9 o seu estilo de pr\u00e1tica?",
        options: [
            { label: "Manual", keywords: ["cirurgia", "trauma", "procedimento", "tecnica"] },
            { label: "Racioc\u00ednio", keywords: ["clinica", "diagnostico", "investigacao"] },
            { label: "Preven\u00e7\u00e3o", keywords: ["familia", "pediatria", "promocao", "saude coletiva"] },
            { label: "Tecnologia", keywords: ["radiologia", "cardio", "robotica", "simulacao"] },
            { label: "Gest\u00e3o", keywords: ["legal", "trabalho", "militar", "organizacao"] },
        ],
    },
    {
        id: 5,
        key: "impact",
        text: "Qual impacto voc\u00ea mais quer causar?",
        options: [
            { label: "Salvar vidas", keywords: ["emergencia", "trauma", "ressuscitacao", "uti"] },
            { label: "Paci\u00eancia", keywords: ["psiquiatria", "oncologia", "seguimento"] },
            { label: "Detalhe", keywords: ["oftalmo", "dermato", "microcirurgia", "precisao"] },
            { label: "Curiosidade", keywords: ["genetica", "patologia", "anatomia", "simulacao"] },
            { label: "V\u00ednculo", keywords: ["familia", "onco", "comunidade", "acolhimento"] },
        ],
    },
];

export default function LigasUscPage() {
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const router = useRouter();
  const cleanTenantSlug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";
  const [pageConfig, setPageConfig] = useState(DEFAULT_LIGAS_USC_UI_CONFIG);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [loadingSelectedLeague, setLoadingSelectedLeague] = useState(false);
  const [likedLeagues, setLikedLeagues] = useState<string[]>([]);
  const [isJoined, setIsJoined] = useState(false); 
  const [followedLeagueIds, setFollowedLeagueIds] = useState<string[]>([]);

  // Quiz
  const [quizStep, setQuizStep] = useState(0);
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<QuizAnswers>({});
  const [quizKeywords, setQuizKeywords] = useState<string[]>([]);
  const [topMatches, setTopMatches] = useState<League[]>([]);
  const tenantPath = (path: string): string =>
    cleanTenantSlug ? withTenantSlug(cleanTenantSlug, path) : path;

  useEffect(() => {
    let mounted = true;
    const loadLeagues = async () => {
      setLoading(true);
      try {
        const data = await fetchLeagueSummaries({
          orderByField: "likes",
          orderDirection: "desc",
          maxResults: 60,
          tenantId: tenantId || undefined,
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
  }, [tenantId]);

  useEffect(() => {
    let mounted = true;

    const loadPageConfig = async () => {
      try {
        const config = await fetchLigasUscUiConfig({
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setPageConfig(config);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) setPageConfig(DEFAULT_LIGAS_USC_UI_CONFIG);
      }
    };

    void loadPageConfig();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    setFollowedLeagueIds(resolveFollowedLeagueIdsFromUserExtra(user?.extra, tenantId));
  }, [tenantId, user?.extra]);

  useEffect(() => {
    if (!selectedLeague) return;
    setIsJoined(followedLeagueIds.includes(selectedLeague.id));
  }, [followedLeagueIds, selectedLeague]);

  const openLeagueDetails = async (league: League): Promise<void> => {
      setLoadingSelectedLeague(true);
      router.push(tenantPath(`/ligas_usc/${league.id}`));
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
          tenantId: tenantId || undefined,
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

  const toggleOption = (label: string) => {
      if (selectedOptions.includes(label)) setSelectedOptions(prev => prev.filter(o => o !== label));
      else if (selectedOptions.length < 3) setSelectedOptions(prev => [...prev, label]);
  };

  const handleNextStep = () => {
      const currentQuestion = QUESTIONS[quizStep];
      const selectedQuestionOptions = currentQuestion.options.filter((option) =>
        selectedOptions.includes(option.label)
      );
      const stepKeywords = selectedQuestionOptions.flatMap((option) => option.keywords);
      const nextAnswers: QuizAnswers = {
        ...quizAnswers,
        [currentQuestion.key]: selectedQuestionOptions.map((option) => option.label),
      };
      const nextKeywords = [...quizKeywords, ...stepKeywords];

      setQuizAnswers(nextAnswers);
      setQuizKeywords(nextKeywords);
      setSelectedOptions([]);
      
      if (quizStep < QUESTIONS.length - 1) {
          setQuizStep(prev => prev + 1); 
      } else {
          void calculateMatches(nextAnswers, nextKeywords);
      }
  };

  const calculateMatches = async (answers: QuizAnswers, finalKeywords: string[]) => {
      const keywordWeight = new Map<string, number>();
      finalKeywords.forEach((keyword) => {
          const normalized = normalizeLeagueText(keyword);
          if (!normalized) return;
          keywordWeight.set(normalized, (keywordWeight.get(normalized) ?? 0) + 1);
      });

      const keywordTotalWeight = Array.from(keywordWeight.values()).reduce((sum, value) => sum + value, 0);
      const selectedAnswerCount = Object.values(answers).reduce(
        (sum, selections) => sum + (selections?.length ?? 0),
        0
      );
      const totalWeight = keywordTotalWeight + (selectedAnswerCount * QUIZ_DIRECT_MATCH_WEIGHT);

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
          let keywordScore = 0;
          let answerScore = 0;

          if (profile) {
            QUESTIONS.forEach((question) => {
              const selectedAnswers = answers[question.key] ?? [];
              const profileAnswers = profile.quizAnswers[question.key] ?? [];

              selectedAnswers.forEach((selectedAnswer) => {
                const normalizedSelectedAnswer = normalizeLeagueText(selectedAnswer);
                const matched = profileAnswers.some(
                  (profileAnswer) =>
                    normalizeLeagueText(profileAnswer) === normalizedSelectedAnswer
                );

                if (matched) {
                  answerScore += QUIZ_DIRECT_MATCH_WEIGHT;
                }
              });
            });
          }

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
              keywordScore += weight;
            }
          });

          const score = answerScore + keywordScore;
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

      setTopMatches(scored.slice(0, 5));
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

  const handleFollowFromCard = async (e: React.MouseEvent, league: League) => {
      e.stopPropagation();
      if (!user) return;

      const isCurrentlyFollowing = followedLeagueIds.includes(league.id);
      const previousFollowedIds = followedLeagueIds;
      const nextFollowedIds = isCurrentlyFollowing
        ? previousFollowedIds.filter((entry) => entry !== league.id)
        : Array.from(new Set([...previousFollowedIds, league.id]));

      setFollowedLeagueIds(nextFollowedIds);

      try {
        await toggleUserLeagueFollow({
          leagueId: league.id,
          userId: user.uid,
          currentlyFollowing: isCurrentlyFollowing,
          tenantId: tenantId || undefined,
        });
        void logActivity(
          user.uid,
          user.nome || "Atleta",
          isCurrentlyFollowing ? "UNFOLLOW" : "FOLLOW",
          "Ligas",
          `${isCurrentlyFollowing ? "Parou de seguir" : "Seguiu"} a liga ${league.sigla || league.nome}`
        );
      } catch (error: unknown) {
        console.error(error);
        setFollowedLeagueIds(previousFollowedIds);
      }
  };

  const getRankStyle = (i: number) => i === 0 ? "border-yellow-500 shadow-yellow-500/20" : i === 1 ? "border-zinc-400" : i === 2 ? "border-orange-700" : "border-zinc-800";
  
  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 font-sans pb-24">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
            <Link href={tenantPath("/dashboard")} className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400"/></Link>
            <div className="pt-1">
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                {pageConfig.titulo}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-zinc-400 sm:text-base">
                {pageConfig.subtitulo}
              </p>
            </div>
        </div>
        <Link href={tenantPath("/ligas")} className="bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-800 transition">Gerenciar</Link>
      </header>

      {loading ? (
        <div className="h-60 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-emerald-500 mb-2 w-8 h-8"/>
            <p className="text-xs uppercase font-bold text-zinc-500">Carregando ligas...</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* QUIZ SECTION */}
        <div className={`bg-gradient-to-br from-indigo-900/40 via-zinc-900 to-zinc-900 border border-indigo-500/30 rounded-3xl p-6 min-h-[350px] ${showQuizResult ? 'col-span-1 md:col-span-2' : ''}`}>
            {!showQuizResult ? (
                <>
                    <div className="mb-4"><span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1"><Brain size={12}/> {"Or\u00e1culo"}</span><h3 className="text-lg font-black italic">{QUESTIONS[quizStep].text}</h3><p className="text-[10px] text-zinc-500">{"Selecione at\u00e9 3 op\u00e7\u00f5es:"}</p></div>
                    <div className="space-y-2">{QUESTIONS[quizStep].options.map((opt, i) => (<button key={i} onClick={() => toggleOption(opt.label)} className={`w-full text-left px-4 py-3 rounded-xl border text-xs font-bold transition flex justify-between ${selectedOptions.includes(opt.label) ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/50' : 'bg-black/40 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>{opt.label} {selectedOptions.includes(opt.label) && <CheckCircle2 size={14}/>}</button>))}</div>
                    <div className="mt-6 flex justify-between items-center"><div className="flex gap-1">{QUESTIONS.map((_, i) => <div key={i} className={`h-1 w-6 rounded-full transition-all ${i <= quizStep ? 'bg-indigo-500' : 'bg-zinc-800'}`}/>)}</div><button onClick={handleNextStep} disabled={selectedOptions.length === 0} className="bg-white hover:bg-zinc-200 text-indigo-900 px-6 py-2 rounded-xl text-xs font-black uppercase disabled:opacity-50 transition shadow-lg">{"Pr\u00f3xima"}</button></div>
                </>
            ) : (
                <div className="space-y-4 animate-in fade-in">
                    <div className="flex justify-between items-center"><h2 className="text-xl font-black italic flex items-center gap-2"><Trophy className="text-yellow-500"/> Compatibilidade por Liga</h2><button onClick={() => {setQuizStep(0); setShowQuizResult(false); setSelectedOptions([]); setQuizAnswers({}); setQuizKeywords([]); setTopMatches([]);}} className="text-xs text-zinc-500 hover:text-white flex items-center gap-1"><RotateCcw size={12}/> Refazer</button></div>
                    {topMatches.length > 0 && topMatches.every((league) => (league.matchPercent || 0) === 0) && (
                      <p className="text-xs text-zinc-500 italic">Nenhuma liga teve compatibilidade acima de 0% com este perfil.</p>
                    )}
                    {topMatches.length === 0 ? <p className="text-xs text-zinc-500 italic">Nenhuma liga cadastrada para comparar.</p> : topMatches.map((l, i) => (
                        <div key={l.id} onClick={() => { void openLeagueDetails(l); }} className="flex items-center gap-4 bg-black/40 p-3 rounded-xl border border-indigo-500/30 cursor-pointer hover:bg-indigo-900/20 transition group">
                            <span className="font-black text-lg text-indigo-800 w-6 text-center group-hover:text-indigo-500">{i+1}</span>
                            <Image
                              src={getLeagueLogoSrc(l)}
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
            <div key={l.id} onClick={() => { void openLeagueDetails(l); }} className={`relative overflow-hidden rounded-[2rem] border transition hover:scale-[1.01] cursor-pointer flex flex-col shadow-2xl ${getRankStyle(i)}`}>
                <div className="relative h-44 w-full bg-black shrink-0">
                    <Image
                      src={getLeagueLogoSrc(l)}
                      alt={l.nome}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-cover opacity-70 transition duration-500 hover:opacity-85"
                      
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.12),rgba(5,5,5,0.96))]"/>
                    <div className="absolute left-4 top-4 flex items-center gap-3">
                        <div className="relative h-16 w-16 overflow-hidden rounded-[1.35rem] border border-white/15 bg-black/40 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                            <Image
                              src={getLeagueLogoSrc(l)}
                              alt={l.nome}
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">
                              {pageConfig.rotuloCard}
                            </p>
                            <h2 title={l.nome} className="line-clamp-2 text-lg font-black uppercase leading-tight tracking-tight text-white sm:text-xl">
                              {clampLeagueCardName(l.nome)}
                            </h2>
                            <p className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200">{l.sigla || l.nome}</p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-1 flex-col bg-[#050505] p-5">
                    <p className="text-xs text-zinc-500 line-clamp-3 leading-relaxed">{l.descricao || "Sem descri\u00e7\u00e3o dispon\u00edvel."}</p>
                    {l.bizu ? (
                        <div className="mt-4 rounded-[1.4rem] border border-amber-500/20 bg-amber-500/10 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">Bizu da liga</p>
                            <p className="mt-2 text-xs leading-5 text-amber-50/90 line-clamp-2">{l.bizu}</p>
                        </div>
                    ) : null}
                    <div className="mt-4 flex items-center gap-2 text-zinc-300">
                        <Users size={15} className="text-emerald-400"/>
                        <span className="text-[11px] font-black uppercase tracking-[0.2em]">
                            {l.membersCount ?? l.membros?.length ?? 0} membros
                        </span>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4">
                        <button onClick={(e) => handleLike(e, l.id)} className="flex items-center justify-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-300 hover:text-red-400 hover:border-red-500/40 transition active:scale-95">
                            <Heart size={14} className={likedLeagues.includes(l.id) ? "fill-current text-red-500" : ""}/>
                            <span className="text-[11px] font-black uppercase">{l.likes || 0}</span>
                        </button>
                        <button
                          onClick={(e) => void handleFollowFromCard(e, l)}
                          className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase transition ${
                            followedLeagueIds.includes(l.id)
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"
                          }`}
                        >
                          {followedLeagueIds.includes(l.id) ? "Seguindo" : "Seguir"}
                        </button>
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
                        src={getLeagueLogoSrc(selectedLeague)}
                        alt="Logo"
                        fill
                        sizes="(max-width: 768px) 100vw, 672px"
                        className="object-cover opacity-50"
                        
                      />
                      <div className="absolute bottom-4 left-6">
                          <h1 className="text-4xl font-black italic text-white drop-shadow-lg">{selectedLeague.sigla || selectedLeague.nome}</h1>
                          <p className="text-sm font-bold text-emerald-500 uppercase tracking-widest">{selectedLeague.nome}</p>
                      </div>
                  </div>

                  <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                      {loadingSelectedLeague && (
                          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex items-center gap-2 text-zinc-400 text-xs">
                              <Loader2 size={14} className="animate-spin text-emerald-500" />
                              {"Carregando detalhes da liga..."}
                          </div>
                      )}

                      {/* BIZU */}
                      {selectedLeague.bizu && (
                          <div className="bg-yellow-900/10 border-l-4 border-yellow-500 p-4 rounded-r-xl">
                              <h3 className="text-xs font-black text-yellow-500 uppercase flex gap-2 mb-1"><Lightbulb size={14}/> Destaque da Liga</h3>
                              <p className="text-sm italic text-zinc-300">&quot;{selectedLeague.bizu}&quot;</p>
                          </div>
                      )}

                      {/* DESCRICAO */}
                      <div><h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-1 mb-2">Sobre</h3><p className="text-sm text-zinc-300 leading-relaxed">{selectedLeague.descricao || "Nenhuma descri\u00e7\u00e3o informada."}</p></div>
                      
                      {/* MEMBROS */}
                      {selectedLeague.membros && selectedLeague.membros.length > 0 && (
                          <div>
                              <h3 className="text-xs font-bold text-zinc-500 uppercase border-b border-zinc-800 pb-1 mb-3">Diretoria ({selectedLeague.membros.length})</h3>
                              <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                                  {selectedLeague.membros.map((m, i) => (
                                      <Link key={i} href={m.linkPerfil?.startsWith("/") ? tenantPath(m.linkPerfil) : (m.linkPerfil || "#")} className="flex flex-col items-center min-w-[80px] group">
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
                                      <Link key={i} href={ev.linkEvento?.startsWith("/") ? tenantPath(ev.linkEvento) : (ev.linkEvento || "#")} className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center gap-4 hover:border-emerald-500 transition group">
                                          <div className="bg-emerald-900/30 text-emerald-500 p-2 rounded-lg group-hover:scale-110 transition"><Calendar size={20}/></div>
                                          <div><h4 className="font-bold text-sm text-white group-hover:text-emerald-400">{ev.titulo}</h4><p className="text-xs text-zinc-400">{ev.data} {"\u2022"} {ev.local}</p></div>
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
                          if (!user || !selectedLeague) return;
                          const action = isJoined ? "UNFOLLOW" : "FOLLOW";
                          const nextJoined = !isJoined;
                          const previousFollowedIds = followedLeagueIds;
                          const nextFollowedIds = nextJoined
                            ? Array.from(new Set([...previousFollowedIds, selectedLeague.id]))
                            : previousFollowedIds.filter((entry) => entry !== selectedLeague.id);

                          setIsJoined(nextJoined);
                          setFollowedLeagueIds(nextFollowedIds);

                          void toggleUserLeagueFollow({
                              leagueId: selectedLeague.id,
                              userId: user.uid,
                              currentlyFollowing: isJoined,
                              tenantId: tenantId || undefined,
                          }).catch((error: unknown) => {
                              console.error(error);
                              setIsJoined(isJoined);
                              setFollowedLeagueIds(previousFollowedIds);
                          });

                          logActivity(
                              user.uid,
                              user.nome || 'Atleta',
                              action,
                              "Ligas",
                              `${isJoined ? 'Deixou de seguir' : 'Seguiu'} a liga ${selectedLeague.sigla || selectedLeague.nome}`
                          );
                          if (Date.now() < 0) {
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
                          }
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
