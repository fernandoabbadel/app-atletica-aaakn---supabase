import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { parseTenantScopedPath } from "./tenantRouting";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;
const TURMAS_CONFIG_DOC_ID = "turmas_config";
const TURMAS_CONFIG_SELECT_COLUMNS = "id,data,updatedAt,createdAt";
const ACTIVE_TURMAS_SNAPSHOT_STORAGE_KEY = "usc_active_turmas_config";

const turmasCache = new Map<string, CacheEntry<TurmaConfig[]>>();
const turmaMemberCountsCache = new Map<string, CacheEntry<Record<string, number>>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

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

const getCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > READ_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedValue = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

export const normalizeTurmaId = (raw: string): string => {
  const input = raw.trim().toUpperCase();
  if (!input) return "";
  if (/^T\d{1,3}$/.test(input)) {
    return `T${String(Number(input.slice(1)))}`;
  }

  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  return `T${String(Number(digits))}`;
};

const buildSlugFromTurmaId = (turmaId: string): string => {
  const digits = turmaId.replace(/\D/g, "");
  if (!digits) return turmaId.trim().toLowerCase();
  return `t${digits}`;
};

const turmaSortWeight = (turmaId: string): number => {
  const digits = Number(turmaId.replace(/\D/g, ""));
  if (Number.isFinite(digits) && digits > 0) return digits;
  return Number.MAX_SAFE_INTEGER;
};

const sortTurmas = (rows: TurmaConfig[]): TurmaConfig[] =>
  [...rows].sort((left, right) => {
    const diff = turmaSortWeight(left.id) - turmaSortWeight(right.id);
    if (diff !== 0) return diff;
    return left.id.localeCompare(right.id, "pt-BR");
  });

const dedupeTurmasById = (rows: TurmaConfig[]): TurmaConfig[] => {
  const map = new Map<string, TurmaConfig>();
  rows.forEach((row) => {
    if (!row.id) return;
    map.set(row.id, row);
  });
  return sortTurmas(Array.from(map.values()));
};

export interface TurmaConfig {
  id: string;
  slug: string;
  nome: string;
  mascote: string;
  capa: string;
  logo: string;
  hidden: boolean;
}

export interface ActiveTurmasSnapshot {
  tenantId: string;
  tenantSlug: string;
  turmas: TurmaConfig[];
  updatedAt: string;
}

const DEFAULT_TURMAS: TurmaConfig[] = [
  {
    id: "T1",
    slug: "t1",
    nome: "Turma I",
    mascote: "Jacare",
    capa: "/capa_t1.jpg",
    logo: "/turma1.jpeg",
    hidden: false,
  },
  {
    id: "T2",
    slug: "t2",
    nome: "Turma II",
    mascote: "Cavalo Marinho",
    capa: "/capa_t2.jpg",
    logo: "/turma2.jpeg",
    hidden: false,
  },
  {
    id: "T3",
    slug: "t3",
    nome: "Turma III",
    mascote: "Tartaruga",
    capa: "/capa_t3.jpg",
    logo: "/turma3.jpeg",
    hidden: false,
  },
  {
    id: "T4",
    slug: "t4",
    nome: "Turma IV",
    mascote: "Baleia",
    capa: "/capa_t4.jpg",
    logo: "/turma4.jpeg",
    hidden: false,
  },
  {
    id: "T5",
    slug: "t5",
    nome: "Turma V",
    mascote: "Pinguim",
    capa: "/capa_t5.jpg",
    logo: "/turma5.jpeg",
    hidden: false,
  },
  {
    id: "T6",
    slug: "t6",
    nome: "Turma VI",
    mascote: "Lagosta",
    capa: "/capa_t6.jpg",
    logo: "/turma6.jpeg",
    hidden: false,
  },
  {
    id: "T7",
    slug: "t7",
    nome: "Turma VII",
    mascote: "Urso Polar",
    capa: "/capa_t7.jpg",
    logo: "/turma7.jpeg",
    hidden: false,
  },
  {
    id: "T8",
    slug: "t8",
    nome: "Turma VIII",
    mascote: "Calouros",
    capa: "/capa_t8.jpg",
    logo: "/turma8.jpg",
    hidden: false,
  },
];

const DEFAULT_TURMAS_MAP = new Map(DEFAULT_TURMAS.map((turma) => [turma.id, turma]));

