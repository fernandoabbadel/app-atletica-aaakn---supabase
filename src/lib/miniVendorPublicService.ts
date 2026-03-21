"use client";

import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { fetchMiniVendorProfileById, type MiniVendorProfile } from "./miniVendorService";
import { fetchStoreProductsBySeller } from "./storePublicService";
import { getSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;
type CacheEntry<T> = { cachedAt: number; value: T };

const TTL_MS = 120_000;
const MAX_PRODUCTS = 24;
const bundleCache = new Map<string, CacheEntry<MiniVendorPublicBundle | null>>();
const socialCountCache = new Map<string, CacheEntry<number>>();
const socialStateCache = new Map<string, CacheEntry<boolean>>();

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const resolveTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const nowIso = (): string => new Date().toISOString();

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const clearMiniVendorPublicCaches = (tenantId?: string | null, miniVendorId?: string | null): void => {
  const scopedTenantId = resolveTenantId(tenantId);
  const cleanMiniVendorId = asString(miniVendorId).trim();

  bundleCache.forEach((_, key) => {
    if (
      (!scopedTenantId || key.startsWith(`${scopedTenantId}:`)) &&
      (!cleanMiniVendorId || key.includes(`:${cleanMiniVendorId}:`))
    ) {
      bundleCache.delete(key);
    }
  });
  socialCountCache.forEach((_, key) => {
    if (
      (!scopedTenantId || key.startsWith(`${scopedTenantId}:`)) &&
      (!cleanMiniVendorId || key.includes(`:${cleanMiniVendorId}:`))
    ) {
      socialCountCache.delete(key);
    }
  });
  socialStateCache.forEach((_, key) => {
    if (
      (!scopedTenantId || key.startsWith(`${scopedTenantId}:`)) &&
      (!cleanMiniVendorId || key.includes(`:${cleanMiniVendorId}:`))
    ) {
      socialStateCache.delete(key);
    }
  });
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

const isMissingMiniVendorSocialSchema = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof raw.code === "string" ? raw.code.trim().toLowerCase() : "";
  const message = [raw.message, raw.details]
    .map((entry) => (typeof entry === "string" ? entry.toLowerCase() : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");

  return (
    code === "42p01" ||
    message.includes("mini_vendor_followers") ||
    message.includes("mini_vendor_likes")
  );
};

const buildScopedKey = (...parts: Array<string | null | undefined>): string =>
  parts.map((entry) => asString(entry).trim() || "_").join(":");

export interface MiniVendorPublicProduct {
  id: string;
  nome: string;
  categoria: string;
  img: string;
  preco: number;
  likes: string[];
  status: "ativo" | "em_breve" | "esgotado";
  seller: {
    type: "tenant" | "mini_vendor";
    id: string;
    name: string;
    logoUrl: string;
  } | null;
}

export interface MiniVendorSocialViewerData {
  uid: string;
  nome: string;
  foto?: string;
  turma?: string;
}

export interface MiniVendorPublicBundle {
  profile: MiniVendorProfile;
  products: MiniVendorPublicProduct[];
  followersCount: number;
  likesCount: number;
  productsCount: number;
  isFollowing: boolean;
  isLiked: boolean;
}

const normalizeMiniVendorPublicProduct = (row: unknown): MiniVendorPublicProduct | null => {
  const data = asObject(row);
  if (!data) return null;
  const id = asString(data.id).trim();
  const nome = asString(data.nome).trim();
  if (!id || !nome) return null;

  const seller = asObject(data.seller);

  return {
    id,
    nome,
    categoria: asString(data.categoria).trim(),
    img: asString(data.img).trim(),
    preco: asNumber(data.preco, 0),
    likes: asStringArray(data.likes),
    status:
      asString(data.status).trim().toLowerCase() === "em_breve"
        ? "em_breve"
        : asString(data.status).trim().toLowerCase() === "esgotado"
        ? "esgotado"
        : "ativo",
    seller: seller
      ? {
          type: asString(seller.type).trim().toLowerCase() === "mini_vendor" ? "mini_vendor" : "tenant",
          id: asString(seller.id).trim(),
          name: asString(seller.name).trim(),
          logoUrl: asString(seller.logoUrl).trim(),
        }
      : null,
  };
};

async function countMiniVendorSocialRows(options: {
  table: "mini_vendor_followers" | "mini_vendor_likes";
  tenantId: string;
  miniVendorId: string;
  forceRefresh?: boolean;
}): Promise<number> {
  const tenantId = options.tenantId.trim();
  const miniVendorId = options.miniVendorId.trim();
  if (!tenantId || !miniVendorId) return 0;

  const cacheKey = buildScopedKey(tenantId, miniVendorId, options.table);
  if (!options.forceRefresh) {
    const cached = getCache(socialCountCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from(options.table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("mini_vendor_id", miniVendorId);

  if (error) {
    if (isMissingMiniVendorSocialSchema(error)) {
      setCache(socialCountCache, cacheKey, 0);
      return 0;
    }
    throwSupabaseError(error);
  }

  const normalized = count ?? 0;
  setCache(socialCountCache, cacheKey, normalized);
  return normalized;
}

async function readMiniVendorSocialState(options: {
  table: "mini_vendor_followers" | "mini_vendor_likes";
  tenantId: string;
  miniVendorId: string;
  userId?: string | null;
  forceRefresh?: boolean;
}): Promise<boolean> {
  const tenantId = options.tenantId.trim();
  const miniVendorId = options.miniVendorId.trim();
  const userId = asString(options.userId).trim();
  if (!tenantId || !miniVendorId || !userId) return false;

  const cacheKey = buildScopedKey(tenantId, miniVendorId, options.table, userId);
  if (!options.forceRefresh) {
    const cached = getCache(socialStateCache, cacheKey);
    if (cached !== null) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(options.table)
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("mini_vendor_id", miniVendorId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingMiniVendorSocialSchema(error)) {
      setCache(socialStateCache, cacheKey, false);
      return false;
    }
    throwSupabaseError(error);
  }

  const normalized = Boolean(data);
  setCache(socialStateCache, cacheKey, normalized);
  return normalized;
}

export async function fetchMiniVendorPublicBundle(options: {
  tenantId?: string | null;
  miniVendorId: string;
  viewerUid?: string | null;
  forceRefresh?: boolean;
  maxProducts?: number;
  userPlanNames?: Array<string | null | undefined>;
  userPlanIds?: Array<string | null | undefined>;
}): Promise<MiniVendorPublicBundle | null> {
  const tenantId = resolveTenantId(options.tenantId);
  const miniVendorId = options.miniVendorId.trim();
  const viewerUid = asString(options.viewerUid).trim();
  if (!tenantId || !miniVendorId) return null;

  const maxProducts = Math.max(1, Math.min(MAX_PRODUCTS, Math.floor(options.maxProducts ?? 12)));
  const forceRefresh = options.forceRefresh ?? false;
  const planNameKey = (options.userPlanNames ?? [])
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0)
    .join("|");
  const planIdKey = (options.userPlanIds ?? [])
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0)
    .join("|");
  const cacheKey = buildScopedKey(
    tenantId,
    miniVendorId,
    viewerUid || "anon",
    String(maxProducts),
    planNameKey,
    planIdKey
  );

  if (!forceRefresh) {
    const cached = getCache(bundleCache, cacheKey);
    if (cached !== null || bundleCache.has(cacheKey)) return cached;
  }

  const profile = await fetchMiniVendorProfileById({
    tenantId,
    miniVendorId,
    forceRefresh,
  });
  if (!profile || profile.status !== "approved") {
    setCache(bundleCache, cacheKey, null);
    return null;
  }

  const [productsRows, followersCount, likesCount, isFollowing, isLiked] = await Promise.all([
    fetchStoreProductsBySeller({
      seller: { type: "mini_vendor", id: miniVendorId },
      tenantId,
      maxResults: maxProducts,
      forceRefresh,
      userPlanNames: options.userPlanNames,
      userPlanIds: options.userPlanIds,
    }),
    countMiniVendorSocialRows({
      table: "mini_vendor_followers",
      tenantId,
      miniVendorId,
      forceRefresh,
    }),
    countMiniVendorSocialRows({
      table: "mini_vendor_likes",
      tenantId,
      miniVendorId,
      forceRefresh,
    }),
    readMiniVendorSocialState({
      table: "mini_vendor_followers",
      tenantId,
      miniVendorId,
      userId: viewerUid,
      forceRefresh,
    }),
    readMiniVendorSocialState({
      table: "mini_vendor_likes",
      tenantId,
      miniVendorId,
      userId: viewerUid,
      forceRefresh,
    }),
  ]);

  const products = productsRows
    .map((row) => normalizeMiniVendorPublicProduct(row))
    .filter((row): row is MiniVendorPublicProduct => row !== null);

  const bundle: MiniVendorPublicBundle = {
    profile,
    products,
    followersCount,
    likesCount,
    productsCount: products.length,
    isFollowing,
    isLiked,
  };

  setCache(bundleCache, cacheKey, bundle);
  return bundle;
}

async function toggleMiniVendorSocialRow(options: {
  table: "mini_vendor_followers" | "mini_vendor_likes";
  tenantId?: string | null;
  miniVendorId: string;
  viewer: MiniVendorSocialViewerData;
  currentlyActive: boolean;
}): Promise<{ active: boolean; count: number; ownerUserId: string; miniVendorName: string }> {
  const tenantId = resolveTenantId(options.tenantId);
  const miniVendorId = options.miniVendorId.trim();
  const viewerUid = options.viewer.uid.trim();
  if (!tenantId || !miniVendorId || !viewerUid) {
    throw new Error("Mini vendor invalido.");
  }

  const profile = await fetchMiniVendorProfileById({
    tenantId,
    miniVendorId,
    forceRefresh: true,
  });
  if (!profile || profile.status !== "approved") {
    throw new Error("Mini vendor indisponivel no momento.");
  }
  if (profile.userId === viewerUid) {
    throw new Error("Voce nao pode interagir com a propria lojinha.");
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from(options.table)
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("mini_vendor_id", miniVendorId)
    .eq("user_id", viewerUid)
    .maybeSingle();

  if (existingError) {
    if (isMissingMiniVendorSocialSchema(existingError)) {
      throw new Error("Ative as tabelas sociais do mini vendor no Supabase para usar curtir e seguir.");
    }
    throwSupabaseError(existingError);
  }

  const shouldRemove = options.currentlyActive || Boolean(existing);

  if (shouldRemove) {
    const { error } = await supabase
      .from(options.table)
      .delete()
      .eq("tenant_id", tenantId)
      .eq("mini_vendor_id", miniVendorId)
      .eq("user_id", viewerUid);
    if (error) throwSupabaseError(error);
  } else {
    const timeField = options.table === "mini_vendor_followers" ? "followed_at" : "liked_at";
    const { error } = await supabase
      .from(options.table)
      .upsert(
        {
          tenant_id: tenantId,
          mini_vendor_id: miniVendorId,
          user_id: viewerUid,
          user_name: options.viewer.nome.trim().slice(0, 120) || "Atleta",
          user_avatar: asString(options.viewer.foto).trim().slice(0, 400) || null,
          user_turma: asString(options.viewer.turma).trim().slice(0, 60) || null,
          [timeField]: nowIso(),
          created_at: nowIso(),
        },
        { onConflict: "tenant_id,mini_vendor_id,user_id" }
      );
    if (error) throwSupabaseError(error);

    void supabase.from("notifications").insert({
      tenant_id: tenantId,
      userId: profile.userId,
      title: options.table === "mini_vendor_followers" ? "Novo Seguidor na Loja" : "Nova Curtida na Loja",
      message:
        options.table === "mini_vendor_followers"
          ? `${options.viewer.nome.trim() || "Um usuario"} comecou a seguir sua lojinha.`
          : `${options.viewer.nome.trim() || "Um usuario"} curtiu sua lojinha.`,
      link: `/perfil/mini-vendor/${miniVendorId}`,
      read: false,
      type: "social",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  clearMiniVendorPublicCaches(tenantId, miniVendorId);
  const count = await countMiniVendorSocialRows({
    table: options.table,
    tenantId,
    miniVendorId,
    forceRefresh: true,
  });
  setCache(
    socialStateCache,
    buildScopedKey(tenantId, miniVendorId, options.table, viewerUid),
    !shouldRemove
  );

  return {
    active: !shouldRemove,
    count,
    ownerUserId: profile.userId,
    miniVendorName: profile.storeName,
  };
}

export async function toggleFollowMiniVendor(payload: {
  tenantId?: string | null;
  miniVendorId: string;
  viewer: MiniVendorSocialViewerData;
  currentlyFollowing: boolean;
}): Promise<{ isFollowing: boolean; followersCount: number }> {
  const result = await toggleMiniVendorSocialRow({
    table: "mini_vendor_followers",
    tenantId: payload.tenantId,
    miniVendorId: payload.miniVendorId,
    viewer: payload.viewer,
    currentlyActive: payload.currentlyFollowing,
  });

  return {
    isFollowing: result.active,
    followersCount: result.count,
  };
}

export async function toggleLikeMiniVendor(payload: {
  tenantId?: string | null;
  miniVendorId: string;
  viewer: MiniVendorSocialViewerData;
  currentlyLiked: boolean;
}): Promise<{ isLiked: boolean; likesCount: number }> {
  const result = await toggleMiniVendorSocialRow({
    table: "mini_vendor_likes",
    tenantId: payload.tenantId,
    miniVendorId: payload.miniVendorId,
    viewer: payload.viewer,
    currentlyActive: payload.currentlyLiked,
  });

  return {
    isLiked: result.active,
    likesCount: result.count,
  };
}
