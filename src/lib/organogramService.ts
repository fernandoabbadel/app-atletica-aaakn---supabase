import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";
import { throwSupabaseError } from "./supabaseData";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 45_000;
const ORGANOGRAM_DOC_ID = "organograma";

const configCache = new Map<string, CacheEntry<OrganogramConfig>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const nowIso = (): string => new Date().toISOString();

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [asString(raw.message), asString(raw.details)]
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

const removeMissingColumnFromSelection = (
  columns: string[],
  missingColumn: string
): string[] | null => {
  const next = columns.filter(
    (column) => column.toLowerCase() !== missingColumn.toLowerCase()
  );
  if (next.length === columns.length) return null;
  return next;
};

const resolveOrganogramTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveOrganogramDocId = (tenantId?: string | null): string =>
  buildTenantScopedRowId(resolveOrganogramTenantId(tenantId), ORGANOGRAM_DOC_ID) ||
  ORGANOGRAM_DOC_ID;

const getCacheKey = (tenantId?: string | null): string =>
  resolveOrganogramTenantId(tenantId) || "global";

export interface OrganogramMemberRecord {
  id: string;
  secao: string;
  cargo: string;
  ordem: number;
  userId?: string;
  nome?: string;
  foto?: string;
}

export interface OrganogramConfig {
  tituloPagina: string;
  subtituloPagina: string;
  membros: OrganogramMemberRecord[];
}

const DEFAULT_ORGANOGRAM_CONFIG: OrganogramConfig = {
  tituloPagina: "Organograma da Atletica",
  subtituloPagina: "Presidencia, vice-presidencia e diretorias em um painel vivo.",
  membros: [],
};

const normalizeMember = (raw: unknown, index: number): OrganogramMemberRecord | null => {
  const data = asObject(raw);
  if (!data) return null;

  const cargo = asString(data.cargo).trim().slice(0, 80);
  const secao = asString(data.secao, "Diretoria").trim().slice(0, 60) || "Diretoria";
  if (!cargo) return null;

  const id =
    asString(data.id).trim().slice(0, 120) || `organograma:${secao}:${cargo}:${index}`;
  const userId = asString(data.userId).trim().slice(0, 120) || undefined;
  const nome = asString(data.nome).trim().slice(0, 120) || undefined;
  const foto = asString(data.foto).trim().slice(0, 2000) || undefined;

  return {
    id,
    secao,
    cargo,
    ordem: Math.max(0, Math.floor(asNumber(data.ordem, index))),
    ...(userId ? { userId } : {}),
    ...(nome ? { nome } : {}),
    ...(foto ? { foto } : {}),
  };
};

const normalizeConfig = (raw: unknown): OrganogramConfig => {
  const data = asObject(raw) ?? {};
  const nested = asObject(data.data) ?? {};
  const title =
    asString(data.tituloPagina).trim() ||
    asString(nested.tituloPagina).trim() ||
    DEFAULT_ORGANOGRAM_CONFIG.tituloPagina;
  const subtitle =
    asString(data.subtituloPagina).trim() ||
    asString(nested.subtituloPagina).trim() ||
    DEFAULT_ORGANOGRAM_CONFIG.subtituloPagina;
  const membersSource = Array.isArray(data.membros)
    ? data.membros
    : Array.isArray(nested.membros)
      ? nested.membros
      : [];

  return {
    tituloPagina: title.slice(0, 120),
    subtituloPagina: subtitle.slice(0, 240),
    membros: membersSource
      .map((member, index) => normalizeMember(member, index))
      .filter((member): member is OrganogramMemberRecord => member !== null)
      .sort((left, right) => left.ordem - right.ordem || left.cargo.localeCompare(right.cargo, "pt-BR")),
  };
};

export async function fetchOrganogramConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string | null;
}): Promise<OrganogramConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = getCacheKey(options?.tenantId);
  const cached = configCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
    return cached.value;
  }

  const supabase = getSupabaseClient();
  let selectColumns = ["id", "tituloPagina", "subtituloPagina", "membros", "data"];
  let row: Record<string, unknown> | null = null;

  while (selectColumns.length > 0) {
    const { data, error } = await supabase
      .from("app_config")
      .select(selectColumns.join(","))
      .eq("id", resolveOrganogramDocId(options?.tenantId))
      .maybeSingle();

    if (!error) {
      row = asObject(data);
      break;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    const nextColumns =
      removeMissingColumnFromSelection(selectColumns, missingColumn) ?? [];
    if (nextColumns.length === 0) throwSupabaseError(error);
    selectColumns = nextColumns;
  }

  const config = row ? normalizeConfig(row) : { ...DEFAULT_ORGANOGRAM_CONFIG };
  configCache.set(cacheKey, { cachedAt: Date.now(), value: config });
  return config;
}

export async function saveOrganogramConfig(
  payload: OrganogramConfig,
  options?: { tenantId?: string | null }
): Promise<void> {
  const normalized = normalizeConfig(payload);
  const supabase = getSupabaseClient();
  const scopedTenantId = resolveOrganogramTenantId(options?.tenantId);
  const mutablePayload: Record<string, unknown> = {
    id: resolveOrganogramDocId(scopedTenantId),
    ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
    tituloPagina: normalized.tituloPagina,
    subtituloPagina: normalized.subtituloPagina,
    membros: normalized.membros,
    data: {
      tituloPagina: normalized.tituloPagina,
      subtituloPagina: normalized.subtituloPagina,
      membros: normalized.membros,
    },
    updatedAt: nowIso(),
  };

  while (Object.keys(mutablePayload).length > 0) {
    const { error } = await supabase
      .from("app_config")
      .upsert(mutablePayload, { onConflict: "id" });
    if (!error) {
      configCache.set(getCacheKey(scopedTenantId), {
        cachedAt: Date.now(),
        value: normalized,
      });
      return;
    }

    const missingColumn = asString(extractMissingSchemaColumn(error)).trim();
    if (!missingColumn) throwSupabaseError(error);

    const removableKey = Object.keys(mutablePayload).find(
      (key) => key.toLowerCase() === missingColumn.toLowerCase()
    );
    if (typeof removableKey !== "string" || removableKey === "id") {
      throwSupabaseError(error);
    }
    delete mutablePayload[removableKey as keyof typeof mutablePayload];
  }
}

export function getDefaultOrganogramConfig(): OrganogramConfig {
  return {
    tituloPagina: DEFAULT_ORGANOGRAM_CONFIG.tituloPagina,
    subtituloPagina: DEFAULT_ORGANOGRAM_CONFIG.subtituloPagina,
    membros: [],
  };
}

export function clearOrganogramConfigCache(): void {
  configCache.clear();
}