const getFallbackTurmas = (): TurmaConfig[] =>
  sortTurmas(DEFAULT_TURMAS.map((row) => ({ ...row })));

const toTurmaConfig = (raw: unknown): TurmaConfig | null => {
  const data = asObject(raw);
  if (!data) return null;

  const id = normalizeTurmaId(asString(data.id));
  if (!id) return null;

  const defaultTurma = DEFAULT_TURMAS_MAP.get(id);
  const slug =
    asString(data.slug).trim().toLowerCase() ||
    defaultTurma?.slug ||
    buildSlugFromTurmaId(id);
  const nome =
    asString(data.nome).trim() ||
    defaultTurma?.nome ||
    `Turma ${id.replace("T", "")}`;
  const mascote = asString(data.mascote).trim() || defaultTurma?.mascote || "Mascote";
  const capa = asString(data.capa).trim() || defaultTurma?.capa || "/capa_t8.jpg";
  const logo = asString(data.logo).trim() || defaultTurma?.logo || "/logo.png";
  const hidden = asBoolean(data.hidden, false);

  return { id, slug, nome, mascote, capa, logo, hidden };
};

const sanitizeTurmas = (rows: readonly unknown[]): TurmaConfig[] => {
  const normalized = rows
    .map((row) => toTurmaConfig(row))
    .filter((row): row is TurmaConfig => row !== null);

  return dedupeTurmasById(normalized);
};

export const getDefaultTurmas = (): TurmaConfig[] => getFallbackTurmas();

const resolveTurmasTenantId = (tenantId?: string): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveCurrentTenantSlug = (): string => {
  if (typeof window === "undefined") return "";
  return parseTenantScopedPath(window.location.pathname || "/").tenantSlug.trim().toLowerCase();
};

const resolveTurmasCacheKey = (tenantId?: string): string => {
  const cleanTenantId = resolveTurmasTenantId(tenantId);
  return cleanTenantId || "default";
};

const buildTurmaMemberCountsCacheKey = (tenantId?: string, turmaIds?: string[]): string => {
  const cleanTenantId = resolveTurmasTenantId(tenantId);
  const normalizedTurmas = Array.from(
    new Set(
      (Array.isArray(turmaIds) ? turmaIds : [])
        .map((entry) => normalizeTurmaId(asString(entry)))
        .filter((entry) => entry.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));

  return `${cleanTenantId || "default"}:${normalizedTurmas.join("|") || "all"}`;
};

const resolveTurmasDocIds = (tenantId?: string): string[] => {
  const cleanTenantId = resolveTurmasTenantId(tenantId);
  if (!cleanTenantId) return [TURMAS_CONFIG_DOC_ID];
  return [buildTenantScopedRowId(cleanTenantId, TURMAS_CONFIG_DOC_ID)];
};

const pickTurmasRow = (
  rows: Array<Record<string, unknown>>,
  tenantId?: string
): Record<string, unknown> | null => {
  const candidates = resolveTurmasDocIds(tenantId);
  for (const candidate of candidates) {
    const match = rows.find((row) => asString(row.id) === candidate);
    if (match) return match;
  }
  return null;
};

const toActiveTurmasSnapshot = (raw: unknown): ActiveTurmasSnapshot | null => {
  const data = asObject(raw);
  if (!data) return null;

  return {
    tenantId: asString(data.tenantId).trim(),
    tenantSlug: asString(data.tenantSlug).trim().toLowerCase(),
    turmas: sanitizeTurmas(Array.isArray(data.turmas) ? data.turmas : []),
    updatedAt: asString(data.updatedAt).trim() || nowIso(),
  };
};

export function readActiveTurmasSnapshot(options?: {
  tenantId?: string;
  tenantSlug?: string;
}): ActiveTurmasSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const rawSnapshot = window.localStorage.getItem(ACTIVE_TURMAS_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) return null;

    const snapshot = toActiveTurmasSnapshot(JSON.parse(rawSnapshot));
    if (!snapshot) return null;

    const expectedTenantId = resolveTurmasTenantId(options?.tenantId);
    const expectedTenantSlug =
      asString(options?.tenantSlug).trim().toLowerCase() || resolveCurrentTenantSlug();

    if (!expectedTenantId && !expectedTenantSlug) return null;
    if (expectedTenantId && snapshot.tenantId !== expectedTenantId) return null;
    if (expectedTenantSlug && snapshot.tenantSlug !== expectedTenantSlug) return null;

    return snapshot;
  } catch {
    return null;
  }
}

