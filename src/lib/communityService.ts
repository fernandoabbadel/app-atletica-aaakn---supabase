import { getSupabaseClient } from "./supabase";
import {
  asObject,
  asString,
  asStringArray,
  boundedLimit,
  incrementUserStats,
  normalizeRowTimestamps,
  throwSupabaseError,
  toggleArrayValue,
  type Row,
} from "./supabaseData";
import { fetchCanonicalUserVisuals } from "./userVisualsService";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import {
  DEFAULT_COMMUNITY_CATEGORIES,
  normalizeCommunityCategories,
  normalizeCommunityCategoryName,
} from "../constants/communityCategories";

type RawData = Record<string, unknown>;

export type QueryRow<T extends RawData = RawData> = {
  id: string;
  data: T;
};

export interface BadgeCategory {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
}

export interface Badge {
  id: string;
  name: string;
  image_url: string;
  points: number;
  category_id: string;
  is_active: boolean;
}

export interface CategoryWithBadges extends BadgeCategory {
  badges: Badge[];
}

const MAX_FEED_RESULTS = 220;
const MAX_ADMIN_POST_RESULTS = 80;
const MAX_REPORT_RESULTS = 80;
const MAX_COMMENT_RESULTS = 60;
const DEFAULT_UNREAD_SINCE_DAYS = 90;
const DEFAULT_RECENT_CATEGORY_WINDOW_DAYS = 2;
const COMMUNITY_READS_TABLE = "community_category_reads";
const COMMUNITY_POSTS_SELECT_COLUMNS =
  "id,userId,userName,avatar,handle,role,plano,plano_cor,plano_icon,patente,patente_icon,patente_cor,texto,imagem,categoria,likes,hype,comentarios,blocked,commentsDisabled,fixado,denunciasCount,createdAt,updatedAt";
const COMMUNITY_REPORTS_SELECT_COLUMNS =
  "id,targetId,targetType,postText,reporterId,reporterName,reason,status,timestamp,reviewedAt,reviewedBy";
const COMMUNITY_COMMENTS_SELECT_COLUMNS =
  "id,postId,userId,userName,avatar,role,plano,plano_cor,plano_icon,patente,patente_icon,patente_cor,texto,likes,hidden,reports,createdAt,updatedAt";
const COMMUNITY_CONFIG_SELECT_COLUMNS = "id,data,titulo,subtitulo,capaUrl,limitMessages,updatedAt";

const nowIso = (): string => new Date().toISOString();
const daysAgoIso = (days: number): string => {
  const value = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const date = new Date();
  date.setDate(date.getDate() - value);
  return date.toISOString();
};

const sanitizeCategoryName = (value: string): string =>
  normalizeCommunityCategoryName(value);

const resolveCommunityTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const toCategoryKey = (value: string): string =>
  sanitizeCategoryName(value).toLowerCase();

const isMissingRelationError = (error: { code?: string | null; message?: string | null }): boolean =>
  error.code === "42P01" ||
  error.code === "PGRST205" ||
  (typeof error.message === "string" && error.message.toLowerCase().includes("does not exist"));

const normalizeCategoryReads = (
  value: unknown,
  categories?: string[]
): Record<string, string> => {
  const data = asObject(value);
  if (!data) return {};

  const allowed = categories?.map((item) => toCategoryKey(item)) ?? [];
  const allowedSet = new Set(allowed);
  const reads: Record<string, string> = {};

  Object.entries(data).forEach(([rawKey, rawValue]) => {
    const key = toCategoryKey(rawKey);
    if (!key) return;
    if (allowedSet.size > 0 && !allowedSet.has(key)) return;
    if (typeof rawValue !== "string") return;
    const iso = rawValue.trim();
    if (!iso) return;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return;
    reads[key] = new Date(parsed).toISOString();
  });

  return reads;
};

