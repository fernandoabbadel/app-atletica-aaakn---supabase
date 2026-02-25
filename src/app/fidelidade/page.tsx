"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft, Gift, Info, Lock, Star, Clock, CheckCircle2, Loader2
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  fetchFidelityConfig,
  fetchFidelityHistory,
  fetchFidelityRewards,
  requestFidelityRedemption,
  type FidelityConfig,
  type FidelityHistoryItem,
  type FidelityReward,
} from "../../lib/fidelityService";

// --- INTERFACES ---
type Premio = FidelityReward;
type HistoricoItem = FidelityHistoryItem;
type ConfigFidelidade = FidelityConfig;

export default function FidelidadePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"cartao" | "regras">("cartao");
  
  // Estados de Dados Reais
  const [loading, setLoading] = useState(true);
  const [premios, setPremios] = useState<Premio[]>([]);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [config, setConfig] = useState<ConfigFidelidade>({ xpPerStamp: 100, rules: [] });

  // 1. CARREGAR DADOS DO FIREBASE
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      try {
        const [configData, premiosData, historyData] = await Promise.all([
          fetchFidelityConfig(),
          fetchFidelityRewards({ activeOnly: true, maxResults: 80 }),
          fetchFidelityHistory(user.uid, { maxResults: 20 }),
        ]);

        if (!mounted) return;
        setConfig(configData);
        setPremios(premiosData);
        setHistorico(historyData);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar fidelidade.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadData();
    return () => {
      mounted = false;
    };
  }, [user, addToast]);

  if (!user || loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={40}/></div>;

  // CÁLCULOS DINÂMICOS
  const userXP = user.xp || 0;
  const XP_POR_SELO = config.xpPerStamp;
  const TOTAL_SELOS = 10;

  const selosConquistados = Math.min(Math.floor(userXP / XP_POR_SELO), TOTAL_SELOS);
  const progresso = (selosConquistados / TOTAL_SELOS) * 100;
  const xpProximoSelo = (selosConquistados + 1) * XP_POR_SELO - userXP;

  // AÇÃO: RESGATAR
  const handleResgatar = async (premio: Premio) => {
    if (userXP < premio.cost) return addToast("XP insuficiente, marujo!", "error");
    if (premio.stock <= 0) return addToast("Estoque esgotado! 😢", "error");

    const confirm = window.confirm(`Deseja reservar o item "${premio.title}"? Vá à atlética para retirar.`);
    if (!confirm) return;

    try {
        await requestFidelityRedemption({
            userId: user.uid,
            userName: user.nome || "Atleta",
            reward: premio,
        });
        setPremios((prev) =>
          prev.map((item) =>
            item.id === premio.id
              ? { ...item, stock: Math.max(0, item.stock - 1) }
              : item
          )
        );
        addToast("Resgate solicitado! Apresente seu ID na lojinha.", "success");
    } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao processar resgate.", "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24 font-sans selection:bg-emerald-500/30">
      
      {/* HEADER */}
      <header className="p-4 sticky top-0 z-30 flex items-center gap-4 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 shadow-lg">
        <Link href="/dashboard" className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-white/5 transition">
          <ArrowLeft size={24} />
        </Link>
        <div className="flex-1">
          <h1 className="font-black text-lg italic uppercase tracking-tighter text-white leading-none">Shark Card</h1>
          <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Programa de Fidelidade</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full flex items-center gap-2 shadow-inner">
          <Star size={12} className="text-yellow-500 fill-yellow-500" />
          <span className="text-xs font-bold text-white">{userXP} XP</span>
        </div>
      </header>

      <main className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* CONTROLES DE ABA */}
        <div className="bg-zinc-900/80 p-1 rounded-xl flex border border-zinc-800 shadow-sm">
          <button onClick={() => setActiveTab("cartao")} className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${activeTab === "cartao" ? "bg-emerald-600 text-white shadow-lg" : "text-zinc-500 hover:text-white"}`}>Meu Cartão</button>
          <button onClick={() => setActiveTab("regras")} className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${activeTab === "regras" ? "bg-emerald-600 text-white shadow-lg" : "text-zinc-500 hover:text-white"}`}>Prêmios & Regras</button>
        </div>

        {activeTab === "cartao" ? (
          <div className="space-y-6">
            
            {/* CARTÃO DIGITAL */}
            <div className="relative w-full max-w-sm mx-auto aspect-[1.58/1] rounded-3xl overflow-hidden shadow-2xl transition-transform hover:scale-[1.01] duration-500 group border border-white/10 ring-1 ring-emerald-500/20">
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-[#064e3b] z-0"></div>
              <div className="absolute -top-20 -right-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] animate-pulse"></div>
              <div className="absolute bottom-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 z-0"></div>

              <div className="relative z-10 p-6 flex flex-col justify-between h-full">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    {/* 🦈 Image otimizado */}
                    <Image src="/logo.png" width={40} height={40} className="object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]" alt="Logo Atlética" unoptimized/>
                    <div>
                      <h2 className="text-base font-black italic uppercase tracking-tighter text-white leading-none">Shark Card</h2>
                      <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest mt-0.5">Membro Oficial</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-zinc-300 uppercase tracking-widest">{user.nome ? user.nome.split(" ")[0] : "Atleta"}</p>
                    <p className="text-[9px] text-zinc-500 font-mono tracking-widest">ID: {user.matricula || "0000"}</p>
                  </div>
                </div>

                {/* GRID DE SELOS */}
                <div className="flex-1 flex items-center justify-center py-2">
                  <div className="grid grid-cols-5 gap-3 w-full max-w-[260px]">
                    {Array.from({ length: TOTAL_SELOS }).map((_, i) => {
                      const conquistado = i < selosConquistados;
                      return (
                        <div key={i} className="aspect-square relative flex items-center justify-center">
                          <div className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-500 border overflow-hidden relative ${conquistado ? "bg-emerald-500 border-emerald-400 shadow-[0_0_15px_#10b981]" : "bg-black/40 border-dashed border-zinc-700"}`}>
                            {conquistado ? (
                              <Image src="/logo.png" fill className="object-contain p-1 mix-blend-multiply opacity-80 filter brightness-0" alt="Selo Conquistado" unoptimized/>
                            ) : (
                              <span className="text-[8px] font-black text-white/10">{i + 1}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                    <span>Progresso</span>
                    <span className={selosConquistados === TOTAL_SELOS ? "text-yellow-400 animate-pulse" : "text-emerald-400"}>
                      {selosConquistados === TOTAL_SELOS ? "COMPLETO!" : `${xpProximoSelo > 0 ? `Faltam ${xpProximoSelo} XP` : "Resgate disponível!"}`}
                    </span>
                  </div>
                  <div className="h-2 bg-black/60 rounded-full overflow-hidden border border-white/5 backdrop-blur-sm">
                    <div className="h-full bg-gradient-to-r from-emerald-700 to-emerald-400 shadow-[0_0_10px_#10b981] transition-all duration-1000 ease-out" style={{ width: `${progresso}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* HISTÓRICO */}
            <section>
              <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-emerald-500" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-widest">Extrato de XP</h3>
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {historico.length === 0 && <p className="text-center text-xs text-zinc-600 py-4">Nenhuma atividade recente.</p>}
                {historico.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/50 transition">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center border border-white/5 bg-emerald-900/20 text-emerald-500">
                        <CheckCircle2 size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-200">{item.acao}</p>
                        <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide">{item.dataDisplay}</p>
                      </div>
                    </div>
                    <span className="text-xs font-black text-emerald-400 bg-emerald-900/20 px-2 py-1 rounded">+{item.xp} XP</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="animate-in slide-in-from-right-4 duration-500 space-y-6">
            
            {/* REGRAS */}
            <section className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl space-y-4 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20"><Info size={20} /></div>
                <div><h3 className="font-bold text-white text-sm uppercase">Regras do Jogo</h3><p className="text-[10px] text-zinc-500">Entenda como turbinar seu card</p></div>
              </div>
              <ul className="space-y-3 pl-2">
                <RegraItem texto={`A cada ${XP_POR_SELO} XP acumulados, você ganha 1 Selo do Tubarão automaticamente.`} />
                {config.rules.length > 0 ? config.rules.map((rule, i) => <RegraItem key={i} texto={rule.replace("{XP}", XP_POR_SELO.toString())} />) : <RegraItem texto="Acumule XP para trocar por prêmios na lojinha."/>}
              </ul>
            </section>

            {/* VITRINE */}
            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 px-1 flex items-center gap-2"><Gift size={14} /> Vitrine de Recompensas</h3>
              <div className="space-y-4">
                {premios.length === 0 && <p className="text-center text-xs text-zinc-600">Nenhum prêmio disponível no momento.</p>}
                {premios.map((premio) => {
                  const bloqueado = userXP < premio.cost;
                  const progressoItem = Math.min((userXP / premio.cost) * 100, 100);

                  return (
                    <div key={premio.id} className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl flex gap-4 items-center group relative overflow-hidden">
                      <div className="absolute bottom-0 left-0 h-1 bg-emerald-500 transition-all duration-1000" style={{ width: `${progressoItem}%`, opacity: bloqueado ? 0.2 : 1 }}></div>

                      <div className={`w-16 h-16 rounded-xl overflow-hidden border border-zinc-700 shrink-0 relative ${bloqueado ? "grayscale opacity-60" : "border-emerald-500/50 shadow-lg shadow-emerald-900/20"}`}>
                        <Image 
                            src={premio.image || "/placeholder.png"} 
                            alt={premio.title}
                            fill
                            className="object-cover" 
                            unoptimized
                        />
                      </div>

                      <div className="flex-1">
                        <h4 className={`font-bold text-sm ${bloqueado ? "text-zinc-400" : "text-white"}`}>{premio.title}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${bloqueado ? "bg-zinc-800 text-zinc-500" : "bg-emerald-900/30 text-emerald-400"}`}>{premio.cost} XP</span>
                          {bloqueado && <span className="text-[9px] text-zinc-600">Faltam {premio.cost - userXP} XP</span>}
                          {premio.stock <= 0 && <span className="text-[9px] text-red-500 font-bold uppercase">Esgotado</span>}
                        </div>
                      </div>

                      <button onClick={() => handleResgatar(premio)} disabled={bloqueado || premio.stock <= 0} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${bloqueado || premio.stock <= 0 ? "bg-zinc-800 text-zinc-600 border border-zinc-700" : "bg-emerald-600 text-white hover:scale-110 shadow-[0_0_20px_rgba(16,185,129,0.4)] border border-emerald-400"}`}>
                        {bloqueado ? <Lock size={18} /> : <Gift size={20} className="animate-bounce-slow" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function RegraItem({ texto }: { texto: string }) {
  return (
    <li className="flex items-start gap-3 text-xs text-zinc-300 font-medium leading-relaxed group">
      <div className="w-1.5 h-1.5 bg-emerald-600 rounded-full mt-1.5 shrink-0 group-hover:bg-emerald-400 group-hover:shadow-[0_0_8px_#10b981] transition"></div>
      {texto}
    </li>
  );
}
