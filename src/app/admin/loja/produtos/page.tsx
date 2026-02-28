"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  ImagePlus,
  Loader2,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Power,
  ShoppingBag,
  Tags,
  Trash2,
  X,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import { uploadImage } from "@/lib/upload";
import {
  createStoreCategory,
  fetchAdminStoreBundle,
  fetchStoreProducts,
  upsertStoreProduct,
} from "../../../../lib/storeService";

type ProductRow = {
  id: string;
  nome?: string;
  descricao?: string;
  preco?: number;
  precoAntigo?: number;
  img?: string;
  categoria?: string;
  estoque?: number;
  lote?: string;
  tagLabel?: string;
  tagColor?: ProductForm["tagColor"];
  tagEffect?: ProductForm["tagEffect"];
  active?: boolean;
  aprovado?: boolean;
  vendidos?: number;
  cliques?: number;
  cores?: string | string[];
  caracteristicas?: string[];
  variantes?: Array<{ id?: string; cor?: string; tamanho?: string; estoque?: number; vendidos?: number }>;
};

type CategoryRow = { id: string; nome?: string };

type VariantForm = {
  id: string;
  tamanho: string;
  cor: string;
  estoque: string;
  vendidos: string;
};

type ProductForm = {
  nome: string;
  categoria: string;
  descricao: string;
  img: string;
  preco: string;
  precoAntigo: string;
  estoque: string;
  lote: string;
  tagLabel: string;
  tagColor: "zinc" | "emerald" | "orange" | "purple" | "blue" | "red";
  tagEffect: "none" | "pulse" | "shine";
  coresText: string;
  caracteristicasText: string;
  usarVariantes: boolean;
  variantes: VariantForm[];
};

const newVariant = (): VariantForm => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  tamanho: "",
  cor: "",
  estoque: "",
  vendidos: "0",
});

const EMPTY_FORM: ProductForm = {
  nome: "",
  categoria: "Geral",
  descricao: "",
  img: "",
  preco: "",
  precoAntigo: "",
  estoque: "",
  lote: "",
  tagLabel: "",
  tagColor: "zinc",
  tagEffect: "none",
  coresText: "",
  caracteristicasText: "",
  usarVariantes: false,
  variantes: [newVariant()],
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const parseIntSafe = (value: string): number => {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};
const parseMoney = (value: string): number => Number(value.replace(",", "."));
const formatMoneyInput = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
};
const isWearCategory = (category: string): boolean => {
  const c = category.toLowerCase();
  return ["camisa", "camiseta", "uniforme", "moletom", "roupa"].some((key) => c.includes(key));
};

const joinTextLines = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

