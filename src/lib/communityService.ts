import { getSupabaseClient } from "./supabase";
import {
  asStringArray,
  boundedLimit,
  incrementUserStats,
  normalizeRowTimestamps,
  throwSupabaseError,
  toggleArrayValue,
  type Row,
} from "./supabaseData";

type RawData = Record<string, unknown>;

export type QueryRow<T extends RawData = RawData> = {
  id: string;
  data: T;
};

const MAX_FEED_RESULTS = 40;
const MAX_ADMIN_POST_RESULTS = 80;
const MAX_REPORT_RESULTS = 80;
const MAX_COMMENT_RESULTS = 60;

const nowIso = (): string => new Date().toISOString();

const mapRow = (row: Row): QueryRow => ({
  id: String(row.id || ""),
  data: normalizeRowTimestamps(row) as RawData,
});

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

  return normalizeRowTimestamps(data as Row) as RawData;
}

export async function saveCommunityConfig(config: RawData): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Row = {
    id: "comunidade",
    updatedAt: nowIso(),
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
  return rows.map((row) => mapRow(row));
}

export async function fetchCommunityAdminPosts(
  maxResults = MAX_ADMIN_POST_RESULTS
): Promise<QueryRow[]> {
  const rows = await selectRows("posts", {
    orderBy: { column: "createdAt", ascending: false },
    limit: boundedLimit(maxResults, MAX_ADMIN_POST_RESULTS),
  });
  return rows.map((row) => mapRow(row));
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
  return ((data ?? []) as Row[]).map((row) => mapRow(row));
}

export async function createCommunityPost(payload: RawData): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const insertPayload = {
    ...payload,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const { data, error } = await supabase
    .from("posts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) throwSupabaseError(error);

  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
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
  const insertPayload = {
    postId,
    ...payload.data,
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

  const userId = typeof payload.data.userId === "string" ? payload.data.userId.trim() : "";
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
