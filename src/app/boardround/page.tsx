"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Dice5, MapPin, Building2, AlertTriangle, XCircle, Lock, 
  TrendingUp, DollarSign, ArrowLeft, HelpCircle, 
  Wrench, Trophy, Heart, ChevronLeft, ChevronRight, Loader2, BarChart3
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from "../../context/ToastContext"; 
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { logActivity } from "../../lib/logger";
import {
  fetchActiveSharkroundLeagues,
  fetchSharkroundPlayersPreview,
  fetchSharkroundTubasRanking,
} from "../../lib/sharkroundGameService";
import {
  fetchSharkroundAppConfig,
  getSharkroundDisplayName,
  getDefaultSharkroundAppConfig,
  type SharkroundAppConfig,
} from "../../lib/sharkroundConfigService";
import { withTenantSlug } from "@/lib/tenantRouting";

// --- TIPAGENS ---
type TipoCasa = 'LIGA' | 'SORTE' | 'AZAR' | 'PRISAO' | 'INICIO';
type NivelConstrucao = 'TERRENO' | 'CLINICA_GERAL' | 'CENTRO_ESPECIALIDADES' | 'CENTRO_MULTIPROFISSIONAL' | 'HOSPITAL_UNIVERSITARIO' | 'CENTRO_EXCELENCIA' | 'MINISTERIO_SAUDE';

interface ModalEventoData {
    titulo: string;
    msg: string;
    tipo: 'success' | 'error' | 'info';
    move?: number;
    isJail?: boolean;
}

interface Pergunta { 
    id: string; 
    texto: string; 
    alternativas: string[]; 
    respostaCorreta: number; 
    imagemBase64?: string; 
}

interface LigaConfig {
    id: string;
    nome: string;
    sigla?: string;
    logoBase64?: string;
    perguntas: Pergunta[];
    ativa?: boolean;
}

interface Jogador { id: string; nome: string; avatar: string; posicao: number; tubas: number; jogadasRestantes: number; preso: boolean; rodadasPreso: number; questoesAcertadasCiclo: number; coracoes: number; }
interface OutroJogador { id: string; nome: string; avatar: string; posicao: number; preso: boolean; coracoes: number; }
interface Socio { uid: string; nome: string; nivel: NivelConstrucao; }
interface CasaTabuleiro { index: number; tipo: TipoCasa; titulo: string; sigla?: string; descricao?: string; cor: string; donoId?: string; socios?: Socio[]; nivel?: NivelConstrucao; backgroundImage?: string; ligaId?: string; } 
interface RankingItem { id: string; nome: string; foto: string; tubas: number; }

interface SharkroundStats {
  clinicas: number;
  acertos: number;
  erros: number;
}

const SHARKROUND_STATS_STORAGE_KEY = "sharkround_local_stats_v1";
const SHARKROUND_ALLOWED_ROLES = new Set(["master", "admin_geral", "admin_gestor"]);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;

  if (typeof error === "object" && error !== null) {
    const raw = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const details = [
      typeof raw.message === "string" ? raw.message : "",
      typeof raw.details === "string" ? raw.details : "",
      typeof raw.hint === "string" ? raw.hint : "",
      typeof raw.code === "string" ? raw.code : "",
    ]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (details.length > 0) return details.join(" | ");
  }

  return "Erro desconhecido";
};

