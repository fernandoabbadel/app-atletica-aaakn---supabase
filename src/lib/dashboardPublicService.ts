import { getSupabaseClient } from "./supabase";
import { isEventExpiredByGrace } from "./eventDateUtils";

type CacheEntry<T> = { cachedAt: number; value: T };

type Row = Record<string, unknown>;

const READ_CACHE_TTL_MS = 300_000;
const DASHBOARD_EVENTS_LIMIT = 5;
const DASHBOARD_EVENTS_FETCH_LIMIT = 12;
const DASHBOARD_PRODUCTS_LIMIT = 8;
const DASHBOARD_POSTS_LIMIT = 2;
const DASHBOARD_TREINOS_LIMIT = 4;
const DASHBOARD_PARTNERS_LIMIT = 50;
const DASHBOARD_LIGAS_DASHBOARD_LIMIT = 2;
const DASHBOARD_TREINO_RSVPS_LIMIT = 12;
const DASHBOARD_ALBUM_FALLBACK_LIMIT = 350;
const DASHBOARD_LIKES_SAMPLE_PER_PRODUCT = 10;
const DASHBOARD_USERS_IN_CHUNK = 10;
const DASHBOARD_USERS_COUNT_FALLBACK_LIMIT = 2_000;
const DASHBOARD_TOTAL_CACA_RPC = "dashboard_total_caca_calouros";
const DASHBOARD_EVENT_GRACE_MS = 24 * 60 * 60 * 1000;

const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,local,imagem,tipo,status,likesList,interessados,imagePositionY,tenant_id";
const DASHBOARD_PRODUCTS_SELECT =
  "id,nome,preco,img,likes,active,aprovado,tenant_id";
const DASHBOARD_PARTNERS_SELECT =
  "id,nome,imgLogo,imgCapa,categoria,tier,status";
const DASHBOARD_LIGAS_SELECT =
  "id,nome,sigla,foto,logoUrl,logo,descricao,bizu,ativa,visivel,status,likes,createdAt,updatedAt";
const DASHBOARD_POSTS_SELECT =
  "id,userId,userName,avatar,createdAt,texto,likes,tenant_id";
const DASHBOARD_TREINOS_SELECT = "id,imagem,dia,createdAt,status,tenant_id";
const DASHBOARD_ALBUM_FALLBACK_SELECT = "targetUserId";

const dashboardCache = new Map<string, CacheEntry<DashboardBundle>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;
const asInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
};
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const normalizeIdList = (value: unknown): string[] =>
  Array.from(
    new Set(
      asStringArray(value)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );

const toMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const obj = asObject(value);
  const toDate = obj?.toDate;
  if (typeof toDate === "function") {
    const parsed = toDate.call(value) as Date;
    if (parsed instanceof Date) return parsed.getTime();
  }
  return 0;
};

const resolveFollowedLeagueIdsFromUserExtra = (
  extra: unknown,
  tenantId?: string
): string[] => {
  const extraData = asObject(extra) ?? {};
  const byTenant = asObject(extraData.followedLeagueIdsByTenant);
  const cleanTenantId = asString(tenantId).trim();

  if (cleanTenantId && byTenant) {
    return normalizeIdList(byTenant[cleanTenantId]);
  }

  return normalizeIdList(extraData.followedLeagueIds);
};

const buildStableSeed = (value: string): number => {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) >>> 0;
  }
  return seed || 1;
};

const seededShuffle = <T>(rows: T[], seedInput: string): T[] => {
  const next = [...rows];
  let seed = buildStableSeed(seedInput);

  for (let index = next.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
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

const chunkArray = <T>(rows: T[], chunkSize: number): T[][] => {
  if (chunkSize < 1) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize));
  return chunks;
};

