import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";
import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import {
  fetchTenantAdminSidebarProfileAssignment,
  fetchTenantAdminSidebarProfilesConfig,
  resolveTenantAdminSidebarProfile,
  type TenantAdminSidebarProfilesConfig,
} from "./tenantAdminSidebarService";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

export type TenantAppModuleKey = string;

export interface TenantAppModuleDefinition {
  key: TenantAppModuleKey;
  label: string;
  description: string;
  surfaces: Array<"dashboard" | "sidebar" | "bottom_nav" | "settings" | "route">;
  route?: string;
  matchRoutes?: string[];
  group: "base" | "conteudo" | "atleta" | "info";
  legacyKeys?: string[];
}

export interface TenantAppModulesConfig {
  modules: Record<string, boolean>;
}

const READ_CACHE_TTL_MS = 60_000;
const APP_MODULES_DOC_ID = "app_modules";
const appModulesCache = new Map<string, CacheEntry<TenantAppModulesConfig>>();
const effectiveAppModulesCache = new Map<string, CacheEntry<TenantAppModulesConfig>>();

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

const moduleItem = (
  key: TenantAppModuleKey,
  label: string,
  description: string,
  surfaces: TenantAppModuleDefinition["surfaces"],
  route: string | undefined,
  group: TenantAppModuleDefinition["group"],
  matchRoutes?: string[],
  legacyKeys?: string[]
): TenantAppModuleDefinition => ({
  key,
  label,
  description,
  surfaces,
  ...(route ? { route } : {}),
  ...(matchRoutes?.length ? { matchRoutes } : {}),
  group,
  ...(legacyKeys?.length ? { legacyKeys } : {}),
});

