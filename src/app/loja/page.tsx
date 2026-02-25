// src/app/loja/page.tsx
"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { 
  ArrowLeft, ShoppingBag, Search, 
  Package, Zap, AlertCircle 
} from "lucide-react";
// addToast removido pois nao estava sendo usado, se precisar re-importe
// import { useToast } from "../../context/ToastContext"; 
import { fetchStoreProducts } from "../../lib/storeService";
// --- TIPAGEM EXATA DO SEU SUPABASE ---
interface Variante {
  id: string;
  cor: string;
  tamanho: string;
  estoque: number;
  vendidos?: number;
}

interface Produto {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  img: string; 
  preco: number;
  precoAntigo?: number;
  estoque: number;
  lote: string;
  tagLabel?: string;
  tagColor?: string;
  tagEffect?: "pulse" | "shine" | "none";
  variantes: Variante[];
  caracteristicas?: string[];
  cliques: number;
  createdAt?: unknown;
}

// Helper de Cores para as Tags
const getTagColorClass = (color?: string) => {
  switch (color) {
    case "red": return "bg-red-600 border-red-500 text-white";
    case "emerald": return "bg-emerald-600 border-emerald-500 text-white";
    case "orange": return "bg-orange-600 border-orange-500 text-white";
    case "purple": return "bg-purple-600 border-purple-500 text-white";
    case "blue": return "bg-blue-600 border-blue-500 text-white";
    default: return "bg-zinc-700 border-zinc-600 text-zinc-300";
  }
};