const throwSupabaseError = (error: { message: string; code?: string | null; name?: string | null }): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const splitSelectColumns = (selectColumns: string): string[] =>
  selectColumns
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const removeMissingColumn = (columns: string[], missingColumn: string): string[] | null => {
  const normalizedMissing = missingColumn.trim().toLowerCase();
  if (!normalizedMissing) return null;

  const next = columns.filter((column) => {
    const normalizedColumn = column.trim().toLowerCase();
    if (!normalizedColumn) return false;
    if (normalizedColumn === normalizedMissing) return false;
    return !normalizedColumn.endsWith(`.${normalizedMissing}`);
  });

  if (next.length === columns.length) return null;
  return next;
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const message = [raw.message, raw.details, raw.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!message) return null;

  const normalized = message.toLowerCase();
  const isMissingColumn =
    (normalized.includes("column") && normalized.includes("does not exist")) ||
    normalized.includes("could not find the");
  if (!isMissingColumn) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /column\s+(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const extracted = match[2] ?? match[1];
    if (extracted) return extracted;
  }

  return null;
};

async function fetchRowsWithFallback(
  table: string,
  selectColumns: string,
  attempts: Array<{
    orderBy?: { column: string; ascending: boolean };
    limit: number;
    eq?: Record<string, string | boolean>;
  }>
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      let mutableColumns = splitSelectColumns(selectColumns);
      let mutableOrderBy = attempt.orderBy;

      while (mutableColumns.length > 0) {
        let q = supabase.from(table).select(mutableColumns.join(","));
        if (attempt.eq) {
          for (const [key, value] of Object.entries(attempt.eq)) {
            q = q.eq(key, value);
          }
        }
        if (mutableOrderBy) {
          q = q.order(mutableOrderBy.column, { ascending: mutableOrderBy.ascending });
        }
        q = q.limit(attempt.limit);
        const { data, error } = await q;
        if (!error) return (data ?? []) as unknown as Row[];

      const missingColumn = extractMissingSchemaColumn(error);
      if (!missingColumn) throw error;
      const safeMissingColumn = missingColumn as string;

      if (
        mutableOrderBy &&
        mutableOrderBy.column.toLowerCase() === safeMissingColumn.toLowerCase()
      ) {
        mutableOrderBy = undefined;
        continue;
      }

      const nextColumns = removeMissingColumn(mutableColumns, safeMissingColumn);
      if (!nextColumns || nextColumns.length === 0) throw error;
      const safeNextColumns = nextColumns as string[];
      mutableColumns = [...safeNextColumns];
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError && typeof lastError === "object" && lastError !== null && "message" in lastError) {
    throwSupabaseError(lastError as { message: string; code?: string | null; name?: string | null });
  }
  return [];
}

async function fetchDashboardEventRows(tenantId?: string): Promise<Row[]> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const attempts: Array<{ orderBy?: { column: string; ascending: boolean } }> = [
    { orderBy: { column: "data", ascending: true } },
    { orderBy: { column: "createdAt", ascending: false } },
    {},
  ];

  for (const attempt of attempts) {
    let mutableColumns = splitSelectColumns(DASHBOARD_EVENTS_SELECT);
    let mutableOrderBy = attempt.orderBy;

    while (mutableColumns.length > 0) {
      let query = supabase
        .from("eventos")
        .select(mutableColumns.join(","))
        .or("status.is.null,status.not.in.(encerrado,cancelado,inativo)")
        .limit(DASHBOARD_EVENTS_FETCH_LIMIT);

      if (scopedTenantId) {
        query = query.eq("tenant_id", scopedTenantId);
      }

      if (mutableOrderBy) {
        query = query.order(mutableOrderBy.column, { ascending: mutableOrderBy.ascending });
      }

      const { data, error } = await query;
      if (!error) {
        return (data ?? []) as unknown as Row[];
      }

      const missingColumn = extractMissingSchemaColumn(error);
      if (typeof missingColumn !== "string" || missingColumn.length === 0) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }
      const safeMissingColumn = missingColumn as string;

      if (
        mutableOrderBy &&
        mutableOrderBy.column.toLowerCase() === safeMissingColumn.toLowerCase()
      ) {
        mutableOrderBy = undefined;
        continue;
      }

      const nextColumns = removeMissingColumn(mutableColumns, safeMissingColumn);
      if (!nextColumns || nextColumns.length === 0) {
        throwSupabaseError(error as { message: string; code?: string | null; name?: string | null });
      }
      const safeNextColumns = nextColumns as string[];
      mutableColumns = [...safeNextColumns];
    }
  }

  return [];
}