export const TENANT_APP_MODULE_DEFINITIONS: TenantAppModuleDefinition[] = [
  moduleItem(
    "dashboard",
    "Dashboard",
    "Controla a entrada principal do app da atletica.",
    ["dashboard", "route"],
    "/dashboard",
    "base",
    ["/dashboard"]
  ),
  moduleItem(
    "perfil",
    "Perfil",
    "Acesso ao perfil do atleta no topo do dashboard e na lateral.",
    ["dashboard", "sidebar"],
    "/perfil",
    "base",
    ["/perfil"]
  ),
  moduleItem(
    "perfil_mini_vendor",
    "Perfil Publico Mini Vendor",
    "Controla o perfil publico das lojinhas mini vendor.",
    ["route"],
    "/perfil/mini-vendor",
    "base",
    ["/perfil/mini-vendor"],
    ["perfil"]
  ),
  moduleItem(
    "carteirinha",
    "Carteirinha",
    "Exibe a carteirinha digital no dashboard e no menu.",
    ["dashboard", "sidebar", "bottom_nav"],
    "/carteirinha",
    "base",
    ["/carteirinha"]
  ),
  moduleItem(
    "configuracoes",
    "Configuracoes",
    "Central de configuracoes do usuario, seguranca e pedidos.",
    ["settings", "route"],
    "/configuracoes",
    "base",
    ["/configuracoes"]
  ),
  moduleItem(
    "configuracoes_lider_turma",
    "Configuracoes - Lider de Turma",
    "Acesso aos ajustes de lider de turma.",
    ["settings", "route"],
    "/configuracoes/lider-turma",
    "base",
    ["/configuracoes/lider-turma"],
    ["configuracoes"]
  ),
  moduleItem(
    "seguranca",
    "Configuracoes - Seguranca",
    "Acesso aos ajustes de seguranca da conta.",
    ["settings", "route"],
    "/configuracoes/seguranca",
    "base",
    ["/configuracoes/seguranca"],
    ["configuracoes"]
  ),
  moduleItem(
    "suporte",
    "Configuracoes - Suporte",
    "Acesso aos canais de suporte.",
    ["settings", "route"],
    "/configuracoes/suporte",
    "base",
    ["/configuracoes/suporte"],
    ["configuracoes"]
  ),
  moduleItem(
    "termos",
    "Configuracoes - Termos",
    "Acesso aos termos e documentos do app.",
    ["settings", "route"],
    "/configuracoes/termos",
    "base",
    ["/configuracoes/termos"],
    ["configuracoes"]
  ),
  moduleItem(
    "pedidos",
    "Configuracoes - Pedidos",
    "Historico consolidado de pedidos do usuario.",
    ["settings", "route"],
    "/configuracoes/pedidos",
    "base",
    ["/configuracoes/pedidos"],
    ["configuracoes"]
  ),
  moduleItem(
    "pedidos_eventos",
    "Pedidos - Eventos",
    "Pedidos e ingressos de eventos.",
    ["settings", "route"],
    "/configuracoes/pedidos/eventos",
    "base",
    ["/configuracoes/pedidos/eventos"],
    ["pedidos", "configuracoes"]
  ),
  moduleItem(
    "pedidos_loja",
    "Pedidos - Loja",
    "Pedidos feitos na loja.",
    ["settings", "route"],
    "/configuracoes/pedidos/loja",
    "base",
    ["/configuracoes/pedidos/loja"],
    ["pedidos", "configuracoes"]
  ),
  moduleItem(
    "pedidos_planos",
    "Pedidos - Planos",
    "Pedidos e adesoes de planos.",
    ["settings", "route"],
    "/configuracoes/pedidos/planos",
    "base",
    ["/configuracoes/pedidos/planos"],
    ["pedidos", "configuracoes"]
  ),
  moduleItem(
    "mini_vendor",
    "Mini Vendor",
    "Libera o hub da lojinha, seus produtos e pedidos na area de configuracoes.",
    ["settings"],
    "/configuracoes/mini-vendor",
    "base",
    ["/configuracoes/mini-vendor"]
  ),
  moduleItem(
    "mini_vendor_editar",
    "Mini Vendor - Editar Loja",
    "Edicao da loja mini vendor.",
    ["settings", "route"],
    "/configuracoes/mini-vendor/editar",
    "base",
    ["/configuracoes/mini-vendor/editar"],
    ["mini_vendor"]
  ),
  moduleItem(
    "mini_vendor_pedidos_aprovados",
    "Mini Vendor - Pedidos Aprovados",
    "Pedidos aprovados da loja mini vendor.",
    ["settings", "route"],
    "/configuracoes/mini-vendor/pedidos-aprovados",
    "base",
    ["/configuracoes/mini-vendor/pedidos-aprovados"],
    ["mini_vendor"]
  ),
  moduleItem(
    "mini_vendor_pedidos_pendentes",
    "Mini Vendor - Pedidos Pendentes",
    "Pedidos pendentes da loja mini vendor.",
    ["settings", "route"],
    "/configuracoes/mini-vendor/pedidos-pendentes",
    "base",
    ["/configuracoes/mini-vendor/pedidos-pendentes"],
    ["mini_vendor"]
  ),
  moduleItem(
    "mini_vendor_produtos",
    "Mini Vendor - Produtos",
    "Cadastro de produtos da loja mini vendor.",
    ["settings", "route"],
    "/configuracoes/mini-vendor/produtos",
    "base",
    ["/configuracoes/mini-vendor/produtos"],
    ["mini_vendor"]
  ),
  moduleItem(
    "album",
    "Album da Galera",
    "Libera o album e o scanner no app.",
    ["dashboard", "sidebar", "bottom_nav"],
    "/album",
    "conteudo",
    ["/album"]
  ),
  moduleItem(
    "eventos",
    "Eventos",
    "Controla eventos no dashboard e na navegacao principal.",
    ["dashboard", "sidebar", "bottom_nav"],
    "/eventos",
    "conteudo",
    ["/eventos"]
  ),
  moduleItem(
    "eventos_compra",
    "Eventos - Compra",
    "Fluxo de compra vinculado aos eventos.",
    ["route"],
    "/eventos/compra",
    "conteudo",
    ["/eventos/compra"],
    ["eventos"]
  ),
  moduleItem(
    "loja",
    "Loja",
    "Mostra a lojinha no dashboard e na lateral.",
    ["dashboard", "sidebar"],
    "/loja",
    "conteudo",
    ["/loja"]
  ),
  moduleItem(
    "carrinho",
    "Loja - Carrinho",
    "Carrinho da loja do tenant.",
    ["route"],
    "/carrinho",
    "conteudo",
    ["/carrinho"],
    ["loja"]
  ),
  moduleItem(
    "checkout",
    "Loja - Checkout",
    "Checkout da loja e dos pedidos.",
    ["route"],
    "/checkout",
    "conteudo",
    ["/checkout"],
    ["loja"]
  ),
  moduleItem(
    "comunidade",
    "Comunidade",
    "Mostra comunidade no dashboard e na barra lateral.",
    ["dashboard", "sidebar"],
    "/comunidade",
    "conteudo",
    ["/comunidade"]
  ),
  moduleItem(
    "parceiros",
    "Parceiros",
    "Exibe parceiros premium no dashboard e o atalho no menu.",
    ["dashboard", "sidebar"],
    "/parceiros",
    "conteudo",
    ["/parceiros"]
  ),
  moduleItem(
    "empresa",
    "Painel Empresa",
    "Painel publico e historico dos parceiros.",
    ["route"],
    "/empresa",
    "conteudo",
    ["/empresa"],
    ["parceiros"]
  ),
  moduleItem(
    "sharkround",
    "BoardRound",
    "Mostra o card e o atalho do BoardRound.",
    ["dashboard", "sidebar"],
    "/boardround",
    "atleta",
    ["/boardround", "/sharkround"]
  ),
  moduleItem(
    "sharkround_estatisticas",
    "BoardRound - Estatisticas",
    "Estatisticas detalhadas do BoardRound.",
    ["route"],
    "/boardround/estatisticas",
    "atleta",
    ["/boardround/estatisticas", "/sharkround/estatisticas"],
    ["sharkround"]
  ),
  moduleItem(
    "sharkround_ranking",
    "BoardRound - Ranking",
    "Ranking do BoardRound.",
    ["route"],
    "/boardround/ranking",
    "atleta",
    ["/boardround/ranking", "/sharkround/ranking"],
    ["sharkround"]
  ),
  moduleItem(
    "treinos",
    "Treinos",
    "Lista treinos no dashboard e no menu lateral.",
    ["dashboard", "sidebar"],
    "/treinos",
    "atleta",
    ["/treinos"]
  ),
  moduleItem(
    "gym_rats",
    "Gym / Check-in",
    "Controla o acesso ao modulo gym e check-in da atletica.",
    ["sidebar", "route"],
    "/gym",
    "atleta",
    ["/gym", "/gym-rats"]
  ),
  moduleItem(
    "gym_checkin",
    "Gym - Check-in",
    "Tela de check-in do modulo gym.",
    ["route"],
    "/gym/checkin",
    "atleta",
    ["/gym/checkin"],
    ["gym_rats"]
  ),
  moduleItem(
    "gym_checkin_details",
    "Gym - Check-in Details",
    "Detalhes do check-in do modulo gym.",
    ["route"],
    "/gym/checkin/details",
    "atleta",
    ["/gym/checkin/details"],
    ["gym_checkin", "gym_rats"]
  ),
  moduleItem(
    "arena_games",
    "Arena Games",
    "Mostra o atalho da Arena Games na lateral.",
    ["sidebar", "route"],
    "/games",
    "atleta",
    ["/games", "/arena-games"]
  ),
  moduleItem(
    "ranking",
    "Ranking",
    "Mostra o atalho de ranking na lateral.",
    ["sidebar", "route"],
    "/ranking",
    "atleta",
    ["/ranking"]
  ),
  moduleItem(
    "ligas",
    "Ligas USC",
    "Exibe a area principal das ligas no dashboard e no menu.",
    ["dashboard", "sidebar"],
    "/ligas_usc",
    "info",
    ["/ligas_usc", "/ligas_unitau"]
  ),
  moduleItem(
    "ligas_gerenciar",
    "Ligas - Gerenciar",
    "Tela de gestao interna das ligas e do quiz.",
    ["route"],
    "/ligas",
    "info",
    ["/ligas"],
    ["ligas"]
  ),
  moduleItem(
    "planos",
    "Planos",
    "Catalogo de planos e assinaturas do tenant.",
    ["sidebar", "route"],
    "/planos",
    "info",
    ["/planos"]
  ),
  moduleItem(
    "planos_adesao",
    "Planos - Adesao",
    "Fluxo de adesao e contratacao de planos.",
    ["route"],
    "/planos/adesao",
    "info",
    ["/planos/adesao"],
    ["planos"]
  ),
  moduleItem(
    "avaliacao",
    "Avaliacao",
    "Mostra o atalho de avaliacao de professores.",
    ["sidebar"],
    "/avaliacao",
    "info",
    ["/avaliacao"]
  ),
  moduleItem(
    "conquistas",
    "Conquistas",
    "Mostra o acesso a conquistas na lateral.",
    ["sidebar", "route"],
    "/conquistas",
    "info",
    ["/conquistas"]
  ),
  moduleItem(
    "fidelidade",
    "Fidelidade",
    "Mostra o acesso ao clube de fidelidade na lateral.",
    ["sidebar", "route"],
    "/fidelidade",
    "info",
    ["/fidelidade"]
  ),
  moduleItem(
    "guia",
    "Guia",
    "Controla o atalho do guia do app na central de informacoes.",
    ["sidebar", "route"],
    "/guia",
    "info",
    ["/guia"]
  ),
  moduleItem(
    "historico",
    "Nossa Historia",
    "Controla o acesso ao historico institucional da atletica.",
    ["sidebar", "route"],
    "/historico",
    "info",
    ["/historico"]
  ),
];

