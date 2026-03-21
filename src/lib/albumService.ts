import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

const DEFAULT_AVATAR_URL = "https://github.com/shadcn.png";
const ALBUM_CAPTURES_TABLE = "album_captures";
const MAX_RANKING_RESULTS = 100;
const MAX_USERS_PER_CLASS = 150;
const MAX_USERS_PAGE_SIZE = 60;
const ALBUM_UI_DOC_COLLECTION = "app_config";
const ALBUM_UI_DOC_ID = "album_ui";
const ALBUM_SUMMARY_COLLECTION = "album_summary";
const READ_CACHE_TTL_MS = 120_000;
const ALBUM_RANKINGS_SELECT_COLUMNS =
  "id,userId,nome,foto,turma,totalColetado,scansT8,tenant_id";
const ALBUM_USERS_SELECT_COLUMNS =
  "uid,nome,turma,foto,apelido,dataNascimento,idadePublica,esportes,pets,cidadeOrigem,relacionamentoPublico,statusRelacionamento,bio,instagram,tenant_id";
const ALBUM_SUMMARY_SELECT_COLUMNS =
  "userId,totalCollected,capturedByTurma,lastCaptureId,lastCaptureAt,updatedAt,tenant_id";
const ALBUM_CONFIG_SELECT_COLUMNS = "id,capa,titulo,subtitulo,updatedAt";
const ALBUM_UI_SELECT_COLUMNS = "id,capa,titulo,subtitulo,updatedAt,data";
const ALBUM_CAPTURES_SELECT_COLUMNS = "id,collectorUserId,targetUserId,nome,turma,dataColada";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const rankingsCache = new Map<string, CacheEntry<AlbumRankingEntry[]>>();
const usersByTurmaCache = new Map<string, CacheEntry<AlbumUserEntry[]>>();
const usersByTurmaPageCache = new Map<string, CacheEntry<AlbumUsersPageResult>>();
const collectedIdsCache = new Map<string, CacheEntry<string[]>>();
const albumConfigCache = new Map<string, CacheEntry<AlbumCmsData | null>>();
const albumSummaryCache = new Map<string, CacheEntry<AlbumSummary | null>>();
const albumUiCache = new Map<string, CacheEntry<AlbumUiConfig | null>>();
const inflightRankingsCache = new Map<string, Promise<AlbumRankingEntry[]>>();
const inflightUsersByTurmaPageCache = new Map<string, Promise<AlbumUsersPageResult>>();
const inflightCollectedIdsCache = new Map<string, Promise<string[]>>();
const inflightAlbumConfigCache = new Map<string, Promise<AlbumCmsData | null>>();
const inflightAlbumSummaryCache = new Map<string, Promise<AlbumSummary | null>>();
const inflightAlbumUiCache = new Map<string, Promise<AlbumUiConfig | null>>();
const inflightEnsureSelfCollectedCache = new Map<string, Promise<void>>();

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const cleanTenantId = (value?: string): string =>
  resolveStoredTenantScopeId(asString(value).trim());

const nowIso = (): string => new Date().toISOString();

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

const boundedLimit = (requested: number, max: number): number => {
  if (!Number.isFinite(requested)) return max;
  if (requested < 1) return 1;
  if (requested > max) return max;
  return Math.floor(requested);
};

const getCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCacheValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T
): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const runWithInflight = async <T>(
  inflight: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>
): Promise<T> => {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fn();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
};

const resolveTenantCacheKey = (tenantId?: string): string => cleanTenantId(tenantId) || "default";

const buildTenantScopedCacheKey = (baseKey: string, tenantId?: string): string => {
  const cleanBaseKey = baseKey.trim();
  const cleanScopedTenantId = cleanTenantId(tenantId);
  if (!cleanScopedTenantId) return cleanBaseKey;
  return `${cleanScopedTenantId}::${cleanBaseKey}`;
};

const resolveScopedDocIds = (tenantId: string | undefined, baseId: string): string[] => {
  const cleanScopedTenantId = cleanTenantId(tenantId);
  if (!cleanScopedTenantId) return [baseId];
  return [buildTenantScopedRowId(cleanScopedTenantId, baseId)];
};

export interface AlbumRankingEntry {
  id: string;
  userId: string;
  nome: string;
  foto: string;
  turma: string;
  totalColetado: number;
  scansT8: number;
}

