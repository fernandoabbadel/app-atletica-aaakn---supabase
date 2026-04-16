"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PackagePlus,
  Pencil,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { fetchLeagueById, type LeagueRecord } from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import {
  approveStoreOrder,
  fetchStoreCategories,
  fetchStoreOrdersPage,
  fetchStoreProducts,
  renameStoreProductsCategory,
  setStoreOrderStatus,
  upsertStoreCategory,
  upsertStoreProduct,
} from "@/lib/storeService";
import { withTenantSlug } from "@/lib/tenantRouting";
import { normalizePhoneToBrE164, PHONE_MAX_LENGTH, URL_MAX_LENGTH } from "@/utils/contactFields";

type LeagueStoreMode = "overview" | "products" | "pending" | "approved";
type Row = Record<string, unknown>;

type ProductForm = {
  nome: string;
  preco: string;
  estoque: string;
  lote: string;
  img: string;
  descricao: string;
  contato: string;
};

const emptyProductForm: ProductForm = {
  nome: "",
  preco: "",
  estoque: "",
  lote: "geral",
  img: "",
  descricao: "",
  contato: "",
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value || 0) || 0;

const isLeagueSellerRow = (row: Row, leagueId: string): boolean =>
  asString(row.seller_type).toLowerCase() === "league" && asString(row.seller_id) === leagueId;

const formatCurrency = (value: unknown): string => `R$ ${asNumber(value).toFixed(2)}`;

const formatDateTime = (value: unknown): string => {
  const raw = asString(value);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "Nao informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
};

