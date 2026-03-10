import { getSupabaseClient } from "./supabase";
import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

export type TenantAppModuleKey =
  | "perfil"
  | "carteirinha"
  | "sharkround"
  | "treinos"
  | "album"
  | "eventos"
  | "ligas"
  | "loja"
  | "comunidade"
  | "parceiros"
  | "arena_games"
  | "ranking"
  | "avaliacao"
  | "conquistas"
  | "fidelidade";

export interface TenantAppModuleDefinition {
  key: TenantAppModuleKey;
  label: string;
  description: string;
  surfaces: Array<"dashboard" | "sidebar" | "bottom_nav">;
  route?: string;
  group: "base" | "conteudo" | "atleta" | "info";
}

export interface TenantAppModulesConfig {
  modules: Record<TenantAppModuleKey, boolean>;
}

const READ_CACHE_TTL_MS = 60_000;
const APP_MODULES_DOC_ID = "app_modules";
const appModulesCache = new Map<string, CacheEntry<TenantAppModulesConfig>>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

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

export const TENANT_APP_MODULE_DEFINITIONS: TenantAppModuleDefinition[] = [
  {
    key: "perfil",
    label: "Perfil",
    description: "Acesso ao perfil do atleta no topo do dashboard e na lateral.",
    surfaces: ["dashboard", "sidebar"],
    route: "/perfil",
    group: "base",
  },
  {
    key: "carteirinha",
    label: "Carteirinha",
    description: "Exibe a carteirinha digital no dashboard e no menu.",
    surfaces: ["dashboard", "sidebar", "bottom_nav"],
    route: "/carteirinha",
    group: "base",
  },
  {
    key: "sharkround",
    label: "Shark Round",
    description: "Mostra o card e o atalho do Shark Round.",
    surfaces: ["dashboard", "sidebar"],
    route: "/sharkround",
    group: "atleta",
  },
  {
    key: "treinos",
    label: "Treinos",
    description: "Lista treinos no dashboard e no menu lateral.",
    surfaces: ["dashboard", "sidebar"],
    route: "/treinos",
    group: "atleta",
  },
  {
    key: "album",
    label: "Album da Galera",
    description: "Libera o album e o scanner no app.",
    surfaces: ["dashboard", "sidebar", "bottom_nav"],
    route: "/album",
    group: "conteudo",
  },
  {
    key: "eventos",
    label: "Eventos",
    description: "Controla eventos no dashboard e na navegacao principal.",
    surfaces: ["dashboard", "sidebar", "bottom_nav"],
    route: "/eventos",
    group: "conteudo",
  },
  {
    key: "ligas",
    label: "Ligas",
    description: "Exibe a area das ligas no dashboard e no menu.",
    surfaces: ["dashboard", "sidebar"],
    route: "/ligas_unitau",
    group: "info",
  },
  {
    key: "loja",
    label: "Loja",
    description: "Mostra a lojinha no dashboard e na lateral.",
    surfaces: ["dashboard", "sidebar"],
    route: "/loja",
    group: "conteudo",
  },
  {
    key: "comunidade",
    label: "Comunidade",
    description: "Mostra comunidade no dashboard e na barra lateral.",
    surfaces: ["dashboard", "sidebar"],
    route: "/comunidade",
    group: "conteudo",
  },
  {
    key: "parceiros",
    label: "Parceiros",
    description: "Exibe parceiros premium no dashboard e o atalho no menu.",
    surfaces: ["dashboard", "sidebar"],
    route: "/parceiros",
    group: "conteudo",
  },
  {
    key: "arena_games",
    label: "Arena Games",
    description: "Mostra o atalho da Arena Games na lateral.",
    surfaces: ["sidebar"],
    route: "/arena-games",
    group: "atleta",
  },
  {
    key: "ranking",
    label: "Ranking",
    description: "Mostra o atalho de ranking na lateral.",
    surfaces: ["sidebar"],
    route: "/ranking",
    group: "atleta",
  },
  {
    key: "avaliacao",
    label: "Avaliacao",
    description: "Mostra o atalho de avaliacao de professores.",
    surfaces: ["sidebar"],
    route: "/avaliacao",
    group: "info",
  },
  {
    key: "conquistas",
    label: "Conquistas",
    description: "Mostra o acesso a conquistas na lateral.",
    surfaces: ["sidebar"],
    route: "/conquistas",
    group: "info",
  },
  {
    key: "fidelidade",
    label: "Fidelidade",
    description: "Mostra o acesso ao clube de fidelidade na lateral.",
    surfaces: ["sidebar"],
    route: "/fidelidade",
    group: "info",
  },
];

