import { ServerCache } from "./serverCache";
import { fetchPublicTenantBySlugWithAdmin } from "./publicTenantDirectoryService";
import { QueryMonitor } from "./queryMonitor";
import { supabaseAdmin } from "./supabaseAdmin";
import {
  createDefaultTenantAppModulesConfig,
  TENANT_APP_MODULE_DEFINITIONS,
  type TenantAppModulesConfig,
} from "./tenantAppModulesService";
import {
  resolveDefaultTenantAdminSidebarProfileKey,
  type TenantAdminSidebarProfilesConfig,
} from "./tenantAdminSidebarService";
import type {
  DashboardBundle,
  DashboardEvent,
  DashboardLiga,
  DashboardPartner,
  DashboardPost,
  DashboardProduct,
  DashboardTurmaStat,
} from "./dashboardPublicService";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

const PUBLIC_DASHBOARD_CACHE_TTL_MS = 60_000;
const PUBLIC_DASHBOARD_ENDPOINT = "/api/public/dashboard";
const ADMIN_SIDEBAR_PROFILES_DOC_ID = "tenant_admin_sidebar_profiles";
const ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID = "tenant_admin_sidebar_profile_assignment";
const APP_MODULES_DOC_ID = "app_modules";
const DASHBOARD_HOME_BUNDLE_RPC = "dashboard_public_home_bundle";
const DASHBOARD_LIGAS_SELECT =
  "id,nome,sigla,foto,logoUrl,logo,descricao,bizu,ativa,visivel,status,likes,createdAt,updatedAt";
const DASHBOARD_LIGAS_LIMIT = 2;
const DASHBOARD_LIGAS_QUERY_WINDOW = 6;

type Row = Record<string, unknown>;

export interface PublicDashboardViewPayload {
  data: DashboardBundle;
  modulesConfig: TenantAppModulesConfig;
  tenantId: string;
}

const emptyDashboardBundle = (): DashboardBundle => ({
  events: [],
  produtos: [],
  parceiros: [],
  ligas: [],
  mensagens: [],
  treinos: [],
  totalCaca: 0,
  totalAlunos: 0,
  productTurmaStats: {},
});

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
};

const normalizeModules = (raw: unknown): Record<string, boolean> => {
  const source = asObject(raw) ?? {};
  const next = { ...createDefaultTenantAppModulesConfig().modules };

  for (const definition of TENANT_APP_MODULE_DEFINITIONS) {
    const direct = source[definition.key];
    if (typeof direct === "boolean") {
      next[definition.key] = direct;
      continue;
    }

    for (const legacyKey of definition.legacyKeys ?? []) {
      const inherited = source[legacyKey];
      if (typeof inherited === "boolean") {
        next[definition.key] = inherited;
        break;
      }
    }
  }

  return next;
};

const resolveModuleVisibility = (
  source: Record<string, boolean>,
  key: string,
  legacyKeys?: string[]
): boolean => {
  const direct = source[key];
  if (typeof direct === "boolean") return direct;

  for (const legacyKey of legacyKeys ?? []) {
    const inherited = source[legacyKey];
    if (typeof inherited === "boolean") return inherited;
  }

  return true;
};

const buildModuleConfig = (
  tenantModulesRaw: unknown,
  profileModulesRaw: unknown
): TenantAppModulesConfig => {
  const tenantModules = normalizeModules(tenantModulesRaw);
  const profileModules = normalizeModules(profileModulesRaw);
  const mergedModules = { ...tenantModules };

  TENANT_APP_MODULE_DEFINITIONS.forEach((definition) => {
    if (!resolveModuleVisibility(profileModules, definition.key, definition.legacyKeys)) {
      mergedModules[definition.key] = false;
    }
  });

  return { modules: mergedModules };
};

const buildStableSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
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

