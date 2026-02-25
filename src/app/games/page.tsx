"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ArrowLeft, Swords, Trophy, Sparkles, Heart, Zap, Brain, User, Palette,
  Gamepad2, Edit2, Save, LogOut, Loader2,
  Eye, ShoppingBag, Dumbbell, Target
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // 🦈 Importando Image
import { useToast } from "../../context/ToastContext";
import SharkAvatar from "../components/SharkAvatar";
import { useAuth } from "../../context/AuthContext";
import { calculateLevel, getNextLevelXP, calculateUserStats, HeroStats } from "../../lib/games";
import {
  fetchArenaUsers,
  registerArenaBattleResult,
  registerArenaFlee,
} from "../../lib/arenaService";

// ============================================================================
// 1. CONFIGURAÇÕES & FÓRMULA OFICIAL 🦈
// ============================================================================

const MAX_SERVER_STAT = 999; 
const MAX_ROUNDS = 10;

// Tipos de Personalidade da IA
type AIType = "estrategista" | "zueiro" | "copao" | "lerdo" | "medio" | string;

interface Combatant {
  id: string; 
  name: string; 
  avatarName: string; 
  level: number; 
  customColor: string; 
  customEyeColor: string;
  maxHp: number; currentHp: number; 
  maxStamina: number; currentStamina: number;
  stats: HeroStats; 
  expression: "normal" | "angry" | "pain" | "dead" | "happy";
  profileImage: string;
  critCooldown: number;
  totalPower: number;
  aiType: AIType; 
  rewardXP: number; 
}

interface Move {
  id: string; name: string; type: "fisico" | "especial" | "suporte";
  power: number; accuracy: number; staminaCost: number; statScaling: keyof HeroStats; icon: string; color: string;
}

// 🦈 Cálculos de nível e stats movidos para src/lib/games.ts

const STAT_CONFIG: Record<keyof HeroStats, { label: string; icon: React.ElementType; color: string; source: string; desc: string }> = {
  forca: { label: "Força", icon: Dumbbell, color: "text-red-500", source: "Gym", desc: "Check-ins e Treinos." },
  defesa: { label: "Defesa", icon: ShoppingBag, color: "text-blue-500", source: "Loja", desc: "Compras e Seguidores." },
  inteligencia: { label: "Inteligência", icon: Brain, color: "text-purple-500", source: "Social", desc: "Posts e Álbum." },
  stamina: { label: "Stamina", icon: Zap, color: "text-yellow-500", source: "Login", desc: "Consistência e Eventos." },
  hp: { label: "Vida", icon: Heart, color: "text-pink-500", source: "Nível", desc: "XP Total acumulado." },
  ataque: { label: "Ataque", icon: Swords, color: "text-orange-500", source: "PvP", desc: "Vitórias na Arena." },
};

const HERO_MOVES: Move[] = [
  { id: "m1", name: "Esmagar", type: "fisico", power: 70, accuracy: 90, staminaCost: 40, statScaling: "forca", icon: "💪", color: "bg-red-600" },
  { id: "m2", name: "Tática", type: "especial", power: 50, accuracy: 100, staminaCost: 30, statScaling: "inteligencia", icon: "🧠", color: "bg-purple-600" },
  { id: "m3", name: "Combo", type: "fisico", power: 30, accuracy: 95, staminaCost: 15, statScaling: "ataque", icon: "⚔️", color: "bg-orange-600" },
  { id: "m4", name: "Postura", type: "suporte", power: 0, accuracy: 100, staminaCost: 0, statScaling: "defesa", icon: "🛡️", color: "bg-blue-600" },
];

interface FloatingEffect {
    id: number;
    type: string;
    value: string | number;
}

// Interface auxiliar para os usuários carregados no ranking/oponentes
interface GameUser {
    id: string;
    name: string;
    apelido: string;
    foto: string;
    xp: number;
    level: number;
    wins: number;
    losses: number;
    stats: HeroStats;
    power: number;
    customColor: string;
    customEyeColor: string;
    isHigher?: boolean;
}