const DEFAULT_MODULES = TENANT_APP_MODULE_DEFINITIONS.reduce<Record<TenantAppModuleKey, boolean>>(
  (acc, definition) => {
    acc[definition.key] = true;
    return acc;
  },
  {} as Record<TenantAppModuleKey, boolean>
);

const resolveModulesTenantId = (tenantId?: string | null): string =>
  resolveStoredTenantScopeId(asString(tenantId).trim());

const resolveCacheKey = (tenantId?: string): string => {
  const cleanTenantId = resolveModulesTenantId(tenantId);
  return cleanTenantId || "default";
};

const resolveDocIds = (tenantId?: string): string[] => {
  const cleanTenantId = resolveModulesTenantId(tenantId);
  if (!cleanTenantId) return [APP_MODULES_DOC_ID];
  return [buildTenantScopedRowId(cleanTenantId, APP_MODULES_DOC_ID), APP_MODULES_DOC_ID];
};

const normalizeModules = (raw: unknown): Record<TenantAppModuleKey, boolean> => {
  const source = asObject(raw) ?? {};
  const next = { ...DEFAULT_MODULES };
  for (const definition of TENANT_APP_MODULE_DEFINITIONS) {
    const value = source[definition.key];
    if (typeof value === "boolean") {
      next[definition.key] = value;
    }
  }
  return next;
};

export const createDefaultTenantAppModulesConfig = (): TenantAppModulesConfig => ({
  modules: { ...DEFAULT_MODULES },
});

export async function fetchTenantAppModulesConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
}): Promise<TenantAppModulesConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = resolveCacheKey(options?.tenantId);

  if (!forceRefresh) {
    const cached = appModulesCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
      return cached.value;
    }
  }

  const supabase = getSupabaseClient();
  const docIds = resolveDocIds(options?.tenantId);
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data")
    .in("id", docIds);
  if (error) throwSupabaseError(error);

  const rows = Array.isArray(data)
    ? data
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const selectedRow = docIds
    .map((docId) => rows.find((row) => asString(row.id) === docId))
    .find((entry) => Boolean(entry));

  const config: TenantAppModulesConfig = {
    modules: normalizeModules(asObject(selectedRow?.data)?.modules),
  };
  appModulesCache.set(cacheKey, { cachedAt: Date.now(), value: config });
  return config;
}

export async function saveTenantAppModulesConfig(
  config: TenantAppModulesConfig,
  options: { tenantId: string }
): Promise<void> {
  const cleanTenantId = resolveModulesTenantId(options.tenantId);
  if (!cleanTenantId) {
    throw new Error("Tenant invalida para salvar configuracao de modulos.");
  }

  const normalizedModules = normalizeModules(config.modules);
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: buildTenantScopedRowId(cleanTenantId, APP_MODULES_DOC_ID),
      data: { modules: normalizedModules },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  appModulesCache.set(resolveCacheKey(cleanTenantId), {
    cachedAt: Date.now(),
    value: { modules: normalizedModules },
  });
}

export const isTenantAppModuleVisible = (
  config: TenantAppModulesConfig,
  key: TenantAppModuleKey
): boolean => config.modules[key] !== false;
