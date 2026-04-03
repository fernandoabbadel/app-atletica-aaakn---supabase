"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { fetchPlanCatalog, type PlanRecord } from "@/lib/plansPublicService";
import { logActivity } from "@/lib/logger";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "@/lib/upload";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  hasValidPhoneLength,
  PHONE_MAX_LENGTH,
  PIX_BANK_MAX_LENGTH,
  PIX_HOLDER_MAX_LENGTH,
  PIX_KEY_MAX_LENGTH,
  URL_MAX_LENGTH,
  normalizePhoneInput,
} from "@/utils/contactFields";
import {
  createStoreCategory,
  fetchAdminStoreBundle,
  fetchStoreProducts,
  upsertStoreProduct,
} from "../../../../lib/storeService";

type ProductStatus = "ativo" | "em_breve" | "esgotado";
type PlanScopeFormRow = {
  planId: string;
  planName: string;
  price: string;
  visible: boolean;
};

type PaymentFormState = {
  enabled: boolean;
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
};

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
  status?: ProductStatus;
  vendidos?: number;
  cliques?: number;
  cores?: string | string[];
  caracteristicas?: string[];
  variantes?: Array<{ id?: string; cor?: string; tamanho?: string; estoque?: number; vendidos?: number }>;
  plan_prices?: Array<{ planId?: string; planName?: string; price?: number }>;
  plan_visibility?: Array<{ planId?: string; planName?: string; visible?: boolean }>;
  payment_config?: { chave?: string; banco?: string; titular?: string; whatsapp?: string } | null;
};

type CategoryRow = {
  id: string;
  nome?: string;
  cover_img?: string;
  button_color?: string;
  logo_url?: string;
};

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
  status: ProductStatus;
  estoque: string;
  lote: string;
  tagLabel: string;
  tagColor: "zinc" | "emerald" | "orange" | "purple" | "blue" | "red";
  tagEffect: "none" | "pulse" | "shine";
  coresText: string;
  caracteristicasText: string;
  usarVariantes: boolean;
  variantes: VariantForm[];
  planScopeRows: PlanScopeFormRow[];
  payment: PaymentFormState;
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
  status: "ativo",
  estoque: "",
  lote: "",
  tagLabel: "",
  tagColor: "zinc",
  tagEffect: "none",
  coresText: "",
  caracteristicasText: "",
  usarVariantes: false,
  variantes: [newVariant()],
  planScopeRows: [],
  payment: {
    enabled: false,
    chave: "",
    banco: "",
    titular: "",
    whatsapp: "",
  },
};

const PRODUCT_NAME_MAX_LENGTH = 120;
const PRODUCT_CATEGORY_MAX_LENGTH = 80;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 1200;
const PRODUCT_LOTE_MAX_LENGTH = 80;
const PRODUCT_BADGE_MAX_LENGTH = 30;
const PRODUCT_COLORS_TEXT_MAX_LENGTH = 600;
const PRODUCT_FEATURES_TEXT_MAX_LENGTH = 1200;
const PRODUCT_VARIANT_FIELD_MAX_LENGTH = 40;

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

const buildPlanScopeRows = (
  plans: PlanRecord[],
  planPrices?: ProductRow["plan_prices"],
  planVisibility?: ProductRow["plan_visibility"]
): PlanScopeFormRow[] => {
  const priceMap = new Map(
    (planPrices ?? []).map((entry) => [
      String(entry.planId || entry.planName || "").trim().toLowerCase(),
      typeof entry.price === "number" && Number.isFinite(entry.price)
        ? String(entry.price)
        : "",
    ])
  );
  const visibilityMap = new Map(
    (planVisibility ?? []).map((entry) => [
      String(entry.planId || entry.planName || "").trim().toLowerCase(),
      entry.visible !== false,
    ])
  );

  return plans.map((plan) => {
    const planKey = (plan.id || plan.nome).trim().toLowerCase();
    return {
      planId: plan.id,
      planName: plan.nome,
      price: priceMap.get(planKey) || "",
      visible: visibilityMap.get(planKey) ?? true,
    };
  });
};

const getStatusClasses = (status: ProductStatus): string => {
  if (status === "em_breve") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  }
  if (status === "esgotado") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

