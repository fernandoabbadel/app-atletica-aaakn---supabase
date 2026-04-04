"use client";

import { updatePermissionUserRole } from "./adminSecurityService";
import {
  clearStoreCaches,
  upsertStoreCategory,
} from "./storeService";
import { incrementUserStats } from "./supabaseData";
import { getSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;
type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const MINI_VENDOR_TTL_MS = 60_000;
const MINI_VENDOR_SELECT_COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "status",
  "store_name",
  "slug",
  "description",
  "logo_url",
  "cover_url",
  "pix_key",
  "pix_bank",
  "pix_holder",
  "pix_whatsapp",
  "instagram",
  "instagram_enabled",
  "whatsapp",
  "whatsapp_enabled",
  "profile_visible",
  "category_visible",
  "products_visible",
  "category_button_color",
  "approved_by",
  "approved_at",
  "created_at",
  "updated_at",
].join(",");
const MINI_VENDOR_ORDER_SELECT_COLUMNS = [
  "id",
  "tenant_id",
  "userId",
  "userName",
  "productId",
  "productName",
  "price",
  "total",
  "quantidade",
  "itens",
  "data",
  "status",
  "approvedBy",
  "seller_type",
  "seller_id",
  "seller_name",
  "seller_logo_url",
  "payment_config",
  "createdAt",
  "updatedAt",
].join(",");
const MINI_VENDOR_PRODUCT_SELECT_COLUMNS = [
  "id",
  "tenant_id",
  "nome",
  "categoria",
  "descricao",
  "img",
  "preco",
  "precoAntigo",
  "estoque",
  "lote",
  "tagLabel",
  "tagColor",
  "tagEffect",
  "active",
  "aprovado",
  "vendidos",
  "cliques",
  "cores",
  "caracteristicas",
  "variantes",
  "status",
  "plan_prices",
  "plan_visibility",
  "payment_config",
  "seller_type",
  "seller_id",
  "seller_name",
  "seller_logo_url",
  "createdAt",
  "updatedAt",
].join(",");

const currentMiniVendorCache = new Map<string, CacheEntry<MiniVendorProfile | null>>();
const miniVendorByIdCache = new Map<string, CacheEntry<MiniVendorProfile | null>>();
const approvedMiniVendorIdsCache = new Map<string, CacheEntry<string[]>>();
const tenantMiniVendorsCache = new Map<string, CacheEntry<MiniVendorProfile[]>>();
const miniVendorOrdersCache = new Map<string, CacheEntry<Row[]>>();
const miniVendorProductsCache = new Map<string, CacheEntry<Row[]>>();

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeMiniVendorStatus = (value: unknown): MiniVendorStatus => {
  const normalized = asString(value).trim().toLowerCase();
  if (
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "disabled"
  ) {
    return normalized;
  }
  return "pending";
};

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [
    typeof raw.message === "string" ? raw.message : "",
    typeof raw.details === "string" ? raw.details : "",
  ]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const nowIso = (): string => new Date().toISOString();

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > MINI_VENDOR_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const buildScopedCacheKey = (...parts: Array<string | null | undefined>): string =>
  parts.map((entry) => asString(entry).trim() || "_").join(":");