const normalizeCommunityConfigRow = (row: Row): RawData => {
  const normalized = normalizeRowTimestamps(row) as RawData;
  const data = asObject(normalized.data) ?? {};
  const titulo = asString(normalized.titulo || data.titulo).trim();
  const subtitulo = asString(normalized.subtitulo || data.subtitulo).trim();
  const capaUrl = asString(normalized.capaUrl || data.capaUrl).trim();
  const limitMessages =
    typeof normalized.limitMessages === "boolean"
      ? normalized.limitMessages
      : typeof data.limitMessages === "boolean"
        ? data.limitMessages
        : true;
  const categorias = normalizeCommunityCategories(
    normalized.categorias ?? data.categorias
  );
  return {
    ...normalized,
    titulo,
    subtitulo,
    capaUrl,
    limitMessages,
    categorias,
    data: {
      ...data,
      titulo,
      subtitulo,
      capaUrl,
      limitMessages,
      categorias,
    },
  };
};

const mapRow = (row: Row): QueryRow => ({
  id: String(row.id || ""),
  data: normalizeRowTimestamps(row) as RawData,
});

const applyCommunityAuthorVisuals = async (rows: Row[]): Promise<Row[]> => {
  if (rows.length === 0) return rows;

  const userIds = rows
    .map((row) => (typeof row.userId === "string" ? row.userId.trim() : ""))
    .filter((value): value is string => value.length > 0);

  if (userIds.length === 0) return rows;

  const visuals = await fetchCanonicalUserVisuals(userIds);
  if (visuals.size === 0) return rows;

  return rows.map((row) => {
    const userId = typeof row.userId === "string" ? row.userId.trim() : "";
    if (!userId) return row;

    const visual = visuals.get(userId);
    if (!visual) return row;

    const next: Row = { ...row };

    next.userName = visual.nome || asString(row.userName).trim();
    next.avatar = visual.foto || asString(row.avatar).trim();
    next.handle = visual.apelido ? `@${visual.apelido}` : asString(row.handle).trim();
    next.role = visual.role || asString(row.role).trim();
    next.plano = visual.plano;
    next.plano_cor = visual.plano_cor;
    next.plano_icon = visual.plano_icon;
    next.patente = visual.patente;
    next.patente_icon = visual.patente_icon;
    next.patente_cor = visual.patente_cor;

    return next;
  });
};

export async function getCategoriesWithBadges(): Promise<CategoryWithBadges[]> {
  const supabase = getSupabaseClient();

  try {
    const [categoriesResult, badgesResult] = await Promise.all([
      supabase
        .from("badge_categories")
        .select("id, name, description, display_order")
        .order("display_order", { ascending: true }),
      supabase
        .from("badges")
        .select("id, name, image_url, points, category_id, is_active")
        .eq("is_active", true)
        .limit(1000),
    ]);

    if (categoriesResult.error) {
      console.error("Erro ao buscar categorias de badges:", categoriesResult.error);
      throwSupabaseError(categoriesResult.error);
    }

    if (badgesResult.error) {
      console.error("Erro ao buscar badges ativos:", badgesResult.error);
      throwSupabaseError(badgesResult.error);
    }

    const categories = (categoriesResult.data ?? []) as BadgeCategory[];
    const allBadges = (badgesResult.data ?? []) as Badge[];
    const badgesByCategory = new Map<string, Badge[]>();

    allBadges.forEach((badge) => {
      const existing = badgesByCategory.get(badge.category_id);
      if (existing) {
        existing.push(badge);
        return;
      }
      badgesByCategory.set(badge.category_id, [badge]);
    });

    return categories.map((category) => ({
      ...category,
      badges: badgesByCategory.get(category.id) ?? [],
    }));
  } catch (error: unknown) {
    console.error("Erro critico em getCategoriesWithBadges:", error);
    return [];
  }
}

const normalizeReportRow = (row: Row): QueryRow => {
  const normalized = normalizeRowTimestamps(row, ["timestamp", "reviewedAt"]);
  const next: Row = { ...normalized };

  // Compatibilidade com UI antiga que espera `postId` em vez de `targetId`.
  if (!("postId" in next) && "targetId" in next) {
    next.postId = next.targetId;
  }

  return {
    id: String(next.id || ""),
    data: next as RawData,
  };
};

