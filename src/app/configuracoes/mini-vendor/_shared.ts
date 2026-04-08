import type { MiniVendorProfile } from "@/lib/miniVendorService";
import type { PlanRecord } from "@/lib/plansPublicService";

export type ProductStatus = "ativo" | "em_breve" | "esgotado";

export type PlanScopeFormRow = {
  planId: string;
  planName: string;
  price: string;
  visible: boolean;
};

export type PaymentFormState = {
  enabled: boolean;
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
};

export type VariantForm = {
  id: string;
  tamanho: string;
  cor: string;
  estoque: string;
  vendidos: string;
};

export type ProductRow = {
  id: string;
  nome?: string;
  categoria?: string;
  descricao?: string;
  img?: string;
  preco?: number;
  precoAntigo?: number;
  estoque?: number;
  lote?: string;
  tagLabel?: string;
  tagColor?: ProductFormState["tagColor"];
  tagEffect?: ProductFormState["tagEffect"];
  active?: boolean;
  aprovado?: boolean;
  vendidos?: number;
  cliques?: number;
  cores?: string | string[];
  caracteristicas?: string[];
  variantes?: Array<{ id?: string; cor?: string; tamanho?: string; estoque?: number; vendidos?: number }>;
  status?: ProductStatus;
  plan_prices?: Array<{ planId?: string; planName?: string; price?: number }>;
  plan_visibility?: Array<{ planId?: string; planName?: string; visible?: boolean }>;
  payment_config?: { chave?: string; banco?: string; titular?: string; whatsapp?: string } | null;
};

export type OrderRow = {
  id: string;
  userId?: string;
  userName?: string;
  productId?: string;
  productName?: string;
  price?: number;
  total?: number;
  quantidade?: number;
  status?: string;
  approvedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MiniVendorFormState = {
  storeName: string;
  description: string;
  logoUrl: string;
  coverUrl: string;
  pixKey: string;
  pixBank: string;
  pixHolder: string;
  pixWhatsapp: string;
  instagram: string;
  instagramEnabled: boolean;
  whatsapp: string;
  whatsappEnabled: boolean;
  profileVisible: boolean;
  categoryVisible: boolean;
  productsVisible: boolean;
  categoryButtonColor: string;
};

export type ProductFormState = {
  nome: string;
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
  status: ProductStatus;
  planScopeRows: PlanScopeFormRow[];
  payment: PaymentFormState;
};

export const EMPTY_VENDOR_FORM: MiniVendorFormState = {
  storeName: "",
  description: "",
  logoUrl: "",
  coverUrl: "",
  pixKey: "",
  pixBank: "",
  pixHolder: "",
  pixWhatsapp: "",
  instagram: "",
  instagramEnabled: false,
  whatsapp: "",
  whatsappEnabled: false,
  profileVisible: true,
  categoryVisible: true,
  productsVisible: true,
  categoryButtonColor: "#2563eb",
};

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  nome: "",
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
  variantes: [],
  status: "ativo",
  planScopeRows: [],
  payment: {
    enabled: false,
    chave: "",
    banco: "",
    titular: "",
    whatsapp: "",
  },
};

export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 1200;
export const PRODUCT_LOTE_MAX_LENGTH = 80;
export const PRODUCT_BADGE_MAX_LENGTH = 30;
export const PRODUCT_COLORS_TEXT_MAX_LENGTH = 600;
export const PRODUCT_FEATURES_TEXT_MAX_LENGTH = 1200;
export const PRODUCT_VARIANT_FIELD_MAX_LENGTH = 40;

export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const asBoolean = (value: unknown): boolean => value === true;

export const parseMoney = (value: string): number => Number(value.replace(",", "."));

export const parseIntSafe = (value: string): number => {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};

export const joinTextLines = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

export const newVariant = (): VariantForm => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  tamanho: "",
  cor: "",
  estoque: "",
  vendidos: "0",
});

export const getVendorStatusLabel = (status?: MiniVendorProfile["status"]): string =>
  status === "approved"
    ? "Aprovado"
    : status === "rejected"
    ? "Rejeitado"
    : status === "disabled"
    ? "Desativado"
    : "Pendente";

