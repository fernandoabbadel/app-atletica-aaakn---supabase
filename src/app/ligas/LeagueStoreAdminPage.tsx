"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  ImageIcon,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Tags,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { LotNameSelector } from "@/components/LotNameSelector";
import { LeagueAdminQuickNav } from "./_components/LeagueAdminQuickNav";
import { fetchLeagueById, uploadLeagueImageToStorage, type LeagueRecord } from "@/lib/leaguesService";
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
import {
  hasValidPhoneLength,
  normalizePhoneToBrE164,
  PHONE_MAX_LENGTH,
  PIX_BANK_MAX_LENGTH,
  PIX_HOLDER_MAX_LENGTH,
  PIX_KEY_MAX_LENGTH,
  URL_MAX_LENGTH,
} from "@/utils/contactFields";

type LeagueStoreMode = "overview" | "products" | "pending" | "approved";
type Row = Record<string, unknown>;
type ProductStatus = "ativo" | "em_breve" | "esgotado";
type ProductTagColor = "zinc" | "emerald" | "orange" | "purple" | "blue" | "red";
type ProductTagEffect = "none" | "pulse" | "shine";

type VariantForm = {
  id: string;
  tamanho: string;
  cor: string;
  estoque: string;
  vendidos: string;
};

type ProductForm = {
  nome: string;
  preco: string;
  precoAntigo: string;
  status: ProductStatus;
  estoque: string;
  lote: string;
  img: string;
  descricao: string;
  contato: string;
  paymentEnabled: boolean;
  pixChave: string;
  pixBanco: string;
  pixTitular: string;
  tagLabel: string;
  tagColor: ProductTagColor;
  tagEffect: ProductTagEffect;
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

const createEmptyProductForm = (): ProductForm => ({
  nome: "",
  preco: "",
  precoAntigo: "",
  status: "ativo",
  estoque: "",
  lote: "geral",
  img: "",
  descricao: "",
  contato: "",
  paymentEnabled: false,
  pixChave: "",
  pixBanco: "",
  pixTitular: "",
  tagLabel: "",
  tagColor: "zinc",
  tagEffect: "none",
  coresText: "",
  caracteristicasText: "",
  usarVariantes: false,
  variantes: [newVariant()],
});

const LEAGUE_STORE_IMAGE_MAX_BYTES = 200 * 1024;
const PRODUCT_NAME_MAX_LENGTH = 120;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 1200;
const PRODUCT_LOTE_MAX_LENGTH = 80;
const PRODUCT_BADGE_MAX_LENGTH = 30;
const PRODUCT_COLORS_TEXT_MAX_LENGTH = 600;
const PRODUCT_FEATURES_TEXT_MAX_LENGTH = 1200;
const PRODUCT_VARIANT_FIELD_MAX_LENGTH = 40;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value || 0) || 0;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const isLeagueSellerRow = (row: Row, leagueId: string): boolean =>
  asString(row.seller_id) === leagueId &&
  ["league", "tenant", ""].includes(asString(row.seller_type).toLowerCase());

const isLeagueCategoryRow = (row: Row, leagueId: string): boolean => {
  const sellerId = asString(row.seller_id);
  const sellerType = asString(row.seller_type).toLowerCase();
  return sellerId === leagueId && (sellerType === "league" || sellerType === "tenant" || !sellerType);
};

const formatCurrency = (value: unknown): string => `R$ ${asNumber(value).toFixed(2)}`;