export interface AlbumUserEntry {
  id: string;
  nome: string;
  turma: string;
  foto?: string;
  apelido?: string;
  dataNascimento?: string;
  idadePublica?: boolean;
  esportes?: string[];
  pets?: string;
  cidadeOrigem?: string;
  relacionamentoPublico?: boolean;
  statusRelacionamento?: string;
  bio?: string;
  instagram?: string;
}

export interface AlbumUsersPageResult {
  users: AlbumUserEntry[];
  nextCursorId: string | null;
  hasMore: boolean;
}

export interface AlbumSummary {
  userId: string;
  totalCollected: number;
  capturedByTurma: Record<string, string[]>;
  lastCaptureId?: string;
  lastCaptureAt?: unknown;
  updatedAt?: unknown;
}

export interface AlbumCmsData {
  capa: string;
  titulo: string;
  subtitulo: string;
}

export interface AlbumUiConfig {
  capa: string;
  titulo: string;
  subtitulo: string;
}

export interface AlbumCollector {
  uid: string;
  nome: string;
  turma?: string;
  foto?: string;
}

export type AlbumCaptureStatus = "ok" | "duplicate" | "invalid-target";

export interface AlbumCaptureResult {
  status: AlbumCaptureStatus;
  targetName?: string;
  targetTurma?: string;
}

const toRankingEntry = (
  docId: string,
  raw: Record<string, unknown>
): AlbumRankingEntry => ({
  id: docId,
  userId: asString(raw.userId, docId),
  nome: asString(raw.nome, "Sem nome"),
  foto: asString(raw.foto, DEFAULT_AVATAR_URL),
  turma: asString(raw.turma, ""),
  totalColetado: asNumber(raw.totalColetado, 0),
  scansT8: asNumber(raw.scansT8, 0),
});

const toUserEntry = (
  docId: string,
  raw: Record<string, unknown>
): AlbumUserEntry => ({
  id: docId,
  nome: asString(raw.nome, "Sem nome"),
  turma: asString(raw.turma, ""),
  foto: asString(raw.foto) || undefined,
  apelido: asString(raw.apelido) || undefined,
  dataNascimento: asString(raw.dataNascimento) || undefined,
  idadePublica:
    typeof raw.idadePublica === "boolean" ? raw.idadePublica : undefined,
  esportes: Array.isArray(raw.esportes)
    ? raw.esportes.filter((item): item is string => typeof item === "string")
    : undefined,
  pets: asString(raw.pets) || undefined,
  cidadeOrigem: asString(raw.cidadeOrigem) || undefined,
  relacionamentoPublico:
    typeof raw.relacionamentoPublico === "boolean"
      ? raw.relacionamentoPublico
      : undefined,
  statusRelacionamento: asString(raw.statusRelacionamento) || undefined,
  bio: asString(raw.bio) || undefined,
  instagram: asString(raw.instagram) || undefined,
});

const toAlbumConfig = (raw: Record<string, unknown>): AlbumCmsData => ({
  capa: asString(raw.capa),
  titulo: asString(raw.titulo),
  subtitulo: asString(raw.subtitulo),
});

const toAlbumUiConfig = (raw: Record<string, unknown>): AlbumUiConfig => ({
  capa: asString(raw.capa),
  titulo: asString(raw.titulo),
  subtitulo: asString(raw.subtitulo),
});

const normalizeTurmaCode = (raw: unknown): string => {
  const turma = asString(raw).trim().toUpperCase();
  if (!turma) return "OUTROS";
  if (/^T\d{1,2}$/.test(turma)) return turma;
  return "OUTROS";
};

