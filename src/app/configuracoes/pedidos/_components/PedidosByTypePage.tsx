"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, Package, XCircle } from "lucide-react";
import { Timestamp } from "firebase/firestore";

import { useAuth } from "../../../../context/AuthContext";
import { fetchUserOrdersByTab } from "../../../../lib/settingsService";

interface PedidoUnificado {
  id: string;
  titulo: string;
  subtitulo: string;
  valor: number;
  status: "aprovado" | "rejeitado" | "pendente";
  data: Date;
}

type PedidoRaw = {
  id: string;
  dataSolicitacao?: Timestamp;
  createdAt?: Timestamp;
  data?: string;
  eventoNome?: string;
  quantidade?: number;
  loteNome?: string;
  valorTotal?: unknown;
  itens?: unknown[];
  total?: unknown;
  planoNome?: string;
  valor?: unknown;
  status?: PedidoUnificado["status"];
};

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

  if (item.dataSolicitacao instanceof Timestamp) data = item.dataSolicitacao.toDate();
  else if (item.createdAt instanceof Timestamp) data = item.createdAt.toDate();
  else if (item.data) data = new Date(item.data);

  if (tab === "eventos") {
    titulo = item.eventoNome || "Ingresso";
    subtitulo = `${item.quantidade || 1}x ${item.loteNome || "Lote unico"}`;
    valor = parseCurrencyValue(item.valorTotal);
  } else if (tab === "loja") {
    titulo = `Pedido #${item.id.slice(0, 6).toUpperCase()}`;
    subtitulo = `${item.itens?.length || 0} itens`;
    valor = parseCurrencyValue(item.total);
  } else {
    titulo = item.planoNome || "Adesao";
    subtitulo = "Anuidade";
    valor = parseCurrencyValue(item.valor);
  }

  return {
    id: item.id,
    titulo,
    subtitulo,
    valor,
    status: item.status || "pendente",
    data,
  };
};

interface PedidosByTypePageProps {
  tab: "eventos" | "loja" | "planos";
}

export function PedidosByTypePage({ tab }: PedidosByTypePageProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoUnificado[]>([]);

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
        const records = await fetchUserOrdersByTab(user.uid, tab, { maxResults: 90 });
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
  }, [user, tab]);

  const counts = useMemo(() => {
    return {
      approved: pedidos.filter((row) => row.status === "aprovado").length,
      pending: pedidos.filter((row) => row.status === "pendente").length,
      rejected: pedidos.filter((row) => row.status === "rejeitado").length,
    };
  }, [pedidos]);

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
          <article key={pedido.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
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
    </main>
  );
}
