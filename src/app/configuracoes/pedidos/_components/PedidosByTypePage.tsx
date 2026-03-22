"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, Copy, MessageCircle, Package, Wallet, X, XCircle } from "lucide-react";

import { useAuth } from "../../../../context/AuthContext";
import { fetchUserOrdersByTab } from "../../../../lib/settingsService";
import { fetchFinanceiroConfig } from "../../../../lib/eventsService";
import { useToast } from "../../../../context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  buildTenantFinanceFallback,
  resolveTenantBrandLabel,
} from "../../../../lib/tenantBranding";

interface PedidoUnificado {
  id: string;
  titulo: string;
  subtitulo: string;
  valor: number;
  status: "aprovado" | "rejeitado" | "pendente";
  data: Date;
  raw?: PedidoRaw;
}

type PedidoRaw = {
  id: string;
  dataSolicitacao?: TimestampLike;
  createdAt?: TimestampLike;
  data?: string | Record<string, unknown>;
  eventoNome?: string;
  quantidade?: number;
  loteNome?: string;
  valorTotal?: unknown;
  itens?: unknown[] | number;
  total?: unknown;
  productName?: string;
  productId?: string;
  price?: unknown;
  userName?: string;
  planoNome?: string;
  valor?: unknown;
  status?: PedidoUnificado["status"];
};

type TimestampLike = { toDate: () => Date };

const parseCurrencyValue = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  const sanitized = value.trim().replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;

  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");

  let normalized = sanitized;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? sanitized.replace(/\./g, "").replace(",", ".") : sanitized.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = sanitized.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePedido = (item: PedidoRaw, tab: "eventos" | "loja" | "planos"): PedidoUnificado => {
  let titulo = "Item";
  let subtitulo = "";
  let valor = 0;
  let data = new Date();

  if (item.dataSolicitacao && typeof item.dataSolicitacao.toDate === "function") data = item.dataSolicitacao.toDate();
  else if (item.createdAt && typeof item.createdAt.toDate === "function") data = item.createdAt.toDate();
  else if (typeof item.data === "string" && item.data) data = new Date(item.data);

  if (tab === "eventos") {
    titulo = item.eventoNome || "Ingresso";
    subtitulo = `${item.quantidade || 1}x ${item.loteNome || "Lote unico"}`;
    valor = parseCurrencyValue(item.valorTotal);
  } else if (tab === "loja") {
    const qtd =
      typeof item.quantidade === "number"
        ? item.quantidade
        : typeof item.itens === "number"
        ? item.itens
        : Array.isArray(item.itens)
        ? item.itens.length
        : 1;
    titulo = item.productName || `Pedido #${item.id.slice(0, 6).toUpperCase()}`;
    subtitulo = `${qtd || 1} item(ns)`;
    valor = parseCurrencyValue(item.total ?? item.price);
  } else {
    titulo = item.planoNome || "Adesao";
    subtitulo = "Anuidade";
    valor = parseCurrencyValue(item.valor);
  }

  const statusRaw = String(item.status || "pendente").toLowerCase();
  const normalizedStatus: PedidoUnificado["status"] =
    statusRaw === "approved" || statusRaw === "aprovado"
      ? "aprovado"
      : statusRaw === "rejected" || statusRaw === "rejeitado"
      ? "rejeitado"
      : "pendente";

  return {
    id: item.id,
    titulo,
    subtitulo,
    valor,
    status: normalizedStatus,
    data,
    raw: item,
  };
};

interface PedidosByTypePageProps {
  tab: "eventos" | "loja" | "planos";
}