const toCapturedByTurma = (raw: unknown): Record<string, string[]> => {
  if (typeof raw !== "object" || raw === null) return {};

  const map = raw as Record<string, unknown>;
  const normalized: Record<string, string[]> = {};

  Object.entries(map).forEach(([turmaRaw, idsRaw]) => {
    if (!Array.isArray(idsRaw)) return;
    const turma = normalizeTurmaCode(turmaRaw);
    const ids = Array.from(
      new Set(
        idsRaw
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    normalized[turma] = ids;
  });

  return normalized;
};

const toAlbumSummary = (
  userId: string,
  raw: Record<string, unknown>
): AlbumSummary => ({
  userId: asString(raw.userId, userId),
  totalCollected: asNumber(raw.totalCollected, 0),
  capturedByTurma: toCapturedByTurma(raw.capturedByTurma),
  lastCaptureId: asString(raw.lastCaptureId) || undefined,
  lastCaptureAt: raw.lastCaptureAt,
  updatedAt: raw.updatedAt,
});

const isUniqueViolationError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code.toLowerCase()
    : "";
  if (code === "23505") return true;

  const details = [
    "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "",
    "details" in error && typeof (error as { details?: unknown }).details === "string"
      ? (error as { details: string }).details
      : "",
  ]
    .join(" ")
    .toLowerCase();

  return details.includes("duplicate key") || details.includes("unique");
};

const resolveUserTurmaCode = async (
  userId: string,
  tenantId?: string
): Promise<string> => {
  const supabase = getSupabaseClient();
  let query = supabase.from("users").select("turma").eq("uid", userId);
  const scopedTenantId = cleanTenantId(tenantId);
  if (scopedTenantId) {
    query = query.eq("tenant_id", scopedTenantId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwSupabaseError(error);
  return normalizeTurmaCode((data as Record<string, unknown> | null)?.turma);
};

const filterUserIdsByTenant = async (
  userIds: string[],
  tenantId?: string
): Promise<Set<string>> => {
  const scopedTenantId = cleanTenantId(tenantId);
  const uniqueIds = [...new Set(userIds.map((entry) => entry.trim()).filter(Boolean))];
  if (!scopedTenantId || uniqueIds.length === 0) {
    return new Set(uniqueIds);
  }

  const supabase = getSupabaseClient();
  const allowedIds = new Set<string>();
  for (let index = 0; index < uniqueIds.length; index += MAX_USERS_PAGE_SIZE) {
    const chunk = uniqueIds.slice(index, index + MAX_USERS_PAGE_SIZE);
    const { data, error } = await supabase
      .from("users")
      .select("uid")
      .eq("tenant_id", scopedTenantId)
      .in("uid", chunk);
    if (error) throwSupabaseError(error);

    for (const row of (data as Array<Record<string, unknown>> | null) ?? []) {
      const uid = asString(row.uid).trim();
      if (uid) allowedIds.add(uid);
    }
  }

  return allowedIds;
};

export async function fetchAlbumRankings(
  maxResults = MAX_RANKING_RESULTS,
  options?: { turma?: string; tenantId?: string }
): Promise<AlbumRankingEntry[]> {
  const safeLimit = boundedLimit(maxResults, MAX_RANKING_RESULTS);
  const turmaFilter = options?.turma?.trim().toUpperCase() || "";
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey(
    `${safeLimit}:${turmaFilter || "all"}`,
    scopedTenantId
  );
  return runWithInflight(inflightRankingsCache, cacheKey, async () => {
    const cached = getCacheValue(rankingsCache, cacheKey);
    if (cached) return cached;

    const supabase = getSupabaseClient();
    const fetchFilteredByTurma = async (turmaValue: string): Promise<AlbumRankingEntry[]> => {
      let query = supabase
        .from("album_rankings")
        .select(ALBUM_RANKINGS_SELECT_COLUMNS)
        .eq("turma", turmaValue);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { data, error } = await query.limit(safeLimit);
      if (error) throwSupabaseError(error);
      return ((data as unknown as Record<string, unknown>[] | null) ?? []).map((row) =>
        toRankingEntry(asString(row.id), row)
      );
    };

    let rows: AlbumRankingEntry[] = [];
    if (turmaFilter) {
      rows = await fetchFilteredByTurma(turmaFilter);
      if (rows.length === 0 && turmaFilter !== turmaFilter.toLowerCase()) {
        rows = await fetchFilteredByTurma(turmaFilter.toLowerCase());
      }
      rows = [...rows].sort(
        (left, right) => (right.totalColetado || 0) - (left.totalColetado || 0)
      );
    } else {
      let query = supabase
        .from("album_rankings")
        .select(ALBUM_RANKINGS_SELECT_COLUMNS)
        .order("totalColetado", { ascending: false });
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { data, error } = await query.limit(safeLimit);
      if (error) throwSupabaseError(error);
      rows = ((data as unknown as Record<string, unknown>[] | null) ?? []).map((row) =>
        toRankingEntry(asString(row.id), row)
      );
    }

    setCacheValue(rankingsCache, cacheKey, rows);
    return rows;
  });
}

export async function fetchUsersByTurma(
  turma: string,
  maxResults = MAX_USERS_PER_CLASS,
  options?: { tenantId?: string }
): Promise<AlbumUserEntry[]> {
  const safeLimit = boundedLimit(maxResults, MAX_USERS_PER_CLASS);
  const cacheKey = buildTenantScopedCacheKey(
    `${turma.trim()}:${safeLimit}`,
    options?.tenantId
  );
  const cached = getCacheValue(usersByTurmaCache, cacheKey);
  if (cached) return cached;

  const page = await fetchUsersByTurmaPage(turma, {
    pageSize: safeLimit,
    tenantId: options?.tenantId,
  });
  setCacheValue(usersByTurmaCache, cacheKey, page.users);
  return page.users;
}

export async function fetchUsersByTurmaPage(
  turma: string,
  options?: {
    pageSize?: number;
    cursorId?: string | null;
    forceRefresh?: boolean;
    tenantId?: string;
  }
): Promise<AlbumUsersPageResult> {
  const turmaCode = turma.trim().toUpperCase();
  if (!turmaCode) {
    return { users: [], nextCursorId: null, hasMore: false };
  }

  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_USERS_PAGE_SIZE);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey(
    `${turmaCode}:${pageSize}:${cursorId || "first"}`,
    scopedTenantId
  );

  const inflightKey = `${cacheKey}:${forceRefresh ? "f" : "c"}`;
  return runWithInflight(inflightUsersByTurmaPageCache, inflightKey, async () => {
    if (!forceRefresh) {
      const cached = getCacheValue(usersByTurmaPageCache, cacheKey);
      if (cached) return cached;
    }

    const supabase = getSupabaseClient();
    const turmaCandidates = Array.from(
      new Set([turmaCode, turmaCode.toLowerCase()])
    );
    const allRows: AlbumUserEntry[] = [];

    for (const turmaCandidate of turmaCandidates) {
      let query = supabase
        .from("users")
        .select(ALBUM_USERS_SELECT_COLUMNS)
        .eq("turma", turmaCandidate);
      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }
      const { data, error } = await query
        .order("nome", { ascending: true })
        .limit(MAX_USERS_PER_CLASS);
      if (error) throwSupabaseError(error);

      for (const row of (data as unknown as Record<string, unknown>[] | null) ?? []) {
        allRows.push(toUserEntry(asString(row.uid), row));
      }
    }

    const deduped = Array.from(
      new Map(allRows.map((entry) => [entry.id, entry])).values()
    ).sort((left, right) =>
      left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" })
    );

    const startIndex = cursorId
      ? Math.max(
          0,
          deduped.findIndex((entry) => entry.id === cursorId) + 1
        )
      : 0;
    const pageRows = deduped.slice(startIndex, startIndex + pageSize);
    const users = pageRows;
    const hasMore = startIndex + pageRows.length < deduped.length;
    const nextCursorId = pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null;

    const result: AlbumUsersPageResult = {
      users,
      nextCursorId,
      hasMore,
    };

    setCacheValue(usersByTurmaPageCache, cacheKey, result);
    return result;
  });
}

export async function fetchAlbumCollectedIds(
  userId: string,
  options?: {
    turma?: string;
    maxResults?: number;
    forceRefresh?: boolean;
    tenantId?: string;
  }
): Promise<string[]> {
  if (!userId) return [];

  try {
    await ensureAlbumSelfCollected(userId, options?.tenantId);
  } catch {
    // Se a semente falhar por politica/RLS, seguimos com leitura sem quebrar a tela.
  }

  const turma = options?.turma?.trim();
  const maxResults = boundedLimit(
    options?.maxResults ?? MAX_USERS_PER_CLASS * 2,
    MAX_USERS_PER_CLASS * 2
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey(
    `${userId}:${turma || "all"}:${maxResults}`,
    scopedTenantId
  );
  const inflightKey = `${cacheKey}:${forceRefresh ? "f" : "c"}`;
  return runWithInflight(inflightCollectedIdsCache, inflightKey, async () => {
    if (!forceRefresh) {
      const cached = getCacheValue(collectedIdsCache, cacheKey);
      if (cached) return cached;
    }

    const summary = await fetchAlbumSummary(userId, {
      forceRefresh,
      tenantId: scopedTenantId,
    });
    if (summary) {
      const source = turma
        ? summary.capturedByTurma[normalizeTurmaCode(turma)] || []
        : Object.values(summary.capturedByTurma).flat();

      const rows = Array.from(new Set([userId, ...source])).slice(0, maxResults);
      setCacheValue(collectedIdsCache, cacheKey, rows);
      return rows;
    }

    const supabase = getSupabaseClient();
    let capturesQuery = supabase
      .from(ALBUM_CAPTURES_TABLE)
      .select(ALBUM_CAPTURES_SELECT_COLUMNS)
      .eq("collectorUserId", userId)
      .order("dataColada", { ascending: false })
      .limit(maxResults);

    if (turma) {
      capturesQuery = capturesQuery.eq("turma", normalizeTurmaCode(turma));
    }

    const { data, error } = await capturesQuery;
    if (error) throwSupabaseError(error);

    const rowsRaw = (data as unknown as Array<Record<string, unknown>> | null) ?? [];
    const allowedTargetIds = await filterUserIdsByTenant(
      rowsRaw.map((row) => asString(row.targetUserId).trim()),
      scopedTenantId
    );
    const ids = Array.from(
      new Set(
        [userId].concat(
        rowsRaw
          .map((row) => asString(row.targetUserId).trim())
          .filter((targetUserId) => allowedTargetIds.has(targetUserId))
          .filter(Boolean)
        )
      )
    );

    if (!turma && ids.length > 0) {
      const capturedByTurma = rowsRaw.reduce<Record<string, string[]>>(
        (acc, row) => {
          const targetId = asString(row.targetUserId).trim();
          if (!targetId || !allowedTargetIds.has(targetId)) return acc;
          const turmaKey = normalizeTurmaCode(row.turma);
          if (!acc[turmaKey]) acc[turmaKey] = [];
          acc[turmaKey].push(targetId);
          return acc;
        },
        {}
      );
      try {
        const userTurma = await resolveUserTurmaCode(userId, scopedTenantId);
        capturedByTurma[userTurma] = Array.from(
          new Set([...(capturedByTurma[userTurma] || []), userId])
        );
      } catch {
        capturedByTurma.OUTROS = Array.from(
          new Set([...(capturedByTurma.OUTROS || []), userId])
        );
      }

      const hydratedSummary: AlbumSummary = {
        userId,
        totalCollected: Array.from(new Set(Object.values(capturedByTurma).flat())).length,
        capturedByTurma,
      };

      try {
        await supabase
          .from(ALBUM_SUMMARY_COLLECTION)
          .upsert(
            {
              userId,
              tenant_id: scopedTenantId || null,
              totalCollected: hydratedSummary.totalCollected,
              capturedByTurma: hydratedSummary.capturedByTurma,
              updatedAt: nowIso(),
              migratedFromCapturesAt: nowIso(),
            },
            { onConflict: "userId" }
          );
      } catch {
        // Regras podem bloquear write do resumo. Nao interrompe a tela.
      }
      setCacheValue(albumSummaryCache, buildTenantScopedCacheKey(userId, scopedTenantId), hydratedSummary);
    }

    setCacheValue(collectedIdsCache, cacheKey, ids);
    return ids;
  });
}

export async function ensureAlbumSelfCollected(
  userId: string,
  tenantId?: string
): Promise<void> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return;
  const scopedTenantId = cleanTenantId(tenantId);

  return runWithInflight(
    inflightEnsureSelfCollectedCache,
    buildTenantScopedCacheKey(cleanUserId, scopedTenantId),
    async () => {
      const userTurma = await resolveUserTurmaCode(cleanUserId, scopedTenantId);
      const summary = await fetchAlbumSummary(cleanUserId, {
        forceRefresh: true,
        tenantId: scopedTenantId,
      });
      const currentSummary = summary ?? {
        userId: cleanUserId,
        totalCollected: 0,
        capturedByTurma: {} as Record<string, string[]>,
      };

      const turmaRows = currentSummary.capturedByTurma[userTurma] || [];
      if (turmaRows.includes(cleanUserId)) return;

      const nextCapturedByTurma = {
        ...currentSummary.capturedByTurma,
        [userTurma]: Array.from(new Set([...turmaRows, cleanUserId])),
      };
      const uniqueCollected = Array.from(
        new Set(Object.values(nextCapturedByTurma).flat())
      );
      const nextSummary: AlbumSummary = {
        userId: cleanUserId,
        totalCollected: uniqueCollected.length,
        capturedByTurma: nextCapturedByTurma,
        lastCaptureId: currentSummary.lastCaptureId,
        lastCaptureAt: currentSummary.lastCaptureAt,
        updatedAt: nowIso(),
      };

      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from(ALBUM_SUMMARY_COLLECTION)
        .upsert(
          {
            userId: nextSummary.userId,
            tenant_id: scopedTenantId || null,
            totalCollected: nextSummary.totalCollected,
            capturedByTurma: nextSummary.capturedByTurma,
            lastCaptureId: nextSummary.lastCaptureId,
            lastCaptureAt: nextSummary.lastCaptureAt,
            updatedAt: nowIso(),
          },
          { onConflict: "userId" }
        );
      if (error) throwSupabaseError(error);

      setCacheValue(
        albumSummaryCache,
        buildTenantScopedCacheKey(cleanUserId, scopedTenantId),
        nextSummary
      );
      collectedIdsCache.clear();
    }
  );
}

export async function fetchAlbumSummary(
  userId: string,
  options?: { forceRefresh?: boolean; tenantId?: string }
): Promise<AlbumSummary | null> {
  if (!userId) return null;
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey(userId, scopedTenantId);

  return runWithInflight(inflightAlbumSummaryCache, cacheKey, async () => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!forceRefresh) {
      const cached = albumSummaryCache.get(cacheKey);
      if (cached) {
        if (Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
          return cached.value;
        }
        albumSummaryCache.delete(cacheKey);
      }
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from(ALBUM_SUMMARY_COLLECTION)
      .select(ALBUM_SUMMARY_SELECT_COLUMNS)
      .eq("userId", userId);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throwSupabaseError(error);
    if (!data) {
      setCacheValue(albumSummaryCache, cacheKey, null);
      return null;
    }

    const summary = toAlbumSummary(userId, data as Record<string, unknown>);
    setCacheValue(albumSummaryCache, cacheKey, summary);
    return summary;
  });
}

