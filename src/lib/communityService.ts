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

const nowIso = (): string => new Date().toISOString();
const daysAgoIso = (days: number): string => {
  const value = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const date = new Date();
  date.setDate(date.getDate() - value);
  return date.toISOString();
};

const sanitizeCategoryName = (value: string): string =>
  normalizeCommunityCategoryName(value);

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
  const categorias = normalizeCommunityCategories(data.categorias);
  return {
    ...normalized,
    categorias,
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
    eq?: Record<string, string | boolean>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
  }
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select("*");

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
  return (data ?? []) as Row[];
}

async function selectSinglePost(postId: string): Promise<Row | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();

  if (error) throwSupabaseError(error);
  return (data as Row | null) ?? null;
}

async function updatePostCommentCount(postId: string, delta: number): Promise<void> {
  if (!delta) return;
  const post = await selectSinglePost(postId);
  if (!post) return;

  const currentCount =
    typeof post.comentarios === "number" && Number.isFinite(post.comentarios)
      ? post.comentarios
      : 0;

  const nextCount = Math.max(0, currentCount + delta);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("posts")
    .update({
      comentarios: nextCount,
      updatedAt: nowIso(),
    })
    .eq("id", postId);

  if (error) throwSupabaseError(error);
}

async function updatePostArrayField(
  postId: string,
  field: "likes" | "hype",
  userId: string
): Promise<{ values: string[]; changed: boolean; active: boolean; authorId: string | null }> {
  const post = await selectSinglePost(postId);
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
  const { error } = await supabase
    .from("posts")
    .update({
      [field]: nextValues,
      updatedAt: nowIso(),
    })
    .eq("id", postId);

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
  userId: string
): Promise<{ values: string[]; changed: boolean; active: boolean; authorId: string | null }> {
  const supabase = getSupabaseClient();
  const { data: row, error: selectError } = await supabase
    .from("posts_comments")
    .select("id, likes, userId")
    .eq("id", commentId)
    .eq("postId", postId)
    .maybeSingle();

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

  const { error: updateError } = await supabase
    .from("posts_comments")
    .update({
      likes: nextValues,
      updatedAt: nowIso(),
    })
    .eq("id", commentId)
    .eq("postId", postId);

  if (updateError) throwSupabaseError(updateError);

  return {
    values: nextValues,
    changed: true,
    active: nextValues.includes(userId),
    authorId: typeof row.userId === "string" ? row.userId : null,
  };
}

export async function fetchCommunityConfig(): Promise<RawData | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("*")
    .eq("id", "comunidade")
    .maybeSingle();

  if (error) throwSupabaseError(error);
  if (!data) return null;

  return normalizeCommunityConfigRow(data as Row);
}

export async function saveCommunityConfig(config: RawData): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: currentData, error: currentError } = await supabase
    .from("app_config")
    .select("data")
    .eq("id", "comunidade")
    .maybeSingle();
  if (currentError) throwSupabaseError(currentError);

  const currentConfigData = asObject(currentData?.data) ?? {};
  const nextConfigData: Row = { ...currentConfigData };

  if ("categorias" in config) {
    nextConfigData.categorias = normalizeCommunityCategories(config.categorias);
  } else if (!Array.isArray(nextConfigData.categorias)) {
    nextConfigData.categorias = [...DEFAULT_COMMUNITY_CATEGORIES];
  }

  const payload: Row = {
    id: "comunidade",
    updatedAt: nowIso(),
    data: nextConfigData,
  };

  for (const key of ["titulo", "subtitulo", "capaUrl", "limitMessages"]) {
    if (key in config) {
      payload[key] = config[key];
    }
  }

  const { error } = await supabase.from("app_config").upsert(payload, { onConflict: "id" });
  if (error) throwSupabaseError(error);
}