export function PedidosByTypePage({ tab }: PedidosByTypePageProps) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSigla, tenantName } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoUnificado[]>([]);
  const [selectedPedido, setSelectedPedido] = useState<PedidoUnificado | null>(null);
  const [financeiro, setFinanceiro] = useState<{
    chave: string;
    banco: string;
    titular: string;
    whatsapp: string;
  } | null>(null);
  const [loadingFinanceiro, setLoadingFinanceiro] = useState(false);
  const financeFallback = useMemo(
    () =>
      buildTenantFinanceFallback({
        tenantSigla,
        tenantName,
      }),
    [tenantName, tenantSigla]
  );
  const brandLabel = useMemo(
    () => resolveTenantBrandLabel(tenantSigla, tenantName),
    [tenantName, tenantSigla]
  );

  useEffect(() => {
    if (!user) {
      setPedidos([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);

    const load = async () => {
      try {
        const records = await fetchUserOrdersByTab(user.uid, tab, {
          maxResults: 90,
          tenantId: tenantId || undefined,
        });
        const rawList = records.map((row) => ({ id: row.id, ...(row.data as Record<string, unknown>) })) as PedidoRaw[];

        const sorted = rawList
          .map((row) => normalizePedido(row, tab))
          .sort((a, b) => b.data.getTime() - a.data.getTime());

        if (mounted) setPedidos(sorted);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [tenantId, user, tab]);

  useEffect(() => {
    if (!selectedPedido) return;
    let mounted = true;
    setLoadingFinanceiro(true);
    const loadFinanceiro = async () => {
      try {
        const row = await fetchFinanceiroConfig({
          forceRefresh: false,
          tenantId: tenantId || undefined,
        });
        if (!mounted) return;
        setFinanceiro({
          chave: typeof row?.chave === "string" && row.chave.trim() ? row.chave.trim() : financeFallback.chave,
          banco: typeof row?.banco === "string" && row.banco.trim() ? row.banco.trim() : financeFallback.banco,
          titular: typeof row?.titular === "string" && row.titular.trim() ? row.titular.trim() : financeFallback.titular,
          whatsapp: typeof row?.whatsapp === "string" && row.whatsapp.trim() ? row.whatsapp.trim() : financeFallback.whatsapp,
        });
      } catch (error: unknown) {
        console.error(error);
      } finally {
        if (mounted) setLoadingFinanceiro(false);
      }
    };
    void loadFinanceiro();
    return () => {
      mounted = false;
    };
  }, [financeFallback, selectedPedido, tenantId]);

  const counts = useMemo(() => {
    return {
      approved: pedidos.filter((row) => row.status === "aprovado").length,
      pending: pedidos.filter((row) => row.status === "pendente").length,
      rejected: pedidos.filter((row) => row.status === "rejeitado").length,
    };
  }, [pedidos]);

  const whatsappDigits = String(financeiro?.whatsapp || financeFallback.whatsapp).replace(/\D/g, "");
  const whatsappMessage = selectedPedido
    ? encodeURIComponent(
        `Fala, equipe ${brandLabel}! Segue comprovante do pedido #${selectedPedido.id.slice(0, 8).toUpperCase()} (${selectedPedido.titulo}).`
      )
    : "";
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}?text=${whatsappMessage}` : "";

  return (
    <main className="p-4 space-y-4">
      <section className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Aprovado</p>
          <p className="text-lg font-black text-emerald-400">{counts.approved}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Pendente</p>
          <p className="text-lg font-black text-yellow-400">{counts.pending}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-[10px] text-zinc-500 uppercase font-bold">Negado</p>
          <p className="text-lg font-black text-red-400">{counts.rejected}</p>
        </div>
      </section>

      {loading ? (
        <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-3">
          <Package size={42} className="opacity-20" />
          <p className="text-sm">Nenhum pedido encontrado.</p>
        </div>
      ) : (
        pedidos.map((pedido) => (
          <article
            key={pedido.id}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-zinc-600 transition"
            onClick={() => {
              setSelectedPedido(pedido);
            }}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">{pedido.titulo}</h3>
                <p className="text-xs text-zinc-400">{pedido.subtitulo}</p>
              </div>
              <p className="text-sm font-black text-emerald-400">R$ {pedido.valor.toFixed(2)}</p>
            </div>

            <div className="mt-3 pt-2 border-t border-zinc-800 flex justify-between items-center">
              <span className="text-[10px] text-zinc-500">{pedido.data.toLocaleDateString("pt-BR")}</span>
              <span
                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1 ${
                  pedido.status === "aprovado"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : pedido.status === "rejeitado"
                    ? "bg-red-500/10 text-red-500"
                    : "bg-yellow-500/10 text-yellow-500"
                }`}
              >
                {pedido.status === "aprovado" ? <CheckCircle size={10} /> : pedido.status === "rejeitado" ? <XCircle size={10} /> : <Clock size={10} />}
                {pedido.status}
              </span>
            </div>
          </article>
        ))
      )}

      {selectedPedido && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0b0b0c] shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Detalhe do Pedido</p>
                <h3 className="text-sm font-black uppercase text-white">{selectedPedido.titulo}</h3>
              </div>
              <button
                onClick={() => setSelectedPedido(null)}
                className="p-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-bold uppercase">Pedido</span>
                  <span className="text-zinc-300 font-mono">#{selectedPedido.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-bold uppercase">Status</span>
                  <span className="text-zinc-300 font-bold uppercase">{selectedPedido.status}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-bold uppercase">Valor</span>
                  <span className="text-emerald-400 font-black">R$ {selectedPedido.valor.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  {selectedPedido.data.toLocaleDateString("pt-BR")} {selectedPedido.data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </div>
                {typeof selectedPedido.raw?.data === "object" && selectedPedido.raw?.data && "corSelecionada" in selectedPedido.raw.data && (
                  <div className="text-xs text-zinc-300">
                    <span className="text-zinc-500 font-bold uppercase">Cor:</span>{" "}
                    {String((selectedPedido.raw.data as Record<string, unknown>).corSelecionada || "-")}
                  </div>
                )}
              </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-emerald-400" />
                  <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Pagamento via PIX</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">Chave PIX</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs font-mono text-white truncate">
                      {loadingFinanceiro ? "Carregando..." : (financeiro?.chave || financeFallback.chave)}
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(financeiro?.chave || financeFallback.chave);
                          addToast("Chave PIX copiada!", "success");
                        } catch (error: unknown) {
                          console.error(error);
                          addToast("Nao foi possivel copiar a chave PIX.", "error");
                        }
                      }}
                      className="p-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-zinc-500 font-bold uppercase text-[10px]">Banco</p>
                    <p className="text-zinc-300 font-bold mt-1">{financeiro?.banco || financeFallback.banco}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 font-bold uppercase text-[10px]">Titular</p>
                    <p className="text-zinc-300 font-bold mt-1 truncate">{financeiro?.titular || financeFallback.titular}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black/50 p-3 space-y-1">
                  <p className="text-[10px] text-zinc-500 uppercase font-bold">WhatsApp p/ comprovante</p>
                  <p className="text-zinc-300 text-xs font-mono">{financeiro?.whatsapp || financeFallback.whatsapp}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black/50 p-3 flex items-start gap-2">
                  <MessageCircle size={14} className="text-emerald-400 mt-0.5" />
                  <p className="text-[11px] text-zinc-400">
                    Envie o comprovante informando o numero do pedido <span className="font-mono text-zinc-200">#{selectedPedido.id.slice(0, 8).toUpperCase()}</span>.
                  </p>
                </div>
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-black uppercase text-emerald-400 hover:bg-emerald-500/20"
                  >
                    <MessageCircle size={14} /> Enviar Comprovante
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}