async function fetchDashboardTotalCaca(tenantId?: string): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const { data, error } = await supabase.rpc(DASHBOARD_TOTAL_CACA_RPC, {
    p_tenant_id: scopedTenantId || null,
  });
  if (!error) {
    return Math.max(0, asInteger(data, 0));
  }

  const albumRows = await fetchRowsWithFallback("album_captures", DASHBOARD_ALBUM_FALLBACK_SELECT, [
    {
      limit: DASHBOARD_ALBUM_FALLBACK_LIMIT * 4,
      ...(scopedTenantId ? { eq: { tenant_id: scopedTenantId } } : {}),
    },
  ]);
  return new Set(
    albumRows
      .map((row) => asString(row.targetUserId).trim())
      .filter((targetUserId) => targetUserId.length > 0)
  ).size;
}

async function safeUsersCount(tenantId?: string): Promise<number> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  try {
    let query = supabase.from("users").select("uid", { count: "exact", head: true });
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch {
    let query = supabase.from("users").select("uid");
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(DASHBOARD_USERS_COUNT_FALLBACK_LIMIT);
    if (error) throwSupabaseError(error);
    return (data ?? []).length;
  }
}

async function fetchUserExtra(userId?: string): Promise<Row | null> {
  const cleanUserId = asString(userId).trim();
  if (!cleanUserId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("extra")
    .eq("uid", cleanUserId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  return asObject(asObject(data)?.extra);
}

async function fetchDashboardLeagueRows(options: {
  tenantId?: string;
  userId?: string;
}): Promise<Row[]> {
  const cleanTenantId = asString(options.tenantId).trim();
  const cleanUserId = asString(options.userId).trim();
  if (!cleanUserId) return [];

  const userExtra = await fetchUserExtra(cleanUserId);
  const followedLeagueIds = resolveFollowedLeagueIdsFromUserExtra(
    userExtra,
    cleanTenantId || undefined
  );
  if (!followedLeagueIds.length) return [];

  const supabase = getSupabaseClient();
  let query = supabase
    .from("ligas_config")
    .select(DASHBOARD_LIGAS_SELECT)
    .in("id", followedLeagueIds)
    .limit(followedLeagueIds.length);
  if (cleanTenantId) {
    query = query.eq("tenant_id", cleanTenantId);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return (data ?? []) as unknown as Row[];
}

async function fetchDashboardTreinoRows(options: {
  tenantId?: string;
  userId?: string;
}): Promise<Row[]> {
  const cleanTenantId = asString(options.tenantId).trim();
  const cleanUserId = asString(options.userId).trim();
  const supabase = getSupabaseClient();

  if (cleanUserId) {
    let rsvpQuery = supabase
      .from("treinos_rsvps")
      .select("treinoId,timestamp,status")
      .eq("userId", cleanUserId)
      .eq("status", "going")
      .order("timestamp", { ascending: false })
      .limit(DASHBOARD_TREINO_RSVPS_LIMIT);
    if (cleanTenantId) {
      rsvpQuery = rsvpQuery.eq("tenant_id", cleanTenantId);
    }

    const { data: rsvpRows, error: rsvpError } = await rsvpQuery;
    if (rsvpError) throwSupabaseError(rsvpError);

    const treinoIds = Array.from(
      new Set(
        ((rsvpRows ?? []) as Row[])
          .map((row) => asString(row.treinoId).trim())
          .filter((entry) => entry.length > 0)
      )
    );

    if (treinoIds.length > 0) {
      let treinoQuery = supabase
        .from("treinos")
        .select(DASHBOARD_TREINOS_SELECT)
        .in("id", treinoIds)
        .eq("status", "ativo")
        .limit(treinoIds.length);
      if (cleanTenantId) {
        treinoQuery = treinoQuery.eq("tenant_id", cleanTenantId);
      }

      const { data: treinoRows, error: treinoError } = await treinoQuery;
      if (treinoError) throwSupabaseError(treinoError);
      const rows = ((treinoRows ?? []) as Row[])
        .sort((left, right) => {
          const dateDiff = toMillis(right.dia) - toMillis(left.dia);
          if (dateDiff !== 0) return dateDiff;
          return toMillis(right.createdAt) - toMillis(left.createdAt);
        })
        .slice(0, DASHBOARD_TREINOS_LIMIT);

      if (rows.length > 0) return rows;
    }
  }

  return fetchRowsWithFallback("treinos", DASHBOARD_TREINOS_SELECT, [
    {
      orderBy: { column: "createdAt", ascending: false },
      limit: DASHBOARD_TREINOS_LIMIT,
      ...(cleanTenantId ? { eq: { tenant_id: cleanTenantId } } : {}),
    },
    { limit: DASHBOARD_TREINOS_LIMIT, ...(cleanTenantId ? { eq: { tenant_id: cleanTenantId } } : {}) },
  ]);
}

const normalizeEvento = (id: string, raw: unknown): DashboardEvent | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    titulo: asString(data.titulo, "Evento"),
    data: asString(data.data),
    hora: asString(data.hora),
    local: asString(data.local),
    imagem: asString(data.imagem),
    tipo: asString(data.tipo),
    status: asString(data.status, "ativo"),
    likesList: asStringArray(data.likesList),
    participantes: asStringArray(data.interessados ?? data.participantes),
    imagePositionY: asNumber(data.imagePositionY, 50),
  };
};

const normalizeProduto = (id: string, raw: unknown): DashboardProduct | null => {
  const data = asObject(raw);
  if (!data) return null;
  const precoRaw = data.preco;
  const preco: string | number = typeof precoRaw === "string" || typeof precoRaw === "number" ? precoRaw : 0;
  return {
    id,
    nome: asString(data.nome, "Produto"),
    preco,
    img: asString(data.img),
    likes: asStringArray(data.likes),
  };
};

const normalizeParceiro = (id: string, raw: unknown): DashboardPartner | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    nome: asString(data.nome, "Parceiro"),
    imgLogo: asString(data.imgLogo),
    imgCapa: asString(data.imgCapa) || undefined,
    categoria: asString(data.categoria) || undefined,
    plano: asString(data.plano) || asString(data.tier) || undefined,
    status: asString(data.status) || undefined,
  };
};

