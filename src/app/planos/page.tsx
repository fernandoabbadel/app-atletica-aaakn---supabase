"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, Crown, Star, Ghost, CheckCircle, ArrowRight, Loader2, ShoppingBag, Check, Zap, Gem, Trophy, Fish, LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { fetchPlanCatalog, type PlanRecord } from "@/lib/plansService";

// 🦈 2. Tipagem Correta do Mapa de Ícones
const ICONS_MAP: Record<string, LucideIcon> = {
  ghost: Ghost,
  star: Star,
  crown: Crown,
  shopping: ShoppingBag,
  zap: Zap,
  gem: Gem,
  trophy: Trophy,
  fish: Fish
};

export default function PlanosPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  
  // 🦈 3. Estado Tipado (Adeus 'any[]')
  const [planos, setPlanos] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadPlanos = async () => {
      setLoading(true);
      try {
        const data = await fetchPlanCatalog({ maxResults: 30 });
        if (!mounted) return;
        setPlanos(data);
      } catch (error: unknown) {
        console.error(error);
        addToast("Nao foi possivel carregar os planos agora.", "error");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadPlanos();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  // 🦈 CORREÇÃO: Respeita EXATAMENTE a cor que vem do banco
  const getColorClasses = (cor: string) => {
      switch(cor) {
          case 'yellow': return { text: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
          case 'emerald': return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
          case 'purple': return { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' };
          case 'blue': return { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
          case 'red': return { text: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' };
          // Default (Zinc)
          default: return { text: 'text-zinc-400', bg: 'bg-zinc-800', border: 'border-zinc-700' };
      }
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-emerald-500 gap-2"><Loader2 className="animate-spin"/></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500 pb-20">
      
      {/* HEADER */}
      <div className="relative pt-10 pb-20 px-6 overflow-hidden">
          <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[80%] h-[80%] bg-emerald-600/20 blur-[120px] rounded-full pointer-events-none"></div>
          <div className="relative z-10 max-w-4xl mx-auto text-center">
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-zinc-500 hover:text-white mb-6 transition uppercase text-xs font-bold tracking-widest"><ArrowLeft size={16}/> Voltar ao Menu</Link>
              <h1 className="text-4xl md:text-6xl font-black text-white uppercase tracking-tighter mb-4">Seja Sócio <span className="text-emerald-500">Tubarão</span></h1>
              <p className="text-zinc-400 max-w-lg mx-auto text-sm md:text-base">Escolha seu nível de acesso e garanta vantagens exclusivas.</p>
          </div>
      </div>

      {/* GRID */}
      <div className="px-6 relative z-20 -mt-10">
          <div className="max-w-[1600px] mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-end">
              {planos.map(plano => {
                  const Icon = ICONS_MAP[plano.icon] || Star;
                  
                  // Lógica do Plano Ativo
                  const isFree = plano.precoVal === 0;
                  
                  const safeUser = user as { plano_badge?: string; plano?: string } | null;
                  
                  // Se o usuário não tem 'plano_badge' definido, assume que ele é Free (Bicho Solto)
                  const userHasNoPlan = !safeUser?.plano_badge && !safeUser?.plano; 
                  
                  // Verifica correspondência exata pelo nome do plano
                  const isMyPlan = 
                    (userHasNoPlan && isFree) || 
                    (safeUser?.plano_badge === plano.nome) || 
                    (safeUser?.plano === plano.nome);

                  // 🦈 CORREÇÃO: Passa apenas a cor do banco, sem o nome para evitar override
                  const styles = getColorClasses(plano.cor); 

                  return (
                      <div key={plano.id} className={`
                        bg-zinc-900/80 backdrop-blur-xl border rounded-[2rem] p-6 flex flex-col relative transition-all duration-300 h-full group
                        ${isMyPlan 
                            ? 'border-emerald-600 shadow-[0_0_40px_rgba(16,185,129,0.2)] scale-105 z-20 bg-zinc-900 cursor-default' 
                            : `cursor-pointer hover:-translate-y-3 hover:shadow-2xl hover:border-zinc-500 ${styles.border}`
                        }
                        ${!isMyPlan && plano.destaque ? 'md:pb-12 md:pt-10 z-10' : ''}
                      `}>
                          
                          {/* BADGE SEU PLANO */}
                          {isMyPlan && (
                              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white font-black text-[10px] uppercase px-4 py-1.5 rounded-full shadow-lg tracking-widest w-max flex items-center gap-2 border-4 border-[#050505]">
                                  <Check size={12} strokeWidth={4}/> PLANO ATUAL
                              </div>
                          )}

                          {/* BADGE DESTAQUE */}
                          {!isMyPlan && plano.destaque && (
                              <div className={`absolute top-0 left-1/2 -translate-x-1/2 ${styles.bg} ${styles.text} font-black text-[10px] uppercase px-4 py-1 rounded-b-xl tracking-widest w-fit whitespace-nowrap`}>
                                  Recomendado
                              </div>
                          )}

                          <div className="mb-6 text-center mt-6">
                              <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300 ${styles.bg} ${styles.text}`}>
                                  <Icon size={32}/>
                              </div>
                              <h3 className={`text-2xl font-black uppercase ${styles.text}`}>{plano.nome}</h3>
                              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1 min-h-[16px]">{plano.descricao}</p>
                          </div>

                          <div className="text-center mb-8">
                              {isFree ? (
                                  <div className="flex items-center justify-center h-[60px]">
                                      <span className="text-3xl font-black text-zinc-600 uppercase">Gratuito</span>
                                  </div>
                              ) : (
                                  <>
                                    <div className="flex items-end justify-center gap-1">
                                        <span className="text-sm font-bold text-zinc-500 mb-2">R$</span>
                                        <span className="text-5xl font-black text-white">{plano.preco}</span>
                                    </div>
                                    <p className={`text-[10px] font-bold mt-2 uppercase tracking-wide opacity-70 ${styles.text}`}>{plano.parcelamento}</p>
                                  </>
                              )}
                          </div>

                          <div className="space-y-3 flex-1 mb-8">
                              {plano.beneficios?.map((ben: string, i: number) => (
                                  <div key={i} className="flex items-start gap-3 text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                                      <CheckCircle size={16} className={`shrink-0 mt-0.5 ${styles.text}`}/>
                                      <span className="leading-tight">{ben}</span>
                                  </div>
                              ))}
                          </div>

                          {isMyPlan ? (
                              <button disabled className="w-full py-4 rounded-xl font-bold uppercase text-xs tracking-wider bg-zinc-950 text-zinc-600 border border-zinc-900 cursor-default flex items-center justify-center gap-2">
                                  <CheckCircle size={14}/> Plano Ativo
                              </button>
                          ) : (
                              <button 
                                onClick={() => router.push(`/planos/adesao?plano=${plano.id}`)}
                                className={`w-full py-4 rounded-xl font-black uppercase text-xs tracking-wider transition shadow-lg flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 hover:scale-[1.02] active:scale-[0.98]`}
                              >
                                  {isFree ? "Ver Detalhes" : "Quero Esse"} <ArrowRight size={14}/>
                              </button>
                          )}
                      </div>
                  )
              })}
          </div>
      </div>
    </div>
  );
}