export async function fetchAlbumConfig(
  turma: string,
  options?: { tenantId?: string }
): Promise<AlbumCmsData | null> {
  const turmaCode = turma.trim().toUpperCase();
  if (!turmaCode) return null;
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey(turmaCode, scopedTenantId);

  return runWithInflight(inflightAlbumConfigCache, cacheKey, async () => {
    const cached = getCacheValue(albumConfigCache, cacheKey);
    if (cached) return cached;

    const supabase = getSupabaseClient();
    const baseCandidates = Array.from(
      new Set([turmaCode, turma.trim(), turma.trim().toLowerCase()])
    ).filter((value) => Boolean(value));
    const candidates = scopedTenantId
      ? Array.from(
          new Set(
            baseCandidates.flatMap((candidate) => resolveScopedDocIds(scopedTenantId, candidate))
          )
        )
      : baseCandidates;

    for (const candidate of candidates) {
      const { data, error } = await supabase
        .from("album_config")
        .select(ALBUM_CONFIG_SELECT_COLUMNS)
        .eq("id", candidate)
        .maybeSingle();
      if (error) throwSupabaseError(error);
      if (!data) continue;

      const config = toAlbumConfig(data as Record<string, unknown>);
      setCacheValue(albumConfigCache, cacheKey, config);
      return config;
    }

    setCacheValue(albumConfigCache, cacheKey, null);
    return null;
  });
}