const invalidateMiniVendorCaches = (tenantId?: string, userId?: string): void => {
  const cleanTenantId = asString(tenantId).trim();
  const cleanUserId = asString(userId).trim();

  if (!cleanTenantId && !cleanUserId) {
    currentMiniVendorCache.clear();
    miniVendorByIdCache.clear();
    approvedMiniVendorIdsCache.clear();
    tenantMiniVendorsCache.clear();
    miniVendorOrdersCache.clear();
    miniVendorProductsCache.clear();
    clearStoreCaches();
    return;
  }

  currentMiniVendorCache.forEach((_, key) => {
    if (
      (!cleanTenantId || key.includes(`${cleanTenantId}:`)) &&
      (!cleanUserId || key.endsWith(`:${cleanUserId}`))
    ) {
      currentMiniVendorCache.delete(key);
    }
  });
  miniVendorByIdCache.forEach((_, key) => {
    if (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) {
      miniVendorByIdCache.delete(key);
    }
  });
  approvedMiniVendorIdsCache.forEach((_, key) => {
    if (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) {
      approvedMiniVendorIdsCache.delete(key);
    }
  });
  tenantMiniVendorsCache.forEach((_, key) => {
    if (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) {
      tenantMiniVendorsCache.delete(key);
    }
  });
  miniVendorOrdersCache.forEach((_, key) => {
    if (
      (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) &&
      (!cleanUserId || key.includes(`:${cleanUserId}:`))
    ) {
      miniVendorOrdersCache.delete(key);
    }
  });
  miniVendorProductsCache.forEach((_, key) => {
    if (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) {
      miniVendorProductsCache.delete(key);
    }
  });
  clearStoreCaches();
};

export type MiniVendorStatus = "pending" | "approved" | "rejected" | "disabled";

