"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Package } from "lucide-react";

import { fetchStoreProducts } from "../../../../lib/storeService";

type ProductRow = {
  id: string;
  nome?: string;
  preco?: number;
  img?: string;
  categoria?: string;
  estoque?: number;
};

export default function AdminLojaProdutosPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const products = await fetchStoreProducts({ maxResults: 120, forceRefresh: true });
        if (!mounted) return;
        setRows(products as ProductRow[]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link href="/admin/loja" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Produtos</h1>
            <p className="text-[11px] text-zinc-500 font-bold">Leitura dedicada: somente catalogo</p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Nenhum produto encontrado.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-black border border-zinc-700">
                  <Image
                    src={row.img || "https://placehold.co/200x200/111/333?text=Produto"}
                    alt={row.nome || "Produto"}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{row.nome || "Produto"}</p>
                  <p className="text-[11px] text-zinc-400 uppercase">{row.categoria || "Sem categoria"}</p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-black text-emerald-400">R$ {Number(row.preco || 0).toFixed(2)}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">Estoque: {Number(row.estoque || 0)}</p>
                </div>

                <Link
                  href={`/loja/${row.id}`}
                  target="_blank"
                  className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white"
                  title="Abrir produto"
                >
                  <ExternalLink size={15} />
                </Link>
              </article>
            ))}
          </div>
        )}

        <div className="mt-5 text-[11px] text-zinc-600 flex items-center gap-2">
          <Package size={13} />
          Limite de carregamento: 120 itens por abertura.
        </div>
      </main>
    </div>
  );
}