async function selectRows(
  table: string,
  options?: {
    selectColumns?: string;
    eq?: Record<string, string | boolean>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
  }
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const selectColumns =
    options?.selectColumns ??
    (table === "posts"
      ? COMMUNITY_POSTS_SELECT_COLUMNS
      : table === "denuncias"
      ? COMMUNITY_REPORTS_SELECT_COLUMNS
      : table === "posts_comments"
      ? COMMUNITY_COMMENTS_SELECT_COLUMNS
      : "id");
  let query = supabase.from(table).select(selectColumns);

  if (options?.eq) {
    for (const [column, value] of Object.entries(options.eq)) {
      query = query.eq(column, value);
    }
  }

  if (options?.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: options.orderBy.ascending ?? true,
    });
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return (data ?? []) as unknown as Row[];
}

async function selectSinglePost(postId: string, tenantId?: string): Promise<Row | null> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(tenantId);
  let query = supabase
    .from("posts")
    .select("id,userId,comentarios,likes,hype,denunciasCount")
    .eq("id", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as Row | null) ?? null;
}

async function updatePostCommentCount(
  postId: string,
  delta: number,
  tenantId?: string
): Promise<void> {
  if (!delta) return;
  const scopedTenantId = resolveCommunityTenantId(tenantId);
  const post = await selectSinglePost(postId, scopedTenantId);
  if (!post) return;

  const currentCount =
    typeof post.comentarios === "number" && Number.isFinite(post.comentarios)
      ? post.comentarios
      : 0;

  const nextCount = Math.max(0, currentCount + delta);
  const supabase = getSupabaseClient();
  let query = supabase
    .from("posts")
    .update({
      comentarios: nextCount,
      updatedAt: nowIso(),
    })
    .eq("id", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;

  if (error) throwSupabaseError(error);
}

async function updatePostArrayField(
  postId: string,
  field: "likes" | "hype",
  userId: string,
  tenantId?: string
): Promise<{ values: string[]; changed: boolean; active: boolean; authorId: string | null }> {
  const scopedTenantId = resolveCommunityTenantId(tenantId);
  const post = await selectSinglePost(postId, scopedTenantId);
  if (!post) {
    return { values: [], changed: false, active: false, authorId: null };
  }

  const currentValues = asStringArray(post[field]);
  const nextValues = toggleArrayValue(currentValues, userId);
  const changed = nextValues.length !== currentValues.length;

  if (!changed) {
    return {
      values: currentValues,
      changed: false,
      active: currentValues.includes(userId),
      authorId: typeof post.userId === "string" ? post.userId : null,
    };
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("posts")
    .update({
      [field]: nextValues,
      updatedAt: nowIso(),
    })
    .eq("id", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;

  if (error) throwSupabaseError(error);

  return {
    values: nextValues,
    changed: true,
    active: nextValues.includes(userId),
    authorId: typeof post.userId === "string" ? post.userId : null,
  };
}

async function updateCommentLikes(
  postId: string,
  commentId: string,
  userId: string,
  tenantId?: string
): Promise<{ values: string[]; changed: boolean; active: boolean; authorId: string | null }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(tenantId);
  let selectQuery = supabase
    .from("posts_comments")
    .select("id, likes, userId")
    .eq("id", commentId)
    .eq("postId", postId);
  if (scopedTenantId) {
    selectQuery = selectQuery.eq("tenant_id", scopedTenantId);
  }
  const { data: row, error: selectError } = await selectQuery.maybeSingle();

  if (selectError) throwSupabaseError(selectError);
  if (!row) return { values: [], changed: false, active: false, authorId: null };

  const currentValues = asStringArray(row.likes);
  const nextValues = toggleArrayValue(currentValues, userId);
  const changed = nextValues.length !== currentValues.length;

  if (!changed) {
    return {
      values: currentValues,
      changed: false,
      active: currentValues.includes(userId),
      authorId: typeof row.userId === "string" ? row.userId : null,
    };
  }

  let updateQuery = supabase
    .from("posts_comments")
    .update({
      likes: nextValues,
      updatedAt: nowIso(),
    })
    .eq("id", commentId)
    .eq("postId", postId);
  if (scopedTenantId) {
    updateQuery = updateQuery.eq("tenant_id", scopedTenantId);
  }
  const { error: updateError } = await updateQuery;

  if (updateError) throwSupabaseError(updateError);

  return {
    values: nextValues,
    changed: true,
    active: nextValues.includes(userId),
    authorId: typeof row.userId === "string" ? row.userId : null,
  };
}

const resolveCommunityConfigDocIds = (tenantId?: string): string[] => {
  const cleanTenantId = asString(tenantId).trim();
  if (!cleanTenantId) return ["comunidade"];
  return [buildTenantScopedRowId(cleanTenantId, "comunidade"), "comunidade"];
};

export async function fetchCommunityConfig(options?: {
  tenantId?: string;
}): Promise<RawData | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select(COMMUNITY_CONFIG_SELECT_COLUMNS)
    .in("id", resolveCommunityConfigDocIds(options?.tenantId));

  if (error) throwSupabaseError(error);
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const selected = resolveCommunityConfigDocIds(options?.tenantId)
    .map((docId) => rows.find((row) => asString(row.id) === docId))
    .find((entry) => Boolean(entry));
  if (!selected) return null;

  return normalizeCommunityConfigRow(selected as Row);
}

export async function saveCommunityConfig(
  config: RawData,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const docId = buildTenantScopedRowId(options?.tenantId, "comunidade") || "comunidade";
  const { data: currentData, error: currentError } = await supabase
    .from("app_config")
    .select("data")
    .eq("id", docId)
    .maybeSingle();
  if (currentError) throwSupabaseError(currentError);

  const currentConfigData = asObject(currentData?.data) ?? {};
  const nextConfigData: Row = { ...currentConfigData };

  const categorias =
    "categorias" in config
      ? normalizeCommunityCategories(config.categorias)
      : normalizeCommunityCategories(nextConfigData.categorias);
  const titulo = asString(config.titulo ?? nextConfigData.titulo).trim();
  const subtitulo = asString(config.subtitulo ?? nextConfigData.subtitulo).trim();
  const capaUrl = asString(config.capaUrl ?? nextConfigData.capaUrl).trim();
  const limitMessages =
    typeof config.limitMessages === "boolean"
      ? config.limitMessages
      : typeof nextConfigData.limitMessages === "boolean"
        ? nextConfigData.limitMessages
        : true;

  nextConfigData.categorias = categorias;
  nextConfigData.titulo = titulo;
  nextConfigData.subtitulo = subtitulo;
  nextConfigData.capaUrl = capaUrl;
  nextConfigData.limitMessages = limitMessages;

  const payload: Row = {
    id: docId,
    updatedAt: nowIso(),
    data: nextConfigData,
    titulo,
    subtitulo,
    capaUrl,
    limitMessages,
  };

  const { error } = await supabase.from("app_config").upsert(payload, { onConflict: "id" });
  if (error) throwSupabaseError(error);
}

export async function fetchCommunityFeed(
  maxResults = MAX_FEED_RESULTS,
  options?: { tenantId?: string }
): Promise<QueryRow[]> {
  const tenantId = resolveCommunityTenantId(options?.tenantId);
  const rows = await selectRows("posts", {
    orderBy: { column: "createdAt", ascending: false },
    limit: boundedLimit(maxResults, MAX_FEED_RESULTS),
    ...(tenantId ? { eq: { tenant_id: tenantId } } : {}),
  });
  const enriched = await applyCommunityAuthorVisuals(rows);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityFeedByCategory(payload: {
  categoria: string;
  maxResults?: number;
  includeBlocked?: boolean;
  tenantId?: string;
}): Promise<QueryRow[]> {
  const categoria = sanitizeCategoryName(payload.categoria);
  if (!categoria) return [];
  const tenantId = resolveCommunityTenantId(payload.tenantId);

  const supabase = getSupabaseClient();
  let query = supabase
    .from("posts")
    .select(COMMUNITY_POSTS_SELECT_COLUMNS)
    .eq("categoria", categoria)
    .order("createdAt", { ascending: false })
    .limit(boundedLimit(payload.maxResults ?? 120, MAX_FEED_RESULTS));

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  if (!payload.includeBlocked) {
    query = query.or("blocked.is.null,blocked.eq.false");
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  const enriched = await applyCommunityAuthorVisuals((data ?? []) as Row[]);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityRecentCategoryCounts(payload?: {
  categorias?: string[];
  includeBlocked?: boolean;
  windowDays?: number;
  tenantId?: string;
}): Promise<Record<string, number>> {
  const tenantId = resolveCommunityTenantId(payload?.tenantId);
  const categories =
    payload?.categorias && payload.categorias.length > 0
      ? normalizeCommunityCategories(payload.categorias)
      : [...DEFAULT_COMMUNITY_CATEGORIES];

  const counts: Record<string, number> = {};
  categories.forEach((item) => {
    counts[item] = 0;
  });

  if (categories.length === 0) return counts;

  const windowDays = Number.isFinite(payload?.windowDays)
    ? Math.max(1, Math.floor(payload?.windowDays ?? DEFAULT_RECENT_CATEGORY_WINDOW_DAYS))
    : DEFAULT_RECENT_CATEGORY_WINDOW_DAYS;
  const sinceIso = daysAgoIso(windowDays);
  const supabase = getSupabaseClient();

  await Promise.all(
    categories.map(async (categoria) => {
      let query = supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("categoria", categoria)
        .gte("createdAt", sinceIso);

      if (tenantId) {
        query = query.eq("tenant_id", tenantId);
      }

      if (!payload?.includeBlocked) {
        query = query.or("blocked.is.null,blocked.eq.false");
      }

      const { count, error } = await query;
      if (error) throwSupabaseError(error);
      counts[categoria] = typeof count === "number" && Number.isFinite(count) ? count : 0;
    })
  );

  return counts;
}

export async function fetchCommunityAdminPosts(
  maxResults = MAX_ADMIN_POST_RESULTS,
  options?: { tenantId?: string }
): Promise<QueryRow[]> {
  const tenantId = resolveCommunityTenantId(options?.tenantId);
  const rows = await selectRows("posts", {
    orderBy: { column: "createdAt", ascending: false },
    limit: boundedLimit(maxResults, MAX_ADMIN_POST_RESULTS),
    ...(tenantId ? { eq: { tenant_id: tenantId } } : {}),
  });
  const enriched = await applyCommunityAuthorVisuals(rows);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityReports(
  maxResults = MAX_REPORT_RESULTS,
  options?: { tenantId?: string }
): Promise<QueryRow[]> {
  const tenantId = resolveCommunityTenantId(options?.tenantId);
  const rows = await selectRows("denuncias", {
    orderBy: { column: "timestamp", ascending: false },
    limit: boundedLimit(maxResults, MAX_REPORT_RESULTS),
    ...(tenantId ? { eq: { tenant_id: tenantId } } : {}),
  });
  return rows.map((row) => normalizeReportRow(row));
}

export async function fetchCommunityComments(
  postId: string,
  options?: { maxResults?: number; order?: "asc" | "desc"; tenantId?: string }
): Promise<QueryRow[]> {
  const cleanPostId = postId.trim();
  if (!cleanPostId) return [];

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(options?.tenantId);
  const maxResults = boundedLimit(
    options?.maxResults ?? MAX_COMMENT_RESULTS,
    MAX_COMMENT_RESULTS
  );
  const ascending = (options?.order ?? "asc") === "asc";

  let query = supabase
    .from("posts_comments")
    .select(COMMUNITY_COMMENTS_SELECT_COLUMNS)
    .eq("postId", cleanPostId)
    .order("createdAt", { ascending });
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.limit(maxResults);

  if (error) throwSupabaseError(error);
  const enriched = await applyCommunityAuthorVisuals((data ?? []) as Row[]);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityCommentPostId(
  commentId: string,
  options?: { tenantId?: string }
): Promise<string | null> {
  const cleanCommentId = commentId.trim();
  if (!cleanCommentId) return null;

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(options?.tenantId);
  let query = supabase
    .from("posts_comments")
    .select("postId")
    .eq("id", cleanCommentId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();

  if (error) throwSupabaseError(error);

  const postId = typeof (data as Row | null)?.postId === "string"
    ? String((data as Row).postId).trim()
    : "";
  return postId || null;
}

export async function fetchCommunityReadMap(
  userId: string,
  categories?: string[]
): Promise<Record<string, string>> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return {};

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(COMMUNITY_READS_TABLE)
    .select("categoria,categoriaKey,readAt")
    .eq("userId", cleanUserId);

  if (error && !isMissingRelationError(error)) {
    throwSupabaseError(error);
  }

  if (Array.isArray(data) && data.length > 0) {
    const allowed = categories?.map((item) => toCategoryKey(item)) ?? [];
    const allowedSet = new Set(allowed);
    const reads: Record<string, string> = {};

    (data as Row[]).forEach((row) => {
      const categoriaKeyRaw =
        typeof row.categoriaKey === "string" && row.categoriaKey
          ? row.categoriaKey
          : typeof row.categoria === "string"
            ? row.categoria
            : "";
      const key = toCategoryKey(categoriaKeyRaw);
      if (!key) return;
      if (allowedSet.size > 0 && !allowedSet.has(key)) return;

      const readAtRaw = row.readAt;
      if (typeof readAtRaw !== "string") return;
      const parsed = Date.parse(readAtRaw);
      if (Number.isNaN(parsed)) return;
      reads[key] = new Date(parsed).toISOString();
    });

    if (Object.keys(reads).length > 0) {
      return reads;
    }
  }

  return fetchLegacyCommunityReadMap(cleanUserId, categories);
}

async function fetchLegacyCommunityReadMap(
  userId: string,
  categories?: string[]
): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", userId)
    .maybeSingle();

  if (error) throwSupabaseError(error);

  const extra = asObject(data?.extra) ?? {};
  const reads = normalizeCategoryReads(extra.communityReads, categories);
  return reads;
}

export async function markCommunityCategoryRead(payload: {
  userId: string;
  categoria: string;
  readAtIso?: string;
}): Promise<void> {
  const userId = payload.userId.trim();
  const categoria = sanitizeCategoryName(payload.categoria);
  if (!userId || !categoria) return;

  const key = toCategoryKey(categoria);
  const readAtMillis = payload.readAtIso ? Date.parse(payload.readAtIso) : NaN;
  const readAtIso = Number.isNaN(readAtMillis) ? nowIso() : new Date(readAtMillis).toISOString();

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(COMMUNITY_READS_TABLE)
    .upsert(
      {
        userId,
        categoria,
        categoriaKey: key,
        readAt: readAtIso,
        updatedAt: nowIso(),
      },
      { onConflict: "userId,categoriaKey" }
    );

  if (!error) return;
  if (!isMissingRelationError(error)) throwSupabaseError(error);

  await saveLegacyCommunityCategoryRead(userId, key, readAtIso);
}

async function saveLegacyCommunityCategoryRead(
  userId: string,
  categoriaKey: string,
  readAtIso: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: currentUser, error: currentError } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", userId)
    .maybeSingle();
  if (currentError) throwSupabaseError(currentError);

  const extra = asObject(currentUser?.extra) ?? {};
  const currentReads = normalizeCategoryReads(extra.communityReads);
  const nextReads: Row = {
    ...currentReads,
    [categoriaKey]: readAtIso,
  };

  const nextExtra: Row = {
    ...extra,
    communityReads: nextReads,
  };

  const { error } = await supabase
    .from("users")
    .update({
      extra: nextExtra,
      updatedAt: nowIso(),
    })
    .eq("uid", userId);

  if (error) throwSupabaseError(error);
}

export async function fetchCommunityUnreadCounts(payload: {
  userId: string;
  categorias: string[];
  includeBlocked?: boolean;
  unreadSinceDays?: number;
  tenantId?: string;
}): Promise<Record<string, number>> {
  const scopedTenantId = resolveCommunityTenantId(payload.tenantId);
  const userId = payload.userId.trim();
  const categories = normalizeCommunityCategories(payload.categorias);
  const counts: Record<string, number> = {};
  categories.forEach((categoria) => {
    counts[categoria] = 0;
  });

  if (!userId || categories.length === 0) return counts;

  const unreadSinceDays = Number.isFinite(payload.unreadSinceDays)
    ? Math.max(1, Math.floor(payload.unreadSinceDays ?? DEFAULT_UNREAD_SINCE_DAYS))
    : DEFAULT_UNREAD_SINCE_DAYS;
  const unreadSinceIso = daysAgoIso(unreadSinceDays);

  const reads = await fetchCommunityReadMap(userId, categories);
  const categoryByKey = new Map(categories.map((categoria) => [toCategoryKey(categoria), categoria]));
  const supabase = getSupabaseClient();

  await Promise.all(
    categories.map(async (categoria) => {
      const key = toCategoryKey(categoria);
      const readAtIso = reads[key] || unreadSinceIso;
      let query = supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("categoria", categoria)
        .gt("createdAt", readAtIso);

      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }

      if (!payload.includeBlocked) {
        query = query.or("blocked.is.null,blocked.eq.false");
      }

      const { count, error } = await query;
      if (error) {
        throwSupabaseError(error);
      }

      const categoryName = categoryByKey.get(key) || categoria;
      counts[categoryName] = typeof count === "number" && Number.isFinite(count) ? count : 0;
    })
  );

  return counts;
}

export async function createCommunityPost(
  payload: RawData,
  options?: { tenantId?: string }
): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(
    options?.tenantId ?? asString(payload.tenantId)
  );
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const visuals = userId ? await fetchCanonicalUserVisuals([userId]) : new Map();
  const visual = userId ? visuals.get(userId) : undefined;
  const payloadData: Row = { ...payload };
  delete payloadData.tenantId;

  const visualPatch: Row = visual
    ? {
        userName: visual.nome || payloadData.userName,
        avatar: visual.foto || payloadData.avatar,
        handle: visual.apelido ? `@${visual.apelido}` : payloadData.handle,
        role: visual.role || payloadData.role,
        plano: visual.plano,
        plano_cor: visual.plano_cor,
        plano_icon: visual.plano_icon,
        patente: visual.patente,
        patente_icon: visual.patente_icon,
        patente_cor: visual.patente_cor,
      }
    : {};

  const insertPayload = {
    ...payloadData,
    ...visualPatch,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const { data, error } = await supabase
    .from("posts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) throwSupabaseError(error);

  if (userId) {
    await incrementUserStats(userId, { postsCount: 1 });
  }

  return { id: String(data?.id || "") };
}

export async function createCommunityComment(payload: {
  postId: string;
  data: RawData;
  tenantId?: string;
}): Promise<{ id: string }> {
  const postId = payload.postId.trim();
  if (!postId) return { id: "" };

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(
    payload.tenantId ?? asString(payload.data.tenantId)
  );
  const userId = typeof payload.data.userId === "string" ? payload.data.userId.trim() : "";
  const visuals = userId ? await fetchCanonicalUserVisuals([userId]) : new Map();
  const visual = userId ? visuals.get(userId) : undefined;
  const payloadData: Row = { ...payload.data };
  delete payloadData.tenantId;

  let postLookup = supabase.from("posts").select("id").eq("id", postId);
  if (scopedTenantId) {
    postLookup = postLookup.eq("tenant_id", scopedTenantId);
  }
  const { data: postRow, error: postError } = await postLookup.maybeSingle();
  if (postError) throwSupabaseError(postError);
  if (!postRow) {
    throw new Error("Post fora do tenant ativo.");
  }

  const visualPatch: Row = visual
    ? {
        userName: visual.nome || payloadData.userName,
        avatar: visual.foto || payloadData.avatar,
        role: visual.role || payloadData.role,
        plano: visual.plano,
        plano_cor: visual.plano_cor,
        plano_icon: visual.plano_icon,
        patente: visual.patente,
        patente_icon: visual.patente_icon,
        patente_cor: visual.patente_cor,
      }
    : {};

  const insertPayload = {
    postId,
    ...payloadData,
    ...visualPatch,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const { data, error } = await supabase
    .from("posts_comments")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) throwSupabaseError(error);

  await updatePostCommentCount(postId, 1, scopedTenantId || undefined);

  if (userId) {
    await incrementUserStats(userId, { commentsCount: 1 });
  }

  return { id: String(data?.id || "") };
}

export async function deleteCommunityPost(
  postId: string,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(options?.tenantId);
  let query = supabase.from("posts").delete().eq("id", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;
  if (error) throwSupabaseError(error);
}

export async function deleteCommunityComment(
  postId: string,
  commentId: string,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(options?.tenantId);
  let query = supabase
    .from("posts_comments")
    .delete()
    .eq("id", commentId)
    .eq("postId", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;

  if (error) throwSupabaseError(error);
  await updatePostCommentCount(postId, -1, scopedTenantId || undefined);
}

export async function createCommunityReport(payload: {
  targetId: string;
  targetType: "post" | "comment";
  postText: string;
  reporterId: string;
  reason: string;
  tenantId?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(payload.tenantId);

  if (payload.targetType === "post") {
    const targetPost = await selectSinglePost(payload.targetId, scopedTenantId || undefined);
    if (!targetPost) {
      throw new Error("Post fora do tenant ativo.");
    }
  } else {
    let commentLookup = supabase
      .from("posts_comments")
      .select("id")
      .eq("id", payload.targetId);
    if (scopedTenantId) {
      commentLookup = commentLookup.eq("tenant_id", scopedTenantId);
    }
    const { data: commentRow, error: commentError } = await commentLookup.maybeSingle();
    if (commentError) throwSupabaseError(commentError);
    if (!commentRow) {
      throw new Error("Comentario fora do tenant ativo.");
    }
  }

  const insertPayload = {
    targetId: payload.targetId,
    targetType: payload.targetType,
    postText: payload.postText,
    reporterId: payload.reporterId,
    reason: payload.reason,
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    timestamp: nowIso(),
    status: "pendente",
  };

  const { error } = await supabase.from("denuncias").insert(insertPayload);
  if (error) throwSupabaseError(error);

  if (payload.targetType === "post") {
    const post = await selectSinglePost(payload.targetId, scopedTenantId || undefined);
    if (!post) return;
    const currentCount =
      typeof post.denunciasCount === "number" && Number.isFinite(post.denunciasCount)
        ? post.denunciasCount
        : 0;
    let query = supabase
      .from("posts")
      .update({
        denunciasCount: currentCount + 1,
        updatedAt: nowIso(),
      })
      .eq("id", payload.targetId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { error: updateError } = await query;
    if (updateError) throwSupabaseError(updateError);
  }
}

export async function setCommunityPostPatch(
  postId: string,
  patch: Partial<Pick<RawData, "blocked" | "commentsDisabled" | "fixado">>,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveCommunityTenantId(options?.tenantId);
  let query = supabase
    .from("posts")
    .update({
      ...patch,
      updatedAt: nowIso(),
    })
    .eq("id", postId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { error } = await query;

  if (error) throwSupabaseError(error);
}

export async function deleteCommunityReport(reportId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("denuncias").delete().eq("id", reportId);
  if (error) throwSupabaseError(error);
}

export async function toggleCommunityPostReaction(payload: {
  postId: string;
  field: "likes" | "hype";
  userId: string;
  tenantId?: string;
}): Promise<{ values: string[]; active: boolean; authorId: string | null }> {
  const result = await updatePostArrayField(
    payload.postId,
    payload.field,
    payload.userId,
    payload.tenantId
  );

  if (!result.changed) {
    return { values: result.values, active: result.active, authorId: result.authorId };
  }

  const diff = result.active ? 1 : -1;
  if (result.authorId && result.authorId !== payload.userId) {
    await incrementUserStats(result.authorId, {
      [payload.field === "likes" ? "likesReceived" : "hypesReceived"]: diff,
    });
  }

  await incrementUserStats(payload.userId, {
    [payload.field === "likes" ? "likesGiven" : "hypesGiven"]: diff,
  });

  return { values: result.values, active: result.active, authorId: result.authorId };
}

export async function toggleCommunityCommentLike(payload: {
  postId: string;
  commentId: string;
  userId: string;
  tenantId?: string;
}): Promise<{ values: string[]; active: boolean; authorId: string | null }> {
  const result = await updateCommentLikes(
    payload.postId,
    payload.commentId,
    payload.userId,
    payload.tenantId
  );

  if (!result.changed) {
    return { values: result.values, active: result.active, authorId: result.authorId };
  }

  const diff = result.active ? 1 : -1;
  if (result.authorId && result.authorId !== payload.userId) {
    await incrementUserStats(result.authorId, { likesReceived: diff });
  }
  await incrementUserStats(payload.userId, { likesGiven: diff });

  return { values: result.values, active: result.active, authorId: result.authorId };
}
