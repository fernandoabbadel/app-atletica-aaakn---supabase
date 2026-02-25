import { httpsCallable } from "@/lib/supa/functions";
import {
  arrayUnion,
  collection,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  where,
} from "@/lib/supa/firestore";

import { db, functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";

const DEFAULT_AVATAR_URL = "https://github.com/shadcn.png";
const ALBUM_SCAN_CALLABLE = "albumRegisterCapture";
const MAX_RANKING_RESULTS = 100;
const MAX_USERS_PER_CLASS = 150;
const MAX_USERS_PAGE_SIZE = 60;
const ALBUM_UI_DOC_COLLECTION = "app_config";
const ALBUM_UI_DOC_ID = "album_ui";
const ALBUM_SUMMARY_COLLECTION = "album_summary";
const READ_CACHE_TTL_MS = 120_000;

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

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

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

const shouldFallbackToClientCapture = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase() || "";
  if (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("cors") ||
    message.includes("access-control-allow-origin") ||
    message.includes("preflight")
  );
};

const isIndexRequiredError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase() || "";
  if (code.includes("failed-precondition")) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("index") && message.includes("query");
};

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

const shouldUseCallable = (): boolean => {
  if (typeof window === "undefined") return true;
  return process.env.NEXT_PUBLIC_FORCE_ALBUM_CLIENT_FALLBACK !== "true";
};

