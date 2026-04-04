"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  GripVertical,
  ImagePlus,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Tags,
} from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchAdminStoreBundle,
  renameStoreProductsCategory,
  saveStoreCategoryDisplayOrder,
  upsertStoreCategory,
} from "@/lib/storeService";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "@/lib/upload";
import { URL_MAX_LENGTH } from "@/utils/contactFields";

type CategoryRow = {
  id: string;
  nome?: string;
  cover_img?: string;
  button_color?: string;
  logo_url?: string;
  display_order?: number | null;
  seller_type?: string;
  seller_id?: string;
};

type ProductRow = {
  id: string;
  categoria?: string;
  seller_type?: string;
  seller_id?: string;
  seller_logo_url?: string;
};

type CategoryFormState = {
  nome: string;
  coverImg: string;
  buttonColor: string;
};

type DisplayCategory = {
  key: string;
  categoryId: string | null;
  nome: string;
  coverImg: string;
  logoUrl: string;
  buttonColor: string;
  displayOrder: number | null;
  sellerType: "tenant" | "mini_vendor";
  sellerId: string;
  derivedOnly: boolean;
};

const CATEGORY_NAME_MAX_LENGTH = 80;
const CATEGORY_COLOR_DEFAULT = "#10b981";
const MINI_VENDOR_COLOR_DEFAULT = "#2563eb";
const buildEmptyForm = (buttonColor: string): CategoryFormState => ({
  nome: "",
  coverImg: "",
  buttonColor,
});

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
};
const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const moveListItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const resolveSellerType = (value: unknown): "tenant" | "mini_vendor" =>
  asString(value).trim().toLowerCase() === "mini_vendor" ? "mini_vendor" : "tenant";

const resolveSellerId = (
  sellerType: "tenant" | "mini_vendor",
  sellerId: unknown,
  tenantId: string
): string => {
  const cleanSellerId = asString(sellerId).trim();
  if (sellerType === "tenant") {
    return cleanSellerId || tenantId.trim();
  }
  return cleanSellerId;
};

const buildCategoryKey = (
  categoryName: string,
  sellerType: "tenant" | "mini_vendor",
  sellerId: string
): string => `${sellerType}:${sellerId || "_"}:${categoryName.trim().toLowerCase()}`;