export default function SharkLegendsPage() {
  const { addToast } = useToast();
  const { user, updateUser } = useAuth();

  // Estados Visuais
  const [heroColor, setHeroColor] = useState("#64748b");
  const [heroEyeColor, setHeroEyeColor] = useState("#0f172a");
  const [heroName, setHeroName] = useState("Tubarão");
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  // Estados de Jogo
  const [activeTab, setActiveTab] = useState<"arena" | "stats" | "ranking" | "visual">("arena");
  const [showOpponentList, setShowOpponentList] = useState(false);
  const [opponents, setOpponents] = useState<Combatant[]>([]);
  const [rankingList, setRankingList] = useState<GameUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyBattles] = useState(5); 
  
  // Batalha
  const [battleState, setBattleState] = useState<"idle" | "combat" | "victory" | "defeat" | "draw">("idle");
  const [hero, setHero] = useState<Combatant | null>(null);
  const [enemy, setEnemy] = useState<Combatant | null>(null);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [floatingEffects, setFloatingEffects] = useState<FloatingEffect[]>([]);
  const [turn, setTurn] = useState<"player" | "enemy">("player");
  const [round, setRound] = useState(1);
  
  const battleLogRef = useRef<HTMLDivElement>(null);

  // Cálculos
  const myStats = useMemo(() => user ? calculateUserStats(user) : null, [user]);
  const myLevel = useMemo(() => user ? calculateLevel(user.xp || 0) : 1, [user]);
  
  // 🦈 Correção de Tipagem no Reduce
  const myTotalPower = useMemo(() => {
      if (!myStats) return 0;
      return Object.values(myStats).reduce((a, b) => (typeof a === 'number' && typeof b === 'number') ? a + b : 0, 0);
  }, [myStats]);
  
  const xpNeeded = getNextLevelXP(myLevel);
  const currentXP = user?.xp || 0;
  const xpProgress = Math.min((currentXP / xpNeeded) * 100, 100);

  // Persistência
  const saveGameState = (currentHero: Combatant | null, currentEnemy: Combatant | null, currentLog: string[], currentTurn: "player" | "enemy", currentRound: number) => {
      if (!currentHero || !currentEnemy) return;
      const state = {
          hero: currentHero, enemy: currentEnemy, log: currentLog, turn: currentTurn, round: currentRound, timestamp: Date.now()
      };
      localStorage.setItem("aaakn_battle_state", JSON.stringify(state));
  };

  const clearGameState = () => localStorage.removeItem("aaakn_battle_state");

  useEffect(() => {
      const savedState = localStorage.getItem("aaakn_battle_state");
      if (savedState) {
          try {
              const parsed = JSON.parse(savedState);
              if (Date.now() - parsed.timestamp < 86400000) {
                  setHero(parsed.hero); setEnemy(parsed.enemy); setBattleLog(parsed.log); 
                  setTurn(parsed.turn); setRound(parsed.round || 1); setBattleState("combat");
                  addToast("Batalha restaurada! 🔄", "info");
              } else clearGameState();
          } catch { clearGameState(); }
      }
      
      const handleOffline = () => addToast("⚠️ Sem conexão! Jogo salvo localmente.", "error");
      window.addEventListener('offline', handleOffline);
      return () => window.removeEventListener('offline', handleOffline);
  }, [addToast]); 

  // Inicialização
  useEffect(() => {
    if (user) {
        setHeroName(user.apelido || user.nome.split(' ')[0]);
        setTempName(user.apelido || user.nome.split(' ')[0]);
        const colors = ["#ef4444", "#3b82f6", "#eab308", "#a855f7", "#10b981", "#f97316"];
        const colorIndex = user.uid.charCodeAt(0) % colors.length;
        setHeroColor(colors[colorIndex]);
    }
    
    const fetchData = async () => {
        if (!user) {
            setLoading(false);
            return;
        }

        try {
            const usersRows = await fetchArenaUsers({
                maxResults: 60,
                forceRefresh: false,
            });

            const allUsers: GameUser[] = usersRows.map((u) => {
                const statsSource = (u.stats || {}) as Record<string, number | undefined>;
                const s = calculateUserStats({ stats: statsSource, xp: u.xp });
                const p = Object.values(s).reduce((a, b) => (typeof a === 'number' && typeof b === 'number') ? a + b : 0, 0);
                const colorIdx = u.id.charCodeAt(0) % 6;
                return {
                    id: u.id,
                    name: u.nome,
                    apelido: u.apelido || "Anon",
                    foto: u.foto || "https://github.com/shadcn.png",
                    xp: u.xp || 0,
                    level: calculateLevel(u.xp || 0),
                    wins: statsSource.arenaWins || 0,
                    losses: statsSource.arenaLosses || 0,
                    stats: s,
                    power: p,
                    customColor: ["#ef4444", "#3b82f6", "#eab308", "#a855f7", "#10b981", "#f97316"][colorIdx],
                    customEyeColor: "#000000",
                };
            });

            allUsers.sort((a, b) => b.power - a.power || b.wins - a.wins);
            setRankingList(allUsers);

            const myIndex = allUsers.findIndex(u => u.id === user.uid);
            let potentialTargets: GameUser[] = [];
            
            if (myIndex !== -1) {
                const above = allUsers.slice(Math.max(0, myIndex - 5), myIndex).map(u => ({...u, isHigher: true}));
                const below = allUsers.slice(myIndex + 1, myIndex + 6).map(u => ({...u, isHigher: false}));
                potentialTargets = [...above, ...below];
            }

            if (potentialTargets.length === 0 && allUsers.length > 1) {
                potentialTargets = allUsers.filter(u => u.id !== user.uid).slice(0, 5).map(u => ({...u, isHigher: false}));
            }

            const formattedOpponents: Combatant[] = potentialTargets.map(u => ({
                id: u.id,
                name: u.apelido,
                avatarName: "Rival",
                level: u.level,
                customColor: u.customColor,
                customEyeColor: u.customEyeColor,
                profileImage: u.foto,
                maxHp: u.stats.hp, currentHp: u.stats.hp,
                maxStamina: u.stats.stamina, currentStamina: u.stats.stamina,
                stats: u.stats,
                expression: "normal" as const,
                totalPower: u.power,
                critCooldown: 0,
                rewardXP: u.isHigher ? 70 : 60,
                aiType: ["estrategista", "zueiro", "copao", "lerdo", "medio"][Math.floor(Math.random() * 5)] as AIType
            }));
            
            setOpponents(formattedOpponents);
        } catch (error: unknown) {
            console.error(error);
            addToast("Erro ao carregar os dados da arena.", "error");
        } finally {
            setLoading(false);
        }
    };

    fetchData();
  }, [user, addToast]);

  const handleSaveName = async () => {
      if(!tempName.trim()) return addToast("Nome vazio!", "error");
      setHeroName(tempName); setIsEditingName(false);
      if(updateUser) await updateUser({ apelido: tempName });
  };

  const startBattle = (opponent: Combatant) => {
    if(!myStats) return;
    if(battleState === 'combat') return;

    const newHero: Combatant = {
        id: user!.uid,
        name: heroName,
        avatarName: heroName,
        level: myLevel,
        customColor: heroColor,
        customEyeColor: heroEyeColor,
        profileImage: user!.foto || "",
        maxHp: myStats.hp, currentHp: myStats.hp,
        maxStamina: myStats.stamina, currentStamina: myStats.stamina,
        stats: myStats,
        expression: "normal",
        critCooldown: 0,
        totalPower: myTotalPower,
        aiType: "medio", // Player
        rewardXP: 0
    };

    setHero(newHero);
    setEnemy(opponent);
    setBattleState("combat");
    setRound(1);
    const initialLog = [`⚔️ Batalha Iniciada! Rodada 1/10`];
    setBattleLog(initialLog);
    setTurn("player");
    setShowOpponentList(false);
    
    saveGameState(newHero, opponent, initialLog, "player", 1);
  };

  const spawnEffect = (type: string, value: string | number) => {
      const id = Math.random();
      setFloatingEffects(prev => [...prev, { id, type, value }]);
      setTimeout(() => setFloatingEffects(prev => prev.filter(e => e.id !== id)), 1000);
  };

  const endBattle = useCallback(async (result: "victory" | "defeat" | "draw", _finalHero: Combatant, finalEnemy: Combatant) => {
    const finalResult: "victory" | "defeat" | "draw" = result === "draw" ? "victory" : result;
    setBattleState(finalResult);
    clearGameState();
    if (!user) return;

    try {
        const xpGain = finalResult === "victory" ? (result === "draw" ? 10 : finalEnemy.rewardXP) : 5;
        await registerArenaBattleResult({
            attackerId: user.uid,
            attackerName: user.nome,
            defenderId: finalEnemy.id,
            defenderName: finalEnemy.name,
            result: finalResult,
            rounds: round,
            rewardXp: xpGain,
        });

        if (finalResult === "victory") {
            addToast(`Vitória! +${xpGain} XP 🏆`, "success");
        } else {
            addToast("Derrota... Ganhou 5 XP.", "error");
        }
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao salvar resultado da batalha.", "error");
    }
  }, [user, addToast, round]);
  const executeEnemyTurn = useCallback((lastPlayerMove: Move, currentHero: Combatant, currentEnemy: Combatant, currentLog: string[]) => {
      let enemyMoveType = lastPlayerMove.type;
      const staminaCost = lastPlayerMove.staminaCost;
      const finalEnemy = { ...currentEnemy };
      const finalHero = { ...currentHero };
      const finalLog = [...currentLog];

      if (finalEnemy.aiType === "zueiro" && Math.random() < 0.2) {
          finalLog.push(`🤡 ${finalEnemy.name} está rindo!`);
      } else {
          if (finalEnemy.currentStamina < staminaCost) enemyMoveType = 'suporte';

          if (enemyMoveType === 'suporte') {
              const heal = Math.floor(finalEnemy.maxHp * 0.2);
              finalEnemy.currentHp = Math.min(finalEnemy.maxHp, finalEnemy.currentHp + heal);
              finalEnemy.currentStamina = Math.min(finalEnemy.maxStamina, finalEnemy.currentStamina + 40);
              finalLog.push(`🛡️ ${finalEnemy.name} usou Postura!`);
              spawnEffect('heal', `+${heal}`);
          } else {
              finalEnemy.currentStamina -= staminaCost;
              const enemyStatVal = finalEnemy.stats[lastPlayerMove.statScaling]; 
              const enemyRawDmg = lastPlayerMove.power + enemyStatVal;
              const enemyFinalDmg = Math.max(5, Math.floor(enemyRawDmg - (finalHero.stats.defesa * 0.5)));

              finalHero.currentHp = Math.max(0, finalHero.currentHp - enemyFinalDmg);
              finalHero.expression = "pain";
              finalLog.push(`💀 ${finalEnemy.name} revidou: -${enemyFinalDmg} HP`);
              spawnEffect('dmg', enemyFinalDmg);
          }
      }

      let nextRound = round;
      if (turn === 'enemy') nextRound = round + 1;

      setHero(finalHero); setEnemy(finalEnemy); setBattleLog(finalLog); setRound(nextRound);
      saveGameState(finalHero, finalEnemy, finalLog, "player", nextRound);

      setTimeout(() => {
          if (finalHero.currentHp <= 0) {
              endBattle("defeat", finalHero, finalEnemy);
          } else if (nextRound > MAX_ROUNDS) {
              if (finalHero.currentHp >= finalEnemy.currentHp) endBattle("draw", finalHero, finalEnemy);
              else endBattle("defeat", finalHero, finalEnemy);
          } else {
              setTurn("player");
              setHero(prev => prev ? {...prev, expression: "normal"} : null);
              setEnemy(prev => prev ? {...prev, expression: "normal"} : null);
          }
      }, 1000);
  }, [round, turn, endBattle]);

  // 4. ATAQUE PLAYER
  const handleAttack = async (playerMove: Move) => {
    if (!hero || !enemy) return;
    if (playerMove.staminaCost > hero.currentStamina && playerMove.type !== 'suporte') {
        return addToast("Sem fôlego! Use Postura.", "error");
    }

    setTurn("enemy");
    const nextHero = { ...hero };
    const nextEnemy = { ...enemy };
    const nextLog = [...battleLog];

    if (playerMove.type === 'suporte') {
        const heal = Math.floor(nextHero.maxHp * 0.2);
        const staRec = 40;
        nextHero.currentHp = Math.min(nextHero.maxHp, nextHero.currentHp + heal);
        nextHero.currentStamina = Math.min(nextHero.maxStamina, nextHero.currentStamina + staRec);
        nextHero.critCooldown = Math.max(0, nextHero.critCooldown - 1);
        spawnEffect('heal', `+${heal}`);
        nextLog.push(`🛡️ Você usou Postura!`);
    } else {
        nextHero.currentStamina -= playerMove.staminaCost;
        
        const hitChance = playerMove.accuracy - (nextEnemy.stats.defesa / 20);
        if (Math.random() * 100 > hitChance) {
            spawnEffect('miss', 'MISS');
            nextLog.push(`💨 ${nextEnemy.name} esquivou!`);
        } else {
            const statVal = nextHero.stats[playerMove.statScaling]; 
            let rawDmg = playerMove.power + statVal;
            let isCrit = false;

            if (nextHero.critCooldown <= 0 && nextHero.stats.inteligencia > nextEnemy.stats.inteligencia) {
                if (Math.random() > 0.5) { isCrit = true; rawDmg *= 2; nextHero.critCooldown = 2; }
            } else {
                nextHero.critCooldown = Math.max(0, nextHero.critCooldown - 1);
            }

            const finalDmg = Math.max(5, Math.floor(rawDmg - (nextEnemy.stats.defesa * 0.5)));
            nextEnemy.currentHp = Math.max(0, nextEnemy.currentHp - finalDmg);
            nextEnemy.expression = "pain";
            spawnEffect(isCrit ? 'crit' : 'dmg', finalDmg);
            nextLog.push(`🗡️ ${playerMove.name}: -${finalDmg} HP`);
        }
    }

    setHero(nextHero); setEnemy(nextEnemy); setBattleLog(nextLog);
    saveGameState(nextHero, nextEnemy, nextLog, "enemy", round);

    if (nextEnemy.currentHp <= 0) {
        setTimeout(() => endBattle("victory", nextHero, nextEnemy), 1000);
    } else {
        setTimeout(() => executeEnemyTurn(playerMove, nextHero, nextEnemy, nextLog), 1500);
    }
  };

  const handleFlee = async () => {
    if (!hero || !enemy) return;
    setBattleState("defeat");
    clearGameState();
    addToast("Você fugiu! Covarde... 🐔", "error");
    
    if (user) {
        try {
            await registerArenaFlee({ defenderId: enemy.id });
        } catch (error: unknown) {
            console.error(error);
        }
    }
    setHero(null); setEnemy(null);
  };
  // 🦈 GRÁFICO RADAR HEXAGONAL PROFISSIONAL (SVG)
  const calculateRadarPolygon = () => {
    if(!myStats) return "";
    const size = 300; const center = size / 2; const radius = size * 0.4;
    const statsKeys = ["forca", "inteligencia", "defesa", "stamina", "hp", "ataque"];
    
    const normalize = (val: number, max: number) => Math.min(Math.max(val / max, 0.1), 1);

    const points = statsKeys.map((key, i) => {
      const angle = (Math.PI * 2 * i) / 6;
      const val = myStats[key as keyof HeroStats];
      let max = MAX_SERVER_STAT;
      if(key === 'hp') max = 5000; 
      
      const r = normalize(val, max) * radius;
      const x = center + r * Math.cos(angle - Math.PI / 2);
      const y = center + r * Math.sin(angle - Math.PI / 2);
      return `${x},${y}`;
    });
    return points.join(" ");
  };

  const canSeeEnemyStats = hero && enemy && hero.stats.inteligencia > enemy.stats.inteligencia;

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-24 selection:bg-emerald-500">
      
      {/* HEADER DE NÍVEL */}
      <header className="p-4 bg-zinc-900 border-b border-zinc-800 sticky top-0 z-30 shadow-lg">
        <div className="flex justify-between items-center mb-2">
            <Link href="/dashboard" className="bg-black p-2 rounded-full border border-zinc-700"><ArrowLeft size={20} /></Link>
            <div className="text-center">
                <h1 className="text-emerald-500 font-black uppercase tracking-widest text-lg flex items-center gap-2 justify-center"><Gamepad2 size={20} /> Shark Arena</h1>
                <p className="text-[9px] text-zinc-500 uppercase font-bold">Nível {myLevel} • {dailyBattles}/5 Lutas</p>
            </div>
            <div className="bg-black px-3 py-1 rounded-full border border-emerald-900 text-xs font-bold text-emerald-400">PvE Online</div>
        </div>
        <div className="w-full h-1.5 bg-black rounded-full overflow-hidden relative">
            <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${xpProgress}%` }}></div>
        </div>
        <p className="text-[8px] text-right text-zinc-600 mt-1">{Math.floor(currentXP)} / {xpNeeded} XP</p>
      </header>

      {/* TABS */}
      {battleState === "idle" && (
        <div className="flex border-b border-zinc-800 bg-black sticky top-[84px] z-20 overflow-x-auto shadow-md">
          {[{ id: "arena", icon: <Swords size={16} />, label: "Arena" }, { id: "visual", icon: <Palette size={16} />, label: "Visual" }, { id: "stats", icon: <Sparkles size={16} />, label: "Atributos" }, { id: "ranking", icon: <Trophy size={16} />, label: "Ranking" }].map((tab) => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 min-w-[80px] py-4 flex flex-col items-center gap-1 text-[10px] font-bold uppercase transition ${activeTab === tab.id ? "text-emerald-400 border-b-2 border-emerald-400 bg-zinc-900" : "text-zinc-500"}`}>{tab.icon} {tab.label}</button>
          ))}
        </div>
      )}

      <main className="p-4">
        
        {/* === ABA 1: ARENA === */}
        {activeTab === "arena" && battleState === "idle" && (
            <div className="space-y-6 animate-in fade-in">
                <div className="text-center relative py-6">
                    <div className="absolute inset-0 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none"></div>
                    <div className="relative z-10 w-40 h-40 mx-auto">
                        <SharkAvatar name={heroName} size="xl" level={myLevel} customColor={heroColor} customEyeColor={heroEyeColor} />
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase italic mt-4">{heroName}</h2>
                    <div className="flex justify-center gap-2 mt-2">
                        <span className="text-[10px] bg-zinc-800 px-2 py-1 rounded text-zinc-400 font-bold border border-zinc-700">Poder: {Math.floor(myTotalPower)}</span>
                        <span className="text-[10px] bg-zinc-800 px-2 py-1 rounded text-zinc-400 font-bold border border-zinc-700">Vitórias: {user?.stats?.arenaWins || 0}</span>
                    </div>
                </div>

                <div>
                    <div className="flex justify-between items-center mb-3">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Target size={14} /> Oponentes (Matchmaking)</h3>
                          <button onClick={() => setShowOpponentList(!showOpponentList)} className="text-[10px] text-emerald-500 underline">Atualizar Lista</button>
                    </div>
                    
                    {loading ? <div className="text-center py-10"><Loader2 className="animate-spin text-emerald-500 mx-auto"/></div> : (
                        <div className="space-y-3">
                            {opponents.length === 0 && <p className="text-zinc-600 text-xs text-center">Nenhum rival encontrado.</p>}
                            {opponents.map(opp => (
                                <div key={opp.id} onClick={() => startBattle(opp)} className="bg-zinc-900 border border-zinc-800 p-3 rounded-2xl flex items-center justify-between hover:border-emerald-500 transition cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-zinc-700 group-hover:border-emerald-500 transition relative bg-zinc-800">
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="scale-[0.4]"><SharkAvatar size="sm" customColor={opp.customColor} /></div>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-sm">{opp.name} <span className="text-[9px] text-zinc-500">({opp.aiType})</span></h4>
                                            <p className="text-[10px] text-zinc-500 font-bold">Nível {opp.level} • Recompensa: <span className="text-emerald-400">{opp.rewardXP} XP</span></p>
                                        </div>
                                    </div>
                                    <button className="bg-red-600 text-white p-2 rounded-xl hover:bg-red-500 shadow-lg"><Swords size={20}/></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* === ABA 2: VISUAL === */}
        {activeTab === "visual" && battleState === "idle" && (
             <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="bg-zinc-900 rounded-3xl border border-zinc-800 h-64 flex items-center justify-center relative overflow-hidden bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]">
                    <div className="transform scale-[1.5] translate-y-4">
                        <SharkAvatar name={heroName} size="xl" customColor={heroColor} customEyeColor={heroEyeColor} level={myLevel} />
                    </div>
                </div>
                
                <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-black p-2 rounded-lg border border-zinc-700"><User size={16} className="text-emerald-500" /></div>
                        {isEditingName ? (
                            <input type="text" className="bg-zinc-800 border border-emerald-500 rounded px-2 py-1 text-sm text-white focus:outline-none w-32 font-bold" value={tempName} onChange={(e) => setTempName(e.target.value)} autoFocus />
                        ) : (
                            <div><p className="text-xs text-zinc-500 uppercase font-bold">Nome de Guerra</p><p className="text-white font-bold">{heroName}</p></div>
                        )}
                    </div>
                    <button onClick={isEditingName ? handleSaveName : () => setIsEditingName(true)} className="p-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-500">{isEditingName ? <Save size={16} /> : <Edit2 size={16} />}</button>
                </div>

                <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 space-y-6">
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm mb-3 uppercase"><Palette size={16} className="text-emerald-500" /> Pele</h3>
                        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">{["#64748b", "#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef"].map((color) => (<button key={color} onClick={() => setHeroColor(color)} className={`w-10 h-10 rounded-full border-4 shrink-0 transition ${heroColor === color ? "border-white scale-110 shadow-lg ring-2 ring-emerald-500" : "border-zinc-800"}`} style={{ backgroundColor: color }} />))}</div>
                    </div>
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm mb-3 uppercase"><Eye size={16} className="text-blue-400" /> Olhos</h3>
                        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">{["#0f172a", "#3b82f6", "#ef4444", "#22c55e", "#eab308", "#ffffff"].map((color) => (<button key={color} onClick={() => setHeroEyeColor(color)} className={`w-10 h-10 rounded-full border-4 shrink-0 flex items-center justify-center transition ${heroEyeColor === color ? "border-white scale-110" : "border-zinc-800"}`} style={{ backgroundColor: color }}><div className="w-2 h-2 bg-white rounded-full opacity-50"></div></button>))}</div>
                    </div>
                </div>
            </div>
        )}

        {/* === ABA 3: STATUS === */}
        {activeTab === "stats" && battleState === "idle" && myStats && (
            <div className="space-y-6 animate-in slide-in-from-right-8">
                <div className="flex justify-center py-4 relative">
                    <div className="relative w-[300px] h-[300px]">
                         <svg viewBox="0 0 300 300" className="w-full h-full overflow-visible drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                            {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => {
                                const r = 120 * scale;
                                const pts = [0, 1, 2, 3, 4, 5].map(i => {
                                    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                                    return `${150 + r * Math.cos(a)},${150 + r * Math.sin(a)}`;
                                }).join(" ");
                                return <polygon key={scale} points={pts} fill="none" stroke="#27272a" strokeWidth="1"/>
                            })}
                            
                            <polygon 
                                points={calculateRadarPolygon()} 
                                fill="rgba(16, 185, 129, 0.4)" 
                                stroke="#10b981" 
                                strokeWidth="2"
                                className="transition-all duration-1000 ease-out"
                            />

                            <text x="150" y="20" textAnchor="middle" fill="#ef4444" fontSize="12" fontWeight="900">FOR</text>
                            <text x="270" y="80" textAnchor="middle" fill="#a855f7" fontSize="12" fontWeight="900">INT</text>
                            <text x="270" y="240" textAnchor="middle" fill="#3b82f6" fontSize="12" fontWeight="900">DEF</text>
                            <text x="150" y="290" textAnchor="middle" fill="#eab308" fontSize="12" fontWeight="900">STA</text>
                            <text x="30" y="240" textAnchor="middle" fill="#ec4899" fontSize="12" fontWeight="900">HP</text>
                            <text x="30" y="80" textAnchor="middle" fill="#f97316" fontSize="12" fontWeight="900">ATK</text>
                        </svg>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {Object.entries(myStats).map(([key, value]) => { 
                        const conf = STAT_CONFIG[key as keyof HeroStats]; 
                        return (
                            <div key={key} className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 flex items-center gap-4">
                                <div className={`p-3 rounded-xl bg-black border border-zinc-800 ${conf.color}`}><conf.icon size={20} /></div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1"><h3 className="font-bold text-white text-sm uppercase">{conf.label}</h3><span className={`text-lg font-black ${conf.color}`}>{Math.floor(value)}</span></div>
                                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full ${conf.color.replace('text', 'bg')}`} style={{ width: `${Math.min((value/MAX_SERVER_STAT)*100, 100)}%` }}></div></div>
                                    <p className="text-[10px] text-zinc-500 mt-1">{conf.desc} <span className="text-white font-bold">({conf.source})</span></p>
                                </div>
                            </div>
                        ); 
                    })}
                </div>
            </div>
        )}

        {/* === ABA 4: RANKING REAL === */}
        {activeTab === "ranking" && battleState === "idle" && (
            <div className="space-y-4 animate-in fade-in">
                <div className="bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden">
                    <div className="p-4 bg-black/20 border-b border-zinc-800 flex items-center gap-2"><Trophy size={18} className="text-yellow-500"/><h3 className="font-black text-white uppercase text-sm">Hall da Fama (Top 100)</h3></div>
                    <div className="divide-y divide-zinc-800/50">
                        {rankingList.map((rankUser, index) => (
                            <Link href={`/perfil/${rankUser.id}`} key={rankUser.id} className="flex items-center p-4 hover:bg-zinc-800/20 transition cursor-pointer">
                                <span className={`font-black w-8 text-center ${index < 3 ? 'text-yellow-500 text-lg' : 'text-zinc-600 text-sm'}`}>#{index+1}</span>
                                <div className="w-10 h-10 rounded-full border border-zinc-700 bg-zinc-800 overflow-hidden shrink-0 relative">
                                    <Image src={rankUser.foto} alt={rankUser.name} fill className="object-cover" unoptimized/>
                                </div>
                                <div className="w-8 h-8 rounded-full border border-zinc-700 bg-black overflow-hidden shrink-0 -ml-3 z-10 flex items-center justify-center">
                                    <div className="scale-[0.3]"><SharkAvatar size="sm" customColor={rankUser.customColor} /></div>
                                </div>
                                <div className="flex-1 ml-3">
                                    <p className="font-bold text-white text-sm flex items-center gap-1">{rankUser.name} {rankUser.id === user?.uid && <span className="text-[8px] bg-emerald-900 text-emerald-400 px-1 rounded">VOCÊ</span>}</p>
                                    <p className="text-[10px] text-zinc-500 font-bold flex items-center gap-1"><Zap size={10} className="text-yellow-500"/> {Math.floor(rankUser.power)} Poder</p>
                                </div>
                                <div className="text-right">
                                    <div className="flex items-center gap-2 justify-end"><span className="text-emerald-500 text-xs font-black">{rankUser.wins}V</span><span className="text-red-500 text-[10px] font-bold opacity-60">{rankUser.losses}D</span></div>
                                    <p className="text-[8px] text-zinc-600 uppercase font-bold tracking-widest">Arena</p>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* === TELA DE COMBATE === */}
        {battleState !== "idle" && (
            <div className="fixed inset-0 z-[9999] bg-black flex flex-col animate-in fade-in duration-300">
                <div className="flex-1 relative bg-cover bg-center" style={{ backgroundImage: `url('/battle-forest.webp')` }}>
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"></div>
                    <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-emerald-900/20 to-black z-0 mix-blend-overlay"></div>

                    <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded-full border border-white/10 text-xs font-bold text-white z-20">Round {round}/{MAX_ROUNDS}</div>

                    {floatingEffects.map((e, i) => (
                        <div key={i} className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-4xl font-black text-white animate-bounce z-50 text-shadow-lg" style={{ color: e.type === 'crit' ? '#facc15' : e.type === 'miss' ? '#a1a1aa' : e.type === 'heal' ? '#10b981' : '#ef4444' }}>{e.type === 'miss' ? 'MISS' : e.value}</div>
                    ))}
                    
                    {enemy && (
                        <div className="absolute top-[15%] right-[10%] flex flex-col items-center z-10">
                            <div className="flex justify-between w-32 mb-1"><span className="text-[12px] font-bold text-white">{enemy.name}</span><span className="text-[10px] font-bold text-red-500">Lv.{enemy.level}</span></div>
                            <div className="w-32 h-4 bg-zinc-800 rounded-full mb-1 border border-zinc-600 overflow-hidden relative">
                                <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${(enemy.currentHp / enemy.maxHp) * 100}%` }}></div>
                                <span className="absolute inset-0 text-[10px] flex items-center justify-center font-bold text-white shadow-sm">{canSeeEnemyStats ? `${enemy.currentHp}/${enemy.maxHp}` : "??/??"}</span>
                            </div>
                            <div className="w-32 h-2 bg-zinc-900 rounded-full mb-2 overflow-hidden relative border border-zinc-700">
                                <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${(enemy.currentStamina / enemy.maxStamina) * 100}%` }}></div>
                            </div>
                            <div className="scale-125"><SharkAvatar size="lg" customColor={enemy.customColor} level={enemy.level} /></div>
                        </div>
                    )}
                    
                    {hero && (
                        <div className="absolute bottom-[15%] left-[10%] flex flex-col items-center z-10">
                            <span className="mb-2 font-bold text-emerald-500 bg-black/50 px-2 py-1 rounded text-sm">{hero.name} <span className="text-white text-[10px]">Lv.{hero.level}</span></span>
                            <div className="scale-150"><SharkAvatar size="lg" customColor={hero.customColor} customEyeColor={hero.customEyeColor} level={hero.level} /></div>
                            <div className="w-32 h-4 bg-zinc-800 rounded-full mt-4 border border-zinc-600 overflow-hidden relative">
                                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(hero.currentHp / hero.maxHp) * 100}%` }}></div>
                                <span className="absolute inset-0 text-[10px] flex items-center justify-center font-bold text-white shadow-sm">{hero.currentHp}/{hero.maxHp}</span>
                            </div>
                            <div className="w-32 h-2 bg-zinc-900 rounded-full mt-1 overflow-hidden relative border border-zinc-700">
                                <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${(hero.currentStamina / hero.maxStamina) * 100}%` }}></div>
                            </div>
                        </div>
                    )}
                    
                    <div className="absolute top-4 left-4 right-4 h-24 bg-black/50 border border-white/10 rounded-xl p-2 overflow-y-auto font-mono text-[10px] text-emerald-400 z-20">
                        {battleLog.map((l, i) => <div key={i}>{">"} {l}</div>)}
                        <div ref={battleLogRef} />
                    </div>
                </div>

                <div className="bg-zinc-900 p-4 border-t border-zinc-800 pb-10">
                    {battleState === 'combat' ? (
                        <div className="grid grid-cols-2 gap-3">
                            {turn !== 'player' && <div className="absolute inset-0 bg-black/70 z-10 flex items-center justify-center text-white font-black uppercase tracking-widest animate-pulse">Vez do Oponente...</div>}
                            {HERO_MOVES.map(move => (
                                <button key={move.id} onClick={() => handleAttack(move)} className={`${move.color} p-4 rounded-xl text-white flex flex-col items-center justify-center border-b-4 border-black/20 active:border-b-0 active:translate-y-1 transition disabled:opacity-50 disabled:cursor-not-allowed`} disabled={turn !== 'player'}>
                                    <span className="text-2xl mb-1">{move.icon}</span>
                                    <span className="font-black text-xs uppercase">{move.name}</span>
                                    <span className="text-[8px] bg-black/20 px-1.5 rounded mt-1 opacity-80">{move.staminaCost} STA</span>
                                </button>
                            ))}
                            <button onClick={handleFlee} className="col-span-2 bg-zinc-800 text-zinc-400 p-2 rounded-xl border border-zinc-700 hover:bg-red-950/30 hover:text-red-500 transition text-[10px] font-bold uppercase flex items-center justify-center gap-2">
                                <LogOut size={14}/> Fugir da Batalha
                            </button>
                        </div>
                    ) : (
                        <div className="text-center space-y-4">
                            <h2 className={`text-4xl font-black uppercase italic ${battleState === 'victory' ? 'text-emerald-500' : 'text-red-500'}`}>{battleState === 'victory' ? 'VITÓRIA!' : battleState === 'defeat' ? 'DERROTA...' : 'EMPATE!'}</h2>
                            <p className="text-zinc-400 text-xs">A batalha terminou.</p>
                            <button onClick={() => { setBattleState("idle"); setShowOpponentList(false); clearGameState(); }} className="w-full bg-white text-black font-black uppercase py-4 rounded-xl">Voltar ao Lobby</button>
                        </div>
                    )}
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