const DEFAULT_MODULES = TENANT_APP_MODULE_DEFINITIONS.reduce<Record<string, boolean>>(
  (acc, definition) => {
    acc[definition.key] = true;
    return acc;
  },
  {}
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
  return [buildTenantScopedRowId(cleanTenantId, APP_MODULES_DOC_ID)];
};

const normalizeModules = (raw: unknown): Record<string, boolean> => {
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

const resolveDefinitionByKey = (key: string): TenantAppModuleDefinition | null =>
  TENANT_APP_MODULE_DEFINITIONS.find((definition) => definition.key === key) ?? null;

const resolveDefinitionVisibility = (
  source: Record<string, boolean>,
  definition: TenantAppModuleDefinition
): boolean => {
  const direct = source[definition.key];
  if (typeof direct === "boolean") {
    return direct;
  }

  for (const legacyKey of definition.legacyKeys ?? []) {
    const inherited = source[legacyKey];
    if (typeof inherited === "boolean") {
      return inherited;
    }
  }

  return true;
};

export const createDefaultTenantAppModulesConfig = (): TenantAppModulesConfig => ({
  modules: { ...DEFAULT_MODULES },
});

export const isTenantAdminProfileAppModuleVisible = (
  config: TenantAdminSidebarProfilesConfig,
  profileKey: string,
  moduleKey: string
): boolean => {
  const profile = resolveTenantAdminSidebarProfile(config, profileKey);
  const definition = resolveDefinitionByKey(moduleKey);
  if (!definition) {
    return profile.appModules[moduleKey] !== false;
  }
  return resolveDefinitionVisibility(profile.appModules, definition);
};

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
  const { data, error } = await supabase.from("app_config").select("id,data").in("id", docIds);
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
      tenant_id: cleanTenantId,
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
  effectiveAppModulesCache.delete(resolveCacheKey(cleanTenantId));
}

