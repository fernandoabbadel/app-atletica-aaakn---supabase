"use client";

import React, { useState, useEffect, Suspense } from "react";
import { ArrowLeft, MessageCircle, Loader2, Copy, Ticket, Minus, Plus, Wallet, Clock } from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // Importando Image
import { useSearchParams } from "next/navigation";
import { useToast } from "../../../context/ToastContext";
import { useAuth } from "../../../context/AuthContext";
import { createEventTicketRequest, fetchEventCheckoutData } from "../../../lib/eventsService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import { collectUserPlanScope } from "@/lib/userPlanScope";
import {
  buildTenantFinanceFallback,
  resolveTenantBrandLabel,
} from "../../../lib/tenantBranding";
// Interfaces para tipagem forte (fim do any)
interface Lote {
    id: string;
    nome: string;
    preco: string;
    status: string;
}

interface EventoData {
    id: string;
    titulo: string;
    imagem?: string;
    lotes?: Lote[];
    [key: string]: unknown; // Flexibilidade para outros campos do evento
}

interface PixData {
    chave: string;
    banco: string;
    titular: string;
    whatsapp?: string;
}

// Componente interno que usa useSearchParams
function CompraContent() {
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { tenantId, tenantSigla, tenantName, tenantSlug } = useTenantTheme();
  const { userPlanNames, userPlanIds } = React.useMemo(() => collectUserPlanScope(user), [user]);
  
  const eventoId = searchParams.get('evento');
  const loteId = searchParams.get('lote');

  const [evento, setEvento] = useState<EventoData | null>(null);
  const [lote, setLote] = useState<Lote | null>(null);
  const [pixData, setPixData] = useState<PixData>({ chave: "Carregando...", banco: "...", titular: "..." });
  
  const [quantidade, setQuantidade] = useState(1);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const financeFallback = buildTenantFinanceFallback({ tenantSigla, tenantName });
  const brandLabel = resolveTenantBrandLabel(tenantSigla, tenantName);
  const eventosHref = tenantSlug ? withTenantSlug(tenantSlug, "/eventos") : "/eventos";

    useEffect(() => {
      const loadData = async () => {
          if (!eventoId || !loteId) {
              setFetching(false);
              return;
          }

          try {
              const checkoutData = await fetchEventCheckoutData({
                  eventId: eventoId,
                  loteId,
                  forceRefresh: false,
                  tenantId: tenantId || undefined,
                  userPlanNames,
                  userPlanIds,
              });

              if (checkoutData.evento) {
                  setEvento(checkoutData.evento as unknown as EventoData);
              }

              if (checkoutData.lote) {
                  setLote(checkoutData.lote as unknown as Lote);
              }

              if (checkoutData.financeiro) {
                  setPixData(checkoutData.financeiro as unknown as PixData);
              } else {
                  setPixData(financeFallback);
              }

          } catch (error: unknown) {
              console.error("Erro ao carregar:", error);
              addToast("Erro ao carregar dados do evento.", "error");
          } finally {
              setFetching(false);
          }
      };
      void loadData();
  }, [addToast, eventoId, financeFallback, loteId, tenantId, userPlanIds, userPlanNames]); // Dependencias corrigidas

  const handleFinish = async () => {
      if (!user || !evento || !lote) return;

      setLoading(true);
      try {
          const valorTotal = parseFloat(lote.preco.replace(',', '.')) * quantidade;

          const ticketRequest = await createEventTicketRequest({
              userId: user.uid,
              userName: user.nome || "Aluno",
              userTurma: user.turma || "T??",
              userPhone: user.telefone || "",
              eventoId: evento.id,
              eventoNome: evento.titulo,
              loteNome: lote.nome,
              loteId: lote.id,
              quantidade,
              valorUnitario: lote.preco,
              valorTotal: valorTotal.toFixed(2),
              metodo: "whatsapp",
              tenantId: tenantId || undefined,
              paymentConfig: { ...pixData },
          });

          // 2. Gerar Link do WhatsApp
          const adminPhone = pixData.whatsapp || financeFallback.whatsapp;
          const message = `Fala, equipe ${brandLabel}! Quero garantir meu lugar no *${evento.titulo}*.\n\n[INGRESSO] *${quantidade}x ${lote.nome}*\n[VALOR] Valor Total: R$ ${valorTotal.toFixed(2)}\n[PEDIDO] Pedido: ${ticketRequest.id.slice(0,5)}\n\nSegue o comprovante!`;
          const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;

          // 3. Redirecionar
          window.open(whatsappUrl, '_blank');
          setStep(3); // Tela de Sucesso
          addToast("Pedido de ingresso gerado!", "success");

      } catch (error) {
          console.error(error);
          addToast("Erro ao processar pedido.", "error");
      } finally {
          setLoading(false);
      }
  };

  const copyPix = () => {
      navigator.clipboard.writeText(pixData.chave);
      addToast("Chave PIX copiada!", "success");
  }

  const handleQty = (op: 'add' | 'sub') => {
      if (op === 'add' && quantidade < 10) setQuantidade(q => q + 1);
      if (op === 'sub' && quantidade > 1) setQuantidade(q => q - 1);
  };

  if (fetching) return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-emerald-500"><Loader2 className="animate-spin"/></div>;
  if (!evento || !lote) return <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">Lote ou evento invalido.</div>;

  const valorTotalDisplay = (parseFloat(lote.preco.replace(',', '.')) * quantidade).toFixed(2).replace('.', ',');

  return (
    <div className="w-full max-w-lg bg-zinc-900/60 backdrop-blur-xl border border-zinc-800/80 p-8 rounded-[2rem] shadow-2xl relative z-10 my-10 animate-in zoom-in-95 duration-300">
            
        {/* HEADER */}
        <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto bg-black rounded-full border border-zinc-700 flex items-center justify-center mb-4 shadow-xl overflow-hidden relative">
                {evento.imagem ? (
                    <Image 
                        src={evento.imagem} 
                        alt={evento.titulo} 
                        fill
                        className="object-cover opacity-80" 
                        
                    />
                ) : (
                    <Ticket size={32} className="text-purple-500"/>
                )}
            </div>
            <h1 className="text-xl font-black text-white uppercase tracking-tighter">{evento.titulo}</h1>
            <p className="text-zinc-400 text-xs font-medium mt-2">Passo {step} de 3</p>
            <div className="w-full h-1 bg-zinc-800 mt-4 rounded-full overflow-hidden">
                <div className={`h-full bg-purple-500 transition-all duration-500 ease-out`} style={{ width: step === 1 ? '33%' : step === 2 ? '66%' : '100%' }}></div>
            </div>
        </div>

        {/* PASSO 1: QUANTIDADE E CONFIRMACAO */}
        {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right">
                
                <div className="bg-black/40 p-5 rounded-2xl border border-zinc-800 space-y-4">
                    <div className="flex justify-between items-center text-sm border-b border-zinc-800 pb-3">
                        <span className="text-zinc-400 font-medium">Ingresso</span>
                        <span className="text-white font-bold">{lote.nome}</span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                        <span className="text-zinc-400 font-medium text-xs uppercase">Quantidade</span>
                        <div className="flex items-center gap-3 bg-zinc-900 rounded-xl p-1 border border-zinc-700">
                            <button onClick={() => handleQty('sub')} className="w-8 h-8 flex items-center justify-center bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white transition disabled:opacity-50" disabled={quantidade <= 1}><Minus size={14}/></button>
                            <span className="font-black text-white w-4 text-center">{quantidade}</span>
                            <button onClick={() => handleQty('add')} className="w-8 h-8 flex items-center justify-center bg-emerald-600 rounded-lg hover:bg-emerald-500 text-white transition disabled:opacity-50" disabled={quantidade >= 10}><Plus size={14}/></button>
                        </div>
                    </div>

                    <div className="border-t border-zinc-800 pt-3 flex justify-between items-center">
                        <span className="text-zinc-300 font-bold uppercase text-xs tracking-wider">Total a Pagar</span>
                        <span className="text-purple-400 font-black text-2xl">R$ {valorTotalDisplay}</span>
                    </div>
                </div>

                <button onClick={() => setStep(2)} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black uppercase py-4 rounded-xl shadow-lg transition active:scale-95 flex justify-center items-center gap-2 group">
                    Confirmar Pedido <ArrowLeft size={18} className="rotate-180 group-hover:translate-x-1 transition"/>
                </button>
            </div>
        )}

        {/* PASSO 2: PIX */}
        {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right text-center">
                <div className="bg-zinc-800/30 p-5 rounded-2xl border border-zinc-700 text-left space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Wallet size={16} className="text-emerald-500"/>
                        <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">Pagamento via PIX</p>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <p className="text-[10px] text-zinc-500 font-bold uppercase">Chave Pix</p>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-white font-mono text-sm bg-black px-3 py-2 rounded-lg border border-zinc-700 flex-1 truncate">{pixData.chave}</p>
                                <button onClick={copyPix} className="bg-zinc-700 hover:bg-zinc-600 p-2 rounded-lg text-white transition"><Copy size={16}/></button>
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
                        <div className="bg-black/40 p-3 rounded-lg border border-zinc-800 mt-2 text-center">
                            <p className="text-[10px] text-zinc-500 uppercase font-bold">Valor exato</p>
                            <p className="text-xl font-black text-emerald-400">R$ {valorTotalDisplay}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-3 pt-2">
                    <button onClick={handleFinish} disabled={loading} className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-black font-black uppercase py-4 rounded-xl shadow-[0_0_20px_rgba(37,211,102,0.2)] transition active:scale-95 flex justify-center items-center gap-2">
                        {loading ? <Loader2 className="animate-spin"/> : (
                            <>
                                <MessageCircle size={20} fill="black" className="text-black"/>
                                Enviar Comprovante
                            </>
                        )}
                    </button>
                    <p className="text-[10px] text-zinc-600 max-w-xs mx-auto leading-relaxed">
                        O comprovante deve ser enviado no WhatsApp para validarmos seu ingresso.
                    </p>
                </div>
            </div>
        )}

        {/* PASSO 3: SUCESSO */}
        {step === 3 && (
            <div className="space-y-6 animate-in zoom-in text-center py-4">
                <div className="w-24 h-24 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(168,85,247,0.2)] border border-purple-500/50 animate-pulse">
                    <Ticket size={40} className="text-purple-500 ml-1 mt-1"/>
                </div>
                
                <div>
                    <h2 className="text-2xl font-black text-white uppercase italic">Ingresso Reservado!</h2>
                    <p className="text-zinc-400 mt-2 text-sm max-w-xs mx-auto">
                        Agora a equipe da atletica vai conferir o PIX e liberar seu QR Code oficial. Fique de olho no status!
                    </p>
                </div>

                <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700 text-left">
                    <p className="text-xs text-zinc-300 mb-2">[INFO] <span className="font-bold text-white">Status do Pedido:</span></p>
                    <div className="flex items-center gap-2 text-yellow-500 font-bold text-xs uppercase tracking-wide bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                        <Clock size={14}/> Analise Financeira
                    </div>
                </div>

                <button onClick={() => window.location.href = eventosHref} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase py-4 rounded-xl shadow-lg transition active:scale-95 border border-zinc-700">
                    Voltar ao Menu
                </button>
            </div>
        )}
    </div>
  );
}

// SUSPENSE WRAPPER (obrigatorio para useSearchParams no Next.js 15)
export default function EventoCompraPage() {
  const { tenantSlug } = useTenantTheme();

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden font-sans">
        {/* Background Animado */}
        <div className="absolute top-[-20%] right-[-20%] w-[60%] h-[60%] bg-purple-600/15 blur-[120px] rounded-full pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-[-20%] left-[-20%] w-[60%] h-[60%] bg-emerald-600/10 blur-[120px] rounded-full pointer-events-none"></div>

        <Link href={tenantSlug ? withTenantSlug(tenantSlug, "/eventos") : "/eventos"} className="absolute top-6 left-6 text-zinc-500 hover:text-white flex items-center gap-2 transition z-50 font-bold uppercase text-xs tracking-wider">
            <ArrowLeft size={18}/> Cancelar
        </Link>

        <Suspense fallback={<div className="text-emerald-500 flex items-center gap-2"><Loader2 className="animate-spin"/> Carregando Checkout...</div>}>
            <CompraContent />
        </Suspense>
    </div>
  );
}