export function LeagueStoreAdminPage({ mode = "overview" }: { mode?: LeagueStoreMode }) {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSlug, palette } = useTenantTheme();
  const leagueId = typeof params?.leagueId === "string" ? params.leagueId : "";

  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [category, setCategory] = useState<Row | null>(null);
  const [products, setProducts] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [storeColor, setStoreColor] = useState(palette.primary || "#10b981");
  const [storeCover, setStoreCover] = useState("");
  const [formOpen, setFormOpen] = useState(mode === "products");
  const [editingProductId, setEditingProductId] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyProductForm);

  const leagueName = league?.sigla?.trim() || league?.nome?.trim() || "Liga";
  const leagueLogo = (league ? resolveLeagueLogoSrc(league) : "") || "/logo.png";
  const categoryVisible = category ? category.visible !== false : false;
  const visibleProducts = products.filter((row) => row.active !== false);
  const productIds = useMemo(() => products.map((row) => asString(row.id)).filter(Boolean), [products]);
  const storeHref = tenantSlug
    ? withTenantSlug(tenantSlug, `/ligas/${encodeURIComponent(leagueId)}/loja`)
    : `/ligas/${encodeURIComponent(leagueId)}/loja`;
  const leagueHomeHref = tenantSlug
    ? withTenantSlug(tenantSlug, `/ligas/${encodeURIComponent(leagueId)}`)
    : `/ligas/${encodeURIComponent(leagueId)}`;
  const publicStoreHref = tenantSlug ? withTenantSlug(tenantSlug, "/loja") : "/loja";

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!leagueId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [leagueRow, categoryRows, productRows] = await Promise.all([
          fetchLeagueById(leagueId, { forceRefresh, tenantId: tenantId || undefined }),
          fetchStoreCategories({ maxResults: 300, forceRefresh, tenantId: tenantId || undefined }),
          fetchStoreProducts({ maxResults: 300, forceRefresh, tenantId: tenantId || undefined }),
        ]);
        const leagueProducts = (productRows as Row[]).filter((row) => isLeagueSellerRow(row, leagueId));
        const leagueCategory =
          (categoryRows as Row[]).find((row) => isLeagueSellerRow(row, leagueId)) || null;
        setLeague(leagueRow);
        setCategory(leagueCategory);
        setProducts(leagueProducts);
        setStoreColor(asString(leagueCategory?.button_color) || palette.primary || "#10b981");
        setStoreCover(asString(leagueCategory?.cover_img));

        if (mode === "pending" || mode === "approved") {
          const ids = leagueProducts.map((row) => asString(row.id)).filter(Boolean);
          const page =
            ids.length === 0
              ? { rows: [], hasMore: false }
              : await fetchStoreOrdersPage({
                  page: 1,
                  pageSize: 50,
                  status: mode === "approved" ? "approved" : "pendente",
                  productIds: ids,
                  tenantId: tenantId || undefined,
                });
          setOrders(page.rows as Row[]);
        } else {
          setOrders([]);
        }
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar loja da liga.", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast, leagueId, mode, palette.primary, tenantId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const ensureCategory = useCallback(
    async (visible?: boolean) => {
      if (!league || !leagueId) return;
      const previousName = asString(category?.nome);
      await upsertStoreCategory({
        categoryId: asString(category?.id) || undefined,
        data: {
          nome: leagueName,
          coverImg: storeCover,
          buttonColor: storeColor,
          logoUrl: leagueLogo,
          visible: typeof visible === "boolean" ? visible : category ? categoryVisible : true,
          sellerType: "league",
          sellerId: leagueId,
          tenantId: tenantId || undefined,
        },
      });
      if (previousName && previousName !== leagueName) {
        await renameStoreProductsCategory({
          previousName,
          nextName: leagueName,
          sellerType: "league",
          sellerId: leagueId,
          tenantId: tenantId || undefined,
        });
      }
    },
    [category, categoryVisible, league, leagueId, leagueLogo, leagueName, storeColor, storeCover, tenantId]
  );

  const handleSaveStore = async (visible?: boolean) => {
    setSaving(true);
    try {
      await ensureCategory(visible);
      addToast("Loja da liga atualizada.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar loja.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProducts = async (visible: boolean) => {
    setSaving(true);
    try {
      await Promise.all(
        products.map((product) =>
          upsertStoreProduct({
            productId: asString(product.id),
            data: { active: visible, aprovado: true },
            tenantId: tenantId || undefined,
          })
        )
      );
      addToast(visible ? "Produtos exibidos." : "Produtos ocultados.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar produtos.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openProductForm = (product?: Row) => {
    setEditingProductId(asString(product?.id));
    setForm(
      product
        ? {
            nome: asString(product.nome),
            preco: String(product.preco ?? ""),
            estoque: String(product.estoque ?? ""),
            lote: asString(product.lote) || "geral",
            img: asString(product.img),
            descricao: asString(product.descricao),
            contato: asString((product.payment_config as { whatsapp?: unknown } | null)?.whatsapp),
          }
        : emptyProductForm
    );
    setFormOpen(true);
  };

  const handleSaveProduct = async () => {
    const nome = form.nome.trim();
    const preco = Number(String(form.preco).replace(",", "."));
    if (!league || !leagueId) return;
    if (!nome) return addToast("Nome do produto obrigatorio.", "error");
    if (!Number.isFinite(preco) || preco < 0) return addToast("Preco invalido.", "error");

    setSaving(true);
    try {
      await ensureCategory(true);
      await upsertStoreProduct({
        ...(editingProductId ? { productId: editingProductId } : {}),
        data: {
          nome,
          categoria: leagueName,
          descricao: form.descricao.trim(),
          img: form.img.trim() || leagueLogo,
          preco,
          estoque: Math.max(0, Math.floor(Number(form.estoque || 0) || 0)),
          lote: form.lote.trim() || "geral",
          status: "ativo",
          active: true,
          aprovado: true,
          likes: [],
          payment_config: {
            chave: "",
            banco: "",
            titular: "",
            whatsapp: normalizePhoneToBrE164(form.contato).slice(0, PHONE_MAX_LENGTH),
          },
          seller_type: "league",
          seller_id: leagueId,
          seller_name: leagueName,
          seller_logo_url: leagueLogo,
        },
        tenantId: tenantId || undefined,
      });
      addToast(editingProductId ? "Produto atualizado." : "Produto criado.", "success");
      setEditingProductId("");
      setForm(emptyProductForm);
      setFormOpen(false);
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar produto.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (order: Row) => {
    const orderId = asString(order.id);
    if (!orderId) return;
    setActionId(orderId);
    try {
      await approveStoreOrder({
        orderId,
        userId: asString(order.userId),
        userName: asString(order.userName) || "Usuario",
        productId: asString(order.productId),
        productName: asString(order.productName) || "Produto",
        price: asNumber(order.total || order.price),
        quantidade: asNumber(order.quantidade || order.itens) || undefined,
        itens: asNumber(order.itens || order.quantidade) || undefined,
        approvedBy: user?.uid || "liga",
      });
      addToast("Pedido aprovado.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao aprovar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  const handleOrderStatus = async (order: Row, status: "pendente" | "rejected" | "delivered") => {
    const orderId = asString(order.id);
    if (!orderId) return;
    setActionId(orderId);
    try {
      await setStoreOrderStatus({ orderId, status });
      addToast("Pedido atualizado.", "success");
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar pedido.", "error");
    } finally {
      setActionId("");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        Liga nao encontrada.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push(leagueHomeHref)} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800">
              <ArrowLeft size={18} />
            </button>
            <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-zinc-700 bg-black">
              <Image src={leagueLogo} alt={leagueName} fill sizes="44px" className="object-cover" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Loja da liga</p>
              <h1 className="text-xl font-black uppercase">{leagueName}</h1>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link href={storeHref} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-800">Loja</Link>
            <Link href={`${storeHref}/produtos`} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20">Produtos</Link>
            <Link href={`${storeHref}/pedidos-pendentes`} className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] font-black uppercase text-yellow-300 hover:bg-yellow-500/20">Pendentes</Link>
            <Link href={`${storeHref}/pedidos-aprovados`} className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] font-black uppercase text-cyan-300 hover:bg-cyan-500/20">Aprovados</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {mode === "overview" && (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[10px] font-black uppercase text-zinc-500">Categoria</p>
                <p className="mt-2 text-lg font-black">{leagueName}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{categoryVisible ? "Visivel" : "Oculta"}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[10px] font-black uppercase text-zinc-500">Produtos</p>
                <p className="mt-2 text-lg font-black">{products.length}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{visibleProducts.length} visiveis</p>
              </div>
              <button onClick={() => void handleSaveStore(!categoryVisible)} disabled={saving} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-left text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
                {categoryVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                <p className="mt-3 text-xs font-black uppercase">{categoryVisible ? "Ocultar categoria" : "Ativar categoria"}</p>
              </button>
              <button onClick={() => void handleToggleProducts(visibleProducts.length !== products.length)} disabled={saving || products.length === 0} className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-left text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60">
                {visibleProducts.length === products.length ? <EyeOff size={18} /> : <Eye size={18} />}
                <p className="mt-3 text-xs font-black uppercase">{visibleProducts.length === products.length ? "Ocultar produtos" : "Exibir produtos"}</p>
              </button>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs font-black uppercase">Informacoes da loja</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={leagueName} disabled className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm font-bold text-zinc-400" />
                  <input type="color" value={storeColor} onChange={(event) => setStoreColor(event.target.value)} className="h-10 rounded-xl border border-zinc-700 bg-black/40 px-2" />
                  <input value={storeCover} maxLength={URL_MAX_LENGTH} onChange={(event) => setStoreCover(event.target.value.slice(0, URL_MAX_LENGTH))} placeholder="URL da capa" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                </div>
                <button onClick={() => void handleSaveStore(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Salvar loja
                </button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                <div className="relative h-40">
                  <Image src={storeCover || leagueLogo} alt={leagueName} fill sizes="320px" className="object-cover opacity-80" />
                </div>
                <div className="p-4">
                  <span className="rounded-full border px-3 py-1 text-[10px] font-black uppercase" style={{ borderColor: storeColor, color: storeColor }}>{leagueName}</span>
                  <Link href={publicStoreHref} className="mt-4 inline-flex rounded-xl border border-zinc-700 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-900">Abrir loja publica</Link>
                </div>
              </div>
            </section>
          </>
        )}

        {mode === "products" && (
          <>
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-black uppercase">Produtos da liga</p>
                <p className="text-[11px] text-zinc-500">Use apenas o telefone de contato da liga.</p>
              </div>
              <button onClick={() => openProductForm()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20">
                <PackagePlus size={14} /> Adicionar produto
              </button>
            </div>

            {formOpen && (
              <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black uppercase">{editingProductId ? "Editar produto" : "Novo produto"}</p>
                  <button onClick={() => { setFormOpen(false); setEditingProductId(""); setForm(emptyProductForm); }} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"><X size={14} /></button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={form.nome} onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value.slice(0, 120) }))} placeholder="Nome do produto" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.preco} onChange={(event) => setForm((prev) => ({ ...prev, preco: event.target.value }))} placeholder="Preco" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.estoque} onChange={(event) => setForm((prev) => ({ ...prev, estoque: event.target.value.replace(/[^\d]/g, "") }))} placeholder="Estoque" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.lote} onChange={(event) => setForm((prev) => ({ ...prev, lote: event.target.value.slice(0, 80) }))} placeholder="Lote" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.img} maxLength={URL_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, img: event.target.value.slice(0, URL_MAX_LENGTH) }))} placeholder="URL da imagem" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                  <input value={form.contato} maxLength={PHONE_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, contato: normalizePhoneToBrE164(event.target.value) }))} placeholder="Telefone/WhatsApp para comprovante" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                  <textarea value={form.descricao} onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value.slice(0, 1200) }))} placeholder="Descricao" rows={4} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                </div>
                <button onClick={() => void handleSaveProduct()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />} Salvar produto
                </button>
              </section>
            )}

            <section className="space-y-3">
              {products.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-500">Nenhum produto cadastrado.</div>
              ) : products.map((product) => (
                <article key={asString(product.id)} className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:flex-row md:items-center">
                  <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                    <Image src={asString(product.img) || leagueLogo} alt={asString(product.nome) || "Produto"} fill sizes="64px" className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{asString(product.nome) || "Produto"}</p>
                    <p className="text-[11px] text-zinc-500">{formatCurrency(product.preco)} - Estoque {asNumber(product.estoque)} - {product.active === false ? "Oculto" : "Visivel"}</p>
                  </div>
                  <button onClick={() => openProductForm(product)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-[10px] font-black uppercase text-zinc-300 hover:bg-zinc-700"><Pencil size={12} /> Editar</button>
                  <button onClick={() => void upsertStoreProduct({ productId: asString(product.id), data: { active: product.active === false, aprovado: true }, tenantId: tenantId || undefined }).then(() => load(true))} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-300 hover:bg-cyan-500/20">
                    {product.active === false ? <Eye size={12} /> : <EyeOff size={12} />} {product.active === false ? "Exibir" : "Ocultar"}
                  </button>
                </article>
              ))}
            </section>
          </>
        )}

        {(mode === "pending" || mode === "approved") && (
          <section className="space-y-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-sm font-black uppercase">{mode === "pending" ? "Pedidos pendentes" : "Pedidos aprovados"}</p>
              <p className="text-[11px] text-zinc-500">Pedidos da loja geral filtrados pelos produtos desta liga.</p>
            </div>
            {productIds.length === 0 || orders.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-500">Nenhum pedido encontrado.</div>
            ) : orders.map((order) => {
              const orderId = asString(order.id);
              const busy = actionId === orderId;
              return (
                <article key={orderId} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-black">{asString(order.productName) || "Produto"}</p>
                      <p className="text-[11px] text-zinc-500">Comprador: {asString(order.userName) || "Usuario"} - {formatDateTime(order.createdAt)}</p>
                      <p className="text-[11px] text-zinc-500">Qtd {asNumber(order.quantidade || order.itens) || 1} - {formatCurrency(order.total || order.price)}</p>
                    </div>
                    {mode === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void handleApprove(order)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-60">{busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Aprovar</button>
                        <button onClick={() => void handleOrderStatus(order, "rejected")} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-60"><XCircle size={12} /> Rejeitar</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void handleOrderStatus(order, "pendente")} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[10px] font-black uppercase text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-60"><RotateCcw size={12} /> Reabrir</button>
                        <button onClick={() => void handleOrderStatus(order, "delivered")} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"><CheckCircle2 size={12} /> Entregue</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
