// src/app/loja/page.tsx
"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { 
  ArrowLeft, ShoppingBag, Search, 
  Package, Zap, AlertCircle, ChevronDown, Clock3
} from "lucide-react";
// addToast removido pois nao estava sendo usado, se precisar re-importe
// import { useToast } from "../../context/ToastContext"; 
import { fetchStoreCategories, fetchStoreProductsPage } from "../../lib/storePublicService";
import { useAuth } from "@/context/AuthContext";
import { ClientCache } from "@/lib/clientCache";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useCart } from "@/context/CartContext";
import { resolveTenantBrandLabel } from "@/lib/tenantBranding";
import { withTenantSlug } from "@/lib/tenantRouting";
import { collectUserPlanScope } from "@/lib/userPlanScope";
// --- TIPAGEM EXATA DO SEU SUPABASE ---
interface Variante {
  id: string;
  cor: string;
  tamanho: string;
  estoque: number;
  vendidos?: number;
}

export interface Produto {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  img: string; 
  preco: number;
  preco_base?: number;
  precoAntigo?: number;
  estoque: number;
  lote: string;
  cores?: string | string[];
  tagLabel?: string;
  tagColor?: string;
  tagEffect?: "pulse" | "shine" | "none";
  variantes: Variante[];
  caracteristicas?: string[];
  cliques: number;
  createdAt?: unknown;
  status?: "ativo" | "em_breve" | "esgotado";
  seller?: {
    type: "tenant" | "mini_vendor";
    id: string;
    name: string;
    logoUrl: string;
  } | null;
}

export type StoreCategory = {
  id: string;
  nome: string;
  cover_img?: string;
  button_color?: string;
  logo_url?: string;
  seller_type?: "tenant" | "mini_vendor";
  seller_id?: string;
};

const STORE_PAGE_SIZE = 20;
const STORE_CLIENT_CACHE_TTL_MS = 2 * 60 * 1000;

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

const getAvailabilityLabel = (status?: Produto["status"]): string => {
  if (status === "em_breve") return "Em-breve";
  if (status === "esgotado") return "Esgotado";
  return "Ativo";
};

const getAvailabilityClass = (status?: Produto["status"]): string => {
  if (status === "em_breve") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  }
  if (status === "esgotado") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

const parseColorLines = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry): entry is string => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter((entry): entry is string => entry.length > 0);
  }
  return [];
};

const getProductColorPreview = (produto: Produto): string[] => {
  const variantColors = Array.isArray(produto.variantes)
    ? produto.variantes
        .map((variant) => (typeof variant?.cor === "string" ? variant.cor.trim() : ""))
        .filter((entry): entry is string => entry.length > 0)
    : [];

  const manualColors = parseColorLines(produto.cores);
  return Array.from(new Set([...variantColors, ...manualColors]));
};

interface LojaClientPageProps {
  initialProducts: Produto[];
  initialCategories: StoreCategory[];
  initialHasMore: boolean;
  initialProductsHydrated: boolean;
  initialCategoriesHydrated: boolean;
  initialPlanScopeKey?: string;
}