export async function fetchAlbumRankings(
  maxResults = MAX_RANKING_RESULTS
): Promise<AlbumRankingEntry[]> {
  const safeLimit = boundedLimit(maxResults, MAX_RANKING_RESULTS);
  const cacheKey = `${safeLimit}`;
  return runWithInflight(inflightRankingsCache, cacheKey, async () => {
    const cached = getCacheValue(rankingsCache, cacheKey);
    if (cached) return cached;

    const q = query(
      collection(db, "album_rankings"),
      orderBy("totalColetado", "desc"),
      limit(safeLimit)
    );
    const snap = await getDocs(q);

    const rows = snap.docs.map((row) =>
      toRankingEntry(row.id, row.data() as Record<string, unknown>)
    );
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

    const runIndexedQuery = async (
      turmaValue: string
    ): Promise<{
      pageDocs: QueryDocumentSnapshot<DocumentData>[];
      users: AlbumUserEntry[];
      hasMore: boolean;
    }> => {
      const constraints: QueryConstraint[] = [
        where("turma", "==", turmaValue),
        orderBy("nome", "asc"),
        limit(pageSize + 1),
      ];

      if (cursorId) {
        const cursorSnap = await getDoc(doc(db, "users", cursorId));
        if (cursorSnap.exists()) {
          constraints.splice(2, 0, startAfter(cursorSnap));
        }
      }

      const snap = await getDocs(query(collection(db, "users"), ...constraints));
      const pageDocs = snap.docs.slice(0, pageSize);
      const users = pageDocs.map((row) =>
        toUserEntry(row.id, row.data() as Record<string, unknown>)
      );

      return { pageDocs, users, hasMore: snap.docs.length > pageSize };
    };

    let users: AlbumUserEntry[] = [];
    let hasMore = false;
    let nextCursorId: string | null = null;

    try {
      let orderedResult = await runIndexedQuery(turmaCode);
      const turmaLower = turmaCode.toLowerCase();
      if (orderedResult.users.length === 0 && turmaLower !== turmaCode) {
        orderedResult = await runIndexedQuery(turmaLower);
      }

      users = orderedResult.users;
      hasMore = orderedResult.hasMore;
      nextCursorId =
        orderedResult.pageDocs.length > 0
          ? orderedResult.pageDocs[orderedResult.pageDocs.length - 1].id
          : null;
    } catch (error: unknown) {
      if (!isIndexRequiredError(error)) {
        throw error;
      }

      const turmaCandidates = Array.from(
        new Set([turmaCode, turmaCode.toLowerCase()])
      );

      const allRows: AlbumUserEntry[] = [];
      for (const turmaCandidate of turmaCandidates) {
        const fallbackSnap = await getDocs(
          query(
            collection(db, "users"),
            where("turma", "==", turmaCandidate),
            limit(MAX_USERS_PER_CLASS)
          )
        );

        for (const row of fallbackSnap.docs) {
          allRows.push(
            toUserEntry(row.id, row.data() as Record<string, unknown>)
          );
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
      users = pageRows;
      hasMore = startIndex + pageRows.length < deduped.length;
      nextCursorId = pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null;
    }

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

      const rows = Array.from(new Set(source)).slice(0, maxResults);
      setCacheValue(collectedIdsCache, cacheKey, rows);
      return rows;
    }

    const baseRef = collection(db, "users", userId, "albumColado");
    const constraints = [
      ...(turma ? [where("turma", "==", turma)] : []),
      limit(maxResults),
    ];

    const snap = await getDocs(query(baseRef, ...constraints));
    const rows = snap.docs.map((row) => row.id);

    if (rows.length > 0) {
      const capturedByTurma = snap.docs.reduce<Record<string, string[]>>(
        (acc, row) => {
          const rowTurma = normalizeTurmaCode(
            (row.data() as Record<string, unknown>).turma
          );
          if (!acc[rowTurma]) acc[rowTurma] = [];
          acc[rowTurma].push(row.id);
          return acc;
        },
        {}
      );

      const hydratedSummary: AlbumSummary = {
        userId,
        totalCollected: rows.length,
        capturedByTurma,
      };

      try {
        await setDoc(
          doc(db, ALBUM_SUMMARY_COLLECTION, userId),
          {
            userId,
            totalCollected: hydratedSummary.totalCollected,
            capturedByTurma: hydratedSummary.capturedByTurma,
            updatedAt: serverTimestamp(),
            migratedFromLegacyAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch {
        // Regras antigas podem bloquear o write do resumo. Nao interrompe a tela.
      }
      setCacheValue(albumSummaryCache, userId, hydratedSummary);
    }

    setCacheValue(collectedIdsCache, cacheKey, rows);
    return rows;
  });
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

    const snap = await getDoc(doc(db, ALBUM_SUMMARY_COLLECTION, userId));
    if (!snap.exists()) {
      setCacheValue(albumSummaryCache, userId, null);
      return null;
    }

    const summary = toAlbumSummary(
      userId,
      snap.data() as Record<string, unknown>
    );
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

    const candidates = Array.from(
      new Set([turmaCode, turma.trim(), turma.trim().toLowerCase()])
    ).filter((value) => Boolean(value));

    for (const candidate of candidates) {
      const snap = await getDoc(doc(db, "album_config", candidate));
      if (!snap.exists()) continue;

      const config = toAlbumConfig(snap.data() as Record<string, unknown>);
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
  await setDoc(
    doc(db, "album_config", turmaCode),
    { ...config, updatedAt: serverTimestamp() },
    { merge: true }
  );
  albumConfigCache.delete(turmaCode);
  usersByTurmaCache.clear();
  usersByTurmaPageCache.clear();
}

export async function fetchAlbumUiConfig(): Promise<AlbumUiConfig | null> {
  return runWithInflight(inflightAlbumUiCache, "albumUi", async () => {
    if (albumUiCache && Date.now() - albumUiCache.cachedAt <= READ_CACHE_TTL_MS) {
      return albumUiCache.value;
    }
    const snap = await getDoc(doc(db, ALBUM_UI_DOC_COLLECTION, ALBUM_UI_DOC_ID));
    if (!snap.exists()) return null;
    const config = toAlbumUiConfig(snap.data() as Record<string, unknown>);
    albumUiCache = { cachedAt: Date.now(), value: config };
    return config;
  });
}

export async function saveAlbumUiConfig(config: AlbumUiConfig): Promise<void> {
  await setDoc(
    doc(db, ALBUM_UI_DOC_COLLECTION, ALBUM_UI_DOC_ID),
    {
      ...config,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
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

  const registerViaClientTransaction = async (): Promise<AlbumCaptureResult> => {
    const collectorRef = doc(db, "users", collectorUid);
    const targetRef = doc(db, "users", targetId);
    const albumRef = doc(db, "users", collectorUid, "albumColado", targetId);
    const rankingRef = doc(db, "album_rankings", collectorUid);
    const summaryRef = doc(db, ALBUM_SUMMARY_COLLECTION, collectorUid);
    const notificationRef = doc(collection(db, "notifications"));

    const transactionResult = await runTransaction(db, async (tx) => {
      const [collectorSnap, targetSnap, albumSnap] = await Promise.all([
        tx.get(collectorRef),
        tx.get(targetRef),
        tx.get(albumRef),
      ]);

      if (!targetSnap.exists()) {
        return { status: "invalid-target" } as AlbumCaptureResult;
      }

      if (albumSnap.exists()) {
        return { status: "duplicate" } as AlbumCaptureResult;
      }

      const collectorData = collectorSnap.data() as Record<string, unknown> | undefined;
      const targetData = targetSnap.data() as Record<string, unknown> | undefined;

      const targetName = asString(targetData?.nome, "Integrante");
      const targetTurma = asString(targetData?.turma, "");
      const collectorName = asString(
        payload.collector.nome || collectorData?.nome,
        "Tubarao"
      );
      const collectorTurma = asString(
        payload.collector.turma || collectorData?.turma,
        ""
      );
      const collectorFoto = asString(
        payload.collector.foto || collectorData?.foto,
        DEFAULT_AVATAR_URL
      );

      tx.set(albumRef, {
        nome: targetName,
        turma: targetTurma,
        dataColada: serverTimestamp(),
      });

      tx.set(
        rankingRef,
        {
          userId: collectorUid,
          nome: collectorName,
          turma: collectorTurma,
          foto: collectorFoto,
          totalColetado: increment(1),
          scansT8: increment(targetTurma.toUpperCase() === "T8" ? 1 : 0),
          ultimoScan: serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        collectorRef,
        {
          stats: {
            albumCollected: increment(1),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const targetTurmaKey = normalizeTurmaCode(targetTurma);
      tx.set(
        summaryRef,
        {
          userId: collectorUid,
          totalCollected: increment(1),
          [`capturedByTurma.${targetTurmaKey}`]: arrayUnion(targetId),
          lastCaptureId: targetId,
          lastCaptureAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(notificationRef, {
        userId: collectorUid,
        title: "Nova captura no Album",
        message: `${targetName} entrou para sua colecao.`,
        link: "/album",
        read: false,
        type: "album",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { status: "ok", targetName, targetTurma } as AlbumCaptureResult;
    });

    clearCaptureCaches();
    return transactionResult;
  };

  try {
    if (!shouldUseCallable()) {
      return registerViaClientTransaction();
    }

    const callable = httpsCallable<
      { collectorUid: string; targetUid: string },
      AlbumCaptureResult
    >(functions, ALBUM_SCAN_CALLABLE);

    const response = await callable({
      collectorUid,
      targetUid: targetId,
    });

    const status = response.data?.status;
    if (status === "duplicate" || status === "invalid-target") {
      return response.data;
    }

    clearCaptureCaches();
    return {
      status: "ok",
      targetName: response.data?.targetName,
      targetTurma: response.data?.targetTurma,
    };
  } catch (error: unknown) {
    if (
      shouldFallbackToClientCapture(error) &&
      process.env.NEXT_PUBLIC_ALLOW_ALBUM_CLIENT_FALLBACK === "true"
    ) {
      return registerViaClientTransaction();
    }
    throw error;
  }
}