export async function fetchCommunityFeed(maxResults = MAX_FEED_RESULTS): Promise<QueryRow[]> {
  const rows = await selectRows("posts", {
    orderBy: { column: "createdAt", ascending: false },
    limit: boundedLimit(maxResults, MAX_FEED_RESULTS),
  });
  const enriched = await applyCommunityAuthorVisuals(rows);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityFeedByCategory(payload: {
  categoria: string;
  maxResults?: number;
  includeBlocked?: boolean;
}): Promise<QueryRow[]> {
  const categoria = sanitizeCategoryName(payload.categoria);
  if (!categoria) return [];

  const supabase = getSupabaseClient();
  let query = supabase
    .from("posts")
    .select("*")
    .eq("categoria", categoria)
    .order("createdAt", { ascending: false })
    .limit(boundedLimit(payload.maxResults ?? 120, MAX_FEED_RESULTS));

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
}): Promise<Record<string, number>> {
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
  maxResults = MAX_ADMIN_POST_RESULTS
): Promise<QueryRow[]> {
  const rows = await selectRows("posts", {
    orderBy: { column: "createdAt", ascending: false },
    limit: boundedLimit(maxResults, MAX_ADMIN_POST_RESULTS),
  });
  const enriched = await applyCommunityAuthorVisuals(rows);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityReports(
  maxResults = MAX_REPORT_RESULTS
): Promise<QueryRow[]> {
  const rows = await selectRows("denuncias", {
    orderBy: { column: "timestamp", ascending: false },
    limit: boundedLimit(maxResults, MAX_REPORT_RESULTS),
  });
  return rows.map((row) => normalizeReportRow(row));
}

export async function fetchCommunityComments(
  postId: string,
  options?: { maxResults?: number; order?: "asc" | "desc" }
): Promise<QueryRow[]> {
  const cleanPostId = postId.trim();
  if (!cleanPostId) return [];

  const supabase = getSupabaseClient();
  const maxResults = boundedLimit(
    options?.maxResults ?? MAX_COMMENT_RESULTS,
    MAX_COMMENT_RESULTS
  );
  const ascending = (options?.order ?? "asc") === "asc";

  const { data, error } = await supabase
    .from("posts_comments")
    .select("*")
    .eq("postId", cleanPostId)
    .order("createdAt", { ascending })
    .limit(maxResults);

  if (error) throwSupabaseError(error);
  const enriched = await applyCommunityAuthorVisuals((data ?? []) as Row[]);
  return enriched.map((row) => mapRow(row));
}

export async function fetchCommunityCommentPostId(commentId: string): Promise<string | null> {
  const cleanCommentId = commentId.trim();
  if (!cleanCommentId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("posts_comments")
    .select("postId")
    .eq("id", cleanCommentId)
    .maybeSingle();

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
    .select('categoria, "categoriaKey", "readAt"')
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
}): Promise<Record<string, number>> {
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

export async function createCommunityPost(payload: RawData): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const visuals = userId ? await fetchCanonicalUserVisuals([userId]) : new Map();
  const visual = userId ? visuals.get(userId) : undefined;

  const visualPatch: Row = visual
    ? {
        userName: visual.nome || payload.userName,
        avatar: visual.foto || payload.avatar,
        handle: visual.apelido ? `@${visual.apelido}` : payload.handle,
        role: visual.role || payload.role,
        plano: visual.plano,
        plano_cor: visual.plano_cor,
        plano_icon: visual.plano_icon,
        patente: visual.patente,
        patente_icon: visual.patente_icon,
        patente_cor: visual.patente_cor,
      }
    : {};

  const insertPayload = {
    ...payload,
    ...visualPatch,
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
}): Promise<{ id: string }> {
  const postId = payload.postId.trim();
  if (!postId) return { id: "" };

  const supabase = getSupabaseClient();
  const userId = typeof payload.data.userId === "string" ? payload.data.userId.trim() : "";
  const visuals = userId ? await fetchCanonicalUserVisuals([userId]) : new Map();
  const visual = userId ? visuals.get(userId) : undefined;

  const visualPatch: Row = visual
    ? {
        userName: visual.nome || payload.data.userName,
        avatar: visual.foto || payload.data.avatar,
        role: visual.role || payload.data.role,
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
    ...payload.data,
    ...visualPatch,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const { data, error } = await supabase
    .from("posts_comments")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) throwSupabaseError(error);

  await updatePostCommentCount(postId, 1);

  if (userId) {
    await incrementUserStats(userId, { commentsCount: 1 });
  }

  return { id: String(data?.id || "") };
}

export async function deleteCommunityPost(postId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throwSupabaseError(error);
}

export async function deleteCommunityComment(postId: string, commentId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("posts_comments")
    .delete()
    .eq("id", commentId)
    .eq("postId", postId);

  if (error) throwSupabaseError(error);
  await updatePostCommentCount(postId, -1);
}

export async function createCommunityReport(payload: {
  targetId: string;
  targetType: "post" | "comment";
  postText: string;
  reporterId: string;
  reason: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const insertPayload = {
    targetId: payload.targetId,
    targetType: payload.targetType,
    postText: payload.postText,
    reporterId: payload.reporterId,
    reason: payload.reason,
    timestamp: nowIso(),
    status: "pendente",
  };

  const { error } = await supabase.from("denuncias").insert(insertPayload);
  if (error) throwSupabaseError(error);

  if (payload.targetType === "post") {
    const post = await selectSinglePost(payload.targetId);
    if (!post) return;
    const currentCount =
      typeof post.denunciasCount === "number" && Number.isFinite(post.denunciasCount)
        ? post.denunciasCount
        : 0;
    const { error: updateError } = await supabase
      .from("posts")
      .update({
        denunciasCount: currentCount + 1,
        updatedAt: nowIso(),
      })
      .eq("id", payload.targetId);
    if (updateError) throwSupabaseError(updateError);
  }
}

export async function setCommunityPostPatch(
  postId: string,
  patch: Partial<Pick<RawData, "blocked" | "commentsDisabled" | "fixado">>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("posts")
    .update({
      ...patch,
      updatedAt: nowIso(),
    })
    .eq("id", postId);

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
}): Promise<{ values: string[]; active: boolean; authorId: string | null }> {
  const result = await updatePostArrayField(payload.postId, payload.field, payload.userId);

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
}): Promise<{ values: string[]; active: boolean; authorId: string | null }> {
  const result = await updateCommentLikes(payload.postId, payload.commentId, payload.userId);

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