export interface MiniVendorProfile {
  id: string;
  tenantId: string;
  userId: string;
  status: MiniVendorStatus;
  storeName: string;
  slug: string;
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
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMiniVendorPayload {
  tenantId: string;
  userId: string;
  storeName: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  pixKey?: string;
  pixBank?: string;
  pixHolder?: string;
  pixWhatsapp?: string;
  instagram?: string;
  instagramEnabled: boolean;
  whatsapp?: string;
  whatsappEnabled: boolean;
  profileVisible?: boolean;
  categoryVisible?: boolean;
  productsVisible?: boolean;
  categoryButtonColor?: string;
}

export const isMiniVendorProfilePublic = (profile: MiniVendorProfile | null): boolean =>
  Boolean(profile && profile.status === "approved" && profile.profileVisible !== false);

export const isMiniVendorCategoryPublic = (profile: MiniVendorProfile | null): boolean =>
  Boolean(profile && profile.status === "approved" && profile.categoryVisible !== false);

export const isMiniVendorProductsPublic = (profile: MiniVendorProfile | null): boolean =>
  Boolean(profile && profile.status === "approved" && profile.productsVisible !== false);

export const isMiniVendorReceivingOrders = (profile: MiniVendorProfile | null): boolean =>
  isMiniVendorCategoryPublic(profile) && isMiniVendorProductsPublic(profile);

export const resolveMiniVendorPaymentConfig = (
  profile: MiniVendorProfile | null
): Row | null => {
  if (!profile) return null;
  const pixKey = profile.pixKey.trim();
  const pixBank = profile.pixBank.trim();
  const pixHolder = profile.pixHolder.trim();
  const pixWhatsapp = profile.pixWhatsapp.trim();

  if (!pixKey && !pixBank && !pixHolder && !pixWhatsapp) {
    return null;
  }

  return {
    chave: pixKey,
    banco: pixBank,
    titular: pixHolder,
    whatsapp: pixWhatsapp,
  };
};

const normalizeMiniVendorProfile = (row: Row | null): MiniVendorProfile | null => {
  if (!row) return null;
  const tenantId = asString(row.tenant_id).trim();
  const userId = asString(row.user_id).trim();
  const id = asString(row.id).trim();
  if (!tenantId || !userId || !id) return null;

  return {
    id,
    tenantId,
    userId,
    status: normalizeMiniVendorStatus(row.status),
    storeName: asString(row.store_name).trim(),
    slug: asString(row.slug).trim(),
    description: asString(row.description).trim(),
    logoUrl: asString(row.logo_url).trim(),
    coverUrl: asString(row.cover_url).trim(),
    pixKey: asString(row.pix_key).trim(),
    pixBank: asString(row.pix_bank).trim(),
    pixHolder: asString(row.pix_holder).trim(),
    pixWhatsapp: asString(row.pix_whatsapp).trim(),
    instagram: asString(row.instagram).trim(),
    instagramEnabled: asBoolean(row.instagram_enabled),
    whatsapp: asString(row.whatsapp).trim(),
    whatsappEnabled: asBoolean(row.whatsapp_enabled),
    profileVisible: asBoolean(row.profile_visible, true),
    categoryVisible: asBoolean(row.category_visible, true),
    productsVisible: asBoolean(row.products_visible, true),
    categoryButtonColor: asString(row.category_button_color).trim() || "#2563eb",
    approvedBy: asString(row.approved_by).trim(),
    approvedAt: asString(row.approved_at).trim(),
    createdAt: asString(row.created_at).trim(),
    updatedAt: asString(row.updated_at).trim(),
  };
};

async function syncMiniVendorStoreCategory(profile: MiniVendorProfile): Promise<void> {
  if (profile.status !== "approved" || !profile.storeName.trim()) return;

  const nextCoverUrl = profile.coverUrl.trim();
  const nextLogoUrl = profile.logoUrl.trim();

  const supabase = getSupabaseClient();
  let existingCategoryRow: unknown = null;
  let selectColumns = ["id", "cover_img", "logo_url"];
  while (selectColumns.length > 0) {
    const { data, error } = await supabase
      .from("categorias")
      .select(selectColumns.join(","))
      .eq("tenant_id", profile.tenantId)
      .eq("seller_type", "mini_vendor")
      .eq("seller_id", profile.id)
      .limit(1)
      .maybeSingle();
    if (!error) {
      existingCategoryRow = data;
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn) {
      throwSupabaseError(error);
    }

    const nextColumns = selectColumns.filter(
      (column) => column.toLowerCase() !== missingColumn.toLowerCase()
    );
    if (nextColumns.length === selectColumns.length) {
      throwSupabaseError(error);
    }
    selectColumns = nextColumns;
  }

  const existingCategory = asObject(existingCategoryRow);
  const existingCategoryId = asString(existingCategory?.id).trim();
  if (existingCategoryId) {
    const existingCoverImg = asString(existingCategory?.cover_img).trim();
    const existingLogoUrl = asString(existingCategory?.logo_url).trim();
    await upsertStoreCategory({
      categoryId: existingCategoryId,
      data: {
        nome: profile.storeName,
        coverImg: nextCoverUrl || existingCoverImg,
        buttonColor: profile.categoryButtonColor || "#2563eb",
        logoUrl: nextLogoUrl || existingLogoUrl,
        sellerType: "mini_vendor",
        sellerId: profile.id,
        tenantId: profile.tenantId,
      },
    });
  } else {
    await upsertStoreCategory({
      data: {
        nome: profile.storeName,
        coverImg: nextCoverUrl,
        buttonColor: profile.categoryButtonColor || "#2563eb",
        logoUrl: nextLogoUrl,
        sellerType: "mini_vendor",
        sellerId: profile.id,
        tenantId: profile.tenantId,
      },
    });
  }

  const productUpdatePayload: Row = {
    categoria: profile.storeName,
    seller_name: profile.storeName,
    updatedAt: nowIso(),
  };
  if (nextLogoUrl) {
    productUpdatePayload.seller_logo_url = nextLogoUrl;
  }

  const { error } = await supabase
    .from("produtos")
    .update(productUpdatePayload)
    .eq("tenant_id", profile.tenantId)
    .eq("seller_type", "mini_vendor")
    .eq("seller_id", profile.id);

  if (error) {
    throwSupabaseError(error);
  }
}

async function maybeDowngradeMiniVendorUser(profile: MiniVendorProfile): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("tenant_role")
    .eq("uid", profile.userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const tenantRole = asString(asObject(data)?.tenant_role).trim().toLowerCase();
  if (tenantRole === "mini_vendor") {
    await updatePermissionUserRole({
      targetUserId: profile.userId,
      role: "user",
      tenantId: profile.tenantId,
    });
  }
}

export async function fetchCurrentMiniVendorProfile(options: {
  tenantId: string;
  userId: string;
  forceRefresh?: boolean;
}): Promise<MiniVendorProfile | null> {
  const tenantId = options.tenantId.trim();
  const userId = options.userId.trim();
  if (!tenantId || !userId) return null;

  const cacheKey = buildScopedCacheKey(tenantId, userId);
  if (!options.forceRefresh) {
    const cached = getCache(currentMiniVendorCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mini_vendors")
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const normalized = normalizeMiniVendorProfile(asObject(data));
  setCache(currentMiniVendorCache, cacheKey, normalized);
  if (normalized) {
    setCache(
      miniVendorByIdCache,
      buildScopedCacheKey(tenantId, normalized.id),
      normalized
    );
  }
  return normalized;
}

export async function fetchMiniVendorProfileById(options: {
  tenantId: string;
  miniVendorId: string;
  forceRefresh?: boolean;
}): Promise<MiniVendorProfile | null> {
  const tenantId = options.tenantId.trim();
  const miniVendorId = options.miniVendorId.trim();
  if (!tenantId || !miniVendorId) return null;

  const cacheKey = buildScopedCacheKey(tenantId, miniVendorId);
  if (!options.forceRefresh) {
    const cached = getCache(miniVendorByIdCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mini_vendors")
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", miniVendorId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const normalized = normalizeMiniVendorProfile(asObject(data));
  setCache(miniVendorByIdCache, cacheKey, normalized);
  if (normalized) {
    setCache(
      currentMiniVendorCache,
      buildScopedCacheKey(tenantId, normalized.userId),
      normalized
    );
  }
  return normalized;
}

export async function fetchTenantMiniVendors(options: {
  tenantId: string;
  statuses?: MiniVendorStatus[];
  forceRefresh?: boolean;
}): Promise<MiniVendorProfile[]> {
  const tenantId = options.tenantId.trim();
  if (!tenantId) return [];

  const normalizedStatuses = Array.from(
    new Set(
      (options.statuses ?? [])
        .map((entry) => normalizeMiniVendorStatus(entry))
        .filter((entry) => entry.length > 0)
    )
  );
  const cacheKey = buildScopedCacheKey(tenantId, normalizedStatuses.join("|"));
  if (!options.forceRefresh) {
    const cached = getCache(tenantMiniVendorsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("mini_vendors")
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (normalizedStatuses.length > 0) {
    query = query.in("status", normalizedStatuses);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);

  const rows = (Array.isArray(data) ? data : [])
    .map((entry) => normalizeMiniVendorProfile(asObject(entry)))
    .filter((entry): entry is MiniVendorProfile => entry !== null);

  setCache(tenantMiniVendorsCache, cacheKey, rows);
  return rows;
}

export async function fetchApprovedMiniVendorIds(options: {
  tenantId: string;
  forceRefresh?: boolean;
}): Promise<string[]> {
  const tenantId = options.tenantId.trim();
  if (!tenantId) return [];

  const cacheKey = buildScopedCacheKey(tenantId, "approved");
  if (!options.forceRefresh) {
    const cached = getCache(approvedMiniVendorIdsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mini_vendors")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "approved");
  if (error) throwSupabaseError(error);

  const ids = (Array.isArray(data) ? data : [])
    .map((entry) => asString(asObject(entry)?.id).trim())
    .filter((entry) => entry.length > 0);
  setCache(approvedMiniVendorIdsCache, cacheKey, ids);
  return ids;
}

export async function upsertMiniVendorProfile(
  payload: UpsertMiniVendorPayload
): Promise<MiniVendorProfile> {
  const tenantId = payload.tenantId.trim();
  const userId = payload.userId.trim();
  const storeName = payload.storeName.trim().slice(0, 80);
  if (!tenantId || !userId || !storeName) {
    throw new Error("Preencha tenant, usuario e nome da loja.");
  }

  const existing = await fetchCurrentMiniVendorProfile({
    tenantId,
    userId,
    forceRefresh: true,
  });
  const nextStatus =
    existing?.status === "rejected"
      ? "pending"
      : existing?.status || "pending";
  const approvedBy = nextStatus === "approved" ? existing?.approvedBy || "" : "";
  const approvedAt = nextStatus === "approved" ? existing?.approvedAt || "" : "";

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mini_vendors")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        status: nextStatus,
        store_name: storeName,
        slug: storeName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80),
        description: asString(payload.description).trim().slice(0, 1200),
        logo_url: asString(payload.logoUrl).trim().slice(0, 400),
        cover_url: asString(payload.coverUrl).trim().slice(0, 400),
        pix_key: asString(payload.pixKey).trim().slice(0, 180),
        pix_bank: asString(payload.pixBank).trim().slice(0, 120),
        pix_holder: asString(payload.pixHolder).trim().slice(0, 180),
        pix_whatsapp: asString(payload.pixWhatsapp).trim().slice(0, 60),
        instagram: asString(payload.instagram).trim().slice(0, 160),
        instagram_enabled: payload.instagramEnabled,
        whatsapp: asString(payload.whatsapp).trim().slice(0, 60),
        whatsapp_enabled: payload.whatsappEnabled,
        profile_visible: payload.profileVisible ?? existing?.profileVisible ?? true,
        category_visible: payload.categoryVisible ?? existing?.categoryVisible ?? true,
        products_visible: payload.productsVisible ?? existing?.productsVisible ?? true,
        category_button_color:
          asString(payload.categoryButtonColor).trim().slice(0, 32) || "#2563eb",
        approved_by: approvedBy || null,
        approved_at: approvedAt || null,
        updated_at: nowIso(),
      },
      {
        onConflict: "tenant_id,user_id",
      }
    )
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .single();
  if (error) throwSupabaseError(error);

  const normalized = normalizeMiniVendorProfile(asObject(data));
  if (!normalized) {
    throw new Error("Nao foi possivel salvar a loja mini vendor.");
  }

  if (normalized.status === "approved") {
    await syncMiniVendorStoreCategory(normalized);
  }

  if (!existing) {
    try {
      await incrementUserStats(userId, { miniVendorCreated: 1 }, { tenantId });
    } catch (statsError: unknown) {
      console.warn("Mini vendor: falha ao sincronizar criacao da loja.", statsError);
    }
  }

  invalidateMiniVendorCaches(tenantId, userId);
  setCache(currentMiniVendorCache, buildScopedCacheKey(tenantId, userId), normalized);
  setCache(miniVendorByIdCache, buildScopedCacheKey(tenantId, normalized.id), normalized);
  return normalized;
}

export async function setMiniVendorStatus(payload: {
  miniVendorId: string;
  status: MiniVendorStatus;
  tenantId?: string | null;
  approvedBy?: string | null;
}): Promise<MiniVendorProfile> {
  const miniVendorId = payload.miniVendorId.trim();
  if (!miniVendorId) {
    throw new Error("Mini vendor invalido.");
  }

  const supabase = getSupabaseClient();
  let selectQuery = supabase
    .from("mini_vendors")
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .eq("id", miniVendorId);
  const scopedTenantId = asString(payload.tenantId).trim();
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: currentRow, error: currentError } = await selectQuery.maybeSingle();
  if (currentError) throwSupabaseError(currentError);

  const current = normalizeMiniVendorProfile(asObject(currentRow));
  if (!current) {
    throw new Error("Mini vendor nao encontrado.");
  }

  const nextStatus = normalizeMiniVendorStatus(payload.status);
  const now = nowIso();
  const { data, error } = await supabase
    .from("mini_vendors")
    .update({
      status: nextStatus,
      approved_by:
        nextStatus === "approved"
          ? asString(payload.approvedBy).trim() || current.approvedBy || null
          : null,
      approved_at: nextStatus === "approved" ? now : null,
      updated_at: now,
    })
    .eq("id", current.id)
    .eq("tenant_id", current.tenantId)
    .select(MINI_VENDOR_SELECT_COLUMNS)
    .single();
  if (error) throwSupabaseError(error);

  const normalized = normalizeMiniVendorProfile(asObject(data));
  if (!normalized) {
    throw new Error("Nao foi possivel atualizar o mini vendor.");
  }

  if (normalized.status === "approved") {
    await updatePermissionUserRole({
      targetUserId: normalized.userId,
      role: "mini_vendor",
      tenantId: normalized.tenantId,
    });
    await syncMiniVendorStoreCategory(normalized);
  } else if (
    normalized.status === "rejected" ||
    normalized.status === "disabled"
  ) {
    await maybeDowngradeMiniVendorUser(normalized);
  }

  invalidateMiniVendorCaches(normalized.tenantId, normalized.userId);
  setCache(
    currentMiniVendorCache,
    buildScopedCacheKey(normalized.tenantId, normalized.userId),
    normalized
  );
  setCache(
    miniVendorByIdCache,
    buildScopedCacheKey(normalized.tenantId, normalized.id),
    normalized
  );
  return normalized;
}

export async function fetchMiniVendorOrders(options: {
  tenantId: string;
  sellerId: string;
  statuses?: string[];
  forceRefresh?: boolean;
  limit?: number;
}): Promise<Row[]> {
  const tenantId = options.tenantId.trim();
  const sellerId = options.sellerId.trim();
  if (!tenantId || !sellerId) return [];

  const statuses = Array.from(
    new Set(
      (options.statuses ?? [])
        .map((entry) => asString(entry).trim())
        .filter((entry) => entry.length > 0)
    )
  );
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 80)));
  const cacheKey = buildScopedCacheKey(tenantId, sellerId, statuses.join("|"), String(limit));
  if (!options.forceRefresh) {
    const cached = getCache(miniVendorOrdersCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("orders")
    .select(MINI_VENDOR_ORDER_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("seller_type", "mini_vendor")
    .eq("seller_id", sellerId)
    .limit(limit);

  if (statuses.length > 0) {
    query = query.in("status", statuses);
  }

  let data: unknown[] = [];
  let error: { message: string; code?: string | null; name?: string | null } | null = null;
  try {
    const result = await query.order("createdAt", { ascending: false });
    data = result.data ?? [];
    error = result.error;
  } catch {
    const fallback = await query;
    data = fallback.data ?? [];
    error = fallback.error;
  }

  if (error) throwSupabaseError(error);

  const rows = (Array.isArray(data) ? data : [])
    .map((entry) => asObject(entry))
    .filter((entry): entry is Row => entry !== null)
    .map((entry) => ({ ...entry }));

  setCache(miniVendorOrdersCache, cacheKey, rows);
  return rows;
}

export async function fetchMiniVendorProducts(options: {
  tenantId: string;
  sellerId: string;
  forceRefresh?: boolean;
  maxResults?: number;
}): Promise<Row[]> {
  const tenantId = options.tenantId.trim();
  const sellerId = options.sellerId.trim();
  if (!tenantId || !sellerId) return [];

  const limit = Math.max(1, Math.min(200, Math.floor(options.maxResults ?? 120)));
  const cacheKey = buildScopedCacheKey(tenantId, sellerId, String(limit));
  if (!options.forceRefresh) {
    const cached = getCache(miniVendorProductsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const query = supabase
    .from("produtos")
    .select(MINI_VENDOR_PRODUCT_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("seller_type", "mini_vendor")
    .eq("seller_id", sellerId)
    .limit(limit);

  let data: unknown[] = [];
  let error: { message: string; code?: string | null; name?: string | null } | null = null;
  try {
    const result = await query.order("createdAt", { ascending: false });
    data = result.data ?? [];
    error = result.error;
  } catch {
    const fallback = await query;
    data = fallback.data ?? [];
    error = fallback.error;
  }

  if (error) throwSupabaseError(error);

  const rows = (Array.isArray(data) ? data : [])
    .map((entry) => asObject(entry))
    .filter((entry): entry is Row => entry !== null)
    .map((entry) => ({ ...entry }));

  setCache(miniVendorProductsCache, cacheKey, rows);
  return rows;
}