export default function LojaPage() {
  // Estados
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("Todos");
  const [cartCount, setCartCount] = useState(0);

    // 1. CARREGAR DADOS DO SUPABASE
  useEffect(() => {
    let mounted = true;

    const loadProducts = async () => {
      try {
        const rows = await fetchStoreProducts({ maxResults: 80, forceRefresh: false });
        if (!mounted) return;
        setProdutos(rows as unknown as Produto[]);
      } catch (error: unknown) {
        console.error(error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadProducts();

    // Atualizar contador do carrinho (LocalStorage)
    const updateCartCount = () => {
        const raw = localStorage.getItem("cart");
        if (raw) {
            const cart = JSON.parse(raw) as Array<{ qtd?: number }>;
            const total = cart.reduce((acc, item) => acc + (item.qtd || 1), 0);
            setCartCount(total);
        }
    };
    
    updateCartCount();
    // Pequeno hack para ouvir mudancas no storage se o usuario voltar do detalhe
    window.addEventListener('storage', updateCartCount);
    
    return () => { 
        mounted = false;
        window.removeEventListener('storage', updateCartCount);
    };
  }, []);

  // 2. FILTRAGEM
  const categoriasDisponiveis = useMemo(() => {
      const cats = new Set(produtos.map(p => p.categoria).filter(Boolean));
      return ["Todos", ...Array.from(cats)];
  }, [produtos]);

  const produtosFiltrados = produtos.filter(p => {
      const matchNome = p.nome.toLowerCase().includes(busca.toLowerCase());
      const matchCat = filtroCategoria === "Todos" || p.categoria === filtroCategoria;
      return matchNome && matchCat;
  });

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32 selection:bg-emerald-500/30">
      
      {/* --- HEADER --- */}
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 space-y-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Link href="/dashboard" className="bg-zinc-900 p-2.5 rounded-full hover:bg-zinc-800 transition border border-zinc-800">
                    <ArrowLeft size={20} className="text-zinc-400" />
                </Link>
                <div>
                    <h1 className="text-xl font-black text-white uppercase tracking-tighter italic">Lojinha AAAKN</h1>
                    <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Vista a camisa</p>
                </div>
            </div>

            <Link href="/configuracoes/pedidos" className="relative bg-zinc-900 p-2.5 rounded-full hover:bg-zinc-800 transition border border-zinc-800 group">
                <ShoppingBag size={20} className="text-zinc-400 group-hover:text-emerald-500 transition"/>
                {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-black text-[10px] font-black flex items-center justify-center rounded-full shadow-lg shadow-emerald-500/20">
                        {cartCount}
                    </span>
                )}
            </Link>
        </div>

        {/* BARRA DE BUSCA */}
        <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"/>
            <input 
                type="text" 
                placeholder="O que voce procura?" 
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-sm text-white focus:border-emerald-500 outline-none transition placeholder:text-zinc-600"
                value={busca}
                onChange={e => setBusca(e.target.value)}
            />
        </div>

        {/* CATEGORIAS (SCROLL HORIZONTAL) */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
            {categoriasDisponiveis.map(cat => (
                <button 
                    key={cat}
                    onClick={() => setFiltroCategoria(cat)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase whitespace-nowrap transition border ${
                        filtroCategoria === cat 
                        ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/20" 
                        : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                    {cat}
                </button>
            ))}
        </div>
      </header>

      {/* --- GRID DE PRODUTOS --- */}
      <main className="p-6">
        {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-2">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-bold uppercase">Carregando Estoque...</p>
            </div>
        ) : produtosFiltrados.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-zinc-800 rounded-3xl">
                <Package size={40} className="mx-auto text-zinc-700 mb-2"/>
                <p className="text-zinc-500 text-sm font-medium">Nenhum produto encontrado.</p>
            </div>
        ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {produtosFiltrados.map((prod) => {
                    // emEstoque removido pois nao era usado, apenas declarado
                    const temVariantes = prod.variantes && prod.variantes.length > 0;
                    const estoqueTotal = temVariantes 
                        ? prod.variantes.reduce((acc, v) => acc + Number(v.estoque), 0) 
                        : Number(prod.estoque);

                    return (
                        <Link 
                            href={`/loja/${prod.id}`} 
                            key={prod.id}
                            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group active:scale-95 transition hover:border-zinc-700 flex flex-col relative"
                        >
                            {/* TAG VISUAL */}
                            {prod.tagLabel && (
                                <div className={`absolute top-3 left-3 z-10 px-3 py-1 rounded text-[9px] font-black uppercase border shadow-xl ${getTagColorClass(prod.tagColor)} ${prod.tagEffect === 'pulse' ? 'animate-pulse' : ''}`}>
                                    {prod.tagLabel}
                                </div>
                            )}

                            {/* IMAGEM */}
                            <div className="relative h-48 bg-black w-full overflow-hidden">
                                {prod.img ? (
                                    <Image
                                        src={prod.img}
                                        alt={prod.nome}
                                        fill
                                        sizes="100vw"
                                        className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition duration-500"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                        <ShoppingBag size={32}/>
                                    </div>
                                )}
                                
                                {/* BADGE DE ESTOQUE BAIXO */}
                                {estoqueTotal > 0 && estoqueTotal < 5 && (
                                    <div className="absolute bottom-2 right-2 bg-orange-500/90 text-white text-[8px] font-black uppercase px-2 py-1 rounded flex items-center gap-1 shadow-lg backdrop-blur-sm">
                                        <AlertCircle size={10}/> Restam {estoqueTotal}
                                    </div>
                                )}
                            </div>

                            {/* INFO */}
                            <div className="p-4 flex flex-col gap-2 flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="text-sm font-black text-white leading-tight line-clamp-2">{prod.nome}</h3>
                                </div>
                                
                                <div className="mt-auto pt-2 flex items-end justify-between">
                                    <div>
                                        {prod.precoAntigo && prod.precoAntigo > prod.preco && (
                                            <p className="text-[10px] text-zinc-500 line-through font-bold">R$ {Number(prod.precoAntigo).toFixed(2)}</p>
                                        )}
                                        <p className="text-xl font-black text-emerald-400">R$ {Number(prod.preco).toFixed(2)}</p>
                                    </div>
                                    
                                    {estoqueTotal > 0 ? (
                                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-emerald-500 group-hover:bg-emerald-500 group-hover:text-black transition">
                                            <ShoppingBag size={16}/>
                                        </div>
                                    ) : (
                                        <span className="text-[10px] font-black uppercase text-red-500 border border-red-500/30 px-2 py-1 rounded bg-red-500/10">
                                            Esgotado
                                        </span>
                                    )}
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>
        )}
      </main>

      {/* BANNER PROMOCIONAL XP (INTEGRACAO COM CONQUISTAS/FIDELIDADE) */}
      <div className="fixed bottom-20 left-0 w-full px-6 pointer-events-none">
          <div className="bg-gradient-to-r from-yellow-600/90 to-yellow-800/90 backdrop-blur-md p-3 rounded-xl border border-yellow-500/30 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-10 duration-700 pointer-events-auto">
              <div className="bg-black/20 p-2 rounded-lg text-yellow-200"><Zap size={18}/></div>
              <div className="flex-1">
                  <p className="text-xs font-bold text-white uppercase">Ganhe XP em compras!</p>
                  <p className="text-[10px] text-yellow-100">Cada R$ 1,00 = 10 XP no Shark Card.</p>
              </div>
          </div>
      </div>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