const parseMoney = (value: string): number =>
  Number(String(value).replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;

const parseIntSafe = (value: string): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

type StorePaymentConfig = {
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
};

const EMPTY_PAYMENT_CONFIG: StorePaymentConfig = {
  chave: "",
  banco: "",
  titular: "",
  whatsapp: "",
};

const normalizePaymentConfigFields = (value: unknown): StorePaymentConfig => {
  const row = value && typeof value === "object" ? (value as Row) : {};
  return {
    chave: asString(row.chave).slice(0, PIX_KEY_MAX_LENGTH),
    banco: asString(row.banco).slice(0, PIX_BANK_MAX_LENGTH),
    titular: asString(row.titular).slice(0, PIX_HOLDER_MAX_LENGTH),
    whatsapp: normalizePhoneToBrE164(asString(row.whatsapp)).slice(0, PHONE_MAX_LENGTH),
  };
};

const hasAnyPaymentConfig = (config: StorePaymentConfig): boolean =>
  Boolean(config.chave || config.banco || config.titular || config.whatsapp);

const hasCompletePaymentConfig = (config: StorePaymentConfig): boolean =>
  Boolean(
    config.chave &&
      config.banco &&
      config.titular &&
      config.whatsapp &&
      hasValidPhoneLength(config.whatsapp)
  );

const paymentConfigMatches = (
  source: { chave?: unknown; banco?: unknown; titular?: unknown; whatsapp?: unknown } | null | undefined,
  target: StorePaymentConfig
): boolean => {
  const normalized = normalizePaymentConfigFields(source);
  return (
    normalized.chave === target.chave &&
    normalized.banco === target.banco &&
    normalized.titular === target.titular &&
    normalized.whatsapp === target.whatsapp
  );
};

const resolveLeaguePaymentConfig = (league: LeagueRecord | null): StorePaymentConfig => {
  const candidates = (league?.eventos || []).map((event) =>
    normalizePaymentConfigFields({
      chave: event.paymentConfig?.chave || event.pixChave,
      banco: event.paymentConfig?.banco || event.pixBanco,
      titular: event.paymentConfig?.titular || event.pixTitular,
      whatsapp: event.paymentConfig?.whatsapp || event.contatoComprovante,
    })
  );
  return (
    candidates.find((config) => hasCompletePaymentConfig(config)) ||
    candidates.find((config) => hasAnyPaymentConfig(config)) ||
    EMPTY_PAYMENT_CONFIG
  );
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Erro inesperado.";
};

const joinTextLines = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join("\n");
  }
  return asString(value);
};

const validateLeagueStoreImage = (file: File): string | null => {
  if (!file.type.startsWith("image/")) {
    return "Envie uma imagem em JPG, PNG ou WEBP.";
  }
  if (file.size > LEAGUE_STORE_IMAGE_MAX_BYTES) {
    return "A imagem precisa ter até 200 KB. Reduza o arquivo no Squoosh antes de enviar.";
  }
  return null;
};

const formatDateTime = (value: unknown): string => {
  const raw = asString(value);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
};