export async function fetchEffectiveTenantAppModulesConfig(options?: {
  forceRefresh?: boolean;
  tenantId?: string;
  tenantSlug?: string | null;
}): Promise<TenantAppModulesConfig> {
  const forceRefresh = options?.forceRefresh ?? false;
  const cleanTenantId = resolveModulesTenantId(options?.tenantId);
  const cacheKey = resolveCacheKey(cleanTenantId);

  if (!forceRefresh) {
    const cached = effectiveAppModulesCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= READ_CACHE_TTL_MS) {
      return cached.value;
    }
  }

  const tenantConfig = await fetchTenantAppModulesConfig({
    forceRefresh,
    tenantId: cleanTenantId,
  });

  if (!cleanTenantId) {
    effectiveAppModulesCache.set(cacheKey, {
      cachedAt: Date.now(),
      value: tenantConfig,
    });
    return tenantConfig;
  }

  const profilesConfig = await fetchTenantAdminSidebarProfilesConfig({ forceRefresh });
  const profileKey = await fetchTenantAdminSidebarProfileAssignment({
    tenantId: cleanTenantId,
    tenantSlug: options?.tenantSlug,
    forceRefresh,
    profilesConfig,
  });

  const mergedModules = { ...tenantConfig.modules };
  TENANT_APP_MODULE_DEFINITIONS.forEach((definition) => {
    if (!isTenantAdminProfileAppModuleVisible(profilesConfig, profileKey, definition.key)) {
      mergedModules[definition.key] = false;
    }
  });

  const effectiveConfig = { modules: mergedModules };
  effectiveAppModulesCache.set(cacheKey, {
    cachedAt: Date.now(),
    value: effectiveConfig,
  });
  return effectiveConfig;
}