export default function SharkRoundPage() {
  const { addToast } = useToast(); 
  const { user, loading } = useAuth(); 
  const { tenantId, tenantLogoUrl, tenantSlug } = useTenantTheme();
  const router = useRouter();
  const sharkroundStatsStorageKey = useMemo(
    () =>
      `${SHARKROUND_STATS_STORAGE_KEY}:${tenantId || tenantSlug || "default"}`,
    [tenantId, tenantSlug]
  );
  const emBreveHref = tenantSlug ? withTenantSlug(tenantSlug, "/em-breve") : "/em-breve";
  const userRole =
    typeof user?.role === "string" ? user.role.toLowerCase().trim() : "guest";
  const canAccessSharkround = SHARKROUND_ALLOWED_ROLES.has(userRole);

  useEffect(() => {
    if (loading) return;
    if (canAccessSharkround) return;
    router.replace(emBreveHref);
  }, [canAccessSharkround, emBreveHref, loading, router]);
  // Configuração (Constantes agora, já que os setters não eram usados)
  const boardSide = 11;
  const boardSizeTotal = 40;

  // Estados do Jogo
  const [tabuleiro, setTabuleiro] = useState<CasaTabuleiro[]>([]);
  const [ligasAtivasMap, setLigasAtivasMap] = useState<Record<string, LigaConfig>>({}); 

  const [jogador, setJogador] = useState<Jogador>({ 
      id: 'guest', nome: 'Visitante', avatar: 'https://github.com/shadcn.png', 
      posicao: 0, tubas: 100, jogadasRestantes: 5, preso: false, rodadasPreso: 0, questoesAcertadasCiclo: 0, coracoes: 0
  });
  const [outrosJogadores, setOutrosJogadores] = useState<OutroJogador[]>([]);
  
  // UI & Modais
  const [dadoRolando, setDadoRolando] = useState(false);
  const [valorDado, setValorDado] = useState(1);
  const [modalPergunta, setModalPergunta] = useState<{pergunta: Pergunta, ligaNome: string} | null>(null);
  
  const [modalEvento, setModalEvento] = useState<ModalEventoData | null>(null);
  
  const [modalRegras, setModalRegras] = useState(false);
  const [modalDetalhes, setModalDetalhes] = useState<CasaTabuleiro | null>(null);
  
  // Ranking
  const [modalRanking, setModalRanking] = useState(false);
  const [rankingData, setRankingData] = useState<RankingItem[]>([]);
  const [semanaRanking, setSemanaRanking] = useState(0); 
  const [gameStats, setGameStats] = useState<SharkroundStats>({
    clinicas: 0,
    acertos: 0,
    erros: 0,
  });
  const [gameConfig, setGameConfig] = useState<SharkroundAppConfig>(
    getDefaultSharkroundAppConfig()
  );
  const boardroundDisplayName = getSharkroundDisplayName(gameConfig);
  
  const [isDebugMode, setIsDebugMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      if (loading || !canAccessSharkround) return;
      try {
        const config = await fetchSharkroundAppConfig({
          forceRefresh: false,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setGameConfig(config);
      } catch (error: unknown) {
        console.error(
          "[sharkround] erro ao carregar configuracao:",
          getErrorMessage(error),
          error
        );
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [loading, canAccessSharkround, tenantId]);

  useEffect(() => {
    setJogador((previous) => {
      const untouchedGuest =
        previous.id === "guest" &&
        previous.posicao === 0 &&
        previous.questoesAcertadasCiclo === 0 &&
        previous.tubas === 100 &&
        previous.jogadasRestantes === 5;

      if (untouchedGuest) {
        return {
          ...previous,
          tubas: gameConfig.startingCoins,
          jogadasRestantes: gameConfig.dailyRollsLimit,
        };
      }

      return {
        ...previous,
        jogadasRestantes: Math.min(
          previous.jogadasRestantes,
          gameConfig.dailyRollsLimit
        ),
      };
    });
  }, [gameConfig]);

  // --- 1. INICIALIZAÃ‡ÃƒO ---
  useEffect(() => {
    if (loading || !canAccessSharkround) return;

    const initGame = async () => {
        // Carregar Ligas da coleção CORRETA (ligas_config)
        const ligasLoaded: LigaConfig[] = []; 
        const ligasMap: Record<string, LigaConfig> = {};

        try {
            const activeLeagues = await fetchActiveSharkroundLeagues({
              maxResults: 32,
              forceRefresh: false,
              tenantId: tenantId || undefined,
            });
            activeLeagues.forEach((league) => {
              const data = league as unknown as LigaConfig;
              ligasLoaded.push(data);
              ligasMap[league.id] = data;
            });
        } catch (error: unknown) {
            console.error(
              "[sharkround] erro ao carregar ligas:",
              getErrorMessage(error),
              error
            );
        }

        setLigasAtivasMap(ligasMap); 

        // Fallback tipado
        const ligasPool = ligasLoaded.length > 0 ? ligasLoaded : [{id: 'demo', nome: "Liga Genérica", sigla: "LIGA", logoBase64: undefined, perguntas: [], ativa: true} as LigaConfig];
        
        // Monta Tabuleiro
        const novoTab: CasaTabuleiro[] = [];
        const cores = ['bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-yellow-600', 'bg-purple-600', 'bg-pink-600', 'bg-indigo-600', 'bg-orange-600'];
        let ligaIdx = 0;

        for (let i = 0; i < boardSizeTotal; i++) {
            let tipo: TipoCasa = 'LIGA';
            let titulo = "", sigla = "", cor = 'bg-zinc-800', desc = "Domine esta área!", bg = undefined;
            let currentLigaId: string | undefined = undefined;

            if (i === 0) { tipo = 'INICIO'; titulo = "Partida"; sigla="START"; cor = 'bg-emerald-600'; desc="Início"; }
            else if (i === 10) { tipo = 'PRISAO'; titulo = "DP Anatomia"; sigla="DP"; cor = 'bg-zinc-900'; desc="Reprovou? Peça ajuda!"; }
            else if (i === 20) { tipo = 'SORTE'; titulo = "Intermed"; sigla="FESTA"; cor = 'bg-yellow-600'; desc="Sorte ou Azar?"; }
            else if (i === 30) { tipo = 'AZAR'; titulo = "Sem Café"; sigla="ZOMBIE"; cor = 'bg-red-700'; desc="Volte 3 casas"; }
            else if ([5, 15, 25, 35].includes(i)) {
                tipo = Math.random() > 0.5 ? 'SORTE' : 'AZAR';
                titulo = tipo === 'SORTE' ? "Carimbo!" : "Plantão";
                sigla = tipo === 'SORTE' ? "SORT" : "AZAR";
                cor = tipo === 'SORTE' ? 'bg-cyan-600' : 'bg-orange-700';
            } else {
                tipo = 'LIGA';
                const l = ligasPool[ligaIdx % ligasPool.length];
                titulo = l.nome;
                sigla = l.sigla || l.nome.substring(0,4).toUpperCase();
                bg = l.logoBase64;
                cor = cores[ligaIdx % cores.length];
                currentLigaId = l.id;
                ligaIdx++;
            }
            novoTab.push({ index: i, tipo, titulo, sigla, descricao: desc, cor, backgroundImage: bg, socios: [], ligaId: currentLigaId });
        }
        setTabuleiro(novoTab);

        // Carrega Jogadores
        try {
            const playersPreview = await fetchSharkroundPlayersPreview({
              maxResults: 20,
              forceRefresh: false,
              tenantId: tenantId || undefined,
            });
            const players = playersPreview.map((entry) => ({
                id: entry.id,
                nome: entry.nome || "Calouro",
                avatar: entry.avatar || "https://github.com/shadcn.png",
                posicao: Math.floor(Math.random() * 40),
                preso: Math.random() > 0.8,
                coracoes: Math.floor(Math.random() * 4)
            }));
            setOutrosJogadores(players);
        } catch (error: unknown) {
             console.error(
               "[sharkround] erro ao carregar jogadores:",
               getErrorMessage(error),
               error
             );
             setOutrosJogadores([{ id: 'p2', nome: 'Vivian', avatar: 'https://github.com/shadcn.png', posicao: 10, preso: true, coracoes: 2 }]);
        }
    };

    initGame();
    if (user && !loading) {
        setJogador(prev => ({...prev, id: user.uid, nome: user.nome || "Atleta", avatar: user.foto || prev.avatar}));
        fetchRanking();
    }
  }, [user, loading, boardSizeTotal, canAccessSharkround, tenantId]);

  useEffect(() => {
    if (!user?.uid) return;
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(
        `${sharkroundStatsStorageKey}:${user.uid}`
      );
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SharkroundStats>;
      setGameStats({
        clinicas:
          typeof parsed.clinicas === "number" ? Math.max(0, parsed.clinicas) : 0,
        acertos:
          typeof parsed.acertos === "number" ? Math.max(0, parsed.acertos) : 0,
        erros: typeof parsed.erros === "number" ? Math.max(0, parsed.erros) : 0,
      });
    } catch {
      setGameStats({ clinicas: 0, acertos: 0, erros: 0 });
    }
  }, [sharkroundStatsStorageKey, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      `${sharkroundStatsStorageKey}:${user.uid}`,
      JSON.stringify(gameStats)
    );
  }, [gameStats, sharkroundStatsStorageKey, user?.uid]);

  const fetchRanking = async () => {
      try {
          const ranking = await fetchSharkroundTubasRanking({
            maxResults: 10,
            forceRefresh: false,
            tenantId: tenantId || undefined,
          });
          setRankingData(ranking.map((entry) => ({
            id: entry.id,
            nome: entry.nome,
            foto: entry.foto,
            tubas: entry.tubas || 0,
          })));
      } catch (error: unknown) {
        console.error(
          "[sharkround] erro ao carregar ranking:",
          getErrorMessage(error),
          error
        );
      }
  };

  // --- MECÃ‚NICA ---
  const jogarDado = async () => {
    if (jogador.jogadasRestantes <= 0) return addToast("Sem jogadas de dado hoje. Volte amanha.", "error");
    
    if (jogador.preso) {
        if (jogador.coracoes >= gameConfig.heartTarget) {
            setJogador(p => ({...p, preso: false, coracoes: 0}));
            addToast(`Voce conseguiu ${gameConfig.heartTarget} coracoes e esta livre!`, "success");
        } else {
            return setModalEvento({
              titulo: "Preso na DP",
              msg: `Voce tem ${jogador.coracoes}/${gameConfig.heartTarget} coracoes. Pague ${gameConfig.bailCost} moedas ou espere ajuda.`,
              tipo: 'error',
              isJail: true
            });
        }
        return;
    }

    if (jogador.rodadasPreso > 0) { 
        setJogador(p => ({ ...p, rodadasPreso: p.rodadasPreso - 1, jogadasRestantes: p.jogadasRestantes - 1 })); 
        return addToast(`De castigo! Faltam ${jogador.rodadasPreso} rodadas.`, "error"); 
    }

    setDadoRolando(true);
    let rolls = 0;
    const interval = setInterval(() => {
      setValorDado(Math.floor(Math.random() * 6) + 1);
      rolls++;
      if (rolls > 10) {
        clearInterval(interval);
        const res = Math.floor(Math.random() * 6) + 1;
        setValorDado(res);
        setDadoRolando(false);
        moverJogador(res);
      }
    }, 100);
  };

  const moverJogador = (passos: number) => {
    let novaPos = jogador.posicao + passos;
    
    // Ciclo Completo
    if (novaPos >= boardSizeTotal) { 
        novaPos %= boardSizeTotal; 
        
        let bonusPredios = 0;
        tabuleiro.forEach(t => {
            if (t.donoId === jogador.id && t.nivel) {
                if (t.nivel === 'CLINICA_GERAL') bonusPredios += 10;
                if (t.nivel === 'HOSPITAL_UNIVERSITARIO') bonusPredios += 20;
                if (t.nivel === 'CENTRO_EXCELENCIA') bonusPredios += 30;
                if (t.nivel === 'MINISTERIO_SAUDE') bonusPredios += 50;
            }
        });
        const bonusQuestoes = jogador.questoesAcertadasCiclo * 10;
        const total = gameConfig.cycleBaseReward + bonusPredios + bonusQuestoes;

        addToast(`Volta completa! +${total} moedas`, "success"); 
        setJogador(p => ({...p, tubas: p.tubas + total, questoesAcertadasCiclo: 0})); 
        
        // --- LOG CORRIGIDO (5 Argumentos) ---
        logActivity(
            user?.uid || 'guest', 
            user?.nome || 'Visitante',
            'GAME_CYCLE', 
            boardroundDisplayName,
            `Ganhou ${total} moedas no ciclo.`
        );
    }

    setJogador(prev => ({ ...prev, posicao: novaPos, jogadasRestantes: Math.max(0, prev.jogadasRestantes - 1) }));
    setTimeout(() => analisarCasa(novaPos), 600);
  };

  const analisarCasa = (index: number) => {
    const casa = tabuleiro[index];

    // Cobrança de Aluguel
    if (casa.donoId && casa.donoId !== jogador.id) { 
        const aluguel = 5; 
        const quemRecebe = casa.socios?.[0]?.nome || "Dono"; 
        addToast(`Pagou ${aluguel} moedas para ${quemRecebe}.`, "info"); 
        setJogador(p => ({...p, tubas: Math.max(0, p.tubas - aluguel)})); 
    }

    if (casa.tipo === 'PRISAO') { 
        setJogador(p => ({ ...p, preso: true, coracoes: 0 })); 
        addToast("Vish! Caiu na DP! 🚨", "error"); 
    } 
    else if (casa.tipo === 'SORTE') { 
        const bonus = Math.floor(Math.random() * 3) + 1; 
        setModalEvento({ titulo: "Sorte Grande!", msg: `Ganhou carimbo! Avance ${bonus} casas.`, tipo: 'success', move: bonus }); 
    } 
    else if (casa.tipo === 'AZAR') { 
        const penalty = Math.floor(Math.random() * 3) + 1; 
        setModalEvento({ titulo: "Sem Café!", msg: `Volte ${penalty} casas.`, tipo: 'error', move: -penalty }); 
    }
    else if (casa.tipo === 'LIGA') { 
        if (casa.ligaId && ligasAtivasMap[casa.ligaId]) {
            const liga = ligasAtivasMap[casa.ligaId];
            if (liga.perguntas && liga.perguntas.length > 0) {
                const randomQ = liga.perguntas[Math.floor(Math.random() * liga.perguntas.length)];
                setModalPergunta({ pergunta: randomQ, ligaNome: liga.nome });
            } else {
                 setModalPergunta({ 
                   pergunta: { id: 'fallback', texto: `Pergunta genérica sobre ${liga.nome}...`, alternativas: ['A','B','C','D'], respostaCorreta: 0 },
                   ligaNome: liga.nome 
                 });
            }
        } else {
             setModalPergunta({ 
                pergunta: { id: 'fallback', texto: "Pergunta Bônus: Qual a cor do céu?", alternativas: ['Azul','Verde','Roxo','Preto'], respostaCorreta: 0 },
                ligaNome: "Bônus"
             });
        }
    }
  };

  const responderQuiz = (idx: number) => {
    if (!modalPergunta) return;
    
    if (idx === modalPergunta.pergunta.respostaCorreta) {
      addToast("Resposta certa!", "success");
      setGameStats((prev) => ({ ...prev, acertos: prev.acertos + 1 }));
      const novoTab = [...tabuleiro];
      const casa = novoTab[jogador.posicao];
      
      if (!casa.donoId) { 
          casa.donoId = jogador.id; 
          casa.nivel = 'TERRENO'; 
          casa.socios = [{ uid: jogador.id, nome: jogador.nome, nivel: 'TERRENO' }];
          addToast(`Conquistou o terreno!`, "success"); 
      } else if (casa.donoId === jogador.id) { 
          if (casa.nivel === 'TERRENO') {
            casa.nivel = 'CLINICA_GERAL';
            setGameStats((prev) => ({ ...prev, clinicas: prev.clinicas + 1 }));
          }
          else if (casa.nivel === 'CLINICA_GERAL') casa.nivel = 'HOSPITAL_UNIVERSITARIO';
          addToast("Evoluiu construção!", "success");
      }
      setTabuleiro(novoTab);
      setJogador(p => ({...p, questoesAcertadasCiclo: p.questoesAcertadasCiclo + 1}));
    } else { 
        setGameStats((prev) => ({ ...prev, erros: prev.erros + 1 }));
        addToast("Errou! Perdeu a vez e 1 rodada.", "error"); 
        setJogador(p => ({...p, rodadasPreso: 1})); 
    }
    setModalPergunta(null);
  };

  const darCoracao = (targetId: string) => {
      setOutrosJogadores(prev => prev.map(p => {
          if (p.id === targetId && p.coracoes < gameConfig.heartTarget) {
              addToast(`Voce ajudou ${p.nome}! +${gameConfig.heartHelpReward} moedas`, "success");
              setJogador(j => ({...j, tubas: j.tubas + gameConfig.heartHelpReward})); 
              return { ...p, coracoes: p.coracoes + 1 };
          }
          return p;
      }));
  };

  const getBoardPosition = (i: number) => { 
      if (i < boardSide) return { gridRow: 1, gridColumn: i + 1 }; 
      if (i < boardSide * 2 - 1) return { gridRow: (i - boardSide) + 2, gridColumn: boardSide }; 
      if (i < boardSide * 3 - 2) return { gridRow: boardSide, gridColumn: boardSide - (i - (boardSide * 2 - 2)) - 1 }; 
      return { gridRow: boardSide - (i - (boardSide * 3 - 2)) - 1, gridColumn: 1 }; 
  };

  if (loading || !canAccessSharkround) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" />
      </div>
    );
  }

  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  const rankingHref = tenantSlug ? withTenantSlug(tenantSlug, "/boardround/ranking") : "/boardround/ranking";
  const statsHref = tenantSlug ? withTenantSlug(tenantSlug, "/boardround/estatisticas") : "/boardround/estatisticas";

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24 overflow-hidden selection:bg-emerald-500/30">
      
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 p-4 flex justify-between items-center shadow-lg">
         <div className="flex items-center gap-3"><Link href={dashboardHref} className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-white/5 transition"><ArrowLeft size={24}/></Link><div><h1 className="font-black text-lg italic uppercase text-white">{boardroundDisplayName}</h1><p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">O jogo da atletica</p></div></div>
         <div className="flex gap-3 items-center">
              <Link href={rankingHref} className="p-2 bg-zinc-800 rounded-full border border-zinc-700 text-emerald-400 hover:bg-zinc-700 transition">
                <Trophy size={18}/>
              </Link>
              <Link href={statsHref} className="p-2 bg-zinc-800 rounded-full border border-zinc-700 text-cyan-400 hover:bg-zinc-700 transition">
                <BarChart3 size={18}/>
              </Link>
              <button onClick={() => setModalRanking(true)} className="p-2 bg-zinc-800 rounded-full border border-zinc-700 text-yellow-500 hover:bg-zinc-700 transition"><Trophy size={18}/></button>
              <button onClick={() => setModalRegras(true)} className="p-2 bg-zinc-800 rounded-full border border-zinc-700 text-blue-400 hover:bg-zinc-700 transition"><HelpCircle size={18}/></button>
             <div className="flex flex-col items-end">
                <span className="text-zinc-500 text-[9px] font-bold uppercase">Moedas</span>
                <span className="text-blue-400 flex items-center gap-1 font-black"><DollarSign size={12}/> {jogador.tubas}</span>
                <span className="text-[9px] font-bold text-zinc-500 uppercase">Dado: {jogador.jogadasRestantes}/{gameConfig.dailyRollsLimit}</span>
             </div>
         </div>
      </header>

      {/* DADO */}
      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
          <button onClick={jogarDado} disabled={dadoRolando || jogador.jogadasRestantes === 0} className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black shadow-[0_0_30px_rgba(16,185,129,0.3)] border-b-8 transition-all active:scale-95 active:border-b-0 active:translate-y-2 ${dadoRolando ? 'bg-zinc-800 border-zinc-600 text-zinc-500' : 'bg-white border-zinc-300 text-black'}`}>
              {dadoRolando ? <Dice5 size={32} className="animate-spin"/> : valorDado}
          </button>
          <div className="bg-black/70 border border-zinc-700 rounded-xl px-3 py-1 text-center">
            <p className="text-[10px] uppercase font-black tracking-widest text-zinc-300">Dado</p>
            <p className="text-[10px] text-zinc-500 font-bold">{gameConfig.dailyRollsLimit} jogadas por dia - faltam {jogador.jogadasRestantes}</p>
          </div>
      </div>

      {/* DEBUG */}
      <div className="fixed top-24 right-4 z-50"><button onClick={() => setIsDebugMode(!isDebugMode)} className="text-[9px] text-zinc-600 uppercase font-bold hover:text-white"><Wrench size={14}/></button></div>
      {isDebugMode && <div className="fixed top-32 right-4 z-50 bg-zinc-900 p-2 rounded border border-zinc-800"><button onClick={() => setJogador(p=>({...p, tubas: p.tubas+100}))} className="text-xs">+100 moedas</button></div>}

      {/* TABULEIRO */}
      <div className="pt-40 pb-32 px-2 flex justify-center items-center min-h-screen">
          <div className={`relative w-full max-w-[800px] aspect-square bg-[#0a0a0a] rounded-3xl border-4 border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.8)] p-2 grid gap-1 overflow-hidden`} style={{ gridTemplateColumns: `repeat(${boardSide}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${boardSide}, minmax(0, 1fr))` }}>
              {/* Logo Central */}
              <div className="col-start-3 col-end-10 row-start-3 row-end-10 flex flex-col items-center justify-center relative z-0">
                  <div className="absolute inset-0 bg-emerald-900/10 blur-3xl rounded-full animate-pulse"></div>
                  <div className="w-40 h-40 md:w-64 md:h-64 relative mb-4 opacity-100 hover:scale-105 transition duration-500 animate-float"><Image src={tenantLogoUrl || "/logo.png"} alt="Logo da atletica" fill className="object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)]" unoptimized={Boolean(tenantLogoUrl && tenantLogoUrl.startsWith("http"))} /></div>
              </div>

              {tabuleiro.map((casa) => {
                  const style = getBoardPosition(casa.index);
                  if (!style) return null;
                  const isHere = jogador.posicao === casa.index;
                  const othersHere = outrosJogadores.filter(p => p.posicao === casa.index);

                  return (
                      <div key={casa.index} onClick={() => setModalDetalhes(casa)} className={`relative rounded-md flex flex-col items-center justify-center text-center transition-all duration-300 border border-black/20 overflow-hidden cursor-pointer hover:brightness-125 ${isHere ? 'z-20 scale-110 shadow-[0_0_15px_rgba(255,255,255,0.3)] ring-1 ring-white' : ''}`} style={{ ...style, backgroundColor: isHere ? '#10b981' : undefined }}>
                          {casa.backgroundImage && <div className="absolute inset-0 opacity-40 z-0"><Image src={casa.backgroundImage} alt="Fundo da casa" fill className="object-cover grayscale mix-blend-overlay" /></div>}
                          <div className={`absolute inset-0 opacity-80 ${casa.cor} transition-opacity -z-10`}></div>
                          
                          <div className="relative z-10 flex flex-col items-center justify-center w-full h-full p-0.5">
                              <div className="text-white drop-shadow-md transform scale-75 md:scale-100">{casa.tipo === 'PRISAO' ? <Lock size={14}/> : casa.tipo === 'SORTE' ? <TrendingUp size={14}/> : casa.tipo === 'AZAR' ? <AlertTriangle size={14}/> : casa.tipo === 'INICIO' ? <MapPin size={14}/> : null}</div>
                              {casa.tipo === 'LIGA' && <span className="text-[7px] font-black text-white/90 drop-shadow-md leading-tight">{casa.sigla}</span>}
                              {casa.nivel && <div className="absolute top-0.5 right-0.5 text-yellow-300 drop-shadow-md bg-black/50 rounded-full p-0.5">{casa.nivel === "TERRENO" && <span className="text-[6px]">🚩</span>}{casa.nivel !== "TERRENO" && <Building2 size={8}/>}</div>}
                          </div>

                          {isHere && <div className="absolute inset-0 flex items-center justify-center z-30"><div className="w-6 h-6 rounded-full border-[2px] border-white shadow-xl overflow-hidden bg-black relative animate-bounce-slow"><Image src={jogador.avatar} alt="Me" fill className="object-cover" /></div></div>}
                          
                          {othersHere.length > 0 && !isHere && (
                              <div className="absolute bottom-0 right-0 flex -space-x-1 z-20 p-0.5">
                                  {othersHere.slice(0,3).map((other, i) => (<div key={i} className="w-3 h-3 rounded-full border border-white bg-black overflow-hidden relative"><Image src={other.avatar} alt={other.nome} fill className="object-cover" /></div>))}
                                  {othersHere.length > 3 && <div className="w-3 h-3 rounded-full bg-zinc-800 text-[5px] flex items-center justify-center border border-white text-white font-bold">+{othersHere.length-3}</div>}
                              </div>
                          )}
                      </div>
                  )
              })}
            </div>
      </div>

      {/* --- MODAIS --- */}

      {/* DETALHES */}
      {modalDetalhes && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in zoom-in">
              <div className="bg-zinc-900 w-full max-w-sm rounded-2xl border border-zinc-700 p-6 text-center relative shadow-2xl">
                  <button onClick={() => setModalDetalhes(null)} className="absolute top-3 right-3 text-zinc-500 hover:text-white"><XCircle size={20}/></button>
                  <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${modalDetalhes.cor} shadow-lg`}>{modalDetalhes.tipo === 'PRISAO' ? <Lock size={32} className="text-white"/> : <MapPin size={32} className="text-white"/>}</div>
                  <h3 className="text-xl font-black text-white uppercase">{modalDetalhes.titulo}</h3>
                  <p className="text-zinc-400 text-sm mt-2">{modalDetalhes.descricao || "Território da Liga"}</p>
                  
                  {modalDetalhes.socios && modalDetalhes.socios.length > 0 && (
                      <div className="mt-4 bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-left">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Ordem de Pagamento</p>
                          {modalDetalhes.socios.map((socio, i) => (
                              <div key={i} className="flex justify-between items-center text-xs text-zinc-300 py-1 border-b border-zinc-800 last:border-0">
                                  <span>{i+1}. {socio.nome}</span><span className="text-emerald-500 font-bold">{socio.nivel.replace('_', ' ')}</span>
                              </div>
                          ))}
                      </div>
                  )}

                  {modalDetalhes.tipo === 'PRISAO' && (
                      <div className="mt-4 text-left">
                          <p className="text-xs font-bold text-zinc-500 uppercase mb-2">Presos na DP</p>
                          {outrosJogadores.filter(p => p.preso).map(p => (
                              <div key={p.id} className="flex items-center justify-between bg-zinc-950 p-2 rounded-lg border border-zinc-800 mb-2">
                                  <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-zinc-800 overflow-hidden relative"><Image src={p.avatar} alt={p.nome} fill className="object-cover" /></div><span className="text-xs text-white font-bold">{p.nome}</span></div>
                                  <div className="flex gap-1 items-center">
                                      <div className="flex">{Array.from({ length: gameConfig.heartTarget }, (_, idx) => idx + 1).map(i => (<Heart key={i} size={10} className={`${i <= (p.coracoes || 0) ? 'fill-red-500 text-red-500' : 'text-zinc-800'}`}/>))}</div>
                                      <button onClick={() => darCoracao(p.id)} className="bg-emerald-500/20 hover:bg-emerald-500 text-emerald-500 hover:text-black p-1 rounded-full ml-1"><Heart size={12}/></button>
                                  </div>
                              </div>
                          ))}
                          <p className="text-[9px] text-zinc-500 italic mt-2">* Clique no botao verde para dar 1 coracao e ganhar {gameConfig.heartHelpReward} moedas.</p>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* EVENTO / PRISÃO */}
      {modalEvento && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in zoom-in">
            <div className="bg-zinc-900 border border-zinc-700 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl">
                <h3 className="text-xl font-black text-white mb-2 uppercase">{modalEvento.titulo}</h3>
                <p className="text-zinc-400 text-sm mb-6">{modalEvento.msg}</p>
                {modalEvento.isJail ? (
                    <div className="flex flex-col gap-3">
                        <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                            <p className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Seus Coracoes ({jogador.coracoes}/{gameConfig.heartTarget})</p>
                            <div className="flex justify-center gap-2 mb-3">{Array.from({ length: gameConfig.heartTarget }, (_, idx) => idx + 1).map(i => (<Heart key={i} size={20} className={`${i <= jogador.coracoes ? 'fill-red-500 text-red-500' : 'text-zinc-700'}`}/>))}</div>
                            <p className="text-xs text-zinc-600">Espere ajuda dos amigos...</p>
                        </div>
                        <button onClick={() => { if(jogador.tubas>=gameConfig.bailCost){setJogador(p=>({...p, tubas:p.tubas-gameConfig.bailCost, preso:false, coracoes:0})); setModalEvento(null);} else {addToast("Sem moedas!", "error")} }} className="w-full bg-zinc-800 text-zinc-400 hover:text-white py-3 rounded-xl font-bold uppercase text-xs border border-zinc-700">Pagar fianca ({gameConfig.bailCost} moedas)</button>
                    </div>
                ) : (
                    <button onClick={() => modalEvento.move ? moverJogador(modalEvento.move) : setModalEvento(null)} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl uppercase text-xs shadow-lg">Continuar</button>
                )}
            </div>
        </div>
      )}

      {/* RANKING */}
      {modalRanking && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in zoom-in">
              <div className="bg-zinc-900 w-full max-w-md rounded-3xl border border-zinc-800 p-6 relative">
                  <button onClick={() => setModalRanking(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><XCircle/></button>
                  <div className="text-center mb-6">
                      <h3 className="text-xl font-black text-white uppercase flex items-center justify-center gap-2"><Trophy className="text-yellow-500"/> Ranking Semanal</h3>
                      <div className="flex items-center justify-center gap-4 mt-2">
                          <button onClick={() => setSemanaRanking(s => s - 1)} className="text-zinc-500 hover:text-white"><ChevronLeft/></button>
                          <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Semana {semanaRanking === 0 ? "Atual" : -semanaRanking}</span>
                          <button onClick={() => setSemanaRanking(s => Math.min(0, s + 1))} className={`text-zinc-500 ${semanaRanking === 0 ? 'opacity-30' : 'hover:text-white'}`}><ChevronRight/></button>
                      </div>
                  </div>
                  <div className="space-y-2">
                      {rankingData.map((user, i) => (
                          <div key={user.id} onClick={() => router.push(`/perfil/${user.id}`)} className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition">
                              <span className={`font-black w-6 text-center ${i===0?'text-yellow-500':i===1?'text-gray-400':i===2?'text-orange-500':'text-zinc-500'}`}>#{i+1}</span>
                              <div className="w-8 h-8 rounded-full bg-black overflow-hidden relative"><Image src={user.foto} alt={user.nome} fill className="object-cover" /></div>
                              <div className="flex-1"><p className="text-sm font-bold text-white">{user.nome}</p></div>
                              <span className="text-xs font-bold text-emerald-500 flex items-center gap-1"><DollarSign size={10}/> {user.tubas}</span>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* MODAL DE PERGUNTA - AGORA REAL */}
      {modalPergunta && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in zoom-in">
            <div className="bg-zinc-900 border border-emerald-500/30 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl">
                <div className="h-24 bg-gradient-to-r from-emerald-900 to-black relative flex items-center justify-center">
                    <div className="absolute top-2 right-2 bg-black/50 px-2 py-1 rounded text-[10px] font-bold uppercase text-emerald-400 border border-emerald-900">Valendo Ponto</div>
                    <span className="text-white/20 font-black text-4xl uppercase tracking-widest absolute">{modalPergunta.ligaNome}</span>
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-bold text-white mb-6">{modalPergunta.pergunta.texto}</h3>
                  <div className="space-y-3">
                      {modalPergunta.pergunta.alternativas.map((alt, i) => (
                          <button key={i} onClick={() => responderQuiz(i)} className="w-full text-left p-4 rounded-xl bg-zinc-800 hover:bg-emerald-600 hover:text-white transition border border-zinc-700 font-medium text-sm text-zinc-300">
                              {alt}
                          </button>
                      ))}
                  </div>
                </div>
            </div>
        </div>
      )}

      {/* REGRAS */}
      {modalRegras && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in zoom-in">
            <div className="bg-zinc-900 w-full max-w-md rounded-3xl border border-zinc-800 p-6 relative h-[80vh] overflow-y-auto custom-scrollbar">
                <button onClick={() => setModalRegras(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white"><XCircle/></button>
                <h3 className="text-xl font-black text-white mb-6 flex items-center gap-2"><HelpCircle className="text-emerald-500"/> Regras do Jogo</h3>
                <ul className="space-y-4 text-sm text-zinc-400 text-left">
                    {gameConfig.rules.map((rule, index) => (
                      <li key={`${rule}-${index}`}>
                        <strong className="text-emerald-500">Regra {index + 1}:</strong> {rule}
                      </li>
                    ))}
                    <li><strong className="text-emerald-500">DP Anatomia:</strong> valor para se salvar: {gameConfig.bailCost} moedas.</li>
                    <li><strong className="text-emerald-500">Coracoes:</strong> libertacao em {gameConfig.heartTarget} coracoes.</li>
                    <li><strong className="text-emerald-500">Dado:</strong> limite diario de {gameConfig.dailyRollsLimit} jogadas.</li>
                </ul>
                <button onClick={() => setModalRegras(false)} className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl uppercase text-xs">Entendi</button>
            </div>
        </div>
      )}
    </div>
  );
}