export function LeagueStoreAdminPage({ mode = "overview" }: { mode?: LeagueStoreMode }) {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSlug, palette } = useTenantTheme();
  const leagueId = typeof params?.leagueId === "string" ? params.leagueId : "";
  const storeCoverInputRef = useRef<HTMLInputElement | null>(null);
  const productImageInputRef = useRef<HTMLInputElement | null>(null);

  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [category, setCategory] = useState<Row | null>(null);
  const [products, setProducts] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [uploadingStoreCover, setUploadingStoreCover] = useState(false);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [lotManagerOpen, setLotManagerOpen] = useState(false);
  const [storeColor, setStoreColor] = useState(palette.primary || "#10b981");
  const [storeCover, setStoreCover] = useState("");
  const [formOpen, setFormOpen] = useState(mode === "products");
  const [editingProductId, setEditingProductId] = useState("");
  const [form, setForm] = useState<ProductForm>(() => createEmptyProductForm());

  const leagueName = league?.sigla?.trim() || league?.nome?.trim() || "Liga";
  const leagueLogo = (league ? resolveLeagueLogoSrc(league) : "") || "/logo.png";
  const leaguePaymentConfig = useMemo(() => resolveLeaguePaymentConfig(league), [league]);
  const categoryVisible = category ? category.visible !== false : false;
  const visibleProducts = products.filter((row) => row.active !== false);
  const productIds = useMemo(() => products.map((row) => asString(row.id)).filter(Boolean), [products]);
  const lotOptions = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((row) => asString(row.lote))
            .filter((entry) => entry.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products]
  );
  const leagueBaseHref = tenantSlug
    ? withTenantSlug(tenantSlug, `/ligas/${encodeURIComponent(leagueId)}`)
    : `/ligas/${encodeURIComponent(leagueId)}`;
  const storeHref = `${leagueBaseHref}/loja`;
  const leagueHomeHref = leagueBaseHref;
  const leagueInformationHref = `${leagueBaseHref}/informacoes`;
  const leagueMembersHref = `${leagueBaseHref}/membros`;
  const leagueEventsHref = `${leagueBaseHref}/eventos`;
  const leagueBoardHref = `${leagueBaseHref}/board-round`;
  const leagueFinanceHref = `${leagueBaseHref}/gestao`;
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
          (categoryRows as Row[]).find((row) => isLeagueCategoryRow(row, leagueId)) || null;
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
          sellerType: "tenant",
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
      addToast(`Erro ao salvar loja: ${extractErrorMessage(error)}`, "error");
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
    setLotManagerOpen(false);
    const rawProductVariants = Array.isArray(product?.variantes) ? product.variantes : [];
    const productVariants = rawProductVariants
          .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
          .map((variant) => ({
            id: asString(variant.id) || newVariant().id,
            tamanho: asString(variant.tamanho),
            cor: asString(variant.cor),
            estoque: String(variant.estoque ?? ""),
            vendidos: String(variant.vendidos ?? "0"),
          }));
    const productStatus = asString(product?.status);
    const productTagColor = asString(product?.tagColor);
    const productTagEffect = asString(product?.tagEffect);
    const productPaymentConfig = product?.payment_config as
      | { whatsapp?: unknown; chave?: unknown; banco?: unknown; titular?: unknown }
      | null
      | undefined;
    const productHasPaymentData = Boolean(
      asString(productPaymentConfig?.chave) ||
        asString(productPaymentConfig?.banco) ||
        asString(productPaymentConfig?.titular)
    );
    const productPaymentEnabled =
      productHasPaymentData && !paymentConfigMatches(productPaymentConfig, leaguePaymentConfig);
    setForm(
      product
        ? {
            nome: asString(product.nome),
            preco: String(product.preco ?? ""),
            precoAntigo: String(product.precoAntigo ?? ""),
            status:
              productStatus === "em_breve" || productStatus === "esgotado" || productStatus === "ativo"
                ? productStatus
                : "ativo",
            estoque: String(product.estoque ?? ""),
            lote: asString(product.lote) || "geral",
            img: asString(product.img),
            descricao: asString(product.descricao),
            contato: productPaymentEnabled
              ? asString(productPaymentConfig?.whatsapp)
              : leaguePaymentConfig.whatsapp,
            paymentEnabled: productPaymentEnabled,
            pixChave: productPaymentEnabled ? asString(productPaymentConfig?.chave) : "",
            pixBanco: productPaymentEnabled ? asString(productPaymentConfig?.banco) : "",
            pixTitular: productPaymentEnabled ? asString(productPaymentConfig?.titular) : "",
            tagLabel: asString(product.tagLabel),
            tagColor:
              productTagColor === "emerald" ||
              productTagColor === "orange" ||
              productTagColor === "purple" ||
              productTagColor === "blue" ||
              productTagColor === "red"
                ? productTagColor
                : "zinc",
            tagEffect: productTagEffect === "pulse" || productTagEffect === "shine" ? productTagEffect : "none",
            coresText: joinTextLines(product.cores),
            caracteristicasText: asStringArray(product.caracteristicas).join("\n"),
            usarVariantes: productVariants.length > 0,
            variantes: productVariants.length > 0 ? productVariants : [newVariant()],
          }
        : { ...createEmptyProductForm(), contato: leaguePaymentConfig.whatsapp }
    );
    setFormOpen(true);
  };

  const handleStoreCoverUpload = async (file?: File | null) => {
    if (!file || !leagueId) return;
    const validationError = validateLeagueStoreImage(file);
    if (validationError) {
      addToast(validationError, "error");
      return;
    }

    setUploadingStoreCover(true);
    try {
      const url = await uploadLeagueImageToStorage({
        file,
        kind: "store",
        leagueId,
        entityId: "capa",
      });
      setStoreCover(url);
      addToast("Imagem da loja enviada. Clique em Salvar loja para publicar.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(`Erro ao enviar imagem: ${extractErrorMessage(error)}`, "error");
    } finally {
      setUploadingStoreCover(false);
    }
  };

  const handleProductImageUpload = async (file?: File | null) => {
    if (!file || !leagueId) return;
    const validationError = validateLeagueStoreImage(file);
    if (validationError) {
      addToast(validationError, "error");
      return;
    }

    setUploadingProductImage(true);
    try {
      const url = await uploadLeagueImageToStorage({
        file,
        kind: "product",
        leagueId,
        entityId: editingProductId || form.nome || "novo-produto",
      });
      setForm((prev) => ({ ...prev, img: url }));
      addToast("Imagem do produto enviada.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast(`Erro ao enviar imagem: ${extractErrorMessage(error)}`, "error");
    } finally {
      setUploadingProductImage(false);
    }
  };

  const addVariant = () => {
    setForm((prev) => ({ ...prev, usarVariantes: true, variantes: [...prev.variantes, newVariant()] }));
  };

  const removeVariant = (id: string) => {
    setForm((prev) => {
      const next = prev.variantes.filter((variant) => variant.id !== id);
      return { ...prev, variantes: next.length > 0 ? next : [newVariant()] };
    });
  };

  const setVariantField = (id: string, field: keyof VariantForm, value: string) => {
    setForm((prev) => ({
      ...prev,
      variantes: prev.variantes.map((variant) =>
        variant.id === id ? { ...variant, [field]: value } : variant
      ),
    }));
  };

  const handleSaveProduct = async () => {
    const nome = form.nome.trim();
    const preco = parseMoney(form.preco);
    const precoAntigo = form.precoAntigo.trim() ? parseMoney(form.precoAntigo) : 0;
    const contatoComprovante = normalizePhoneToBrE164(form.contato).slice(0, PHONE_MAX_LENGTH);
    const pixChave = form.pixChave.trim().slice(0, PIX_KEY_MAX_LENGTH);
    const pixBanco = form.pixBanco.trim().slice(0, PIX_BANK_MAX_LENGTH);
    const pixTitular = form.pixTitular.trim().slice(0, PIX_HOLDER_MAX_LENGTH);
    if (!league || !leagueId) return;
    if (!nome) return addToast("Nome do produto obrigatório.", "error");
    if (!Number.isFinite(preco) || preco < 0) return addToast("Preço inválido.", "error");
    if (form.paymentEnabled && (!contatoComprovante || !hasValidPhoneLength(contatoComprovante))) {
      return addToast("Informe um WhatsApp válido para o comprovante da liga.", "error");
    }
    if (form.paymentEnabled && (!pixChave || !pixBanco || !pixTitular)) {
      return addToast("Preencha a chave PIX, o banco e o titular para usar dados próprios.", "error");
    }
    if (!form.paymentEnabled && !hasCompletePaymentConfig(leaguePaymentConfig)) {
      return addToast("Configure os dados de pagamento na edição da liga ou use dados próprios.", "error");
    }

    const variants = form.usarVariantes
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

    if (form.usarVariantes && variants.length === 0) {
      return addToast("Adicione pelo menos uma variação.", "error");
    }

    const estoqueTotal = variants.length
      ? variants.reduce((acc, item) => acc + Number(item.estoque || 0), 0)
      : parseIntSafe(form.estoque);
    const caracteristicas = form.caracteristicasText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const coresText = form.coresText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    const paymentConfig = form.paymentEnabled
      ? {
          chave: pixChave,
          banco: pixBanco,
          titular: pixTitular,
          whatsapp: contatoComprovante,
        }
      : leaguePaymentConfig;

    setSaving(true);
    try {
      await ensureCategory(true);
      const productData: Row = {
        nome,
        categoria: leagueName,
        descricao: form.descricao.trim(),
        img: form.img.trim() || leagueLogo,
        preco,
        estoque: estoqueTotal,
        lote: form.lote.trim() || "geral",
        status: form.status,
        active: true,
        aprovado: true,
        variantes: variants,
        cores: coresText,
        caracteristicas,
        likes: [],
        payment_config: paymentConfig,
        seller_type: "league",
        seller_id: leagueId,
        seller_name: leagueName,
        seller_logo_url: leagueLogo,
      };

      if (Number.isFinite(precoAntigo) && precoAntigo > preco) {
        productData.precoAntigo = precoAntigo;
      } else if (editingProductId) {
        productData.precoAntigo = 0;
      }

      if (form.tagLabel.trim()) {
        productData.tagLabel = form.tagLabel.trim();
        productData.tagColor = form.tagColor;
        productData.tagEffect = form.tagEffect;
      } else if (editingProductId) {
        productData.tagLabel = "";
        productData.tagColor = "zinc";
        productData.tagEffect = "none";
      }

      await upsertStoreProduct({
        ...(editingProductId ? { productId: editingProductId } : {}),
        data: productData,
        tenantId: tenantId || undefined,
      });
      addToast(editingProductId ? "Produto atualizado." : "Produto criado.", "success");
      setEditingProductId("");
      setForm(createEmptyProductForm());
      setLotManagerOpen(false);
      setFormOpen(false);
      await load(true);
    } catch (error: unknown) {
      console.error(error);
      addToast(`Erro ao salvar produto: ${extractErrorMessage(error)}`, "error");
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
        userName: asString(order.userName) || "Usuário",
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
        Liga não encontrada.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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
          <LeagueAdminQuickNav
            active="store"
            homeHref={leagueHomeHref}
            informationHref={leagueInformationHref}
            membersHref={leagueMembersHref}
            eventsHref={leagueEventsHref}
            storeHref={storeHref}
            financeHref={leagueFinanceHref}
            boardHref={leagueBoardHref}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {mode === "overview" && (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[10px] font-black uppercase text-zinc-500">Categoria</p>
                <p className="mt-2 text-lg font-black">{leagueName}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{categoryVisible ? "Visível" : "Oculta"}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-[10px] font-black uppercase text-zinc-500">Produtos</p>
                <p className="mt-2 text-lg font-black">{products.length}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{visibleProducts.length} visíveis</p>
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
                <p className="text-xs font-black uppercase">Informações da loja</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={leagueName} disabled className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm font-bold text-zinc-400" />
                  <input type="color" value={storeColor} onChange={(event) => setStoreColor(event.target.value)} className="h-10 rounded-xl border border-zinc-700 bg-black/40 px-2" />
                  <input value={storeCover} maxLength={URL_MAX_LENGTH} onChange={(event) => setStoreCover(event.target.value.slice(0, URL_MAX_LENGTH))} placeholder="URL da capa" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                </div>
                <input
                  ref={storeCoverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleStoreCoverUpload(file);
                  }}
                />
                <div className="rounded-xl border border-zinc-800 bg-black/30 p-3">
                  <p className="text-[11px] font-bold text-zinc-300">
                    Imagem da capa: somente JPG, PNG ou WEBP de até 200 KB.
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Reduza o arquivo no <ImageResizeHelpLink label="Squoosh" /> antes de enviar, se passar do limite.
                  </p>
                  <button
                    type="button"
                    onClick={() => storeCoverInputRef.current?.click()}
                    disabled={uploadingStoreCover || saving}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60"
                  >
                    {uploadingStoreCover ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Adicionar imagem
                  </button>
                </div>
                <button onClick={() => void handleSaveStore(true)} disabled={saving || uploadingStoreCover} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
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
                  <Link href={publicStoreHref} className="mt-4 inline-flex rounded-xl border border-zinc-700 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 hover:bg-zinc-900">Abrir loja pública</Link>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black uppercase">{editingProductId ? "Editar produto" : "Novo produto"}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setLotManagerOpen((current) => !current)}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase text-amber-300 hover:bg-amber-500/20"
                    >
                      <Tags size={12} />
                      Editar lotes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormOpen(false);
                        setEditingProductId("");
                        setForm(createEmptyProductForm());
                        setLotManagerOpen(false);
                      }}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 hover:bg-zinc-700"
                      aria-label="Fechar formulário de produto"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <input
                  ref={productImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleProductImageUpload(file);
                  }}
                />
                <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                  <div className="relative h-44 overflow-hidden rounded-xl border border-zinc-800 bg-black">
                    <Image
                      src={form.img || leagueLogo}
                      alt={form.nome || "Imagem do produto"}
                      fill
                      sizes="180px"
                      className="object-cover"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => productImageInputRef.current?.click()}
                        disabled={uploadingProductImage || saving}
                        className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs font-black uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-60"
                      >
                        {uploadingProductImage ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                        Adicionar imagem
                      </button>
                      <p className="text-[11px] text-zinc-500">
                        Somente JPG, PNG ou WEBP de até 200 KB. Reduza no{" "}
                        <ImageResizeHelpLink label="Squoosh" /> antes de enviar.
                      </p>
                    </div>
                    <input
                      value={form.img}
                      maxLength={URL_MAX_LENGTH}
                      onChange={(event) => setForm((prev) => ({ ...prev, img: event.target.value.slice(0, URL_MAX_LENGTH) }))}
                      placeholder="URL da imagem"
                      className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={form.nome} maxLength={PRODUCT_NAME_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value.slice(0, PRODUCT_NAME_MAX_LENGTH) }))} placeholder="Nome do produto" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.preco} onChange={(event) => setForm((prev) => ({ ...prev, preco: event.target.value }))} placeholder="Preço" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <input value={form.precoAntigo} onChange={(event) => setForm((prev) => ({ ...prev, precoAntigo: event.target.value }))} placeholder="Preço antigo (opcional)" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as ProductStatus }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500">
                    <option value="ativo">Ativo</option>
                    <option value="em_breve">Em breve</option>
                    <option value="esgotado">Esgotado</option>
                  </select>
                  <input value={form.estoque} onChange={(event) => setForm((prev) => ({ ...prev, estoque: event.target.value.replace(/[^\d]/g, "") }))} placeholder="Estoque" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <LotNameSelector value={form.lote} maxLength={PRODUCT_LOTE_MAX_LENGTH} onChange={(value) => setForm((prev) => ({ ...prev, lote: value }))} selectClassName="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" inputClassName="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
                  <input value={form.contato} maxLength={PHONE_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, contato: normalizePhoneToBrE164(event.target.value) }))} placeholder="Telefone/WhatsApp para comprovante" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                  <textarea value={form.descricao} maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH) }))} placeholder="Descrição" rows={4} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 md:col-span-2" />
                </div>

                <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-white">Pagamento do produto</p>
                      <p className="text-[11px] text-zinc-500">
                        Se desligado, usa automaticamente os dados de pagamento da edição da liga.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-bold text-zinc-400">
                      <input
                        type="checkbox"
                        checked={form.paymentEnabled}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, paymentEnabled: event.target.checked }))
                        }
                        className="accent-emerald-500"
                      />
                      Usar dados próprios
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={form.pixChave}
                      maxLength={PIX_KEY_MAX_LENGTH}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          pixChave: event.target.value.slice(0, PIX_KEY_MAX_LENGTH),
                        }))
                      }
                      placeholder="Chave PIX"
                      disabled={!form.paymentEnabled}
                      className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                    />
                    <input
                      value={form.pixBanco}
                      maxLength={PIX_BANK_MAX_LENGTH}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          pixBanco: event.target.value.slice(0, PIX_BANK_MAX_LENGTH),
                        }))
                      }
                      placeholder="Banco"
                      disabled={!form.paymentEnabled}
                      className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                    />
                    <input
                      value={form.pixTitular}
                      maxLength={PIX_HOLDER_MAX_LENGTH}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          pixTitular: event.target.value.slice(0, PIX_HOLDER_MAX_LENGTH),
                        }))
                      }
                      placeholder="Titular"
                      disabled={!form.paymentEnabled}
                      className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                {lotManagerOpen && (
                  <div className="space-y-3 border-t border-zinc-800 pt-3">
                    <p className="text-xs font-black uppercase text-white">Lotes do produto</p>
                    <p className="text-[11px] text-zinc-500">
                      Escolha um lote existente ou edite o nome do lote deste produto.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {lotOptions.length === 0 ? (
                        <span className="text-[11px] text-zinc-500">Nenhum lote cadastrado ainda.</span>
                      ) : (
                        lotOptions.map((lot) => (
                          <button
                            key={lot}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, lote: lot }))}
                            className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase ${
                              form.lote === lot
                                ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                                : "border-zinc-700 bg-black/30 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {lot}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 border-t border-zinc-800 pt-3 md:grid-cols-3">
                  <input value={form.tagLabel} maxLength={PRODUCT_BADGE_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, tagLabel: event.target.value.slice(0, PRODUCT_BADGE_MAX_LENGTH) }))} placeholder="Texto da badge" className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <select value={form.tagColor} onChange={(event) => setForm((prev) => ({ ...prev, tagColor: event.target.value as ProductTagColor }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500">
                    <option value="zinc">Cinza</option>
                    <option value="emerald">Verde</option>
                    <option value="orange">Laranja</option>
                    <option value="purple">Roxo</option>
                    <option value="blue">Azul</option>
                    <option value="red">Vermelho</option>
                  </select>
                  <select value={form.tagEffect} onChange={(event) => setForm((prev) => ({ ...prev, tagEffect: event.target.value as ProductTagEffect }))} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500">
                    <option value="none">Sem efeito</option>
                    <option value="pulse">Pulse</option>
                    <option value="shine">Shine</option>
                  </select>
                </div>

                <div className="space-y-3 border-t border-zinc-800 pt-3">
                  <label className="inline-flex items-center gap-2 text-[11px] font-bold text-zinc-400">
                    <input type="checkbox" checked={form.usarVariantes} onChange={(event) => setForm((prev) => ({ ...prev, usarVariantes: event.target.checked }))} className="accent-emerald-500" />
                    Usar variações de tamanho/cor
                  </label>
                  {form.usarVariantes && (
                    <div className="space-y-2">
                      {form.variantes.map((variant) => (
                        <div key={variant.id} className="grid grid-cols-12 gap-2">
                          <input value={variant.tamanho} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(event) => setVariantField(variant.id, "tamanho", event.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Tamanho" className="col-span-4 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-3" />
                          <input value={variant.cor} maxLength={PRODUCT_VARIANT_FIELD_MAX_LENGTH} onChange={(event) => setVariantField(variant.id, "cor", event.target.value.slice(0, PRODUCT_VARIANT_FIELD_MAX_LENGTH))} placeholder="Cor" className="col-span-4 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500 md:col-span-3" />
                          <input value={variant.estoque} onChange={(event) => setVariantField(variant.id, "estoque", event.target.value.replace(/[^\d]/g, ""))} placeholder="Qtd." inputMode="numeric" className="col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                          <input value={variant.vendidos} onChange={(event) => setVariantField(variant.id, "vendidos", event.target.value.replace(/[^\d]/g, ""))} placeholder="Vend." inputMode="numeric" className="col-span-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                          <button type="button" onClick={() => removeVariant(variant.id)} className="col-span-12 inline-flex items-center justify-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10 md:col-span-2">
                            <Trash2 size={12} />
                            Remover
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={addVariant} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-700">
                        <Plus size={12} />
                        Adicionar variação
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 border-t border-zinc-800 pt-3 md:grid-cols-2">
                  <textarea value={form.coresText} maxLength={PRODUCT_COLORS_TEXT_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, coresText: event.target.value.slice(0, PRODUCT_COLORS_TEXT_MAX_LENGTH) }))} rows={3} placeholder={"Cores\n1 por linha"} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                  <textarea value={form.caracteristicasText} maxLength={PRODUCT_FEATURES_TEXT_MAX_LENGTH} onChange={(event) => setForm((prev) => ({ ...prev, caracteristicasText: event.target.value.slice(0, PRODUCT_FEATURES_TEXT_MAX_LENGTH) }))} rows={3} placeholder={"Características\n1 por linha"} className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                </div>

                <button onClick={() => void handleSaveProduct()} disabled={saving || uploadingProductImage} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60">
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
                    <p className="text-[11px] text-zinc-500">{formatCurrency(product.preco)} - Estoque {asNumber(product.estoque)} - {product.active === false ? "Oculto" : "Visível"}</p>
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
                      <p className="text-[11px] text-zinc-500">Comprador: {asString(order.userName) || "Usuário"} - {formatDateTime(order.createdAt)}</p>
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
