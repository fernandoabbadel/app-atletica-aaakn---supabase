"use client";

import React, { useState, useMemo, useEffect } from "react";
import { 
  ArrowLeft, Lock, CheckCircle2, ChevronLeft, ChevronRight, 
  Fish, Rocket, Swords, Skull, ShoppingBag, Gem, PartyPopper, 
  Beer, Ticket, BookOpen, DollarSign, HeartHandshake, Heart, Megaphone, 
  ShieldAlert, Crown, Activity, Dumbbell, Flame, Zap, Wallet, Timer, MessageCircle, Gamepad2,
  ThumbsUp, LayoutGrid, UserPlus, Target, Star, Ghost, Medal,
  Briefcase, GraduationCap, AlertTriangle, Database, Wrench, Bot
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext"; 
import { useTenantTheme } from "../../context/TenantThemeContext";
import { ACHIEVEMENTS_CATALOG, AchievementCategory } from "../../lib/achievements";
import {
  fetchAchievementsConfig,
  fetchPatentesConfig,
  type AchievementConfigRecord,
  type PatenteConfigRecord,
} from "../../lib/achievementsService";
import {
  fetchTenantMembershipDirectory,
  resolveTenantScopedStats,
  resolveTenantScopedXp,
} from "../../lib/tenantMembershipDirectory";

// 🦈 Tipagem Segura para o Mapa de Ícones
const IconMap: Record<string, React.ElementType> = {
    Fish, Rocket, Swords, Skull,
    ShoppingBag, Gem, PartyPopper,
    Beer, Ticket, BookOpen, DollarSign,
    HeartHandshake, Heart, Megaphone,
    ShieldAlert, Activity, Dumbbell,
    Flame, Crown, Zap, Wallet,
    Timer, MessageCircle, Gamepad2,
    ThumbsUp, LayoutGrid, CheckCircle2,
    UserPlus, Target, Star, Ghost, Medal,
    Briefcase, GraduationCap, Diamond: Gem, Beiceps: Dumbbell
};

// 🦈 Interfaces para eliminar any
interface AchievementConfig {
    id: string;
    titulo: string;
    desc: string;
    xp: number;
    target: number;
    statKey: string;
    cat: AchievementCategory;
    iconName: string;
    iconEmoji?: string;
}

interface AchievementDisplay extends AchievementConfig {
    progress: number;
    isUnlocked: boolean;
    keyExists: boolean;
}

interface BadgeConfig {
    id: string;
    titulo: string;
    minXp: number;
    cor: string;
    bg: string;
    border: string;
    iconName: string;
}

const DEFAULT_BADGES: BadgeConfig[] = [
    { id: "p1", titulo: "Plâncton", minXp: 0, cor: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30", iconName: "Fish" },
    { id: "p2", titulo: "Peixe Palhaço", minXp: 500, cor: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", iconName: "Fish" },
    { id: "p3", titulo: "Barracuda", minXp: 2000, cor: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", iconName: "Swords" },
    { id: "p4", titulo: "Tubarão Martelo", minXp: 5000, cor: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30", iconName: "Fish" },
    { id: "p5", titulo: "Tubarão Branco", minXp: 15000, cor: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", iconName: "Fish" },
    { id: "p6", titulo: "MEGALODON", minXp: 50000, cor: "text-red-600", bg: "bg-red-500/10", border: "border-red-500/30", iconName: "Crown" },
];

const normalizeAchievementCategory = (category: string): AchievementCategory => {
    if (category === "Gym" || category === "Games" || category === "Social" || category === "Loja" || category === "Eventos") {
        return category;
    }
    return "Geral";
};

const mapAchievementConfig = (entry: AchievementConfigRecord): AchievementConfig => ({
    id: entry.id,
    titulo: entry.titulo,
    desc: entry.desc,
    xp: entry.xp,
    target: entry.target,
    statKey: entry.statKey,
    cat: normalizeAchievementCategory(entry.cat),
    iconName: entry.iconName,
});

const DEFAULT_CATALOG_BY_ID = new Map(
  ACHIEVEMENTS_CATALOG.map((item) => [item.id, item] as const)
);

const mergeCatalogWithDefaults = (entries: AchievementConfigRecord[]): AchievementConfig[] => {
  const mapped = entries.map(mapAchievementConfig);
  const mergedEventIds = new Set<string>();
  const withOverrides = mapped.map((entry) => {
    const fallback = DEFAULT_CATALOG_BY_ID.get(entry.id);
    if (!fallback || !entry.id.startsWith("evt_")) {
      return {
        ...entry,
        iconEmoji: fallback?.iconEmoji,
      };
    }
    mergedEventIds.add(entry.id);
    return {
      ...entry,
      titulo: fallback.titulo,
      desc: fallback.desc,
      xp: fallback.xp,
      target: fallback.target,
      statKey: fallback.statKey,
      cat: fallback.cat,
      iconName: fallback.iconName,
      iconEmoji: fallback.iconEmoji,
    };
  });

  const seenIds = new Set(withOverrides.map((item) => item.id));
  const missingDefaults = ACHIEVEMENTS_CATALOG.filter((item) => !seenIds.has(item.id));

  return [...withOverrides, ...missingDefaults];
};

const mapBadgeConfig = (entry: PatenteConfigRecord): BadgeConfig => ({
    id: entry.id,
    titulo: entry.titulo,
    minXp: entry.minXp,
    cor: entry.cor,
    bg: entry.bg || "bg-zinc-500/10",
    border: entry.border || "border-zinc-500/30",
    iconName: entry.iconName,
});

export default function ConquistasPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId: activeTenantId } = useTenantTheme();
  const [filtro, setFiltro] = useState<AchievementCategory | "Todas">("Todas");
  
  const [catalog, setCatalog] = useState<AchievementConfig[]>(ACHIEVEMENTS_CATALOG);
  const [badgesList, setBadgesList] = useState<BadgeConfig[]>(DEFAULT_BADGES);
  const [tenantScopedStats, setTenantScopedStats] = useState<Record<string, number | undefined>>({});
  const [tenantScopedXp, setTenantScopedXp] = useState(0);
  
  const [debugMode, setDebugMode] = useState(false);
  
  // 🦈 Verificação segura de role
  const role = typeof user?.role === 'string' ? user.role : '';
  const isAdmin = role === 'master' || role.includes('admin');
  const effectiveTenantId =
    activeTenantId || (typeof user?.tenant_id === "string" ? user.tenant_id.trim() : "");
  useEffect(() => {
      if (!user) {
          setTenantScopedStats({});
          setTenantScopedXp(0);
          return;
      }

      let mounted = true;

      const loadCatalogData = async () => {
          try {
              const membershipPromise =
                  effectiveTenantId
                      ? fetchTenantMembershipDirectory({
                            tenantId: effectiveTenantId,
                            userIds: [user.uid],
                            statuses: ["approved", "pending", "disabled"],
                            limit: 1,
                        })
                      : Promise.resolve([]);

              const [catalogData, badgesData, membershipRows] = await Promise.all([
                  fetchAchievementsConfig({
                      maxResults: 220,
                      tenantId: effectiveTenantId || undefined,
                  }),
                  fetchPatentesConfig({
                      maxResults: 40,
                      tenantId: effectiveTenantId || undefined,
                  }),
                  membershipPromise,
              ]);

              if (!mounted) return;

              const membership = membershipRows[0];
              setTenantScopedStats(
                  membership
                      ? (resolveTenantScopedStats(membership) as Record<string, number | undefined>)
                      : (user.stats ?? {})
              );
              setTenantScopedXp(
                  membership ? resolveTenantScopedXp(membership) : Math.max(0, user.xp || 0)
              );

              if (catalogData.length > 0) {
                  setCatalog(mergeCatalogWithDefaults(catalogData));
              } else {
                  setCatalog(ACHIEVEMENTS_CATALOG);
              }

              if (badgesData.length > 0) {
                  setBadgesList(badgesData.map(mapBadgeConfig));
              }
          } catch (error: unknown) {
              console.error(error);
              if (mounted) {
                  setTenantScopedStats(user.stats ?? {});
                  setTenantScopedXp(Math.max(0, user.xp || 0));
                  addToast("Nao foi possivel sincronizar conquistas agora.", "error");
              }
          }
      };

      void loadCatalogData();
      return () => {
          mounted = false;
      };
  }, [addToast, effectiveTenantId, user]);

  const userStats = useMemo(() => tenantScopedStats, [tenantScopedStats]); 
  
  // 🦈 useMemo otimizado e seguro
  const calculatedAchievements = useMemo(() => {
      let unlockedCount = 0;
      let totalXp = 0;
      const missingKeys: string[] = []; // 🦈 Const aqui (array mutável é ok)

      const processed: AchievementDisplay[] = catalog.map(ach => {
          const keyExists = userStats && Object.prototype.hasOwnProperty.call(userStats, ach.statKey);
          // 🦈 Acesso seguro ao userStats com index signature implícita
          const userValue = userStats ? (userStats[ach.statKey] || 0) : 0;
          const isUnlocked = userValue >= ach.target;
          
          if (!keyExists && !missingKeys.includes(ach.statKey)) {
              missingKeys.push(ach.statKey);
          }
          
          if (isUnlocked) {
              unlockedCount++;
              totalXp += ach.xp;
          }

          return { ...ach, progress: userValue, isUnlocked, keyExists };
      });

      processed.sort((a, b) => (a.isUnlocked === b.isUnlocked ? 0 : a.isUnlocked ? -1 : 1));

      return { list: processed, unlockedCount, totalXp, missingKeys };
  }, [catalog, userStats]);

  const displayXp = Math.max(tenantScopedXp, calculatedAchievements.totalXp);

  const generateIAPrompt = () => {
      const missing = calculatedAchievements.missingKeys;
      if (missing.length === 0) {
          addToast("Tudo certo! Nenhuma chave faltando.", "success");
          return;
      }

      const promptText = `
Olá Gemini! Estou debugando meu sistema de Conquistas (Gamification).
O App detectou que as seguintes chaves ('statKeys') estão faltando no banco de dados do usuário (objeto 'user.stats') ou não estão sendo inicializadas:

${missing.map(k => `- ${k}`).join('\n')}

Por favor, analise onde essas chaves deveriam ser atualizadas (ex: ao fazer login, ao postar, ao confirmar treino) e me forneça o código para corrigir/implementar esses incrementos no Supabase.
      `.trim();

      navigator.clipboard.writeText(promptText);
      addToast("Prompt copiado! Cole no Gemini. 🤖", "success");
  };

  const currentBadgeIndex = badgesList.slice().reverse().findIndex(b => displayXp >= b.minXp);
  const realCurrentIndex = currentBadgeIndex === -1 ? 0 : badgesList.length - 1 - currentBadgeIndex;
  const [viewIndex, setViewIndex] = useState(realCurrentIndex);

  useEffect(() => { if (badgesList.length > 0) setViewIndex(realCurrentIndex); }, [realCurrentIndex, badgesList]);

  const displayedBadge = badgesList[viewIndex] || DEFAULT_BADGES[0];
  const isCurrent = viewIndex === realCurrentIndex;
  const isLocked = viewIndex > realCurrentIndex;
  const isPast = viewIndex < realCurrentIndex;

  let progressPercent = 0;
  let xpNeeded = 0;

  if (isPast) progressPercent = 100; 
  else if (isCurrent) {
      const nextBadge = badgesList[viewIndex + 1];
      if (nextBadge) {
          const totalRange = nextBadge.minXp - displayedBadge.minXp;
          const currentProgress = displayXp - displayedBadge.minXp;
          progressPercent = totalRange > 0 ? Math.min(Math.max((currentProgress / totalRange) * 100, 0), 100) : 100;
          xpNeeded = nextBadge.minXp - displayXp;
      } else {
          progressPercent = 100;
      }
  } else if (isLocked) {
      progressPercent = 0; 
      xpNeeded = displayedBadge.minXp - displayXp;
  }

  const handleNext = () => { if (viewIndex < badgesList.length - 1) setViewIndex(viewIndex + 1); };
  const handlePrev = () => { if (viewIndex > 0) setViewIndex(viewIndex - 1); };

  const filteredList = filtro === "Todas" 
    ? calculatedAchievements.list 
    : calculatedAchievements.list.filter(c => c.cat === filtro);

  const renderBadgeIcon = (iconName: string, isLocked: boolean) => {
      const Icon = IconMap[iconName] || Fish;
      return <Icon size={64} className={isLocked ? 'opacity-50 blur-[2px]' : ''} />;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-10 selection:bg-emerald-500/30">
      
      <header className="p-4 sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md flex items-center gap-3 border-b border-white/5 shadow-lg">
        <Link href="/dashboard" className="p-2 -ml-2 text-zinc-400 hover:text-white transition rounded-full hover:bg-zinc-900">
          <ArrowLeft size={24} />
        </Link>
        <div className="flex-1">
            <h1 className="font-black text-lg italic uppercase tracking-tighter">Sala de Troféus</h1>
            <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">
                {calculatedAchievements.unlockedCount} / {catalog.length} Desbloqueadas
            </p>
        </div>
        
        {isAdmin && (
            <div className="flex gap-2">
                {debugMode && (
                    <button 
                        onClick={generateIAPrompt}
                        className="p-2 rounded-lg border bg-blue-500/20 border-blue-500 text-blue-400 hover:bg-blue-500/30 transition flex items-center gap-2"
                        title="Gerar Relatório para IA"
                    >
                        <Bot size={18} />
                        <span className="text-[10px] font-bold uppercase hidden sm:inline">Relatório IA</span>
                    </button>
                )}
                <button 
                    onClick={() => setDebugMode(!debugMode)}
                    className={`p-2 rounded-lg border transition ${debugMode ? 'bg-red-500/20 border-red-500 text-red-500 animate-pulse' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}
                >
                    <Wrench size={18} />
                </button>
            </div>
        )}
      </header>

      <main className="p-4 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* ALERTA DE DEBUG GLOBAL */}
        {debugMode && calculatedAchievements.missingKeys.length > 0 && (
            <div className="bg-red-950/50 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 animate-pulse">
                <AlertTriangle size={24} className="text-red-500 shrink-0" />
                <div className="flex-1">
                    <h3 className="text-sm font-bold text-red-200">Atenção, Tubarão Dev!</h3>
                    <p className="text-xs text-red-400 mb-2">Existem <b>{calculatedAchievements.missingKeys.length}</b> chaves de banco ausentes.</p>
                    <button 
                        onClick={generateIAPrompt}
                        className="text-[10px] font-bold bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition"
                    >
                        Copiar Relatório de Erros
                    </button>
                </div>
            </div>
        )}

        {/* CARROSSEL DE NÍVEL */}
        <section className={`relative overflow-hidden rounded-3xl border ${displayedBadge.border || 'border-zinc-800'} ${displayedBadge.bg || 'bg-zinc-900'} p-6 text-center shadow-2xl transition-colors duration-500`}>
            <button onClick={handlePrev} disabled={viewIndex === 0} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-20 transition"><ChevronLeft size={32}/></button>
            <button onClick={handleNext} disabled={viewIndex === badgesList.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/50 hover:text-white disabled:opacity-20 transition"><ChevronRight size={32}/></button>
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
            <div className="relative z-10 px-6">
                <div className={`mx-auto mb-4 flex h-28 w-28 items-center justify-center rounded-full bg-zinc-950/80 border-4 ${displayedBadge.border || 'border-zinc-700'} shadow-[0_0_40px_rgba(0,0,0,0.3)] transition-all duration-500`}>
                    <div className={`drop-shadow-lg ${displayedBadge.cor || 'text-zinc-400'} ${isLocked ? 'grayscale' : ''}`}>
                        {isLocked ? <Lock size={48}/> : renderBadgeIcon(displayedBadge.iconName, isLocked)}
                    </div>
                </div>
                <h2 className={`text-3xl font-black uppercase italic tracking-tighter ${displayedBadge.cor || 'text-white'} drop-shadow-md transition-all duration-500`}>{displayedBadge.titulo}</h2>
                <div className="mt-2 min-h-[60px] flex flex-col items-center justify-center">
                    {isCurrent && (
                        <div className="w-full animate-in zoom-in duration-300">
                            <span className="text-[10px] font-bold text-white bg-emerald-500/20 px-3 py-1 rounded-full border border-emerald-500/30 uppercase tracking-widest mb-3 inline-block">Patente Atual</span>
                            <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/5"><div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" style={{ width: `${progressPercent}%` }}></div></div>
                            <p className="text-[10px] text-zinc-400 mt-2 font-mono">{displayXp.toLocaleString()} / {badgesList[viewIndex + 1]?.minXp.toLocaleString() || "MAX"} XP</p>
                        </div>
                    )}
                    {isPast && (<div className="animate-in zoom-in duration-300"><div className="flex items-center gap-2 text-emerald-500 font-bold bg-emerald-950/50 px-4 py-2 rounded-xl border border-emerald-900"><CheckCircle2 size={16}/> <span>Conquistado</span></div></div>)}
                    {isLocked && (<div className="animate-in zoom-in duration-300"><p className="text-xs text-zinc-500 font-bold uppercase mb-1">Bloqueado</p><p className="text-sm font-mono text-white">Necessário <span className="text-red-400 font-black">{displayedBadge.minXp.toLocaleString()} XP</span></p><p className="text-[10px] text-zinc-600 mt-1">Faltam {xpNeeded.toLocaleString()} XP</p></div>)}
                </div>
            </div>
        </section>

        {/* FILTROS */}
        <section className="overflow-x-auto pb-2 scrollbar-hide">
            <div className="flex gap-2">
                {(["Todas", "Gym", "Games", "Loja", "Eventos", "Social"] as Array<AchievementCategory | "Todas">).map((cat) => (
                    <button key={cat} onClick={() => setFiltro(cat)} className={`px-5 py-2.5 rounded-full text-xs font-bold uppercase transition border ${filtro === cat ? "bg-emerald-600 border-emerald-500 text-white shadow-lg" : "bg-zinc-900 border-zinc-800 text-zinc-500"}`}>{cat}</button>
                ))}
            </div>
        </section>

        {/* LISTA DE CONQUISTAS */}
        <section className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
                {filteredList.map((item) => {
                    const percent = Math.min((item.progress / item.target) * 100, 100);
                    const IconComponent = IconMap[item.iconName] || Lock;
                    
                    const isError = !item.keyExists && debugMode;
                    const cardBorder = isError ? "border-red-500 border-2" : item.isUnlocked ? "border-emerald-500/30" : "border-zinc-800/60";
                    const cardBg = isError ? "bg-red-950/20" : item.isUnlocked ? "bg-zinc-900" : "bg-black opacity-60";

                    return (
                        <div key={item.id} className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 group ${cardBg} ${cardBorder}`}>
                            
                            {/* DEBUG INFO OVERLAY */}
                            {debugMode && (
                                <div className="absolute top-2 right-2 text-[9px] font-mono text-right z-20">
                                    <div className={`flex items-center gap-1 ${isError ? 'text-red-400 font-bold' : 'text-zinc-500'}`}>
                                        <Database size={10} /> {item.statKey}
                                    </div>
                                    <div className="text-emerald-500">
                                        Valor: {item.progress}
                                    </div>
                                    {isError && <div className="text-red-500 font-black animate-pulse">CHAVE AUSENTE!</div>}
                                </div>
                            )}

                            <div className="absolute bottom-0 left-0 h-1 bg-emerald-500/20 transition-all duration-1000" style={{ width: `${percent}%` }}></div>

                            <div className="flex items-center gap-4 relative z-10">
                                <div className={`h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center border transition-colors ${item.isUnlocked ? "bg-emerald-500 text-black border-emerald-400" : "bg-zinc-800 text-zinc-600 border-zinc-700"}`}>
                                    <span className="text-2xl">
                                      {item.isUnlocked
                                        ? item.iconEmoji || <IconComponent size={20}/>
                                        : <Lock size={20}/>}
                                    </span>
                                </div>

                                <div className="flex-1 min-w-0 pr-16">
                                    <div className="flex justify-between items-start">
                                        <h4 className={`text-sm font-bold truncate ${item.isUnlocked ? "text-white" : "text-zinc-400"}`}>{item.titulo}</h4>
                                        {item.isUnlocked && <CheckCircle2 size={16} className="text-emerald-500 shrink-0"/>}
                                    </div>
                                    <p className="text-[10px] text-zinc-500 leading-tight mt-0.5 font-medium">{item.desc}</p>
                                    
                                    <div className="mt-3 flex items-center gap-3">
                                        <div className="h-2 flex-1 rounded-full bg-zinc-950 overflow-hidden border border-white/5">
                                            <div className={`h-full rounded-full ${item.isUnlocked ? 'bg-emerald-500' : 'bg-zinc-700'}`} style={{ width: `${percent}%` }}></div>
                                        </div>
                                        <span className={`text-[9px] font-black ${item.isUnlocked ? "text-emerald-400" : "text-zinc-600"}`}>
                                            {item.progress}/{item.target}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className={`absolute top-3 right-3 ${debugMode ? 'opacity-0' : 'opacity-100'}`}>
                                <span className={`text-[8px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${item.isUnlocked ? "bg-emerald-950/50 text-emerald-400 border-emerald-500/20" : "bg-zinc-900 text-zinc-600 border-zinc-800"}`}>
                                    +{item.xp} XP
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>

      </main>
    </div>
  );
}