export default function AdminLojaCategoriasPage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantLogoUrl, tenantSlug, palette } = useTenantTheme();
  const tenantCategoryColor = palette.primary || CATEGORY_COLOR_DEFAULT;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [editingCategoryKey, setEditingCategoryKey] = useState<string | null>(null);
  const [orderedCategoryKeys, setOrderedCategoryKeys] = useState<string[]>([]);
  const [draggingCategoryKey, setDraggingCategoryKey] = useState<string | null>(null);
  const [isOrderPanelOpen, setIsOrderPanelOpen] = useState(true);
  const [form, setForm] = useState<CategoryFormState>(() => buildEmptyForm(tenantCategoryColor));

  useEffect(() => {
    if (editingCategoryKey) return;
    setForm((previous) =>
      previous.nome.trim() || previous.coverImg.trim()
        ? previous
        : { ...previous, buttonColor: tenantCategoryColor }
    );
  }, [editingCategoryKey, tenantCategoryColor]);

  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/loja") : "/admin/loja";
  const productsHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/produtos")
    : "/admin/loja/produtos";
  const newProductHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/produtos?action=new")
    : "/admin/loja/produtos?action=new";
  const miniVendorAdminHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/mini-vendors/cadastros")
    : "/admin/mini-vendors/cadastros";

  const loadData = useCallback(async (forceRefresh = true) => {
    const bundle = await fetchAdminStoreBundle({
      productsLimit: 240,
      categoriesLimit: 240,
      ordersLimit: 1,
      reviewsLimit: 1,
      forceRefresh,
    });

    setCategories(bundle.categorias as CategoryRow[]);
    setProducts(bundle.produtos as ProductRow[]);
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await loadData(false);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar categorias da loja.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, loadData]);

  const displayedCategories = useMemo(() => {
    const rows = new Map<string, DisplayCategory>();
    const cleanTenantId = activeTenantId.trim();
    const cleanTenantLogoUrl = tenantLogoUrl.trim();

    categories.forEach((row) => {
      const nome = asString(row.nome).trim();
      if (!nome) return;

      const sellerType = resolveSellerType(row.seller_type);
      const sellerId = resolveSellerId(sellerType, row.seller_id, cleanTenantId);
      const key = buildCategoryKey(nome, sellerType, sellerId);

      rows.set(key, {
        key,
        categoryId: asString(row.id).trim() || null,
        nome,
        coverImg: asString(row.cover_img).trim(),
        logoUrl:
          sellerType === "tenant"
            ? cleanTenantLogoUrl || asString(row.logo_url).trim()
            : asString(row.logo_url).trim(),
        buttonColor:
          asString(row.button_color).trim() ||
          (sellerType === "mini_vendor" ? MINI_VENDOR_COLOR_DEFAULT : tenantCategoryColor),
        displayOrder: asInt(row.display_order),
        sellerType,
        sellerId,
        derivedOnly: false,
      });
    });

    products.forEach((row) => {
      const nome = asString(row.categoria).trim();
      if (!nome) return;

      const sellerType = resolveSellerType(row.seller_type);
      const sellerId = resolveSellerId(sellerType, row.seller_id, cleanTenantId);
      const key = buildCategoryKey(nome, sellerType, sellerId);
      const productLogoUrl =
        sellerType === "tenant" ? cleanTenantLogoUrl : asString(row.seller_logo_url).trim();
      const current = rows.get(key);

      if (current) {
        rows.set(key, {
          ...current,
          coverImg: current.coverImg || current.logoUrl || productLogoUrl,
          logoUrl:
            current.logoUrl ||
            (sellerType === "tenant" ? cleanTenantLogoUrl : productLogoUrl),
        });
        return;
      }

      rows.set(key, {
        key,
        categoryId: null,
        nome,
        coverImg: productLogoUrl,
        logoUrl: productLogoUrl,
        buttonColor:
          sellerType === "mini_vendor" ? MINI_VENDOR_COLOR_DEFAULT : tenantCategoryColor,
        displayOrder: null,
        sellerType,
        sellerId,
        derivedOnly: true,
      });
    });

    return Array.from(rows.values()).sort((left, right) => {
      if (left.displayOrder !== null || right.displayOrder !== null) {
        if (left.displayOrder === null) return 1;
        if (right.displayOrder === null) return -1;
        if (left.displayOrder !== right.displayOrder) {
          return left.displayOrder - right.displayOrder;
        }
      }
      if (left.sellerType !== right.sellerType) {
        return left.sellerType === "tenant" ? -1 : 1;
      }
      return left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" });
    });
  }, [activeTenantId, categories, products, tenantCategoryColor, tenantLogoUrl]);

  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const cleanTenantId = activeTenantId.trim();
    products.forEach((row) => {
      const nome = asString(row.categoria).trim();
      if (!nome) return;

      const sellerType = resolveSellerType(row.seller_type);
      const sellerId = resolveSellerId(sellerType, row.seller_id, cleanTenantId);
      const key = buildCategoryKey(nome, sellerType, sellerId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [activeTenantId, products]);

  const tenantCategories = useMemo(
    () => displayedCategories.filter((row) => row.sellerType === "tenant"),
    [displayedCategories]
  );
  const miniVendorCategories = useMemo(
    () => displayedCategories.filter((row) => row.sellerType === "mini_vendor"),
    [displayedCategories]
  );
  const editingCategory = useMemo(
    () =>
      editingCategoryKey
        ? displayedCategories.find((row) => row.key === editingCategoryKey) ?? null
        : null,
    [displayedCategories, editingCategoryKey]
  );
  const orderableCategoryMap = useMemo(
    () =>
      new Map(
        displayedCategories
          .filter((row) => Boolean(row.categoryId))
          .map((row) => [row.key, row])
      ),
    [displayedCategories]
  );
  const defaultOrderedKeys = useMemo(
    () =>
      displayedCategories
        .filter((row) => Boolean(row.categoryId))
        .map((row) => row.key),
    [displayedCategories]
  );
  const orderableCategories = useMemo(
    () =>
      orderedCategoryKeys
        .map((key) => orderableCategoryMap.get(key) ?? null)
        .filter((row): row is DisplayCategory => row !== null),
    [orderableCategoryMap, orderedCategoryKeys]
  );
  const nonOrderableCategoriesCount = displayedCategories.length - orderableCategories.length;
  const isOrderDirty = useMemo(
    () => !arraysEqual(orderedCategoryKeys, defaultOrderedKeys),
    [defaultOrderedKeys, orderedCategoryKeys]
  );

  useEffect(() => {
    setOrderedCategoryKeys((previous) => {
      if (defaultOrderedKeys.length === 0) return [];
      if (previous.length === 0) return defaultOrderedKeys;

      const previousFiltered = previous.filter((key) => defaultOrderedKeys.includes(key));
      const missingKeys = defaultOrderedKeys.filter((key) => !previousFiltered.includes(key));
      const merged = [...previousFiltered, ...missingKeys];
      return arraysEqual(merged, previous) ? previous : merged;
    });
  }, [defaultOrderedKeys]);

  const moveCategoryInOrder = useCallback((sourceKey: string, targetKey: string) => {
    setOrderedCategoryKeys((previous) => {
      const sourceIndex = previous.indexOf(sourceKey);
      const targetIndex = previous.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      return moveListItem(previous, sourceIndex, targetIndex);
    });
  }, []);

  const resetForm = () => {
    setEditingCategoryKey(null);
    setForm(buildEmptyForm(tenantCategoryColor));
  };

  const handleEditCategory = (row: DisplayCategory) => {
    if (row.sellerType === "mini_vendor") {
      addToast("A logo e a categoria da lojinha continuam no cadastro do mini vendor.", "info");
      return;
    }

    setEditingCategoryKey(row.key);
    setForm({
      nome: row.nome,
      coverImg: row.coverImg,
      buttonColor: row.buttonColor || tenantCategoryColor,
    });
  };

  const handleUploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setUploadingCover(true);
      const tenantScope = sanitizeStoragePathSegment(activeTenantId || "global");
      const stableCategoryId =
        editingCategory?.categoryId?.trim() ||
        sanitizeStoragePathSegment(form.nome || editingCategory?.nome || "");
      const isStableTarget = stableCategoryId.length > 0;
      const objectDir = isStableTarget
        ? `store/${tenantScope}/categorias/${stableCategoryId}`
        : `store/${tenantScope}/categorias/drafts`;
      const { url, error } = await uploadImage(file, objectDir, {
        fileName: isStableTarget ? "cover" : buildDraftAssetFileName("cover"),
        upsert: isStableTarget,
        versionStrategy: isStableTarget ? "file-metadata" : "none",
        cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
        scopeKey: `store:category:${tenantScope}:${stableCategoryId || "draft"}`,
      });
      if (error || !url) {
        addToast(error || "Erro ao enviar capa da categoria.", "error");
        return;
      }

      setForm((previous) => ({
        ...previous,
        coverImg: url,
      }));
      addToast("Capa enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar capa da categoria.", "error");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSave = async () => {
    const nome = form.nome.trim();
    if (!nome) {
      addToast("Nome da categoria obrigatorio.", "error");
      return;
    }

    const tenantId = activeTenantId.trim();
    const tenantLogo = tenantLogoUrl.trim() || asString(editingCategory?.logoUrl).trim();
    const previousName = asString(editingCategory?.nome).trim();

    try {
      setSaving(true);
      await upsertStoreCategory({
        ...(editingCategory?.categoryId ? { categoryId: editingCategory.categoryId } : {}),
        data: {
          nome,
          coverImg: form.coverImg.trim(),
          logoUrl: tenantLogo,
          buttonColor: form.buttonColor.trim() || tenantCategoryColor,
          sellerType: "tenant",
          sellerId: tenantId,
          tenantId: tenantId || undefined,
        },
      });

      if (editingCategory && previousName && previousName !== nome) {
        await renameStoreProductsCategory({
          previousName,
          nextName: nome,
          sellerType: "tenant",
          sellerId: tenantId,
          tenantId: tenantId || undefined,
        });
      }

      await loadData(true);
      resetForm();
      addToast(editingCategory ? "Categoria atualizada." : "Categoria criada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(editingCategory ? "Erro ao atualizar categoria." : "Erro ao criar categoria.", "error");
    } finally {
      setSaving(false);
    }
  };

  const previewLogo = tenantLogoUrl.trim() || asString(editingCategory?.logoUrl).trim() || "/logo.png";
  const previewCover = form.coverImg.trim() || previewLogo;
  const previewColor = form.buttonColor.trim() || tenantCategoryColor;

  const handleSaveOrder = async () => {
    const tenantId = activeTenantId.trim();
    const orderedCategoryIds = orderableCategories
      .map((row) => row.categoryId)
      .filter((row): row is string => Boolean(row));

    if (!tenantId) {
      addToast("Abra um tenant valido antes de salvar a ordem.", "error");
      return;
    }
    if (orderedCategoryIds.length === 0) {
      addToast("Nenhuma categoria persistida para ordenar.", "info");
      return;
    }

    try {
      setSavingOrder(true);
      await saveStoreCategoryDisplayOrder({
        orderedCategoryIds,
        tenantId,
      });
      await loadData(true);
      addToast("Ordem das categorias salva.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar a ordem das categorias.", "error");
    } finally {
      setSavingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Categorias da Loja</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Tenant, categorias detectadas nos produtos e visao das lojinhas.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={productsHref}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-800"
            >
              <Tags size={14} />
              Produtos
            </Link>
            <Link
              href={newProductHref}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
            >
              <Pencil size={14} />
              Novo Produto
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <div className="grid gap-3 md:grid-cols-3">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Total
            </p>
            <p className="mt-2 text-2xl font-black text-white">{displayedCategories.length}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Junta categorias da tabela e categorias achadas nos produtos.
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Tenant
            </p>
            <p className="mt-2 text-2xl font-black text-emerald-300">{tenantCategories.length}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Editaveis aqui com a logo oficial do tenant.
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Mini Vendors
            </p>
            <p className="mt-2 text-2xl font-black text-blue-300">{miniVendorCategories.length}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Visiveis aqui e com logo editada no cadastro da lojinha.
            </p>
          </article>
        </div>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase text-white">
                  {editingCategory ? "Editar Categoria do Tenant" : "Nova Categoria do Tenant"}
                </h2>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Nome com ate 80 caracteres. A logo e herdada automaticamente da atletica.
                </p>
              </div>

              {editingCategory ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-800"
                >
                  <RotateCcw size={14} />
                  Nova
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 md:col-span-2">
                <button
                  type="button"
                  onClick={() => setIsOrderPanelOpen((previous) => !previous)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Ordem publica das categorias
                    </p>
                    <p className="mt-2 text-sm text-zinc-300">
                      Arraste para definir a ordem em que as categorias aparecem na loja.
                    </p>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`text-zinc-400 transition ${isOrderPanelOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOrderPanelOpen ? (
                  <div className="mt-4 space-y-3">
                    {orderableCategories.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-500">
                        Salve pelo menos uma categoria para poder ordenar aqui.
                      </div>
                    ) : (
                      orderableCategories.map((row, index) => (
                        <div
                          key={row.key}
                          draggable
                          onDragStart={() => setDraggingCategoryKey(row.key)}
                          onDragEnd={() => setDraggingCategoryKey(null)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (!draggingCategoryKey || draggingCategoryKey === row.key) return;
                            moveCategoryInOrder(draggingCategoryKey, row.key);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (!draggingCategoryKey || draggingCategoryKey === row.key) return;
                            moveCategoryInOrder(draggingCategoryKey, row.key);
                            setDraggingCategoryKey(null);
                          }}
                          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                            draggingCategoryKey === row.key
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : "border-zinc-800 bg-zinc-950/80"
                          }`}
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-black text-[11px] font-black text-zinc-300">
                            {index + 1}
                          </span>
                          <div className="inline-flex cursor-grab items-center justify-center rounded-xl border border-zinc-700 bg-black/40 p-2 text-zinc-400 active:cursor-grabbing">
                            <GripVertical size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold text-white">{row.nome}</p>
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                                  row.sellerType === "mini_vendor"
                                    ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                }`}
                              >
                                {row.sellerType === "mini_vendor" ? "Mini Vendor" : "Tenant"}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-zinc-500">
                              {row.sellerType === "mini_vendor"
                                ? "Categoria publica da lojinha aprovada."
                                : "Categoria publica do tenant."}
                            </p>
                          </div>
                        </div>
                      ))
                    )}

                    {nonOrderableCategoriesCount > 0 ? (
                      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-[11px] text-yellow-100">
                        {nonOrderableCategoriesCount} categoria
                        {nonOrderableCategoriesCount === 1 ? "" : "s"} ainda aparece
                        apenas nos produtos. Complete o cadastro dela antes de arrastar.
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setOrderedCategoryKeys(defaultOrderedKeys)}
                        disabled={!isOrderDirty || savingOrder}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        Restaurar ordem
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveOrder()}
                        disabled={!isOrderDirty || savingOrder}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {savingOrder ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {savingOrder ? "Salvando ordem..." : "Salvar ordem"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Nome da categoria
                </span>
                <input
                  value={form.nome}
                  maxLength={CATEGORY_NAME_MAX_LENGTH}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      nome: event.target.value.slice(0, CATEGORY_NAME_MAX_LENGTH),
                    }))
                  }
                  placeholder="Ex.: Geral, Camisas, Acessorios"
                  className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                />
              </label>

              <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 md:col-span-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Logo da categoria
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  As categorias do tenant usam a mesma logo do tenant. Por isso o campo de logo
                  nao aparece mais aqui.
                </p>
              </div>

              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  URL da capa
                </span>
                <input
                  value={form.coverImg}
                  maxLength={URL_MAX_LENGTH}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      coverImg: event.target.value.slice(0, URL_MAX_LENGTH),
                    }))
                  }
                  placeholder="Capa do card publico"
                  className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                />
              </label>

              <div className="space-y-2 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Upload da capa
                </span>
                <label
                  className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase transition ${
                    uploadingCover
                      ? "border-zinc-700 bg-zinc-800 text-zinc-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  }`}
                >
                  {uploadingCover ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ImagePlus size={14} />
                  )}
                  {uploadingCover ? "Enviando..." : "Adicionar capa"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => void handleUploadCover(event)}
                    disabled={uploadingCover}
                  />
                </label>
                <ImageResizeHelpLink label="Diminuir a capa no favicon.io/favicon-converter" />
              </div>

              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Cor do botao
                </span>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5">
                  <input
                    type="color"
                    value={form.buttonColor}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        buttonColor: event.target.value,
                      }))
                    }
                    className="h-10 w-12 rounded border border-zinc-700 bg-transparent"
                  />
                  <span className="text-sm text-zinc-300">{previewColor}</span>
                </div>
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/20 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Preview da categoria
              </p>
              <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                <div className="relative h-40">
                  <Image
                    src={previewCover}
                    alt="Preview da capa"
                    fill
                    unoptimized
                    sizes="640px"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                  <div className="absolute left-4 top-4 h-16 w-16 overflow-hidden rounded-2xl border border-white/20 bg-black/40">
                    <Image
                      src={previewLogo}
                      alt="Preview da logo"
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                  </div>
                  <span
                    className="absolute bottom-4 left-4 rounded-full border px-3 py-1 text-[10px] font-black uppercase text-white"
                    style={{
                      borderColor: previewColor,
                      backgroundColor: `${previewColor}26`,
                      color: "#ffffff",
                    }}
                  >
                    {form.nome.trim() || "Categoria"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || uploadingCover}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Salvando..." : editingCategory ? "Salvar Categoria" : "Criar Categoria"}
              </button>
            </div>
          </div>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div>
              <h2 className="text-sm font-black uppercase text-white">Categorias Cadastradas</h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                Itens do tenant podem ser completados aqui. Categorias de mini vendor continuam no
                cadastro da lojinha.
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                  Carregando categorias...
                </div>
              ) : displayedCategories.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                  Nenhuma categoria encontrada.
                </div>
              ) : (
                displayedCategories.map((row) => {
                  const rowColor = row.buttonColor || tenantCategoryColor;
                  const productCount = productCounts.get(row.key) ?? 0;
                  const previewImage = row.coverImg || row.logoUrl || tenantLogoUrl || "/logo.png";
                  const logoImage = row.logoUrl || tenantLogoUrl || "/logo.png";

                  return (
                    <article
                      key={row.key}
                      className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/20"
                    >
                      <div className="relative h-28">
                        <Image
                          src={previewImage}
                          alt={row.nome}
                          fill
                          unoptimized
                          sizes="480px"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                        <div className="absolute left-3 top-3 h-12 w-12 overflow-hidden rounded-xl border border-white/20 bg-black/40">
                          <Image
                            src={logoImage}
                            alt={`Logo ${row.nome}`}
                            fill
                            unoptimized
                            sizes="48px"
                            className="object-cover"
                          />
                        </div>
                        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
                          <span
                            className="rounded-full border px-3 py-1 text-[10px] font-black uppercase text-white"
                            style={{
                              borderColor: rowColor,
                              backgroundColor: `${rowColor}26`,
                            }}
                          >
                            {row.nome}
                          </span>
                          <span className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-200">
                            {productCount} produto{productCount === 1 ? "" : "s"}
                          </span>
                          {row.derivedOnly ? (
                            <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-300">
                              So nos produtos
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 p-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-white">{row.nome}</p>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                                row.sellerType === "mini_vendor"
                                  ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              }`}
                            >
                              {row.sellerType === "mini_vendor" ? "Mini Vendor" : "Tenant"}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {row.sellerType === "mini_vendor"
                              ? "A logo continua sendo editada dentro do cadastro da lojinha."
                              : row.derivedOnly
                              ? "Categoria detectada nos produtos do tenant e pronta para ser completada."
                              : "Categoria persistida e editavel no admin da loja."}
                          </p>
                        </div>

                        {row.sellerType === "mini_vendor" ? (
                          <Link
                            href={miniVendorAdminHref}
                            className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-black uppercase text-blue-300 hover:bg-blue-500/20"
                          >
                            <ExternalLink size={14} />
                            Editar logo
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEditCategory(row)}
                            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-800"
                          >
                            <Pencil size={14} />
                            {row.derivedOnly ? "Completar" : "Editar"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