export function persistActiveTurmasSnapshot(payload: {
  tenantId?: string;
  tenantSlug?: string;
  turmas: readonly unknown[];
}): void {
  if (typeof window === "undefined") return;

  const tenantId = resolveTurmasTenantId(payload.tenantId);
  const tenantSlug =
    asString(payload.tenantSlug).trim().toLowerCase() || resolveCurrentTenantSlug();
  if (!tenantId && !tenantSlug) {
    clearActiveTurmasSnapshot();
    return;
  }

  try {
    const snapshot: ActiveTurmasSnapshot = {
      tenantId,
      tenantSlug,
      turmas: sanitizeTurmas(payload.turmas),
      updatedAt: nowIso(),
    };
    window.localStorage.setItem(
      ACTIVE_TURMAS_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // ignora erro de storage
  }
}

export function clearActiveTurmasSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_TURMAS_SNAPSHOT_STORAGE_KEY);
  } catch {
    // ignora erro de storage
  }
}

export function resolveActiveTurmaConfig(
  turmaIdRaw: string,
  options?: {
    tenantId?: string;
    tenantSlug?: string;
  }
): TurmaConfig | null {
  const turmaId = normalizeTurmaId(turmaIdRaw);
  if (!turmaId) return null;

  const snapshot = readActiveTurmasSnapshot(options);
  if (!snapshot) return null;

  return snapshot.turmas.find((turma) => turma.id === turmaId) ?? null;
}