const normalizeLeague = (raw: unknown): DashboardLiga | null => {
  const data = asObject(raw);
  const id = asString(data?.id).trim();
  if (!data || !id) return null;

  const logoUrl = asString(data.logoUrl) || undefined;
  const logoLegacy = asString(data.logo) || undefined;

  return {
    id,
    nome: asString(data.nome, "Liga"),
    sigla: asString(data.sigla),
    foto: asString(data.foto) || undefined,
    logoUrl,
    logo: logoLegacy || logoUrl,
    descricao: asString(data.descricao) || undefined,
    bizu: asString(data.bizu) || undefined,
    ativa: asBoolean(data.ativa, false),
    visivel: asBoolean(data.visivel, false),
    status: asString(data.status) || undefined,
    likes: asInteger(data.likes, 0),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
};

const normalizeEvent = (raw: unknown): DashboardEvent | null => {
  const data = asObject(raw);
  const id = asString(data?.id).trim();
  if (!data || !id) return null;

  return {
    id,
    titulo: asString(data.titulo, "Evento"),
    data: asString(data.data),
    hora: asString(data.hora) || undefined,
    local: asString(data.local),
    imagem: asString(data.imagem),
    tipo: asString(data.tipo, "Geral"),
    status: asString(data.status) || undefined,
    likesCount: Math.max(0, asInteger(data.likesCount, 0)),
    viewerHasLiked: asBoolean(data.viewerHasLiked, false),
    interessadosCount: Math.max(0, asInteger(data.interessadosCount, 0)),
    viewerIsInterested: asBoolean(data.viewerIsInterested, false),
    imagePositionY:
      typeof data.imagePositionY === "number" && Number.isFinite(data.imagePositionY)
        ? data.imagePositionY
        : undefined,
  };
};

const normalizeProduct = (
  raw: unknown,
  productTurmaStats: Record<string, DashboardTurmaStat[]>
): DashboardProduct | null => {
  const data = asObject(raw);
  const id = asString(data?.id).trim();
  if (!data || !id) return null;

  productTurmaStats[id] = asArray(data.topTurmas)
    .map((entry) => {
      const row = asObject(entry);
      const turma = asString(row?.turma).trim();
      const count = Math.max(0, asInteger(row?.count, 0));
      if (!turma || count <= 0) return null;
      return { turma, count } satisfies DashboardTurmaStat;
    })
    .filter((entry): entry is DashboardTurmaStat => entry !== null)
    .slice(0, 3);

  return {
    id,
    nome: asString(data.nome, "Produto"),
    preco: asString(data.preco) || asInteger(data.preco, 0),
    img: asString(data.img),
    likesCount: Math.max(0, asInteger(data.likesCount, 0)),
    viewerHasLiked: asBoolean(data.viewerHasLiked, false),
  };
};

const normalizePartner = (raw: unknown): DashboardPartner | null => {
  const data = asObject(raw);
  const id = asString(data?.id).trim();
  if (!data || !id) return null;

  return {
    id,
    nome: asString(data.nome, "Parceiro"),
    imgLogo: asString(data.imgLogo),
    imgCapa: asString(data.imgCapa) || undefined,
    categoria: asString(data.categoria) || undefined,
    plano: asString(data.tier) || undefined,
    status: asString(data.status) || undefined,
  };
};

const normalizePost = (raw: unknown): DashboardPost | null => {
  const data = asObject(raw);
  const id = asString(data?.id).trim();
  if (!data || !id) return null;

  return {
    id,
    userId: asString(data.userId),
    userName: asString(data.userName, "Usuário"),
    avatar: asString(data.avatar),
    createdAt: data.createdAt ?? null,
    texto: asString(data.texto),
    likesCount: Math.max(0, asInteger(data.likesCount, 0)),
    viewerHasLiked: asBoolean(data.viewerHasLiked, false),
  };
};

const fetchLeaguePreviewWithAdmin = async (
  tenantId: string
): Promise<DashboardLiga[]> => {
  const attempts: Array<{ orderBy: string }> = [{ orderBy: "likes" }, { orderBy: "updatedAt" }];
  let rows: Row[] = [];

  for (const attempt of attempts) {
    const { data, error } = await supabaseAdmin
      .from("ligas_config")
      .select(DASHBOARD_LIGAS_SELECT)
      .eq("tenant_id", tenantId)
      .eq("visivel", true)
      .order(attempt.orderBy, { ascending: false })
      .limit(DASHBOARD_LIGAS_QUERY_WINDOW);

    if (!error) {
      rows = (Array.isArray(data) ? data : []) as Row[];
      break;
    }
  }

  return seededShuffle(
    rows
      .map((entry) => normalizeLeague(entry))
      .filter((entry): entry is DashboardLiga => entry !== null)
      .filter((entry) => entry.visivel === true),
    `${tenantId}:${new Date().toISOString().slice(0, 10)}:public-ligas`
  )
    .slice(0, DASHBOARD_LIGAS_LIMIT)
    .sort((left, right) => (right.likes || 0) - (left.likes || 0));
};

const fetchModulesConfigWithAdmin = async (
  tenantId: string,
  tenantSlug?: string
): Promise<TenantAppModulesConfig> => {
  const ids = [
    ADMIN_SIDEBAR_PROFILES_DOC_ID,
    buildTenantScopedRowId(tenantId, ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID),
    buildTenantScopedRowId(tenantId, APP_MODULES_DOC_ID),
  ];

  const { data, error } = await supabaseAdmin
    .from("app_config")
    .select("id,data")
    .in("id", ids);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data)
    ? data.map((entry) => asObject(entry)).filter((entry): entry is Row => entry !== null)
    : [];

  const profilesRow = rows.find((entry) => asString(entry.id) === ADMIN_SIDEBAR_PROFILES_DOC_ID);
  const assignmentRow = rows.find(
    (entry) =>
      asString(entry.id) === buildTenantScopedRowId(tenantId, ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID)
  );
  const tenantModulesRow = rows.find(
    (entry) => asString(entry.id) === buildTenantScopedRowId(tenantId, APP_MODULES_DOC_ID)
  );

  const profilesData =
    (asObject(profilesRow?.data) ?? {}) as unknown as TenantAdminSidebarProfilesConfig;
  const storedProfileKey = asString(asObject(assignmentRow?.data)?.profileKey).trim();
  const defaultProfileKey = resolveDefaultTenantAdminSidebarProfileKey({
    tenantSlug,
    config: profilesData,
  });
  const profileKey =
    storedProfileKey && asObject(asObject(profilesData.profiles)?.[storedProfileKey])
      ? storedProfileKey
      : defaultProfileKey;
  const profileModules = asObject(asObject(asObject(profilesData.profiles)?.[profileKey])?.appModules);
  const tenantModules = asObject(tenantModulesRow?.data)?.modules;

  return buildModuleConfig(tenantModules, profileModules);
};

