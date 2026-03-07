import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 120_000;
const TURMAS_CONFIG_DOC_ID = "turmas_config";
const TURMAS_CONFIG_SELECT_COLUMNS = "id,data,updatedAt,createdAt";

const turmasCache = new Map<string, CacheEntry<TurmaConfig[]>>();

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

const normalizeTurmaId = (raw: string): string => {
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

const sanitizeTurmas = (rows: TurmaConfig[]): TurmaConfig[] => {
  const normalized = rows
    .map((row) => toTurmaConfig(row))
    .filter((row): row is TurmaConfig => row !== null);

  return dedupeTurmasById(normalized);
};

export const getDefaultTurmas = (): TurmaConfig[] => getFallbackTurmas();

export async function fetchTurmasConfig(options?: { forceRefresh?: boolean }): Promise<TurmaConfig[]> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = "default";
  if (!forceRefresh) {
    const cached = getCachedValue(turmasCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select(TURMAS_CONFIG_SELECT_COLUMNS)
    .eq("id", TURMAS_CONFIG_DOC_ID)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const row = asObject(data);
  const dataObj = asObject(row?.data);
  const turmasRaw = Array.isArray(dataObj?.turmas) ? dataObj.turmas : [];
  const parsed = turmasRaw
    .map((entry) => toTurmaConfig(entry))
    .filter((entry): entry is TurmaConfig => entry !== null);

  const hasStoredRow = Boolean(row);
  const resolved = parsed.length > 0 || hasStoredRow ? sortTurmas(parsed) : getFallbackTurmas();
  setCachedValue(turmasCache, cacheKey, resolved);
  return resolved;
}

export async function saveTurmasConfig(turmas: TurmaConfig[]): Promise<TurmaConfig[]> {
  const next = sanitizeTurmas(turmas);

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: TURMAS_CONFIG_DOC_ID,
      data: { turmas: next },
      updatedAt: nowIso(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCachedValue(turmasCache, "default", next);
  return next;
}

export async function addTurmaConfig(payload: {
  id: string;
  nome?: string;
  mascote?: string;
  capa?: string;
  logo?: string;
}): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(payload.id);
  if (!turmaId) throw new Error("Codigo de turma invalido. Use formato T9, T10...");

  const current = await fetchTurmasConfig({ forceRefresh: true });
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

  return saveTurmasConfig([...current, nextTurma]);
}

export async function updateTurmaConfig(payload: {
  id: string;
  nome?: string;
  mascote?: string;
  capa?: string;
  logo?: string;
  hidden?: boolean;
}): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(payload.id);
  if (!turmaId) throw new Error("Codigo de turma invalido.");

  const current = await fetchTurmasConfig({ forceRefresh: true });
  const currentTurma = current.find((turma) => turma.id === turmaId);
  if (!currentTurma) {
    throw new Error(`Turma ${turmaId} nao encontrada.`);
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

  return saveTurmasConfig(next);
}

export async function toggleTurmaVisibility(
  turmaIdRaw: string,
  hidden?: boolean
): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(turmaIdRaw);
  if (!turmaId) throw new Error("Codigo de turma invalido.");

  const current = await fetchTurmasConfig({ forceRefresh: true });
  const currentTurma = current.find((turma) => turma.id === turmaId);
  if (!currentTurma) {
    throw new Error(`Turma ${turmaId} nao encontrada.`);
  }

  const nextHidden = typeof hidden === "boolean" ? hidden : !currentTurma.hidden;
  return updateTurmaConfig({ id: turmaId, hidden: nextHidden });
}

export async function deleteTurmaConfig(turmaIdRaw: string): Promise<TurmaConfig[]> {
  const turmaId = normalizeTurmaId(turmaIdRaw);
  if (!turmaId) throw new Error("Codigo de turma invalido.");

  const current = await fetchTurmasConfig({ forceRefresh: true });
  if (!current.some((turma) => turma.id === turmaId)) {
    throw new Error(`Turma ${turmaId} nao encontrada.`);
  }

  const next = current.filter((turma) => turma.id !== turmaId);
  return saveTurmasConfig(next);
}

export function clearTurmasCache(): void {
  turmasCache.clear();
}