export const getVendorStatusClass = (status?: MiniVendorProfile["status"]): string =>
  status === "approved"
    ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
    : status === "rejected"
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : status === "disabled"
    ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";

export const getProductStatusClass = (status: ProductStatus): string =>
  status === "em_breve"
    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
    : status === "esgotado"
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

export const buildPlanScopeRows = (
  plans: PlanRecord[],
  planPrices?: ProductRow["plan_prices"],
  planVisibility?: ProductRow["plan_visibility"]
): PlanScopeFormRow[] => {
  const priceMap = new Map(
    (planPrices ?? []).map((entry) => [
      String(entry.planId || entry.planName || "").trim().toLowerCase(),
      typeof entry.price === "number" && Number.isFinite(entry.price) ? String(entry.price) : "",
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

export const normalizeVendorForm = (profile: MiniVendorProfile | null): MiniVendorFormState => ({
  storeName: profile?.storeName || "",
  description: profile?.description || "",
  logoUrl: profile?.logoUrl || "",
  coverUrl: profile?.coverUrl || "",
  pixKey: profile?.pixKey || "",
  pixBank: profile?.pixBank || "",
  pixHolder: profile?.pixHolder || "",
  pixWhatsapp: profile?.pixWhatsapp || "",
  instagram: profile?.instagram || "",
  instagramEnabled: profile?.instagramEnabled || false,
  whatsapp: profile?.whatsapp || "",
  whatsappEnabled: profile?.whatsappEnabled || false,
  profileVisible: profile?.profileVisible ?? true,
  categoryVisible: profile?.categoryVisible ?? true,
  productsVisible: profile?.productsVisible ?? true,
  categoryButtonColor: profile?.categoryButtonColor || "#2563eb",
});

export const readDraftObject = (storageKey: string): Record<string, unknown> | null => {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    return asObject(JSON.parse(window.localStorage.getItem(storageKey) || "null"));
  } catch {
    return null;
  }
};

export const writeDraftObject = (
  storageKey: string,
  value: Record<string, unknown>
): void => {
  if (!storageKey || typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
};

export const removeDraftObject = (storageKey: string): void => {
  if (!storageKey || typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey);
};

export const restoreVendorFormDraft = (
  draft: Record<string, unknown>
): MiniVendorFormState => ({
  storeName: asString(draft.storeName),
  description: asString(draft.description),
  logoUrl: asString(draft.logoUrl),
  coverUrl: asString(draft.coverUrl),
  pixKey: asString(draft.pixKey),
  pixBank: asString(draft.pixBank),
  pixHolder: asString(draft.pixHolder),
  pixWhatsapp: asString(draft.pixWhatsapp),
  instagram: asString(draft.instagram),
  instagramEnabled: asBoolean(draft.instagramEnabled),
  whatsapp: asString(draft.whatsapp),
  whatsappEnabled: asBoolean(draft.whatsappEnabled),
  profileVisible: "profileVisible" in draft ? asBoolean(draft.profileVisible) : true,
  categoryVisible: "categoryVisible" in draft ? asBoolean(draft.categoryVisible) : true,
  productsVisible: "productsVisible" in draft ? asBoolean(draft.productsVisible) : true,
  categoryButtonColor: asString(draft.categoryButtonColor) || "#2563eb",
});

export const restoreProductFormDraft = (
  draft: Record<string, unknown>,
  plans: PlanRecord[]
): {
  editingProductId: string | null;
  isProductOpen: boolean;
  isPlanModalOpen: boolean;
  form: ProductFormState;
} => {
  const rawForm = asObject(draft.form);
  const rawPayment = asObject(rawForm?.payment);
  const rawVariants = asArray(rawForm?.variantes);
  const restoredVariants = rawVariants
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      id:
        asString(entry.id) ||
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`),
      tamanho: asString(entry.tamanho),
      cor: asString(entry.cor),
      estoque: asString(entry.estoque),
      vendidos: asString(entry.vendidos) || "0",
    }));
  const rawPlanScopeRows = asArray(rawForm?.planScopeRows)
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const rawTagColor = asString(rawForm?.tagColor);
  const rawTagEffect = asString(rawForm?.tagEffect);
  const rawStatus = asString(rawForm?.status);

  return {
    editingProductId: asString(draft.editingProductId) || null,
    isProductOpen: asBoolean(draft.isProductOpen),
    isPlanModalOpen: asBoolean(draft.isPlanModalOpen),
    form: {
      nome: asString(rawForm?.nome),
      descricao: asString(rawForm?.descricao),
      img: asString(rawForm?.img),
      preco: asString(rawForm?.preco),
      precoAntigo: asString(rawForm?.precoAntigo),
      estoque: asString(rawForm?.estoque),
      lote: asString(rawForm?.lote),
      tagLabel: asString(rawForm?.tagLabel),
      tagColor:
        rawTagColor === "emerald" ||
        rawTagColor === "orange" ||
        rawTagColor === "purple" ||
        rawTagColor === "blue" ||
        rawTagColor === "red"
          ? rawTagColor
          : "zinc",
      tagEffect:
        rawTagEffect === "pulse" || rawTagEffect === "shine"
          ? rawTagEffect
          : "none",
      coresText: asString(rawForm?.coresText),
      caracteristicasText: asString(rawForm?.caracteristicasText),
      usarVariantes: asBoolean(rawForm?.usarVariantes),
      variantes: restoredVariants.length ? restoredVariants : [newVariant()],
      status:
        rawStatus === "em_breve" || rawStatus === "esgotado"
          ? rawStatus
          : "ativo",
      planScopeRows: buildPlanScopeRows(
        plans,
        rawPlanScopeRows.map((entry) => ({
          planId: asString(entry.planId),
          planName: asString(entry.planName),
          price: asString(entry.price)
            ? Number(asString(entry.price).replace(",", "."))
            : undefined,
        })),
        rawPlanScopeRows.map((entry) => ({
          planId: asString(entry.planId),
          planName: asString(entry.planName),
          visible: entry.visible !== false,
        }))
      ),
      payment: {
        enabled: asBoolean(rawPayment?.enabled),
        chave: asString(rawPayment?.chave),
        banco: asString(rawPayment?.banco),
        titular: asString(rawPayment?.titular),
        whatsapp: asString(rawPayment?.whatsapp),
      },
    },
  };
};

export const mapProductRowToForm = (
  row: ProductRow,
  plans: PlanRecord[]
): ProductFormState => {
  const mappedVariants =
    Array.isArray(row.variantes) && row.variantes.length > 0
      ? row.variantes.map((variant) => ({
          id:
            typeof variant.id === "string" && variant.id.trim()
              ? variant.id
              : typeof crypto !== "undefined" &&
                typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
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

  return {
    nome: asString(row.nome),
    descricao: asString(row.descricao),
    img: asString(row.img),
    preco: typeof row.preco === "number" ? String(row.preco) : "",
    precoAntigo: typeof row.precoAntigo === "number" ? String(row.precoAntigo) : "",
    estoque: typeof row.estoque === "number" ? String(row.estoque) : "",
    lote: asString(row.lote),
    tagLabel: asString(row.tagLabel),
    tagColor: row.tagColor || "zinc",
    tagEffect: row.tagEffect || "none",
    coresText: joinTextLines(row.cores),
    caracteristicasText: Array.isArray(row.caracteristicas)
      ? row.caracteristicas
          .filter((entry): entry is string => typeof entry === "string")
          .join("\n")
      : "",
    usarVariantes: Array.isArray(row.variantes) && row.variantes.length > 0,
    variantes: mappedVariants,
    status: row.status || "ativo",
    planScopeRows: buildPlanScopeRows(plans, row.plan_prices, row.plan_visibility),
    payment: {
      enabled: Boolean(row.payment_config),
      chave: row.payment_config?.chave || "",
      banco: row.payment_config?.banco || "",
      titular: row.payment_config?.titular || "",
      whatsapp: row.payment_config?.whatsapp || "",
    },
  };
};