export async function fetchTurmasConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
}): Promise<TurmaConfig[]> {
  const forceRefresh = options?.forceRefresh ?? false;
  const scopedTenantId = resolveTurmasTenantId(options?.tenantId);
  const cacheKey = resolveTurmasCacheKey(scopedTenantId);
  if (!forceRefresh) {
    const cached = getCachedValue(turmasCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const docIds = resolveTurmasDocIds(scopedTenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select(TURMAS_CONFIG_SELECT_COLUMNS)
    .in("id", docIds);
  if (error) throwSupabaseError(error);

  const rows = Array.isArray(data)
    ? data
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const row = pickTurmasRow(rows, scopedTenantId);
  const dataObj = asObject(row?.data);
  const turmasRaw = Array.isArray(dataObj?.turmas) ? dataObj.turmas : [];
  const parsed = turmasRaw
    .map((entry) => toTurmaConfig(entry))
    .filter((entry): entry is TurmaConfig => entry !== null);

  const hasStoredRow = Boolean(row);
  const resolved = parsed.length > 0 || hasStoredRow ? sortTurmas(parsed) : getFallbackTurmas();
  setCachedValue(turmasCache, cacheKey, resolved);
  if (scopedTenantId) {
    persistActiveTurmasSnapshot({
      tenantId: scopedTenantId,
      turmas: resolved,
    });
  }
  return resolved;
}

export async function fetchTurmaMemberCounts(options?: {
  tenantId?: string;
  turmaIds?: string[];
  forceRefresh?: boolean;
}): Promise<Record<string, number>> {
  const normalizedTurmas = Array.from(
    new Set(
      (Array.isArray(options?.turmaIds) ? options?.turmaIds : [])
        .map((entry) => normalizeTurmaId(asString(entry)))
        .filter((entry) => entry.length > 0)
    )
  );

  if (normalizedTurmas.length === 0) {
    return {};
  }

  const cacheKey = buildTurmaMemberCountsCacheKey(options?.tenantId, normalizedTurmas);
  const forceRefresh = options?.forceRefresh ?? false;
  if (!forceRefresh) {
    const cached = getCachedValue(turmaMemberCountsCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const scopedTenantId = resolveTurmasTenantId(options?.tenantId);
  const counts = Object.fromEntries(
    await Promise.all(
      normalizedTurmas.map(async (turmaId) => {
        const turmaCandidates = Array.from(new Set([turmaId, turmaId.toLowerCase()]));
        let query = supabase
          .from("users")
          .select("uid", { count: "exact", head: true })
          .in("turma", turmaCandidates);
        if (scopedTenantId) {
          query = query.eq("tenant_id", scopedTenantId);
        }

        const { count, error } = await query;
        if (error) throwSupabaseError(error);

        return [turmaId, Math.max(0, count ?? 0)] as const;
      })
    )
  );

  setCachedValue(turmaMemberCountsCache, cacheKey, counts);
  return counts;
}

export async function saveTurmasConfig(
  turmas: TurmaConfig[],
  options?: { tenantId?: string }
): Promise<TurmaConfig[]> {
  const next = sanitizeTurmas(turmas);
  const scopedTenantId = resolveTurmasTenantId(options?.tenantId);
  const docId =
    buildTenantScopedRowId(scopedTenantId, TURMAS_CONFIG_DOC_ID) || TURMAS_CONFIG_DOC_ID;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: docId,
      data: { turmas: next },
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCachedValue(turmasCache, resolveTurmasCacheKey(scopedTenantId), next);
  if (scopedTenantId) {
    persistActiveTurmasSnapshot({
      tenantId: scopedTenantId,
      turmas: next,
    });
  }
  return next;
}

export async function addTurmaConfig(payload: {
  id: string;
  nome?: string;
  mascote?: string;
  capa?: string;
  logo?: string;
}, options?: { tenantId?: string }): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(payload.id);
  if (!turmaId) throw new Error("Código de turma inválido. Use formato T9, T10...");

  const current = await fetchTurmasConfig({ forceRefresh: true, tenantId: options?.tenantId });
  if (current.some((turma) => turma.id === turmaId)) {
    throw new Error(`A turma ${turmaId} ja existe.`);
  }

  const defaultNumero = turmaId.replace("T", "");
  const nextTurma: TurmaConfig = {
    id: turmaId,
    slug: buildSlugFromTurmaId(turmaId),
    nome: payload.nome?.trim() || `Turma ${defaultNumero}`,
    mascote: payload.mascote?.trim() || "Novo mascote",
    capa: payload.capa?.trim() || `/capa_${buildSlugFromTurmaId(turmaId)}.jpg`,
    logo: payload.logo?.trim() || "/logo.png",
    hidden: false,
  };

  return saveTurmasConfig([...current, nextTurma], options);
}

export async function updateTurmaConfig(payload: {
  id: string;
  nome?: string;
  mascote?: string;
  capa?: string;
  logo?: string;
  hidden?: boolean;
}, options?: { tenantId?: string }): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(payload.id);
  if (!turmaId) throw new Error("Código de turma inválido.");

  const current = await fetchTurmasConfig({ forceRefresh: true, tenantId: options?.tenantId });
  const currentTurma = current.find((turma) => turma.id === turmaId);
  if (!currentTurma) {
    throw new Error(`Turma ${turmaId} não encontrada.`);
  }

  const next = current.map((turma) =>
    turma.id === turmaId
      ? {
          ...turma,
          nome: payload.nome?.trim() || turma.nome,
          mascote: payload.mascote?.trim() || turma.mascote,
          capa: payload.capa?.trim() || turma.capa,
          logo: payload.logo?.trim() || turma.logo,
          hidden: typeof payload.hidden === "boolean" ? payload.hidden : turma.hidden,
        }
      : turma
  );

  return saveTurmasConfig(next, options);
}

export async function toggleTurmaVisibility(
  turmaIdRaw: string,
  hidden?: boolean,
  options?: { tenantId?: string }
): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(turmaIdRaw);
  if (!turmaId) throw new Error("Código de turma inválido.");

  const current = await fetchTurmasConfig({ forceRefresh: true, tenantId: options?.tenantId });
  const currentTurma = current.find((turma) => turma.id === turmaId);
  if (!currentTurma) {
    throw new Error(`Turma ${turmaId} não encontrada.`);
  }

  const nextHidden = typeof hidden === "boolean" ? hidden : !currentTurma.hidden;
  return updateTurmaConfig({ id: turmaId, hidden: nextHidden }, options);
}

export async function deleteTurmaConfig(
  turmaIdRaw: string,
  options?: { tenantId?: string }
): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(turmaIdRaw);
  if (!turmaId) throw new Error("Código de turma inválido.");

  const current = await fetchTurmasConfig({ forceRefresh: true, tenantId: options?.tenantId });
  if (!current.some((turma) => turma.id === turmaId)) {
    throw new Error(`Turma ${turmaId} não encontrada.`);
  }

  const next = current.filter((turma) => turma.id !== turmaId);
  return saveTurmasConfig(next, options);
}

export function clearTurmasCache(): void {
  turmasCache.clear();
  turmaMemberCountsCache.clear();
}