export default function LojaClientPage({
  initialProducts,
  initialCategories,
  initialHasMore,
  initialProductsHydrated,
  initialCategoriesHydrated,
  initialPlanScopeKey = "",
}: LojaClientPageProps) {
  const { user } = useAuth();
  const { tenantId: activeTenantId, tenantSigla, tenantName, tenantSlug, tenantLogoUrl, palette } = useTenantTheme();
  const { itemCount: cartCount } = useCart();
  const brandLabel = resolveTenantBrandLabel(tenantSigla, tenantName);
  const { userPlanNames, userPlanIds } = useMemo(
    () => collectUserPlanScope(user),
    [user]
  );
  const currentPlanScopeKey = useMemo(
    () => [...userPlanNames].sort((left, right) => left.localeCompare(right, "pt-BR")).join("|"),
    [userPlanNames]
  );
  const skipInitialCategoryFetch = useRef(initialCategoriesHydrated && initialCategories.length > 0);
  const skippedInitialProductsFetch = useRef(false);
  const dashboardHref = tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard";
  const pedidosHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/configuracoes/pedidos")
    : "/configuracoes/pedidos";

  // Estados
  const [produtos, setProdutos] = useState<Produto[]>(initialProducts);
  const [loading, setLoading] = useState(!initialProductsHydrated);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("Todos");
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [currentPage, setCurrentPage] = useState(1);
  const [categoriasCatalogo, setCategoriasCatalogo] = useState<StoreCategory[]>(initialCategories);

  // 1. CARREGAR CATEGORIAS (leve)
  useEffect(() => {
    if (skipInitialCategoryFetch.current) {
      skipInitialCategoryFetch.current = false;
      return;
    }

    let mounted = true;

    const loadCategories = async () => {
      try {
        const rows = await ClientCache.getOrSet(
          `store:categories:${activeTenantId || "all"}`,
          () =>
            fetchStoreCategories({
              maxResults: 120,
              forceRefresh: false,
              tenantId: activeTenantId || undefined,
            }),
          STORE_CLIENT_CACHE_TTL_MS
        );
        if (!mounted) return;
        setCategoriasCatalogo(rows as StoreCategory[]);
      } catch (error: unknown) {
        console.error(error);
      }
    };

    void loadCategories();
    return () => {
      mounted = false;
    };
  }, [activeTenantId]);

  // 2. CARREGAR PRODUTOS POR PAGINA/CATEGORIA (reduz over-fetch no plano free)
  useEffect(() => {
    const canReuseInitialProducts =
      initialProductsHydrated &&
      filtroCategoria === "Todos" &&
      initialPlanScopeKey === currentPlanScopeKey;

    if (!skippedInitialProductsFetch.current && canReuseInitialProducts) {
      skippedInitialProductsFetch.current = true;
      return;
    }

    let mounted = true;

    const loadFirstPage = async () => {
      setLoading(true);
      try {
        const planIdsKey = [...userPlanIds]
          .sort((left, right) => left.localeCompare(right))
          .join("|");
        const page = await ClientCache.getOrSet(
          [
            "store:products",
            activeTenantId || "all",
            filtroCategoria || "Todos",
            currentPlanScopeKey || "_",
            planIdsKey || "_",
            "1",
            String(STORE_PAGE_SIZE),
          ].join(":"),
          () =>
            fetchStoreProductsPage({
              page: 1,
              pageSize: STORE_PAGE_SIZE,
              category: filtroCategoria,
              forceRefresh: false,
              tenantId: activeTenantId || undefined,
              userPlanNames,
              userPlanIds,
            }),
          STORE_CLIENT_CACHE_TTL_MS
        );
        if (!mounted) return;
        setProdutos(page.products as unknown as Produto[]);
        setHasMore(page.hasMore);
        setCurrentPage(1);
      } catch (error: unknown) {
        console.error(error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadFirstPage();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, currentPlanScopeKey, filtroCategoria, initialPlanScopeKey, initialProductsHydrated, userPlanIds, userPlanNames]);

  const handleLoadMore = async () => {
    if (loading || loadingMore || !hasMore) return;

    const nextPage = currentPage + 1;
    setLoadingMore(true);
    try {
      const page = await fetchStoreProductsPage({
        page: nextPage,
        pageSize: STORE_PAGE_SIZE,
        category: filtroCategoria,
        forceRefresh: false,
        tenantId: activeTenantId || undefined,
        userPlanNames,
        userPlanIds,
      });

      setProdutos((prev) => {
        const existing = new Set(prev.map((item) => item.id));
        const next = [...prev];
        (page.products as unknown as Produto[]).forEach((item) => {
          if (existing.has(item.id)) return;
          existing.add(item.id);
          next.push(item);
        });
        return next;
      });
      setHasMore(page.hasMore);
      setCurrentPage(nextPage);
    } catch (error: unknown) {
      console.error(error);
    } finally {
      setLoadingMore(false);
    }
  };

  // 3. FILTRAGEM
  const categoriasDisponiveis = useMemo(() => {
      const categoriesByName = new Map<string, StoreCategory>();
      const tenantColor = palette.primary || "#10b981";
      const tenantLogo = tenantLogoUrl || "/logo.png";

      categoriasCatalogo.forEach((category) => {
        const nome = String(category.nome || "").trim();
        if (!nome) return;
        const sellerType = category.seller_type === "mini_vendor" ? "mini_vendor" : "tenant";
        const categoryLogo =
          sellerType === "tenant"
            ? tenantLogo
            : category.logo_url && category.logo_url.trim()
            ? category.logo_url
            : tenantLogo;
        const categoryCover =
          category.cover_img && category.cover_img.trim()
            ? category.cover_img
            : categoryLogo;
        categoriesByName.set(nome, {
          ...category,
          nome,
          cover_img: categoryCover,
          button_color:
            category.button_color ||
            (sellerType === "tenant" ? tenantColor : "#2563eb"),
          logo_url: categoryLogo,
        });
      });

      produtos.forEach((product) => {
        const nome = String(product.categoria || "").trim();
        if (!nome || categoriesByName.has(nome)) return;
        const sellerType = product.seller?.type === "mini_vendor" ? "mini_vendor" : "tenant";
        const vendorCategory =
          sellerType === "mini_vendor"
            ? categoriasCatalogo.find(
                (category) =>
                  category.seller_type === "mini_vendor" &&
                  String(category.seller_id || "").trim() === String(product.seller?.id || "").trim()
              )
            : null;
        const categoryLogo =
          sellerType === "tenant"
            ? tenantLogo
            : (vendorCategory?.logo_url && vendorCategory.logo_url.trim()) ||
              product.seller?.logoUrl ||
              tenantLogo;
        const categoryCover =
          (vendorCategory?.cover_img && vendorCategory.cover_img.trim()) || categoryLogo;
        const categoryColor =
          (vendorCategory?.button_color && vendorCategory.button_color.trim()) ||
          (sellerType === "tenant" ? tenantColor : "#2563eb");
        categoriesByName.set(nome, {
          id: nome,
          nome,
          cover_img: categoryCover,
          button_color: categoryColor,
          logo_url: categoryLogo,
          seller_type: sellerType,
          seller_id: product.seller?.id || "",
        });
      });

      return Array.from(categoriesByName.values()).sort((left, right) => {
        const leftMiniVendor = left.seller_type === "mini_vendor";
        const rightMiniVendor = right.seller_type === "mini_vendor";
        if (leftMiniVendor !== rightMiniVendor) {
          return leftMiniVendor ? 1 : -1;
        }
        return left.nome.localeCompare(right.nome, "pt-BR");
      });
  }, [categoriasCatalogo, palette.primary, produtos, tenantLogoUrl]);

  const produtosFiltrados = useMemo(
    () =>
      produtos
        .filter((product) => {
          const matchNome = product.nome.toLowerCase().includes(busca.toLowerCase());
          const matchCat = filtroCategoria === "Todos" || product.categoria === filtroCategoria;
          return matchNome && matchCat;
        })
        .sort((left, right) => {
          const leftMiniVendor = left.seller?.type === "mini_vendor";
          const rightMiniVendor = right.seller?.type === "mini_vendor";
          if (leftMiniVendor !== rightMiniVendor) {
            return leftMiniVendor ? 1 : -1;
          }
          return left.nome.localeCompare(right.nome, "pt-BR");
        }),
    [busca, filtroCategoria, produtos]
  );
  const selectedCategory = useMemo(
    () =>
      filtroCategoria === "Todos"
        ? null
        : categoriasDisponiveis.find((category) => category.nome === filtroCategoria) || null,
    [categoriasDisponiveis, filtroCategoria]
  );
  const featuredCategory = useMemo(
    () =>
      categoriasDisponiveis.find(
        (category) => typeof category.cover_img === "string" && category.cover_img.trim()
      ) || categoriasDisponiveis[0] || null,
    [categoriasDisponiveis]
  );
  const featuredTenantCategory = useMemo(
    () =>
      categoriasDisponiveis.find(
        (category) =>
          category.seller_type !== "mini_vendor" &&
          ((typeof category.cover_img === "string" && category.cover_img.trim()) ||
            (typeof category.logo_url === "string" && category.logo_url.trim()))
      ) || null,
    [categoriasDisponiveis]
  );
  const storeHero = useMemo(() => {
    const heroImage =
      filtroCategoria === "Todos"
        ? featuredTenantCategory?.cover_img ||
          featuredTenantCategory?.logo_url ||
          tenantLogoUrl ||
          "/logo.png"
        : selectedCategory?.cover_img ||
          featuredCategory?.cover_img ||
          featuredCategory?.logo_url ||
          tenantLogoUrl ||
          "/logo.png";

    return {
      image: heroImage,
      eyebrow:
        filtroCategoria === "Todos" ? "Loja oficial e mini vendors" : "Categoria em destaque",
      title: filtroCategoria === "Todos" ? `Lojinha ${brandLabel}` : filtroCategoria,
      description:
        filtroCategoria === "Todos"
          ? "Produtos da atletica e lojinhas aprovadas em um unico lugar."
          : `Explore ${filtroCategoria.toLowerCase()} com a capa da categoria em destaque no topo.`,
    };
  }, [
    brandLabel,
    featuredCategory?.cover_img,
    featuredCategory?.logo_url,
    featuredTenantCategory?.cover_img,
    featuredTenantCategory?.logo_url,
    filtroCategoria,
    selectedCategory?.cover_img,
    tenantLogoUrl,
  ]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32 selection:bg-emerald-500/30">
      <section className="relative h-[240px] overflow-hidden border-b border-white/5 sm:h-[320px]">
        <Image
          src={storeHero.image}
          alt={storeHero.title}
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/35 to-[#050505]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_34%)]" />
      </section>

      {/* --- HEADER --- */}
      <header className="relative z-10 -mt-16 px-6 pb-6 space-y-4">
        <div className="space-y-4 rounded-[2rem] border border-white/10 bg-[#050505]/92 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                  <Link href={dashboardHref} className="rounded-full border border-zinc-800 bg-zinc-900 p-2.5 transition hover:bg-zinc-800">
                      <ArrowLeft size={20} className="text-zinc-400" />
                  </Link>
                  <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">
                        {storeHero.eyebrow}
                      </p>
                      <h1 className="text-2xl font-black uppercase tracking-tighter italic text-white sm:text-3xl">
                        {storeHero.title}
                      </h1>
                      <p className="mt-1 max-w-xl text-xs text-zinc-400 sm:text-sm">
                        {storeHero.description}
                      </p>
                  </div>
              </div>

              <Link href={pedidosHref} className="group relative rounded-full border border-zinc-800 bg-zinc-900 p-2.5 transition hover:bg-zinc-800">
                  <ShoppingBag size={20} className="text-zinc-400 transition group-hover:text-emerald-500"/>
                  {cartCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-black shadow-lg shadow-emerald-500/20">
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
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-3 pl-12 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-500"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
              />
          </div>
        </div>

        {/* CATEGORIAS (SCROLL HORIZONTAL) */}
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
            <button
              onClick={() => setFiltroCategoria("Todos")}
              className={`min-w-[148px] overflow-hidden rounded-2xl border text-left transition ${
                filtroCategoria === "Todos"
                  ? "border-emerald-500/40 bg-zinc-900 shadow-lg shadow-emerald-900/20"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
              }`}
            >
              <div className="relative h-20 bg-black">
                <Image
                  src={
                    featuredTenantCategory?.cover_img ||
                    featuredTenantCategory?.logo_url ||
                    tenantLogoUrl ||
                    "/logo.png"
                  }
                  alt={`Logo ${brandLabel}`}
                  fill
                  sizes="148px"
                  className="object-cover opacity-50"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
              </div>
              <div className="p-3">
                <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-300">
                  Todas
                </span>
              </div>
            </button>

            {categoriasDisponiveis.map((cat) => (
                <button
                    key={cat.id || cat.nome}
                    onClick={() => setFiltroCategoria(cat.nome)}
                    className={`min-w-[148px] overflow-hidden rounded-2xl border text-left transition ${
                      filtroCategoria === cat.nome
                        ? "border-white/15 bg-zinc-900 shadow-lg"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                    }`}
                >
                    <div className="relative h-20 bg-black">
                      <Image
                        src={cat.cover_img || cat.logo_url || tenantLogoUrl || "/logo.png"}
                        alt={cat.nome}
                        fill
                        sizes="148px"
                        className="object-cover opacity-80"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                    </div>
                    <div className="p-3">
                      <span
                        className="inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white"
                        style={{
                          backgroundColor: cat.button_color || palette.primary || "#10b981",
                          borderColor: cat.button_color || palette.primary || "#10b981",
                        }}
                      >
                        {cat.nome}
                      </span>
                    </div>
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
                    const basePrice = Number(prod.preco_base ?? prod.preco);
                    const finalPrice = Number(prod.preco);
                    const hasPlanBenefit = finalPrice < basePrice;
                    const allColors = getProductColorPreview(prod);
                    const colorPreview = allColors.slice(0, 3);
                    const status = prod.status || (estoqueTotal > 0 ? "ativo" : "esgotado");
                    const sellerLogo = prod.seller?.logoUrl || tenantLogoUrl || "/logo.png";
                    const sellerName = prod.seller?.name || brandLabel;
                    const isDisabledSale = status !== "ativo";
                    const productHref = tenantSlug ? withTenantSlug(tenantSlug, `/loja/${prod.id}`) : `/loja/${prod.id}`;
                    const sellerHref =
                      prod.seller?.type === "mini_vendor" && prod.seller.id
                        ? tenantSlug
                          ? withTenantSlug(tenantSlug, `/perfil/mini-vendor/${prod.seller.id}`)
                          : `/perfil/mini-vendor/${prod.seller.id}`
                        : "";

                    return (
                        <article
                            key={prod.id}
                            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group transition hover:border-zinc-700 flex flex-col relative"
                        >
                            {/* TAG VISUAL */}
                            {prod.tagLabel && (
                                <div className={`absolute top-3 left-3 z-10 px-3 py-1 rounded text-[9px] font-black uppercase border shadow-xl ${getTagColorClass(prod.tagColor)} ${prod.tagEffect === 'pulse' ? 'animate-pulse' : ''}`}>
                                    {prod.tagLabel}
                                </div>
                            )}

                            <div className={`absolute right-3 top-3 z-10 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase shadow-xl backdrop-blur-md ${getAvailabilityClass(status)}`}>
                              {getAvailabilityLabel(status)}
                            </div>

                            {/* IMAGEM */}
                            <Link href={productHref} className="block active:scale-[0.99] transition">
                              <div className="relative h-48 bg-black w-full overflow-hidden">
                                  {prod.img ? (
                                      <Image
                                          src={prod.img}
                                          alt={prod.nome}
                                          fill
                                          sizes="100vw"
                                          className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition duration-500"
                                      />
                                  ) : (
                                      <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                          <ShoppingBag size={32}/>
                                      </div>
                                  )}
                                  
                                  {/* BADGE DE ESTOQUE BAIXO */}
                                  {estoqueTotal > 0 && estoqueTotal < 5 && (
                                      <div className="absolute bottom-2 right-2 bg-orange-500/90 text-white text-[8px] font-black uppercase px-2 py-1 rounded flex items-center gap-1 shadow-lg backdrop-blur-sm">
                                          <AlertCircle size={10}/> Poucas unidades
                                      </div>
                                  )}
                              </div>
                            </Link>

                            {/* INFO */}
                            <div className="p-4 flex flex-col gap-2 flex-1">
                                {sellerHref ? (
                                  <Link
                                    href={sellerHref}
                                    className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/20 px-2.5 py-2 transition hover:border-blue-500/30 hover:bg-blue-500/10"
                                  >
                                    <div className="relative h-8 w-8 overflow-hidden rounded-full border border-zinc-700 bg-black">
                                      <Image
                                        src={sellerLogo}
                                        alt={sellerName}
                                        fill
                                        sizes="32px"
                                        className="object-cover"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        Mini vendor
                                      </p>
                                      <p className="truncate text-[11px] font-bold text-zinc-200">{sellerName}</p>
                                    </div>
                                  </Link>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="relative h-8 w-8 overflow-hidden rounded-full border border-zinc-700 bg-black">
                                      <Image
                                        src={sellerLogo}
                                        alt={sellerName}
                                        fill
                                        sizes="32px"
                                        className="object-cover"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        Loja da atletica
                                      </p>
                                      <p className="truncate text-[11px] font-bold text-zinc-200">{sellerName}</p>
                                    </div>
                                  </div>
                                )}

                                <Link href={productHref} className="flex flex-1 flex-col gap-2 active:scale-[0.99] transition">
                                  <div className="flex justify-between items-start">
                                      <h3 className="text-sm font-black text-white leading-tight line-clamp-2">{prod.nome}</h3>
                                  </div>
                                  {colorPreview.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {colorPreview.map((color) => (
                                        <span
                                          key={`${prod.id}-color-${color}`}
                                          className="px-2 py-0.5 rounded-md border border-zinc-700 bg-zinc-950 text-[9px] font-bold uppercase text-zinc-300"
                                        >
                                          {color}
                                        </span>
                                      ))}
                                      {allColors.length > colorPreview.length && (
                                        <span className="px-2 py-0.5 rounded-md border border-zinc-700 bg-zinc-950 text-[9px] font-bold uppercase text-zinc-500">
                                          +{allColors.length - colorPreview.length}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  <div className="mt-auto pt-2 flex items-end justify-between">
                                      <div>
                                          {prod.precoAntigo && prod.precoAntigo > prod.preco && (
                                              <p className="text-[10px] text-zinc-500 line-through font-bold">R$ {Number(prod.precoAntigo).toFixed(2)}</p>
                                          )}
                                          {hasPlanBenefit ? (
                                            <p className="text-[10px] text-zinc-500 line-through font-bold">
                                              R$ {basePrice.toFixed(2)}
                                            </p>
                                          ) : null}
                                          <p className="text-xl font-black text-emerald-400">R$ {finalPrice.toFixed(2)}</p>
                                          <p className="mt-1 text-[10px] font-bold uppercase text-zinc-500">
                                            {status === "em_breve" ? "Liberacao antecipada por plano" : "Compra por pedido"}
                                          </p>
                                          {hasPlanBenefit ? (
                                            <p className="mt-1 text-[10px] font-black uppercase text-emerald-300">
                                              Beneficio {userPlanNames[0]?.trim() || "do seu plano"}
                                            </p>
                                          ) : null}
                                      </div>
                                      
                                      {!isDisabledSale && estoqueTotal > 0 ? (
                                          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-emerald-500 group-hover:bg-emerald-500 group-hover:text-black transition">
                                              <ShoppingBag size={16}/>
                                          </div>
                                      ) : status === "em_breve" ? (
                                          <span className="inline-flex items-center gap-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[10px] font-black uppercase text-yellow-300">
                                            <Clock3 size={10} />
                                            Em breve
                                          </span>
                                      ) : (
                                          <span className="text-[10px] font-black uppercase text-red-500 border border-red-500/30 px-2 py-1 rounded bg-red-500/10">
                                              Esgotado
                                          </span>
                                      )}
                                  </div>
                                </Link>
                            </div>
                        </article>
                    );
                })}
            </div>
        )}

        {!loading && produtosFiltrados.length > 0 && hasMore && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
            >
              {loadingMore ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  Carregando
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  Carregar mais desta categoria
                </>
              )}
            </button>
          </div>
        )}

        {!loading && (
          <p className="mt-4 text-center text-[10px] text-zinc-600 font-bold uppercase tracking-wide">
            Loja paginada por categoria ({STORE_PAGE_SIZE} por leitura)
          </p>
        )}
      </main>

      {/* BANNER PROMOCIONAL XP (INTEGRACAO COM CONQUISTAS/FIDELIDADE) */}
      <div className="fixed bottom-20 left-0 w-full px-6 pointer-events-none">
          <div className="bg-gradient-to-r from-yellow-600/90 to-yellow-800/90 backdrop-blur-md p-3 rounded-xl border border-yellow-500/30 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-10 duration-700 pointer-events-auto">
              <div className="bg-black/20 p-2 rounded-lg text-yellow-200"><Zap size={18}/></div>
              <div className="flex-1">
                  <p className="text-xs font-bold text-white uppercase">Ganhe XP em compras!</p>
                  <p className="text-[10px] text-yellow-100">Cada R$ 1,00 gera XP no clube de fidelidade.</p>
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