export default function AdminLojaProdutosPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProductOpen, setIsProductOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);

  const categoryNames = useMemo(() => {
    const merged = new Set<string>();
    categories.forEach((row) => {
      const name = asString(row.nome).trim();
      if (name) merged.add(name);
    });
    rows.forEach((row) => {
      const name = asString(row.categoria).trim();
      if (name) merged.add(name);
    });
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [categories, rows]);

  const variantsEnabled = form.usarVariantes || isWearCategory(form.categoria);

  const loadProducts = async (forceRefresh = true) => {
    const products = await fetchStoreProducts({ maxResults: 120, forceRefresh });
    setRows(products as ProductRow[]);
  };

  const loadCategories = async (forceRefresh = true) => {
    const bundle = await fetchAdminStoreBundle({
      productsLimit: 1,
      categoriesLimit: 200,
      ordersLimit: 1,
      reviewsLimit: 1,
      forceRefresh,
    });
    setCategories(bundle.categorias as CategoryRow[]);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await Promise.all([loadProducts(true), loadCategories(true)]);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar produtos.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const resetForm = () => setForm({ ...EMPTY_FORM, variantes: [newVariant()] });

  const openCreateProduct = () => {
    setEditingProductId(null);
    resetForm();
    setIsProductOpen(true);
  };

  const closeProductForm = () => {
    setIsProductOpen(false);
    setEditingProductId(null);
    resetForm();
  };

  const openEditProduct = (row: ProductRow) => {
    const mappedVariants = Array.isArray(row.variantes) && row.variantes.length > 0
      ? row.variantes.map((variant) => ({
          id:
            typeof variant.id === "string" && variant.id.trim()
              ? variant.id
              : (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random()}`),
          tamanho: asString(variant.tamanho),
          cor: asString(variant.cor),
          estoque:
            typeof variant.estoque === "number" && Number.isFinite(variant.estoque)
              ? String(variant.estoque)
              : "",
          vendidos:
            typeof variant.vendidos === "number" && Number.isFinite(variant.vendidos)
              ? String(variant.vendidos)
              : "0",
        }))
      : [newVariant()];

    const caracteristicasText = Array.isArray(row.caracteristicas)
      ? row.caracteristicas.filter((entry): entry is string => typeof entry === "string").join("\n")
      : "";

    setEditingProductId(row.id);
    setForm({
      nome: asString(row.nome),
      categoria: asString(row.categoria) || "Geral",
      descricao: asString(row.descricao),
      img: asString(row.img),
      preco: formatMoneyInput(row.preco),
      precoAntigo: formatMoneyInput(row.precoAntigo),
      estoque:
        typeof row.estoque === "number" && Number.isFinite(row.estoque)
          ? String(row.estoque)
          : "",
      lote: asString(row.lote),
      tagLabel: asString(row.tagLabel),
      tagColor: row.tagColor || "zinc",
      tagEffect: row.tagEffect || "none",
      coresText: joinTextLines(row.cores),
      caracteristicasText,
      usarVariantes: Array.isArray(row.variantes) && row.variantes.length > 0,
      variantes: mappedVariants,
    });
    setIsProductOpen(true);
  };

  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "new") {
      setEditingProductId(null);
      setForm({ ...EMPTY_FORM, variantes: [newVariant()] });
      setIsProductOpen(true);
    }
    if (action === "category") setIsCategoryOpen(true);
  }, [searchParams]);

  useEffect(() => {
    if (isWearCategory(form.categoria)) {
      setForm((prev) => ({ ...prev, usarVariantes: true }));
    }
  }, [form.categoria]);

  const handleCreateCategory = async () => {
    const nome = categoryName.trim();
    if (!nome) {
      addToast("Nome da categoria obrigatorio.", "error");
      return;
    }
    setSavingCategory(true);
    try {
      await createStoreCategory(nome);
      await loadCategories(true);
      setCategoryName("");
      setIsCategoryOpen(false);
      addToast("Categoria criada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao criar categoria.", "error");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleUploadProductImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setUploadingProductImage(true);
      const { url, error } = await uploadImage(file, "produtos");
      if (error || !url) {
        addToast(error || "Erro ao subir imagem do produto.", "error");
        return;
      }
      setForm((prev) => ({ ...prev, img: url }));
      addToast("Imagem do produto enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao subir imagem do produto.", "error");
    } finally {
      setUploadingProductImage(false);
    }
  };

  const handleSaveProduct = async () => {
    const nome = form.nome.trim();
    const categoria = form.categoria.trim() || "Geral";
    const preco = parseMoney(form.preco);
    const precoAntigo = form.precoAntigo.trim() ? parseMoney(form.precoAntigo) : 0;

    if (!nome) return void addToast("Nome do produto obrigatorio.", "error");
    if (!Number.isFinite(preco) || preco < 0) return void addToast("Preco invalido.", "error");

    const variants = variantsEnabled
      ? form.variantes
          .map((variant) => ({
            id: variant.id,
            tamanho: variant.tamanho.trim(),
            cor: variant.cor.trim(),
            estoque: parseIntSafe(variant.estoque),
            vendidos: parseIntSafe(variant.vendidos),
          }))
          .filter((variant) => variant.tamanho || variant.cor)
      : [];

    if (variantsEnabled && variants.length === 0) {
      return void addToast("Adicione pelo menos uma variacao.", "error");
    }

    const estoqueTotal = variants.length
      ? variants.reduce((acc, item) => acc + Number(item.estoque || 0), 0)
      : parseIntSafe(form.estoque);

    const caracteristicas = form.caracteristicasText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const coresText = form.coresText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    const payload: Record<string, unknown> = {
      nome,
      categoria,
      descricao: form.descricao.trim(),
      img: form.img.trim() || "/logo.png",
      preco,
      estoque: estoqueTotal,
      lote: form.lote.trim() || "geral",
      variantes: variants,
      cores: coresText,
      caracteristicas,
      updatedAt: new Date().toISOString(),
    };

    if (!editingProductId) {
      payload.likes = [];
      payload.cliques = 0;
      payload.vendidos = 0;
      payload.active = true;
      payload.aprovado = true;
    }

    if (Number.isFinite(precoAntigo) && precoAntigo > preco) payload.precoAntigo = precoAntigo;
    else if (editingProductId) payload.precoAntigo = 0;
    if (form.tagLabel.trim()) {
      payload.tagLabel = form.tagLabel.trim();
      payload.tagColor = form.tagColor;
      payload.tagEffect = form.tagEffect;
    } else if (editingProductId) {
      // Clear badge fields on edit when admin removes the label.
      payload.tagLabel = "";
      payload.tagColor = "zinc";
      payload.tagEffect = "none";
    }

    setSavingProduct(true);
    try {
      await upsertStoreProduct({
        ...(editingProductId ? { productId: editingProductId } : {}),
        data: payload,
      });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          editingProductId ? "UPDATE" : "CREATE",
          "Loja/Produto",
          editingProductId ? `Produto editado: ${nome}` : `Produto criado: ${nome}`
        ).catch(() => {});
      }
      await loadProducts(true);
      await loadCategories(true);
      closeProductForm();
      addToast(editingProductId ? "Produto atualizado com sucesso." : "Produto criado com sucesso.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(editingProductId ? "Erro ao atualizar produto." : "Erro ao criar produto.", "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleToggleProductActive = async (row: ProductRow) => {
    if (togglingProductId) return;
    const currentActive = row.active !== false;
    const nextActive = !currentActive;

    try {
      setTogglingProductId(row.id);
      await upsertStoreProduct({
        productId: row.id,
        data: {
          active: nextActive,
          updatedAt: new Date().toISOString(),
        },
      });
      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Loja/Produto",
          `${nextActive ? "Ativou" : "Desativou"} produto: ${asString(row.nome) || row.id}`
        ).catch(() => {});
      }
      addToast(nextActive ? "Produto ativado." : "Produto desativado.", "success");
      await loadProducts(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar status do produto.", "error");
    } finally {
      setTogglingProductId(null);
    }
  };

  const addVariant = () => setForm((prev) => ({ ...prev, variantes: [...prev.variantes, newVariant()] }));
  const removeVariant = (id: string) =>
    setForm((prev) => {
      const next = prev.variantes.filter((variant) => variant.id !== id);
      return { ...prev, variantes: next.length ? next : [newVariant()] };
    });
  const setVariantField = (id: string, field: keyof VariantForm, value: string) =>
    setForm((prev) => ({
      ...prev,
      variantes: prev.variantes.map((variant) =>
        variant.id === id
          ? {
              ...variant,
              [field]:
                field === "estoque" || field === "vendidos"
                  ? value.replace(/[^\d]/g, "")
                  : value,
            }
          : variant
      ),
    }));

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin/loja" className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Produtos</h1>
              <p className="text-[11px] text-zinc-500 font-bold">Criacao completa + categorias + variacoes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsCategoryOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-black uppercase text-blue-300 hover:bg-blue-500/20"><Tags size={14} /> Categoria</button>
            <button onClick={openCreateProduct} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"><Plus size={14} /> Novo Produto</button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Link href="/admin/loja/pedidos-pendentes" className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 hover:bg-yellow-500/10 transition">
            <div className="inline-flex items-center gap-2 text-xs font-black uppercase text-yellow-300"><ShoppingBag size={14} /> Pedidos Pendentes</div>
            <p className="mt-1 text-[11px] text-zinc-400">Aprovacao manual continua ativa.</p>
          </Link>
          <Link href="/admin/loja/review" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 hover:bg-emerald-500/10 transition">
            <div className="inline-flex items-center gap-2 text-xs font-black uppercase text-emerald-300"><MessageSquare size={14} /> Reviews</div>
            <p className="mt-1 text-[11px] text-zinc-400">Avaliacoes continuam moderadas apos compra.</p>
          </Link>
        </div>

        {isCategoryOpen && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black uppercase">Nova Categoria</h2>
                <p className="text-[11px] text-zinc-500">Usada no filtro da lojinha e na paginacao por categoria.</p>
              </div>
              <button onClick={() => !savingCategory && setIsCategoryOpen(false)} className="p-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700"><X size={14} /></button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Nome da categoria" className="flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <button onClick={() => void handleCreateCategory()} disabled={savingCategory} className="px-4 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60 inline-flex items-center gap-2 justify-center">
                {savingCategory ? <Loader2 size={14} className="animate-spin" /> : <Tags size={14} />} {savingCategory ? "Salvando..." : "Criar Categoria"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryNames.map((name) => (
                <button key={name} onClick={() => setForm((prev) => ({ ...prev, categoria: name }))} className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-950 text-[10px] font-black uppercase text-zinc-300 hover:border-zinc-500">{name}</button>
              ))}
            </div>
          </section>
        )}

        {isProductOpen && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black uppercase">{editingProductId ? "Editar Produto" : "Criar Produto"}</h2>
                <p className="text-[11px] text-zinc-500">Suporta tamanhos/variacoes, badge promocional, lote, cores e caracteristicas.</p>
              </div>
              <button
                onClick={() => {
                  if (savingProduct) return;
                  closeProductForm();
                }}
                className="p-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} placeholder="Nome do produto" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select value={form.categoria} onChange={(e) => setForm((prev) => ({ ...prev, categoria: e.target.value }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
                  <option value="Geral">Geral</option>
                  {categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button onClick={() => setIsCategoryOpen(true)} className="px-3 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"><Tags size={14} /></button>
              </div>
              <input value={form.preco} onChange={(e) => setForm((prev) => ({ ...prev, preco: e.target.value }))} placeholder="Preco" inputMode="decimal" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
              <input value={form.precoAntigo} onChange={(e) => setForm((prev) => ({ ...prev, precoAntigo: e.target.value }))} placeholder="Preco antigo (promo)" inputMode="decimal" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
              <input value={form.estoque} onChange={(e) => setForm((prev) => ({ ...prev, estoque: e.target.value.replace(/[^\d]/g, "") }))} disabled={variantsEnabled} placeholder="Estoque total (sem variacoes)" inputMode="numeric" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
              <input value={form.lote} onChange={(e) => setForm((prev) => ({ ...prev, lote: e.target.value }))} placeholder="Lote / promocao" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <input value={form.img} onChange={(e) => setForm((prev) => ({ ...prev, img: e.target.value }))} placeholder="URL da imagem (opcional)" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                <label className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase cursor-pointer transition ${uploadingProductImage ? "border-zinc-700 bg-zinc-800 text-zinc-400 cursor-wait" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                  {uploadingProductImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  {uploadingProductImage ? "Enviando..." : "Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleUploadProductImage(e)} disabled={uploadingProductImage} />
                </label>
              </div>
              {form.img.trim() && (
                <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-black/20 p-3 flex items-center gap-3">
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-700 shrink-0">
                    <Image src={form.img} alt="Preview do produto" fill sizes="56px" className="object-cover"  />
                  </div>
                  <p className="text-[11px] text-zinc-400 break-all">{form.img}</p>
                </div>
              )}
              <textarea value={form.descricao} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))} rows={3} placeholder="Descricao" className="md:col-span-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-y" />
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-white">Badge / Promocao</p>
                  <p className="text-[11px] text-zinc-500">Desconto, lote, campanha, etc.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] text-zinc-400 font-bold">
                  <input type="checkbox" checked={form.tagLabel.trim().length > 0} onChange={(e) => setForm((prev) => ({ ...prev, tagLabel: e.target.checked ? (prev.tagLabel || "PROMO") : "" }))} className="accent-emerald-500" />
                  Ativar
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={form.tagLabel} onChange={(e) => setForm((prev) => ({ ...prev, tagLabel: e.target.value }))} placeholder="Texto da badge" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                <select value={form.tagColor} onChange={(e) => setForm((prev) => ({ ...prev, tagColor: e.target.value as ProductForm["tagColor"] }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
                  <option value="zinc">Cinza</option><option value="emerald">Verde</option><option value="orange">Laranja</option><option value="purple">Roxo</option><option value="blue">Azul</option><option value="red">Vermelho</option>
                </select>
                <select value={form.tagEffect} onChange={(e) => setForm((prev) => ({ ...prev, tagEffect: e.target.value as ProductForm["tagEffect"] }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
                  <option value="none">Sem efeito</option><option value="pulse">Pulse</option><option value="shine">Shine</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-white">Variacoes / Tamanhos</p>
                  <p className="text-[11px] text-zinc-500">Categorias de roupa ativam variacoes automaticamente.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] text-zinc-400 font-bold">
                  <input type="checkbox" checked={variantsEnabled} disabled={isWearCategory(form.categoria)} onChange={(e) => setForm((prev) => ({ ...prev, usarVariantes: e.target.checked }))} className="accent-emerald-500" />
                  {isWearCategory(form.categoria) ? "Obrigatorio" : "Usar"}
                </label>
              </div>

              {variantsEnabled && (
                <div className="space-y-2">
                  {form.variantes.map((v) => (
                    <div key={v.id} className="grid grid-cols-12 gap-2">
                      <input value={v.tamanho} onChange={(e) => setVariantField(v.id, "tamanho", e.target.value)} placeholder="Tamanho" className="col-span-4 md:col-span-3 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                      <input value={v.cor} onChange={(e) => setVariantField(v.id, "cor", e.target.value)} placeholder="Cor" className="col-span-4 md:col-span-3 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                      <input value={v.estoque} onChange={(e) => setVariantField(v.id, "estoque", e.target.value)} placeholder="Qtd" inputMode="numeric" className="col-span-2 md:col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                      <input value={v.vendidos} onChange={(e) => setVariantField(v.id, "vendidos", e.target.value)} placeholder="Vend." inputMode="numeric" className="col-span-2 md:col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                      <button onClick={() => removeVariant(v.id)} className="col-span-12 md:col-span-2 rounded-lg border border-red-500/20 bg-red-500/5 text-red-300 hover:bg-red-500/10 inline-flex items-center justify-center gap-1 text-xs font-bold py-2"><Trash2 size={12} /> Remover</button>
                    </div>
                  ))}
                  <button onClick={addVariant} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-700"><Plus size={12} /> Adicionar variacao</button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4">
              <p className="text-xs font-black uppercase text-white mb-2">Cores (texto livre)</p>
              <textarea
                value={form.coresText}
                onChange={(e) => setForm((prev) => ({ ...prev, coresText: e.target.value }))}
                rows={3}
                className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-y"
                placeholder={"Preto\nBranco\nVerde Neon"}
              />
              <p className="mt-2 text-[11px] text-zinc-500">
                Campo opcional para listar cores disponiveis (separar por linha).
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4">
              <p className="text-xs font-black uppercase text-white mb-2">Caracteristicas (1 por linha)</p>
              <textarea value={form.caracteristicasText} onChange={(e) => setForm((prev) => ({ ...prev, caracteristicasText: e.target.value }))} rows={4} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-y" placeholder={"100% algodao\nEdicao limitada\nFrete local"} />
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-[11px] text-zinc-400 space-y-1">
              <p className="font-black uppercase text-white">Integracoes preservadas</p>
              <p>Compra continua indo para aprovacao manual em `Pedidos Pendentes`.</p>
              <p>Aprovacao continua gerando XP/Selos (fidelidade/conquistas) no fluxo da loja.</p>
              <p>Reviews continuam pendentes e moderadas em `Reviews` apos compra aprovada.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={() => {
                  if (savingProduct) return;
                  closeProductForm();
                }}
                disabled={savingProduct}
                className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 text-xs font-black uppercase hover:bg-zinc-700 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button onClick={() => void handleSaveProduct()} disabled={savingProduct || uploadingProductImage} className="px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {savingProduct ? <Loader2 size={14} className="animate-spin" /> : editingProductId ? <Pencil size={14} /> : <Plus size={14} />} {savingProduct ? "Salvando..." : (uploadingProductImage ? "Aguardando upload..." : (editingProductId ? "Salvar Alteracoes" : "Criar Produto"))}
              </button>
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-xs text-zinc-500 uppercase font-bold">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-zinc-500 border border-zinc-800 rounded-xl p-5">Nenhum produto encontrado.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-black border border-zinc-700">
                  <Image src={row.img || "https://placehold.co/200x200/111/333?text=Produto"} alt={row.nome || "Produto"} fill  className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-bold truncate">{row.nome || "Produto"}</p>
                    {row.tagLabel && <span className="px-2 py-0.5 rounded border border-zinc-700 text-[9px] font-black uppercase text-zinc-300">{row.tagLabel}</span>}
                    <span
                      className={`px-2 py-0.5 rounded border text-[9px] font-black uppercase ${
                        row.active === false
                          ? "border-red-500/30 text-red-300 bg-red-500/5"
                          : "border-emerald-500/30 text-emerald-300 bg-emerald-500/5"
                      }`}
                    >
                      {row.active === false ? "Inativo" : "Ativo"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 uppercase">{row.categoria || "Sem categoria"} • Lote: {row.lote || "-"}</p>
                  {!!row.variantes?.length && <p className="text-[10px] text-zinc-500 uppercase">Variacoes: {row.variantes.length}</p>}
                  {typeof row.cores === "string" && row.cores.trim() && (
                    <p className="text-[10px] text-zinc-500 line-clamp-1">Cores: {row.cores}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-emerald-400">R$ {Number(row.preco || 0).toFixed(2)}</p>
                  {!!row.precoAntigo && Number(row.precoAntigo) > Number(row.preco || 0) && <p className="text-[10px] text-zinc-500 line-through">R$ {Number(row.precoAntigo || 0).toFixed(2)}</p>}
                  <p className="text-[10px] text-zinc-500 uppercase">Estoque: {Number(row.estoque || 0)}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">Vendidos: {Number(row.vendidos || 0)}</p>
                </div>
                <button
                  onClick={() => openEditProduct(row)}
                  className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white"
                  title="Editar produto"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void handleToggleProductActive(row)}
                  disabled={togglingProductId === row.id}
                  className={`p-2 rounded-lg border hover:text-white disabled:opacity-50 ${
                    row.active === false
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                      : "bg-red-500/10 border-red-500/20 text-red-300"
                  }`}
                  title={row.active === false ? "Ativar produto" : "Desativar produto"}
                >
                  {togglingProductId === row.id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                </button>
                <Link href={`/loja/${row.id}`} target="_blank" className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white" title="Abrir produto">
                  <ExternalLink size={15} />
                </Link>
              </article>
            ))}
          </div>
        )}

        <div className="mt-5 text-[11px] text-zinc-600 flex items-center gap-2">
          <Package size={13} />
          Limite de carregamento: 120 itens por abertura. Pedidos/Reviews continuam em modulos separados para manter leve.
        </div>
      </main>
    </div>
  );
}