export async function saveAlbumConfig(
  turma: string,
  config: AlbumCmsData,
  options?: { tenantId?: string }
): Promise<void> {
  const turmaCode = turma.trim().toUpperCase();
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const storageId = buildTenantScopedRowId(scopedTenantId, turmaCode) || turmaCode;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("album_config").upsert(
    {
      id: storageId,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      ...config,
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  albumConfigCache.delete(buildTenantScopedCacheKey(turmaCode, scopedTenantId));
  usersByTurmaCache.clear();
  usersByTurmaPageCache.clear();
}

export async function fetchAlbumUiConfig(options?: {
  tenantId?: string;
}): Promise<AlbumUiConfig | null> {
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const cacheKey = buildTenantScopedCacheKey("albumUi", scopedTenantId);
  return runWithInflight(inflightAlbumUiCache, cacheKey, async () => {
    const cached = albumUiCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
      return cached.value;
    }
    const supabase = getSupabaseClient();
    const docIds = resolveScopedDocIds(scopedTenantId, ALBUM_UI_DOC_ID);
    const { data, error } = await supabase
      .from(ALBUM_UI_DOC_COLLECTION)
      .select(ALBUM_UI_SELECT_COLUMNS)
      .in("id", docIds);
    if (error) throwSupabaseError(error);
    const rows = Array.isArray(data)
      ? data
          .map((entry) =>
            typeof entry === "object" && entry !== null
              ? (entry as Record<string, unknown>)
              : null
          )
          .filter((entry): entry is Record<string, unknown> => entry !== null)
      : [];
    const selectedRow = docIds
      .map((docId) => rows.find((row) => asString(row.id) === docId))
      .find((entry) => Boolean(entry));
    if (!selectedRow) return null;

    const selectedRowData = selectedRow as Record<string, unknown>;
    const nestedData =
      typeof selectedRowData.data === "object" && selectedRowData.data !== null
        ? (selectedRowData.data as Record<string, unknown>)
        : {};
    const config = toAlbumUiConfig({
      capa: selectedRowData.capa ?? nestedData.capa,
      titulo: selectedRowData.titulo ?? nestedData.titulo,
      subtitulo: selectedRowData.subtitulo ?? nestedData.subtitulo,
    });
    albumUiCache.set(cacheKey, { cachedAt: Date.now(), value: config });
    return config;
  });
}

export async function saveAlbumUiConfig(
  config: AlbumUiConfig,
  options?: { tenantId?: string }
): Promise<void> {
  const supabase = getSupabaseClient();
  const scopedTenantId = cleanTenantId(options?.tenantId);
  const { error } = await supabase.from(ALBUM_UI_DOC_COLLECTION).upsert(
    {
      id: buildTenantScopedRowId(scopedTenantId, ALBUM_UI_DOC_ID) || ALBUM_UI_DOC_ID,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      ...config,
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  albumUiCache.set(buildTenantScopedCacheKey("albumUi", scopedTenantId), {
    cachedAt: Date.now(),
    value: config,
  });
}

export async function registerAlbumCapture(payload: {
  collector: AlbumCollector;
  targetId: string;
  tenantId?: string;
}): Promise<AlbumCaptureResult> {
  const targetId = payload.targetId.trim();
  const collectorUid = payload.collector.uid.trim();
  const scopedTenantId = cleanTenantId(payload.tenantId);
  if (!targetId || !collectorUid || targetId === collectorUid) {
    return { status: "invalid-target" };
  }

  const clearCaptureCaches = () => {
    collectedIdsCache.clear();
    rankingsCache.clear();
    albumSummaryCache.clear();
  };
  const supabase = getSupabaseClient();
  let collectorQuery = supabase
    .from("users")
    .select("uid,nome,turma,foto,stats")
    .eq("uid", collectorUid);
  let targetQuery = supabase
    .from("users")
    .select("uid,nome,turma")
    .eq("uid", targetId);
  if (scopedTenantId) {
    collectorQuery = collectorQuery.eq("tenant_id", scopedTenantId);
    targetQuery = targetQuery.eq("tenant_id", scopedTenantId);
  }
  const [collectorRes, targetRes] = await Promise.all([
    collectorQuery.maybeSingle(),
    targetQuery.maybeSingle(),
  ]);
  if (collectorRes.error) throwSupabaseError(collectorRes.error);
  if (targetRes.error) throwSupabaseError(targetRes.error);
  if (!collectorRes.data || !targetRes.data) {
    return { status: "invalid-target" };
  }

  const collectorData = (collectorRes.data ?? {}) as Record<string, unknown>;
  const targetData = targetRes.data as Record<string, unknown>;

  const targetName = asString(targetData.nome, "Integrante");
  const targetTurma = asString(targetData.turma, "");
  const targetTurmaKey = normalizeTurmaCode(targetTurma);
  const collectorName = asString(
    payload.collector.nome || collectorData.nome,
    "Integrante"
  );
  const collectorTurma = asString(
    payload.collector.turma || collectorData.turma,
    ""
  );
  const collectorFoto = asString(
    payload.collector.foto || collectorData.foto,
    DEFAULT_AVATAR_URL
  );

  const captureId = `${collectorUid}__${targetId}`;
  const { error: insertCaptureError } = await supabase
    .from(ALBUM_CAPTURES_TABLE)
    .insert({
      id: captureId,
      collectorUserId: collectorUid,
      targetUserId: targetId,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      nome: targetName,
      turma: targetTurmaKey,
      dataColada: nowIso(),
    });
  if (insertCaptureError) {
    if (isUniqueViolationError(insertCaptureError)) {
      return { status: "duplicate", targetName, targetTurma };
    }
    throwSupabaseError(insertCaptureError);
  }

  const rankingWrite = async (): Promise<void> => {
    let rankingReadQuery = supabase
      .from("album_rankings")
      .select("id,totalColetado,scansT8")
      .eq("id", collectorUid);
    if (scopedTenantId) {
      rankingReadQuery = rankingReadQuery.eq("tenant_id", scopedTenantId);
    }
    const { data: rankingData, error: rankingReadError } = await rankingReadQuery.maybeSingle();
    if (rankingReadError) throwSupabaseError(rankingReadError);

    const rankingRaw = (rankingData ?? {}) as Record<string, unknown>;
    const nextTotalColetado = asNumber(rankingRaw.totalColetado, 0) + 1;
    const nextScansT8 =
      asNumber(rankingRaw.scansT8, 0) + (targetTurmaKey === "T8" ? 1 : 0);

    const { error: rankingWriteError } = await supabase.from("album_rankings").upsert(
      {
        id: collectorUid,
        userId: collectorUid,
        nome: collectorName,
        turma: collectorTurma,
        foto: collectorFoto,
        tenant_id: scopedTenantId || null,
        totalColetado: nextTotalColetado,
        scansT8: nextScansT8,
        ultimoScan: nowIso(),
      },
      { onConflict: "id" }
    );
    if (rankingWriteError) throwSupabaseError(rankingWriteError);
  };

  const userStatsWrite = async (): Promise<void> => {
    const currentStats = (collectorData.stats &&
    typeof collectorData.stats === "object"
      ? (collectorData.stats as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const nextStats = {
      ...currentStats,
      albumCollected: asNumber(currentStats.albumCollected, 0) + 1,
    };

    let query = supabase
      .from("users")
      .update({ stats: nextStats, updatedAt: nowIso() })
      .eq("uid", collectorUid);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { error } = await query;
    if (error) throwSupabaseError(error);
  };

  const summaryWrite = async (): Promise<void> => {
    let summaryReadQuery = supabase
      .from(ALBUM_SUMMARY_COLLECTION)
      .select(ALBUM_SUMMARY_SELECT_COLUMNS)
      .eq("userId", collectorUid);
    if (scopedTenantId) {
      summaryReadQuery = summaryReadQuery.eq("tenant_id", scopedTenantId);
    }
    const { data: summaryData, error: summaryReadError } = await summaryReadQuery.maybeSingle();
    if (summaryReadError) throwSupabaseError(summaryReadError);

    const currentSummary = summaryData
      ? toAlbumSummary(collectorUid, summaryData as Record<string, unknown>)
      : {
          userId: collectorUid,
          totalCollected: 0,
          capturedByTurma: {} as Record<string, string[]>,
        };

    const nextCapturedByTurma = { ...currentSummary.capturedByTurma };
    const turmaIds = Array.from(
      new Set([...(nextCapturedByTurma[targetTurmaKey] || []), targetId])
    );
    nextCapturedByTurma[targetTurmaKey] = turmaIds;

    const { error: summaryWriteError } = await supabase
      .from(ALBUM_SUMMARY_COLLECTION)
      .upsert(
        {
          userId: collectorUid,
          tenant_id: scopedTenantId || null,
          totalCollected: currentSummary.totalCollected + 1,
          capturedByTurma: nextCapturedByTurma,
          lastCaptureId: targetId,
          lastCaptureAt: nowIso(),
          updatedAt: nowIso(),
        },
        { onConflict: "userId" }
      );
    if (summaryWriteError) throwSupabaseError(summaryWriteError);
  };

  const notificationWrite = async (): Promise<void> => {
    const { error } = await supabase.from("notifications").insert({
      id: crypto.randomUUID(),
      userId: collectorUid,
      ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      title: "Nova captura no Album",
      message: `${targetName} entrou para sua colecao.`,
      link: "/album",
      read: false,
      type: "album",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (error) throwSupabaseError(error);
  };

  const sideEffects = await Promise.allSettled([
    rankingWrite(),
    userStatsWrite(),
    summaryWrite(),
    notificationWrite(),
  ]);
  if (sideEffects.some((effect) => effect.status === "rejected")) {
    console.warn("Album capture: side-effects com falha parcial.", sideEffects);
  }

  clearCaptureCaches();
  return { status: "ok", targetName, targetTurma };
}


