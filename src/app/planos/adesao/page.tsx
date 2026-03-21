"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Ghost,
  Loader2,
  MessageCircle,
  Send,
  ShoppingBag,
  Star,
  type LucideIcon,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  createPlanRequest,
  fetchFinanceConfig,
  fetchPlanById,
  fetchUserPlanRequests,
  type FinanceConfigRecord,
  type PlanRecord,
} from "@/lib/plansService";
import {
  buildTenantFinanceFallback,
  resolveTenantBrandLabel,
} from "@/lib/tenantBranding";
import { withTenantSlug } from "@/lib/tenantRouting";

const ICONS_MAP: Record<string, LucideIcon> = {
  ghost: Ghost,
  star: Star,
  crown: Crown,
  shopping: ShoppingBag,
};

export default function AdesaoPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();
  const { user } = useAuth();
  const {
    tenantId,
    tenantSlug,
    tenantSigla,
    tenantName,
    loading: tenantThemeLoading,
  } = useTenantTheme();

  const planId = searchParams.get("plano");
  const [plano, setPlano] = useState<PlanRecord | null>(null);
  const [pixData, setPixData] = useState<FinanceConfigRecord>({
    chave: "Carregando...",
    banco: "...",
    titular: "...",
  });
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);

  const financeFallback = buildTenantFinanceFallback({ tenantSigla, tenantName });
  const brandLabel = resolveTenantBrandLabel(tenantSigla, tenantName);
  const planosHref = tenantSlug ? withTenantSlug(tenantSlug, "/planos") : "/planos";

  useEffect(() => {
    let mounted = true;

    const fetchConfigAndPlan = async () => {
      if (tenantThemeLoading) return;

      if (!planId || !user) {
        setFetching(false);
        return;
      }

      try {
        const userRequests = await fetchUserPlanRequests(user.uid, {
          maxResults: 40,
          tenantId,
        });

        const hasPending = userRequests.some((request) => request.status === "pendente");
        if (hasPending) {
          if (!mounted) return;
          setHasPendingRequest(true);
          setFetching(false);
          return;
        }

        const [planoData, financeData] = await Promise.all([
          fetchPlanById(planId, { tenantId }),
          fetchFinanceConfig({ tenantId }),
        ]);

        if (!mounted) return;
        setPlano(planoData);
        setPixData({
          ...financeFallback,
          ...financeData,
          whatsapp: financeData.whatsapp || financeFallback.whatsapp,
        });
      } catch (error: unknown) {
        console.error("Erro ao carregar adesao:", error);
      } finally {
        if (mounted) {
          setFetching(false);
        }
      }
    };

    void fetchConfigAndPlan();
    return () => {
      mounted = false;
    };
  }, [financeFallback, planId, tenantId, tenantThemeLoading, user]);

  const handleFinish = async () => {
    if (!user || !plano) return;

    setLoading(true);
    try {
      const userDisplayName =
        (typeof user.displayName === "string" && user.displayName.trim()) ||
        (typeof user.nome === "string" && user.nome.trim()) ||
        "Aluno";
      const userTurma = typeof user.turma === "string" ? user.turma : "T??";

      await createPlanRequest({
        userId: user.uid,
        userName: userDisplayName,
        userTurma,
        planoId: plano.id,
        planoNome: plano.nome,
        valor: plano.precoVal,
        tenantId,
      });

      const adminPhone = (pixData.whatsapp || financeFallback.whatsapp).replace(/\D/g, "");
      const message = `Fala, equipe ${brandLabel}! Fiz o PIX para o plano *${plano.nome}*. Segue meu ID: ${user.uid.slice(0, 5)}. Posso mandar o comprovante?`;
      const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;

      window.open(whatsappUrl, "_blank");
      setStep(3);
      addToast("Solicitacao iniciada!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao iniciar solicitacao.", "error");
    } finally {
      setLoading(false);
    }
  };

  const copyPix = () => {
    navigator.clipboard.writeText(pixData.chave);
    addToast("Chave PIX copiada!", "success");
  };

  if (fetching || tenantThemeLoading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-emerald-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (hasPendingRequest) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-zinc-900 border border-yellow-500/30 p-8 rounded-3xl relative overflow-hidden">
          <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
            <Clock size={40} className="text-yellow-500" />
          </div>
          <h2 className="text-xl font-black text-white uppercase mb-2">Solicitacao em analise</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Voce ja tem um pedido pendente. Aguarde a aprovacao antes de solicitar outro plano.
          </p>
          <Link
            href={planosHref}
            className="block w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl uppercase text-xs tracking-wider transition"
          >
            Voltar ao menu
          </Link>
        </div>
      </div>
    );
  }

  if (!plano) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        Plano nao encontrado.
      </div>
    );
  }

  const Icon = ICONS_MAP[plano.icon] || Star;
  const colorClass =
    plano.cor === "yellow"
      ? "text-yellow-500"
      : plano.cor === "zinc"
      ? "text-purple-500"
      : "text-emerald-500";

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] right-[-20%] w-[60%] h-[60%] bg-emerald-600/15 blur-[120px] rounded-full pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-[-20%] left-[-20%] w-[60%] h-[60%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />

      <Link
        href={planosHref}
        className="absolute top-6 left-6 text-zinc-500 hover:text-white flex items-center gap-2 transition z-50 font-bold uppercase text-xs tracking-wider"
      >
        <ArrowLeft size={18} />
        Cancelar
      </Link>

      <div className="w-full max-w-lg bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 p-8 rounded-[2rem] shadow-2xl relative z-10 my-10 animate-in zoom-in-95 duration-300">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-black rounded-full border border-zinc-700 flex items-center justify-center mb-4 shadow-xl">
            <Icon size={32} className={colorClass} />
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Adesao {plano.nome}</h1>
          <p className="text-zinc-400 text-xs font-medium mt-2">Passo {step} de 3</p>
          <div className="w-full h-1 bg-zinc-800 mt-4 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: step === 1 ? "33%" : step === 2 ? "66%" : "100%" }}
            />
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-6 animate-in slide-in-from-right">
            <div className="bg-black/40 p-5 rounded-2xl border border-zinc-800 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-400 font-medium">Plano selecionado</span>
                <span className="text-white font-bold">{plano.nome}</span>
              </div>
              <div className="border-t border-zinc-800 pt-3 flex justify-between items-center">
                <span className="text-zinc-300 font-bold uppercase text-xs tracking-wider">Valor total</span>
                <span className="text-emerald-400 font-black text-2xl">R$ {plano.preco}</span>
              </div>
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase py-4 rounded-xl shadow-lg transition active:scale-95 flex justify-center items-center gap-2 group"
            >
              Ir para pagamento
              <ArrowLeft size={18} className="rotate-180 group-hover:translate-x-1 transition" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 animate-in slide-in-from-right text-center">
            <div className="bg-zinc-800/30 p-5 rounded-2xl border border-zinc-700 text-left space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard size={16} className="text-emerald-500" />
                <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">Dados para transferencia</p>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">Chave Pix</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-white font-mono text-sm bg-black px-3 py-2 rounded-lg border border-zinc-700 flex-1 truncate">
                      {pixData.chave}
                    </p>
                    <button
                      onClick={copyPix}
                      className="bg-zinc-700 hover:bg-zinc-600 p-2 rounded-lg text-white transition"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Banco</p>
                    <p className="text-zinc-300 text-xs font-bold mt-0.5">{pixData.banco}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Titular</p>
                    <p className="text-zinc-300 text-xs font-bold mt-0.5 truncate">{pixData.titular}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest flex items-center justify-center gap-2">
                <AlertCircle size={12} />
                Proximo passo
              </p>
              <button
                onClick={handleFinish}
                disabled={loading}
                className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-black font-black uppercase py-4 rounded-xl shadow-[0_0_20px_rgba(37,211,102,0.2)] transition active:scale-95 flex justify-center items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <>
                    <MessageCircle size={20} fill="black" className="text-black" />
                    Enviar comprovante
                  </>
                )}
              </button>
              <p className="text-[10px] text-zinc-600 max-w-xs mx-auto leading-relaxed">
                Ao clicar, voce vai para o WhatsApp da atletica. Envie o comprovante por la para liberarmos seu acesso.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-in zoom-in text-center py-4">
            <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(16,185,129,0.2)] border border-emerald-500/50 animate-pulse">
              <Send size={40} className="text-emerald-500 ml-1 mt-1" />
            </div>

            <div>
              <h2 className="text-2xl font-black text-white uppercase italic">Pedido registrado</h2>
              <p className="text-zinc-400 mt-2 text-sm max-w-xs mx-auto">
                Agora e so aguardar a confirmacao do pagamento para liberar seu acesso.
              </p>
            </div>

            <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700 text-left">
              <p className="text-xs text-zinc-300 mb-2">
                <span className="font-bold text-white">Status do pedido:</span>
              </p>
              <div className="flex items-center gap-2 text-yellow-500 font-bold text-xs uppercase tracking-wide bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                <Clock size={14} />
                Em analise
              </div>
            </div>

            <button
              onClick={() => router.push(planosHref)}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase py-4 rounded-xl shadow-lg transition active:scale-95 border border-zinc-700"
            >
              Voltar ao menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