const measurePayloadBytes = (payload: unknown): number => {
  try {
    return JSON.stringify(payload).length;
  } catch {
    return 0;
  }
};

export async function fetchPublicDashboardViewWithAdmin(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
  tenantSlug?: string | null;
}): Promise<PublicDashboardViewPayload> {
  const forceRefresh = options?.forceRefresh ?? false;
  const requestedTenantId = asString(options?.tenantId).trim();
  const tenantSlug = asString(options?.tenantSlug).trim().toLowerCase();

  let tenantId = requestedTenantId;
  if (!tenantId && tenantSlug) {
    const tenant = await fetchPublicTenantBySlugWithAdmin(tenantSlug);
    tenantId = tenant?.id?.trim() || "";
  }

  if (!tenantId) {
    return {
      data: emptyDashboardBundle(),
      modulesConfig: createDefaultTenantAppModulesConfig(),
      tenantId: "",
    };
  }

  const cacheKey = `public_dashboard_view:${tenantId}`;
  const fetcher = async (): Promise<PublicDashboardViewPayload> => {
    const startedAt = Date.now();
    const [{ data: rpcData, error: rpcError }, modulesConfig, leaguePreview] =
      await Promise.all([
        supabaseAdmin.rpc(DASHBOARD_HOME_BUNDLE_RPC, {
          p_tenant_id: tenantId,
          p_user_id: null,
        }),
        fetchModulesConfigWithAdmin(tenantId, tenantSlug),
        fetchLeaguePreviewWithAdmin(tenantId),
      ]);

    if (rpcError) {
      throw rpcError;
    }

    const payload = asObject(rpcData) ?? {};
    const productTurmaStats: Record<string, DashboardTurmaStat[]> = {};
    const rpcLigas = asArray(payload.ligas)
      .map((entry) => normalizeLeague(entry))
      .filter((entry): entry is DashboardLiga => entry !== null)
      .filter((entry) => entry.visivel === true);

    const response: PublicDashboardViewPayload = {
      data: {
        events: asArray(payload.events)
          .map((entry) => normalizeEvent(entry))
          .filter((entry): entry is DashboardEvent => entry !== null),
        produtos: asArray(payload.produtos)
          .map((entry) => normalizeProduct(entry, productTurmaStats))
          .filter((entry): entry is DashboardProduct => entry !== null),
        parceiros: asArray(payload.parceiros)
          .map((entry) => normalizePartner(entry))
          .filter((entry): entry is DashboardPartner => entry !== null),
        ligas: rpcLigas.length > 0 ? rpcLigas : leaguePreview,
        mensagens: asArray(payload.mensagens)
          .map((entry) => normalizePost(entry))
          .filter((entry): entry is DashboardPost => entry !== null),
        treinos: asArray(payload.treinos)
          .map((entry) => asString(entry).trim())
          .filter((entry) => entry.length > 0),
        totalCaca: Math.max(0, asInteger(payload.totalCaca, 0)),
        totalAlunos: Math.max(0, asInteger(payload.totalAlunos, 0)),
        productTurmaStats,
      },
      modulesConfig,
      tenantId,
    };

    QueryMonitor.recordQuery({
      endpoint: PUBLIC_DASHBOARD_ENDPOINT,
      method: "GET",
      durationMs: Date.now() - startedAt,
      payloadBytes: measurePayloadBytes(response),
      cacheHit: false,
      statusCode: 200,
      tenantId,
    });

    return response;
  };

  if (forceRefresh) {
    ServerCache.delete(cacheKey);
    return fetcher();
  }

  const cached = ServerCache.get<PublicDashboardViewPayload>(cacheKey);
  if (cached) {
    QueryMonitor.recordQuery({
      endpoint: PUBLIC_DASHBOARD_ENDPOINT,
      method: "GET",
      durationMs: 0,
      payloadBytes: measurePayloadBytes(cached),
      cacheHit: true,
      statusCode: 200,
      tenantId,
    });
    return cached;
  }

  const fresh = await ServerCache.getOrSet(cacheKey, fetcher, PUBLIC_DASHBOARD_CACHE_TTL_MS);
  return fresh;
}