const normalizeLiga = (id: string, raw: unknown): DashboardLiga | null => {
  const data = asObject(raw);
  if (!data) return null;
  const logoUrl = asString(data.logoUrl) || undefined;
  const logoLegacy = asString(data.logo) || undefined;
  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    foto: asString(data.foto) || undefined,
    logoUrl,
    logoBase64: logoUrl || logoLegacy,
    logo: logoLegacy || logoUrl,
    descricao: asString(data.descricao) || undefined,
    bizu: asString(data.bizu) || undefined,
    ativa: asBoolean(data.ativa, false),
    visivel: asBoolean(data.visivel, false),
    status: asString(data.status) || undefined,
    likes: asNumber(data.likes, 0),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
};

const normalizePost = (id: string, raw: unknown): DashboardPost | null => {
  const data = asObject(raw);
  if (!data) return null;
  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Usuario"),
    avatar: asString(data.avatar),
    createdAt: data.createdAt ?? null,
    texto: asString(data.texto) || asString(data.text),
    likes: asStringArray(data.likes),
  };
};

const toTurmaKey = (raw: unknown): string | null => {
  const digits = asString(raw).replace(/\D/g, "");
  return digits ? digits : null;
};

async function fetchUsersTurmaMap(
  uids: string[],
  tenantId?: string
): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const scopedTenantId = asString(tenantId).trim();
  const uniqueIds = [...new Set(uids.filter((entry) => entry.trim().length > 0))];
  const result = new Map<string, string>();
  if (!uniqueIds.length) return result;

  const chunks = chunkArray(uniqueIds, DASHBOARD_USERS_IN_CHUNK);
  for (const chunk of chunks) {
    let query = supabase
      .from("users")
      .select("uid,turma")
      .in("uid", chunk);
    if (scopedTenantId) {
      query = query.eq("tenant_id", scopedTenantId);
    }
    const { data, error } = await query.limit(chunk.length);
    if (error) throwSupabaseError(error);
    for (const row of data ?? []) {
      const record = row as Record<string, unknown>;
      const uid = asString(record.uid);
      const turma = toTurmaKey(record.turma);
      if (uid && turma) result.set(uid, turma);
    }
  }

  return result;
}

