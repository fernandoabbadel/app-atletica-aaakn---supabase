import { getSupabaseClient } from "./supabase";

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
  "id,userId,nome,foto,turma,totalColetado,scansT8";
const ALBUM_USERS_SELECT_COLUMNS =
  "uid,nome,turma,foto,apelido,dataNascimento,idadePublica,esportes,pets,cidadeOrigem,relacionamentoPublico,statusRelacionamento,bio,instagram";
const ALBUM_SUMMARY_SELECT_COLUMNS =
  "userId,totalCollected,capturedByTurma,lastCaptureId,lastCaptureAt,updatedAt";
const ALBUM_CONFIG_SELECT_COLUMNS = "id,capa,titulo,subtitulo,updatedAt";
const ALBUM_UI_SELECT_COLUMNS = "id,capa,titulo,subtitulo,updatedAt";
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
let albumUiCache: CacheEntry<AlbumUiConfig | null> | null = null;
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

const resolveUserTurmaCode = async (userId: string): Promise<string> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("turma")
    .eq("uid", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);
  return normalizeTurmaCode((data as Record<string, unknown> | null)?.turma);
};

export async function fetchAlbumRankings(
  maxResults = MAX_RANKING_RESULTS,
  options?: { turma?: string }
): Promise<AlbumRankingEntry[]> {
  const safeLimit = boundedLimit(maxResults, MAX_RANKING_RESULTS);
  const turmaFilter = options?.turma?.trim().toUpperCase() || "";
  const cacheKey = `${safeLimit}:${turmaFilter || "all"}`;
  return runWithInflight(inflightRankingsCache, cacheKey, async () => {
    const cached = getCacheValue(rankingsCache, cacheKey);
    if (cached) return cached;

    const supabase = getSupabaseClient();
    const fetchFilteredByTurma = async (turmaValue: string): Promise<AlbumRankingEntry[]> => {
      const { data, error } = await supabase
        .from("album_rankings")
        .select(ALBUM_RANKINGS_SELECT_COLUMNS)
        .eq("turma", turmaValue)
        .limit(safeLimit);
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
      const { data, error } = await supabase
        .from("album_rankings")
        .select(ALBUM_RANKINGS_SELECT_COLUMNS)
        .order("totalColetado", { ascending: false })
        .limit(safeLimit);
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
  maxResults = MAX_USERS_PER_CLASS
): Promise<AlbumUserEntry[]> {
  const safeLimit = boundedLimit(maxResults, MAX_USERS_PER_CLASS);
  const cacheKey = `${turma.trim()}:${safeLimit}`;
  const cached = getCacheValue(usersByTurmaCache, cacheKey);
  if (cached) return cached;

  const page = await fetchUsersByTurmaPage(turma, {
    pageSize: safeLimit,
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
  }
): Promise<AlbumUsersPageResult> {
  const turmaCode = turma.trim().toUpperCase();
  if (!turmaCode) {
    return { users: [], nextCursorId: null, hasMore: false };
  }

  const pageSize = boundedLimit(options?.pageSize ?? 20, MAX_USERS_PAGE_SIZE);
  const cursorId = options?.cursorId?.trim() || "";
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${turmaCode}:${pageSize}:${cursorId || "first"}`;

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
      const { data, error } = await supabase
        .from("users")
        .select(ALBUM_USERS_SELECT_COLUMNS)
        .eq("turma", turmaCandidate)
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
  options?: { turma?: string; maxResults?: number; forceRefresh?: boolean }
): Promise<string[]> {
  if (!userId) return [];

  try {
    await ensureAlbumSelfCollected(userId);
  } catch {
    // Se a semente falhar por politica/RLS, seguimos com leitura sem quebrar a tela.
  }

  const turma = options?.turma?.trim();
  const maxResults = boundedLimit(
    options?.maxResults ?? MAX_USERS_PER_CLASS * 2,
    MAX_USERS_PER_CLASS * 2
  );
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${userId}:${turma || "all"}:${maxResults}`;
  const inflightKey = `${cacheKey}:${forceRefresh ? "f" : "c"}`;
  return runWithInflight(inflightCollectedIdsCache, inflightKey, async () => {
    if (!forceRefresh) {
      const cached = getCacheValue(collectedIdsCache, cacheKey);
      if (cached) return cached;
    }

    const summary = await fetchAlbumSummary(userId, { forceRefresh });
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
    const ids = Array.from(
      new Set(
        [userId].concat(
        rowsRaw
          .map((row) => asString(row.targetUserId).trim())
          .filter(Boolean)
        )
      )
    );

    if (!turma && ids.length > 0) {
      const capturedByTurma = rowsRaw.reduce<Record<string, string[]>>(
        (acc, row) => {
          const targetId = asString(row.targetUserId).trim();
          if (!targetId) return acc;
          const turmaKey = normalizeTurmaCode(row.turma);
          if (!acc[turmaKey]) acc[turmaKey] = [];
          acc[turmaKey].push(targetId);
          return acc;
        },
        {}
      );
      try {
        const userTurma = await resolveUserTurmaCode(userId);
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
      setCacheValue(albumSummaryCache, userId, hydratedSummary);
    }

    setCacheValue(collectedIdsCache, cacheKey, ids);
    return ids;
  });
}

export async function ensureAlbumSelfCollected(userId: string): Promise<void> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return;

  return runWithInflight(
    inflightEnsureSelfCollectedCache,
    cleanUserId,
    async () => {
      const userTurma = await resolveUserTurmaCode(cleanUserId);
      const summary = await fetchAlbumSummary(cleanUserId, { forceRefresh: true });
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
            totalCollected: nextSummary.totalCollected,
            capturedByTurma: nextSummary.capturedByTurma,
            lastCaptureId: nextSummary.lastCaptureId,
            lastCaptureAt: nextSummary.lastCaptureAt,
            updatedAt: nowIso(),
          },
          { onConflict: "userId" }
        );
      if (error) throwSupabaseError(error);

      setCacheValue(albumSummaryCache, cleanUserId, nextSummary);
      collectedIdsCache.clear();
    }
  );
}

export async function fetchAlbumSummary(
  userId: string,
  options?: { forceRefresh?: boolean }
): Promise<AlbumSummary | null> {
  if (!userId) return null;

  return runWithInflight(inflightAlbumSummaryCache, userId, async () => {
    const forceRefresh = options?.forceRefresh ?? false;
    if (!forceRefresh) {
      const cached = albumSummaryCache.get(userId);
      if (cached) {
        if (Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
          return cached.value;
        }
        albumSummaryCache.delete(userId);
      }
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(ALBUM_SUMMARY_COLLECTION)
      .select(ALBUM_SUMMARY_SELECT_COLUMNS)
      .eq("userId", userId)
      .maybeSingle();
    if (error) throwSupabaseError(error);
    if (!data) {
      setCacheValue(albumSummaryCache, userId, null);
      return null;
    }

    const summary = toAlbumSummary(userId, data as Record<string, unknown>);
    setCacheValue(albumSummaryCache, userId, summary);
    return summary;
  });
}

export async function fetchAlbumConfig(
  turma: string
): Promise<AlbumCmsData | null> {
  const turmaCode = turma.trim().toUpperCase();
  if (!turmaCode) return null;

  return runWithInflight(inflightAlbumConfigCache, turmaCode, async () => {
    const cached = getCacheValue(albumConfigCache, turmaCode);
    if (cached) return cached;

    const supabase = getSupabaseClient();
    const candidates = Array.from(
      new Set([turmaCode, turma.trim(), turma.trim().toLowerCase()])
    ).filter((value) => Boolean(value));

    for (const candidate of candidates) {
      const { data, error } = await supabase
        .from("album_config")
        .select(ALBUM_CONFIG_SELECT_COLUMNS)
        .eq("id", candidate)
        .maybeSingle();
      if (error) throwSupabaseError(error);
      if (!data) continue;

      const config = toAlbumConfig(data as Record<string, unknown>);
      setCacheValue(albumConfigCache, turmaCode, config);
      return config;
    }

    setCacheValue(albumConfigCache, turmaCode, null);
    return null;
  });
}

export async function saveAlbumConfig(
  turma: string,
  config: AlbumCmsData
): Promise<void> {
  const turmaCode = turma.trim().toUpperCase();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("album_config").upsert(
    { id: turmaCode, ...config, updatedAt: nowIso() },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  albumConfigCache.delete(turmaCode);
  usersByTurmaCache.clear();
  usersByTurmaPageCache.clear();
}

export async function fetchAlbumUiConfig(): Promise<AlbumUiConfig | null> {
  return runWithInflight(inflightAlbumUiCache, "albumUi", async () => {
    if (albumUiCache && Date.now() - albumUiCache.cachedAt <= READ_CACHE_TTL_MS) {
      return albumUiCache.value;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(ALBUM_UI_DOC_COLLECTION)
      .select(ALBUM_UI_SELECT_COLUMNS)
      .eq("id", ALBUM_UI_DOC_ID)
      .maybeSingle();
    if (error) throwSupabaseError(error);
    if (!data) return null;

    const config = toAlbumUiConfig(data as Record<string, unknown>);
    albumUiCache = { cachedAt: Date.now(), value: config };
    return config;
  });
}

export async function saveAlbumUiConfig(config: AlbumUiConfig): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(ALBUM_UI_DOC_COLLECTION).upsert(
    {
      id: ALBUM_UI_DOC_ID,
      ...config,
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  albumUiCache = { cachedAt: Date.now(), value: config };
}

export async function registerAlbumCapture(payload: {
  collector: AlbumCollector;
  targetId: string;
}): Promise<AlbumCaptureResult> {
  const targetId = payload.targetId.trim();
  const collectorUid = payload.collector.uid.trim();
  if (!targetId || !collectorUid || targetId === collectorUid) {
    return { status: "invalid-target" };
  }

  const clearCaptureCaches = () => {
    collectedIdsCache.clear();
    rankingsCache.clear();
    albumSummaryCache.clear();
  };
  const supabase = getSupabaseClient();
  const [collectorRes, targetRes] = await Promise.all([
    supabase
      .from("users")
      .select("uid,nome,turma,foto,stats")
      .eq("uid", collectorUid)
      .maybeSingle(),
    supabase
      .from("users")
      .select("uid,nome,turma")
      .eq("uid", targetId)
      .maybeSingle(),
  ]);
  if (collectorRes.error) throwSupabaseError(collectorRes.error);
  if (targetRes.error) throwSupabaseError(targetRes.error);
  if (!targetRes.data) {
    return { status: "invalid-target" };
  }

  const collectorData = (collectorRes.data ?? {}) as Record<string, unknown>;
  const targetData = targetRes.data as Record<string, unknown>;

  const targetName = asString(targetData.nome, "Integrante");
  const targetTurma = asString(targetData.turma, "");
  const targetTurmaKey = normalizeTurmaCode(targetTurma);
  const collectorName = asString(
    payload.collector.nome || collectorData.nome,
    "Tubarao"
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
    const { data: rankingData, error: rankingReadError } = await supabase
      .from("album_rankings")
      .select("id,totalColetado,scansT8")
      .eq("id", collectorUid)
      .maybeSingle();
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

    const { error } = await supabase
      .from("users")
      .update({ stats: nextStats, updatedAt: nowIso() })
      .eq("uid", collectorUid);
    if (error) throwSupabaseError(error);
  };

  const summaryWrite = async (): Promise<void> => {
    const { data: summaryData, error: summaryReadError } = await supabase
      .from(ALBUM_SUMMARY_COLLECTION)
      .select(ALBUM_SUMMARY_SELECT_COLUMNS)
      .eq("userId", collectorUid)
      .maybeSingle();
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