export function clearEffectiveTenantAppModulesCache(tenantId?: string | null): void {
  const cleanTenantId = resolveModulesTenantId(tenantId);
  if (cleanTenantId) {
    effectiveAppModulesCache.delete(resolveCacheKey(cleanTenantId));
    return;
  }
  effectiveAppModulesCache.clear();
}

export const isTenantAppModuleVisible = (
  config: TenantAppModulesConfig,
  key: TenantAppModuleKey
): boolean => {
  const definition = resolveDefinitionByKey(key);
  if (!definition) return config.modules[key] !== false;
  return resolveDefinitionVisibility(config.modules, definition);
};

export const resolveTenantAppModuleByPath = (
  path: string
): TenantAppModuleDefinition | null => {
  const cleanPath = asString(path).trim();
  if (!cleanPath.startsWith("/")) return null;

  const matchedDefinitions = TENANT_APP_MODULE_DEFINITIONS.filter((definition) => {
    const matchRoutes = definition.matchRoutes?.length
      ? definition.matchRoutes
      : definition.route
        ? [definition.route]
        : [];

    return matchRoutes.some((route) => {
      if (route === "/perfil") {
        return (
          cleanPath === "/perfil" ||
          (cleanPath.startsWith("/perfil/") && !cleanPath.startsWith("/perfil/mini-vendor"))
        );
      }
      return cleanPath === route || cleanPath.startsWith(`${route}/`);
    });
  });

  return (
    matchedDefinitions.sort((left, right) => {
      const leftLength = Math.max(
        ...(left.matchRoutes?.length ? left.matchRoutes : [left.route || ""]).map(
          (route) => route.length
        )
      );
      const rightLength = Math.max(
        ...(right.matchRoutes?.length ? right.matchRoutes : [right.route || ""]).map(
          (route) => route.length
        )
      );
      return rightLength - leftLength;
    })[0] ?? null
  );
};

export const isTenantAppModulePathVisible = (
  config: TenantAppModulesConfig,
  path: string
): boolean => {
  const definition = resolveTenantAppModuleByPath(path);
  if (!definition) return true;
  return isTenantAppModuleVisible(config, definition.key);
};