async function buildProductTurmaStats(
  products: DashboardProduct[],
  tenantId?: string
): Promise<Record<string, DashboardTurmaStat[]>> {
  const likesByProduct = new Map<string, string[]>();
  const sampledUids: string[] = [];

  for (const product of products) {
    const sampled = product.likes.slice(0, DASHBOARD_LIKES_SAMPLE_PER_PRODUCT);
    likesByProduct.set(product.id, sampled);
    sampledUids.push(...sampled);
  }

  const turmaByUid = await fetchUsersTurmaMap(sampledUids, tenantId);
  const statsByProduct: Record<string, DashboardTurmaStat[]> = {};

  for (const [productId, likes] of likesByProduct.entries()) {
    const perTurma: Record<string, number> = {};
    for (const uid of likes) {
      const turma = turmaByUid.get(uid);
      if (!turma) continue;
      perTurma[turma] = (perTurma[turma] || 0) + 1;
    }

    statsByProduct[productId] = Object.entries(perTurma)
      .map(([turma, count]) => ({ turma, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 3);
  }

  return statsByProduct;
}

async function toggleArrayMembership(params: {
  table: string;
  id: string;
  column: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(params.table)
    .select(`${params.column}`)
    .eq("id", params.id)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const current = asStringArray(asObject(data)?.[params.column]);
  const next = params.currentlyLiked
    ? current.filter((entry) => entry !== params.userId)
    : Array.from(new Set([...current, params.userId]));

  const { error: updateError } = await supabase
    .from(params.table)
    .update({ [params.column]: next })
    .eq("id", params.id);
  if (updateError) throwSupabaseError(updateError);

  dashboardCache.clear();
}

export interface DashboardTurmaStat {
  turma: string;
  count: number;
}

export interface DashboardEvent {
  id: string;
  titulo: string;
  data: string;
  hora?: string;
  local: string;
  imagem: string;
  tipo: string;
  status?: string;
  likesList: string[];
  participantes: string[];
  imagePositionY?: number;
}

export interface DashboardProduct {
  id: string;
  nome: string;
  preco: string | number;
  img: string;
  likes: string[];
}

export interface DashboardLiga {
  id: string;
  nome: string;
  sigla: string;
  foto?: string;
  logoUrl?: string;
  logoBase64?: string;
  logo?: string;
  descricao?: string;
  bizu?: string;
  ativa?: boolean;
  visivel?: boolean;
  status?: string;
  likes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DashboardPartner {
  id: string;
  nome: string;
  imgLogo: string;
  imgCapa?: string;
  categoria?: string;
  plano?: string;
  status?: string;
}

export interface DashboardPost {
  id: string;
  userId: string;
  userName: string;
  avatar: string;
  createdAt?: unknown;
  texto: string;
  likes: string[];
}

export interface DashboardBundle {
  events: DashboardEvent[];
  produtos: DashboardProduct[];
  parceiros: DashboardPartner[];
  ligas: DashboardLiga[];
  mensagens: DashboardPost[];
  treinos: string[];
  totalCaca: number;
  totalAlunos: number;
  productTurmaStats: Record<string, DashboardTurmaStat[]>;
}

export async function fetchDashboardBundle(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
  userId?: string;
}): Promise<DashboardBundle> {
  const forceRefresh = options?.forceRefresh ?? false;
  const tenantId = asString(options?.tenantId).trim();
  const userId = asString(options?.userId).trim();
  const cacheKey = `${tenantId || "default"}:${userId || "anon"}`;
  if (!forceRefresh) {
    const cached = getCachedValue(dashboardCache, cacheKey);
    if (cached) return cached;
  }

  const tenantFilter = tenantId ? { tenant_id: tenantId } : null;

  const [eventRows, productRows, partnerRows, ligaRows, postRows, treinoRows, totalAlunos, totalCaca] =
    await Promise.all([
      fetchDashboardEventRows(tenantId || undefined),
      fetchRowsWithFallback("produtos", DASHBOARD_PRODUCTS_SELECT, [
        {
          limit: DASHBOARD_PRODUCTS_LIMIT,
          eq: {
            active: true,
            aprovado: true,
            ...(tenantFilter ?? {}),
          },
        },
      ]),
      fetchRowsWithFallback("parceiros", DASHBOARD_PARTNERS_SELECT, [
        {
          eq: {
            status: "active",
            ...(tenantFilter ?? {}),
          },
          limit: DASHBOARD_PARTNERS_LIMIT,
        },
        { limit: DASHBOARD_PARTNERS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
      ]),
      fetchDashboardLeagueRows({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      }),
      fetchRowsWithFallback("posts", DASHBOARD_POSTS_SELECT, [
        {
          orderBy: { column: "createdAt", ascending: false },
          limit: DASHBOARD_POSTS_LIMIT,
          ...(tenantFilter ? { eq: tenantFilter } : {}),
        },
        { limit: DASHBOARD_POSTS_LIMIT, ...(tenantFilter ? { eq: tenantFilter } : {}) },
      ]),
      fetchDashboardTreinoRows({
        tenantId: tenantId || undefined,
        userId: userId || undefined,
      }),
      safeUsersCount(tenantId || undefined),
      fetchDashboardTotalCaca(tenantId || undefined),
    ]);

  const events = eventRows
    .map((row) => normalizeEvento(asString(row.id), row))
    .filter((row): row is DashboardEvent => row !== null)
    .filter((event) => {
      const normalizedStatus = asString(event.status, "ativo").toLowerCase().trim();
      if (
        normalizedStatus === "encerrado" ||
        normalizedStatus === "cancelado" ||
        normalizedStatus === "inativo"
      ) {
        return false;
      }
      return !isEventExpiredByGrace(event.data, event.hora, DASHBOARD_EVENT_GRACE_MS);
    })
    .slice(0, DASHBOARD_EVENTS_LIMIT);
  const produtos = productRows.map((row) => normalizeProduto(asString(row.id), row)).filter((row): row is DashboardProduct => row !== null);
  const parceiros = partnerRows
    .map((row) => normalizeParceiro(asString(row.id), row))
    .filter((row): row is DashboardPartner => row !== null)
    .filter((partner) => (partner.status || "active") === "active");
  const ligasBase = ligaRows
    .map((row) => normalizeLiga(asString(row.id), row))
    .filter((row): row is DashboardLiga => row !== null)
    .filter((liga) => liga.visivel === true)
    .sort((left, right) => (right.likes || 0) - (left.likes || 0));
  const ligas =
    ligasBase.length > DASHBOARD_LIGAS_DASHBOARD_LIMIT
      ? seededShuffle(
          ligasBase,
          `${userId || "anon"}:${tenantId || "default"}:${new Date().toISOString().slice(0, 10)}`
        )
          .slice(0, DASHBOARD_LIGAS_DASHBOARD_LIMIT)
          .sort((left, right) => (right.likes || 0) - (left.likes || 0))
      : ligasBase;
  const mensagens = [...postRows]
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .map((row) => normalizePost(asString(row.id), row))
    .filter((row): row is DashboardPost => row !== null);
  const treinos = treinoRows.map((row) => asString(row.imagem)).filter((entry) => entry.length > 0);
  const productTurmaStats = await buildProductTurmaStats(produtos, tenantId || undefined);

  const bundle: DashboardBundle = {
    events,
    produtos,
    parceiros,
    ligas,
    mensagens,
    treinos,
    totalCaca,
    totalAlunos,
    productTurmaStats,
  };

  setCachedValue(dashboardCache, cacheKey, bundle);
  return bundle;
}

export async function toggleDashboardEventLike(payload: { eventId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const eventId = payload.eventId.trim();
  const userId = payload.userId.trim();
  if (!eventId || !userId) return;
  await toggleArrayMembership({ table: "eventos", id: eventId, column: "likesList", userId, currentlyLiked: payload.currentlyLiked });
}

export async function toggleDashboardProductLike(payload: { productId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const productId = payload.productId.trim();
  const userId = payload.userId.trim();
  if (!productId || !userId) return;
  await toggleArrayMembership({ table: "produtos", id: productId, column: "likes", userId, currentlyLiked: payload.currentlyLiked });
}

export async function toggleDashboardPostLike(payload: { postId: string; userId: string; currentlyLiked: boolean }): Promise<void> {
  const postId = payload.postId.trim();
  const userId = payload.userId.trim();
  if (!postId || !userId) return;
  await toggleArrayMembership({ table: "posts", id: postId, column: "likes", userId, currentlyLiked: payload.currentlyLiked });
}

export function clearDashboardCaches(): void {
  dashboardCache.clear();
}