export default function AdminLojaProdutosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { tenantId: activeTenantId, tenantLogoUrl, tenantName, tenantSigla, tenantSlug, palette } = useTenantTheme();
  const { addToast } = useToast();
  const tenantCategoryColor = palette.primary || "#10b981";

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [planCatalog, setPlanCatalog] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProductOpen, setIsProductOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [uploadingCategoryCover, setUploadingCategoryCover] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryCoverImg, setCategoryCoverImg] = useState("");
  const [categoryButtonColor, setCategoryButtonColor] = useState(tenantCategoryColor);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);

  useEffect(() => {
    if (categoryName.trim() || categoryCoverImg.trim()) return;
    setCategoryButtonColor(tenantCategoryColor);
  }, [categoryCoverImg, categoryName, tenantCategoryColor]);

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
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/loja") : "/admin/loja";
  const categoryManagerHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/categorias")
    : "/admin/loja/categorias";
  const pendingOrdersHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/pedidos-pendentes")
    : "/admin/loja/pedidos-pendentes";
  const reviewHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/loja/review")
    : "/admin/loja/review";

  const variantsEnabled = form.usarVariantes || isWearCategory(form.categoria);

  const loadProducts = useCallback(async (forceRefresh = true) => {
    const products = await fetchStoreProducts({
      maxResults: 120,
      forceRefresh,
      tenantId: activeTenantId || undefined,
    });
    setRows(products as ProductRow[]);
  }, [activeTenantId]);

  const loadCategories = useCallback(async (forceRefresh = true) => {
    const bundle = await fetchAdminStoreBundle({
      productsLimit: 1,
      categoriesLimit: 200,
      ordersLimit: 1,
      reviewsLimit: 1,
      forceRefresh,
    });
    setCategories(bundle.categorias as CategoryRow[]);
  }, []);

  const loadPlans = useCallback(async (forceRefresh = true) => {
    const plans = await fetchPlanCatalog({
      forceRefresh,
      tenantId: activeTenantId || undefined,
      maxResults: 40,
    });
    setPlanCatalog(plans);
  }, [activeTenantId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await Promise.all([loadProducts(true), loadCategories(true), loadPlans(true)]);
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
  }, [addToast, loadCategories, loadPlans, loadProducts]);

  useEffect(() => {
    if (planCatalog.length === 0) return;
    setForm((prev) => ({
      ...prev,
      planScopeRows: buildPlanScopeRows(
        planCatalog,
        prev.planScopeRows.map((entry) => ({
          planId: entry.planId,
          planName: entry.planName,
          price: entry.price ? Number(entry.price.replace(",", ".")) : undefined,
        })),
        prev.planScopeRows.map((entry) => ({
          planId: entry.planId,
          planName: entry.planName,
          visible: entry.visible,
        }))
      ),
    }));
  }, [planCatalog]);

  const resetForm = () =>
    setForm({
      ...EMPTY_FORM,
      variantes: [newVariant()],
      planScopeRows: buildPlanScopeRows(planCatalog),
    });

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
      status: row.status || "ativo",
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
      planScopeRows: buildPlanScopeRows(planCatalog, row.plan_prices, row.plan_visibility),
      payment: {
        enabled: Boolean(row.payment_config),
        chave: row.payment_config?.chave || "",
        banco: row.payment_config?.banco || "",
        titular: row.payment_config?.titular || "",
        whatsapp: row.payment_config?.whatsapp || "",
      },
    });
    setIsProductOpen(true);
  };

  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "category") {
      router.replace(categoryManagerHref);
      return;
    }
    if (action === "new") {
      setEditingProductId(null);
      setForm({
        ...EMPTY_FORM,
        variantes: [newVariant()],
        planScopeRows: buildPlanScopeRows(planCatalog),
      });
      setIsProductOpen(true);
    }
  }, [categoryManagerHref, planCatalog, router, searchParams]);

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
      await createStoreCategory({
        nome,
        coverImg: categoryCoverImg.trim() || tenantLogoUrl || "/logo.png",
        buttonColor: categoryButtonColor.trim(),
        logoUrl: tenantLogoUrl || "/logo.png",
        sellerType: "tenant",
        sellerId: activeTenantId || "",
        tenantId: activeTenantId || undefined,
      });
      await loadCategories(true);
      setCategoryName("");
      setCategoryCoverImg("");
      setCategoryButtonColor(tenantCategoryColor);
      setIsCategoryOpen(false);
      addToast("Categoria criada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao criar categoria.", "error");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleUploadCategoryCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setUploadingCategoryCover(true);
      const tenantScope = sanitizeStoragePathSegment(activeTenantId || "global");
      const stableCategoryId = sanitizeStoragePathSegment(categoryName || "");
      const isStableTarget = stableCategoryId.length > 0;
      const { url, error } = await uploadImage(
        file,
        isStableTarget
          ? `store/${tenantScope}/categorias/${stableCategoryId}`
          : `store/${tenantScope}/categorias/drafts`,
        {
          fileName: isStableTarget ? "cover" : buildDraftAssetFileName("cover"),
          upsert: isStableTarget,
          versionStrategy: isStableTarget ? "file-metadata" : "none",
          cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
          scopeKey: `store:category:${tenantScope}:${stableCategoryId || "draft"}`,
        }
      );
      if (error || !url) {
        addToast(error || "Erro ao subir capa da categoria.", "error");
        return;
      }
      setCategoryCoverImg(url);
      addToast("Capa da categoria enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao subir capa da categoria.", "error");
    } finally {
      setUploadingCategoryCover(false);
    }
  };

  const handleUploadProductImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setUploadingProductImage(true);
      const tenantScope = sanitizeStoragePathSegment(activeTenantId || "global");
      const stableProductId = editingProductId?.trim() || "";
      const isStableTarget = stableProductId.length > 0;
      const { url, error } = await uploadImage(
        file,
        isStableTarget
          ? `store/${tenantScope}/produtos/${sanitizeStoragePathSegment(stableProductId)}`
          : `store/${tenantScope}/produtos/drafts`,
        {
          fileName: isStableTarget ? "produto" : buildDraftAssetFileName("produto"),
          upsert: isStableTarget,
          versionStrategy: isStableTarget ? "file-metadata" : "none",
          cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
          scopeKey: `store:product:${tenantScope}:${stableProductId || "draft"}`,
        }
      );
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
    if (
      form.payment.enabled &&
      (!form.payment.chave.trim() || !form.payment.banco.trim() || !form.payment.titular.trim())
    ) {
      return void addToast("Preencha chave, banco e titular para usar pagamento proprio.", "error");
    }
    if (
      form.payment.enabled &&
      form.payment.whatsapp.trim() &&
      !hasValidPhoneLength(form.payment.whatsapp)
    ) {
      return void addToast("Informe um WhatsApp valido para o pagamento proprio.", "error");
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
      status: form.status,
      estoque: estoqueTotal,
      lote: form.lote.trim() || "geral",
      variantes: variants,
      cores: coresText,
      caracteristicas,
      plan_prices: form.planScopeRows
        .filter((entry) => entry.price.trim().length > 0)
        .map((entry) => ({
          planId: entry.planId,
          planName: entry.planName,
          price: Number(entry.price.replace(",", ".")),
        }))
        .filter((entry) => Number.isFinite(entry.price) && entry.price >= 0),
      plan_visibility: form.planScopeRows.map((entry) => ({
        planId: entry.planId,
        planName: entry.planName,
        visible: entry.visible,
      })),
      payment_config: form.payment.enabled
        ? {
            chave: form.payment.chave.trim(),
            banco: form.payment.banco.trim(),
            titular: form.payment.titular.trim(),
            whatsapp: form.payment.whatsapp.trim(),
          }
        : null,
      seller_type: "tenant",
      seller_id: activeTenantId || "",
      seller_name: tenantName || tenantSigla || "Atletica",
      seller_logo_url: tenantLogoUrl || "/logo.png",
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
        tenantId: activeTenantId || undefined,
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
        tenantId: activeTenantId || undefined,
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
            <Link href={backHref} className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800">
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Produtos</h1>
              <p className="text-[11px] text-zinc-500 font-bold">Criacao completa + categorias + variacoes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={categoryManagerHref} className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-black uppercase text-blue-300 hover:bg-blue-500/20"><Tags size={14} /> Categorias</Link>
            <button onClick={openCreateProduct} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"><Plus size={14} /> Novo Produto</button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Link href={pendingOrdersHref} className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 hover:bg-yellow-500/10 transition">
            <div className="inline-flex items-center gap-2 text-xs font-black uppercase text-yellow-300"><ShoppingBag size={14} /> Pedidos Pendentes</div>
            <p className="mt-1 text-[11px] text-zinc-400">Aprovacao manual continua ativa.</p>
          </Link>
          <Link href={reviewHref} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 hover:bg-emerald-500/10 transition">
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
              <input value={categoryName} maxLength={PRODUCT_CATEGORY_MAX_LENGTH} onChange={(e) => setCategoryName(e.target.value.slice(0, PRODUCT_CATEGORY_MAX_LENGTH))} placeholder="Nome da categoria" className="flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <button onClick={() => void handleCreateCategory()} disabled={savingCategory} className="px-4 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60 inline-flex items-center gap-2 justify-center">
                {savingCategory ? <Loader2 size={14} className="animate-spin" /> : <Tags size={14} />} {savingCategory ? "Salvando..." : "Criar Categoria"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
              <input
                value={categoryCoverImg}
                maxLength={URL_MAX_LENGTH}
                onChange={(e) => setCategoryCoverImg(e.target.value.slice(0, URL_MAX_LENGTH))}
                placeholder="URL da capa da categoria"
                className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <label className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase cursor-pointer transition ${uploadingCategoryCover ? "border-zinc-700 bg-zinc-800 text-zinc-400 cursor-wait" : "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"}`}>
                {uploadingCategoryCover ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {uploadingCategoryCover ? "Enviando..." : "Upload capa"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleUploadCategoryCover(e)} disabled={uploadingCategoryCover} />
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5">
                <span className="text-[10px] font-black uppercase text-zinc-400">Cor</span>
                <input
                  type="color"
                  value={categoryButtonColor}
                  onChange={(e) => setCategoryButtonColor(e.target.value)}
                  className="h-8 w-10 rounded border border-zinc-700 bg-transparent"
                />
              </div>
            </div>
            <ImageResizeHelpLink label="Diminuir a imagem da categoria: favicon.io/favicon-converter" />
            <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/20 p-3">
              <div className="relative h-14 w-20 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                <Image
                  src={categoryCoverImg || tenantLogoUrl || "/logo.png"}
                  alt="Preview da categoria"
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-black uppercase text-white">Preview do card da categoria</p>
                <button
                  type="button"
                  className="mt-2 rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase"
                  style={{
                    borderColor: categoryButtonColor,
                    color: categoryButtonColor,
                    backgroundColor: `${categoryButtonColor}1A`,
                  }}
                >
                  {categoryName.trim() || "Categoria"}
                </button>
              </div>
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
              <input value={form.nome} maxLength={PRODUCT_NAME_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value.slice(0, PRODUCT_NAME_MAX_LENGTH) }))} placeholder="Nome do produto" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
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
              <input value={form.lote} maxLength={PRODUCT_LOTE_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, lote: e.target.value.slice(0, PRODUCT_LOTE_MAX_LENGTH) }))} placeholder="Lote / promocao" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <input value={form.img} maxLength={URL_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, img: e.target.value.slice(0, URL_MAX_LENGTH) }))} placeholder="URL da imagem (opcional)" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
                <label className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase cursor-pointer transition ${uploadingProductImage ? "border-zinc-700 bg-zinc-800 text-zinc-400 cursor-wait" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
                  {uploadingProductImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  {uploadingProductImage ? "Enviando..." : "Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleUploadProductImage(e)} disabled={uploadingProductImage} />
                </label>
              </div>
              <ImageResizeHelpLink label="Diminuir a imagem do produto: favicon.io/favicon-converter" />
              {form.img.trim() && (
                <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-black/20 p-3 flex items-center gap-3">
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-700 shrink-0">
                    <Image src={form.img} alt="Preview do produto" fill sizes="56px" className="object-cover"  />
                  </div>
                  <p className="text-[11px] text-zinc-400 break-all">{form.img}</p>
                </div>
              )}
              <textarea value={form.descricao} maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH) }))} rows={3} placeholder="Descricao" className="md:col-span-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-y" />
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-white">Venda por Status</p>
                  <p className="text-[11px] text-zinc-500">Controla se o produto aparece ativo, em breve ou esgotado.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Tags size={14} />
                  Planos
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["ativo", "em_breve", "esgotado"] as ProductStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, status }))}
                    className={`rounded-xl border px-3 py-3 text-[11px] font-black uppercase transition ${
                      form.status === status
                        ? getStatusClasses(status)
                        : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em-breve" : "Esgotado"}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-white">Pagamento do Produto</p>
                  <p className="text-[11px] text-zinc-500">Se desligado, usa automaticamente os dados da atletica.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] font-bold text-zinc-400">
                  <input
                    type="checkbox"
                    checked={form.payment.enabled}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        payment: { ...prev.payment, enabled: e.target.checked },
                      }))
                    }
                    className="accent-emerald-500"
                  />
                  Usar dados proprios
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={form.payment.chave}
                  maxLength={PIX_KEY_MAX_LENGTH}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      payment: {
                        ...prev.payment,
                        chave: e.target.value.slice(0, PIX_KEY_MAX_LENGTH),
                      },
                    }))
                  }
                  placeholder="Chave PIX"
                  disabled={!form.payment.enabled}
                  className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <input
                  value={form.payment.banco}
                  maxLength={PIX_BANK_MAX_LENGTH}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      payment: {
                        ...prev.payment,
                        banco: e.target.value.slice(0, PIX_BANK_MAX_LENGTH),
                      },
                    }))
                  }
                  placeholder="Banco"
                  disabled={!form.payment.enabled}
                  className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <input
                  value={form.payment.titular}
                  maxLength={PIX_HOLDER_MAX_LENGTH}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      payment: {
                        ...prev.payment,
                        titular: e.target.value.slice(0, PIX_HOLDER_MAX_LENGTH),
                      },
                    }))
                  }
                  placeholder="Titular"
                  disabled={!form.payment.enabled}
                  className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <input
                  value={form.payment.whatsapp}
                  maxLength={PHONE_MAX_LENGTH}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      payment: {
                        ...prev.payment,
                        whatsapp: normalizePhoneInput(e.target.value),
                      },
                    }))
                  }
                  placeholder="WhatsApp para comprovante"
                  inputMode="numeric"
                  disabled={!form.payment.enabled}
                  className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                />
              </div>
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
                <input value={form.tagLabel} maxLength={PRODUCT_BADGE_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, tagLabel: e.target.value.slice(0, PRODUCT_BADGE_MAX_LENGTH) }))} placeholder="Texto da badge" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
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
                      <input value={v.tamanho} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(e) => setVariantField(v.id, "tamanho", e.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Tamanho" className="col-span-4 md:col-span-3 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                      <input value={v.cor} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(e) => setVariantField(v.id, "cor", e.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Cor" className="col-span-4 md:col-span-3 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
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
                maxLength={PRODUCT_COLORS_TEXT_MAX_LENGTH}
                onChange={(e) => setForm((prev) => ({ ...prev, coresText: e.target.value.slice(0, PRODUCT_COLORS_TEXT_MAX_LENGTH) }))}
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
              <textarea value={form.caracteristicasText} maxLength={PRODUCT_FEATURES_TEXT_MAX_LENGTH} onChange={(e) => setForm((prev) => ({ ...prev, caracteristicasText: e.target.value.slice(0, PRODUCT_FEATURES_TEXT_MAX_LENGTH) }))} rows={4} className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-y" placeholder={"100% algodao\nEdicao limitada\nFrete local"} />
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

        {isPlanModalOpen && isProductOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase text-white">Preco e Visibilidade por Plano</h3>
                  <p className="text-[11px] text-zinc-500">
                    So preencha quem tiver preco especial. Em branco, o plano usa o preco geral do produto.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(false)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 hover:bg-zinc-800"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {form.planScopeRows.map((entry) => (
                  <div key={entry.planId} className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_auto] gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                    <div>
                      <p className="text-sm font-bold text-white">{entry.planName}</p>
                      <p className="text-[10px] text-zinc-500">
                        Em branco: usa o preco geral
                        {form.preco.trim() ? ` (R$ ${form.preco.trim()})` : "."}
                      </p>
                    </div>
                    <input
                      value={entry.price}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          planScopeRows: prev.planScopeRows.map((row) =>
                            row.planId === entry.planId ? { ...row, price: e.target.value } : row
                          ),
                        }))
                      }
                      placeholder={`Preco especial para ${entry.planName}`}
                      inputMode="decimal"
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                    />
                    <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-[11px] font-black uppercase text-zinc-300">
                      <input
                        type="checkbox"
                        checked={entry.visible}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            planScopeRows: prev.planScopeRows.map((row) =>
                              row.planId === entry.planId ? { ...row, visible: e.target.checked } : row
                            ),
                          }))
                        }
                        className="accent-emerald-500"
                      />
                      Visivel
                    </label>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(false)}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
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
                    <span className={`px-2 py-0.5 rounded border text-[9px] font-black uppercase ${getStatusClasses(row.status || "ativo")}`}>
                      {row.status === "em_breve" ? "Em-breve" : row.status === "esgotado" ? "Esgotado" : "Ativo"}
                    </span>
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
