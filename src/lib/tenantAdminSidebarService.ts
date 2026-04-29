import { getSupabaseClient } from "./supabase";
import { buildTenantScopedRowId } from "./tenantScopedCatalog";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 60_000;
const ADMIN_SIDEBAR_PROFILES_DOC_ID = "tenant_admin_sidebar_profiles";
const ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID = "tenant_admin_sidebar_profile_assignment";

export type TenantAdminSidebarProfileKey = string;

export interface TenantAdminSidebarItemDefinition {
  key: string;
  group: "Base" | "Comercial" | "Conteúdo" | "Esportes" | "Governança" | "Plataforma";
  name: string;
  path: string;
  description: string;
  legacyKeys?: string[];
}

export type TenantAdminSidebarItemKey = TenantAdminSidebarItemDefinition["key"];

export interface TenantAdminSidebarProfileDefinition {
  name: string;
  description: string;
  adminItems: Partial<Record<TenantAdminSidebarItemKey, boolean>>;
  appModules: Record<string, boolean>;
}

export interface TenantAdminSidebarProfilesConfig {
  order: TenantAdminSidebarProfileKey[];
  profiles: Record<TenantAdminSidebarProfileKey, TenantAdminSidebarProfileDefinition>;
}

const profilesCache = new Map<string, CacheEntry<TenantAdminSidebarProfilesConfig>>();
const assignmentCache = new Map<string, CacheEntry<TenantAdminSidebarProfileKey>>();

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

export const TENANT_ADMIN_SIDEBAR_GROUP_ORDER: Array<
  TenantAdminSidebarItemDefinition["group"]
> = ["Base", "Comercial", "Conteúdo", "Esportes", "Governança", "Plataforma"];

const sidebarItem = (
  key: string,
  group: TenantAdminSidebarItemDefinition["group"],
  name: string,
  path: string,
  description: string,
  legacyKeys?: string[]
): TenantAdminSidebarItemDefinition => ({
  key,
  group,
  name,
  path,
  description,
  ...(legacyKeys?.length ? { legacyKeys } : {}),
});

export const TENANT_ADMIN_SIDEBAR_ITEMS: TenantAdminSidebarItemDefinition[] = [
  sidebarItem("atletica", "Base", "Atlética", "/admin/atletica", "Edição dos dados principais, logo e identidade da atlética."),
  sidebarItem("dashboard", "Base", "Dashboard", "/admin", "Entrada principal do painel da atlética."),
  sidebarItem("dashboard_modulos", "Base", "Dashboard Módulos", "/admin/dashboard-modulos", "Controla os atalhos e módulos públicos liberados para o app da atlética."),
  sidebarItem("album", "Base", "Álbum da Galera", "/admin/album", "Gestão do álbum, scanner e visibilidade do conteúdo."),
  sidebarItem("album_caca_calouro", "Base", "Álbum - Caça Calouro", "/admin/album/caca_calouro", "Etapa especial do álbum para caça ao calouro.", ["album"]),
  sidebarItem("album_customizacao", "Base", "Álbum - Customização", "/admin/album/customizacao", "Customização visual e operacional do álbum.", ["album"]),
  sidebarItem("album_pontua_calouro", "Base", "Álbum - Pontua Calouro", "/admin/album/pontua_calouro", "Pontuação do álbum focada em calouros.", ["album"]),
  sidebarItem("album_pontua_geral", "Base", "Álbum - Pontua Geral", "/admin/album/pontua_geral", "Pontuação geral do álbum.", ["album"]),
  sidebarItem("turma", "Base", "Turma", "/admin/turma", "Gestão das turmas e estrutura acadêmica da atlética."),
  sidebarItem("carteirinha", "Base", "Carteirinha", "/admin/carteirinha", "Carteirinha digital e fundos por turma."),
  sidebarItem("guia", "Base", "Guia do App", "/admin/guia", "Guia de links, turismo, transporte e contatos."),
  sidebarItem("usuarios", "Base", "Usuários", "/admin/usuarios", "Gestão de usuários, status e dados da base."),
  sidebarItem("configuracoes", "Comercial", "Configurações", "/admin/configuracoes", "Configurações gerais do tenant e fluxo operacional."),
  sidebarItem("landing", "Comercial", "Landing", "/admin/landing", "Personalização da landing e conteúdo comercial."),
  sidebarItem("loja", "Comercial", "Loja", "/admin/loja", "Produtos, pedidos, reviews e operação da loja."),
  sidebarItem("loja_categorias", "Comercial", "Loja - Categorias", "/admin/loja/categorias", "Cadastro e organização de categorias da loja.", ["loja"]),
  sidebarItem("loja_pedidos_aprovados", "Comercial", "Loja - Pedidos Aprovados", "/admin/loja/pedidos-aprovados", "Histórico e edição dos pedidos aprovados da loja.", ["loja"]),
  sidebarItem("loja_pedidos_pendentes", "Comercial", "Loja - Pedidos Pendentes", "/admin/loja/pedidos-pendentes", "Acompanhamento de pedidos pendentes da loja.", ["loja"]),
  sidebarItem("loja_produtos_desativados", "Comercial", "Loja - Produtos Desativados", "/admin/loja/produtos-desativados", "Histórico de produtos fora do ar com reativação.", ["loja"]),
  sidebarItem("loja_produtos", "Comercial", "Loja - Produtos", "/admin/loja/produtos", "Gestão detalhada dos produtos da loja.", ["loja"]),
  sidebarItem("loja_review", "Comercial", "Loja - Review", "/admin/loja/review", "Revisão e aprovação de reviews da loja.", ["loja"]),
  sidebarItem("mini_vendor_admin", "Comercial", "Mini Vendor Admin", "/admin/mini-vendors", "Aprovação e acompanhamento das lojas mini vendor do tenant."),
  sidebarItem("mini_vendor_aprovacoes", "Comercial", "Mini Vendor - Aprovações", "/admin/mini-vendors/aprovacoes", "Fila de aprovação das lojas mini vendor.", ["mini_vendor_admin"]),
  sidebarItem("mini_vendor_cadastros", "Comercial", "Mini Vendor - Cadastros", "/admin/mini-vendors/cadastros", "Cadastros e auditoria dos mini vendors.", ["mini_vendor_admin"]),
  sidebarItem("parceiros", "Comercial", "Parceiros", "/admin/parceiros", "Rede de parceiros e publicações comerciais."),
  sidebarItem("parceiros_ativos", "Comercial", "Parceiros - Ativos", "/admin/parceiros/ativos", "Lista e status dos parceiros ativos.", ["parceiros"]),
  sidebarItem("parceiros_dados", "Comercial", "Parceiros - Dados", "/admin/parceiros/dados", "Dados operacionais e cadastros de parceiros.", ["parceiros"]),
  sidebarItem("parceiros_empresas", "Comercial", "Parceiros - Empresas", "/admin/parceiros/empresas", "Empresas parceiras e suas vitrines.", ["parceiros"]),
  sidebarItem("parceiros_historico", "Comercial", "Parceiros - Histórico", "/admin/parceiros/historico", "Histórico comercial de parceiros.", ["parceiros"]),
  sidebarItem("planos", "Comercial", "Planos", "/admin/planos", "Planos, assinaturas e auditoria comercial."),
  sidebarItem("planos_auditoria", "Comercial", "Planos - Auditoria", "/admin/planos/auditoria", "Auditoria dos planos comercializados.", ["planos"]),
  sidebarItem("planos_editar", "Comercial", "Planos - Editar", "/admin/planos/editar", "Edição da vitrine e regras dos planos.", ["planos"]),
  sidebarItem("planos_historico", "Comercial", "Planos - Histórico", "/admin/planos/historico", "Histórico de vendas e movimentações de planos.", ["planos"]),
  sidebarItem("planos_lista_atleta", "Comercial", "Planos - Lista Atleta", "/admin/planos/lista_atleta", "Base do plano Atleta.", ["planos"]),
  sidebarItem("planos_lista_bicho_solto", "Comercial", "Planos - Lista Bicho Solto", "/admin/planos/lista_bicho_solto", "Base do plano Bicho Solto.", ["planos"]),
  sidebarItem("planos_lista_cardume_livre", "Comercial", "Planos - Lista Cardume Livre", "/admin/planos/lista_cardume_livre", "Base do plano Cardume Livre.", ["planos"]),
  sidebarItem("planos_lista_lenda", "Comercial", "Planos - Lista Lenda", "/admin/planos/lista_lenda", "Base do plano Lenda.", ["planos"]),
  sidebarItem("fidelidade", "Comercial", "Fidelidade", "/admin/fidelidade", "Clube de fidelidade e recompensas comerciais."),
  sidebarItem("scanner", "Comercial", "Scanner", "/admin/scanner", "Scanner e operações presenciais do tenant."),
  sidebarItem("scan_festas", "Comercial", "Scan Eventos", "/admin/scan-eventos", "Leitura de QR code e baixa de ingressos dos eventos do tenant."),
  sidebarItem("comunidade", "Conteúdo", "Comunidade", "/admin/comunidade", "Moderação e configuração da comunidade."),
  sidebarItem("conquistas", "Conteúdo", "Conquistas", "/admin/conquistas", "Conquistas, patentes e recompensas do tenant."),
  sidebarItem("apadrinhamento", "Conteúdo", "Apadrinhamento", "/admin/apadrinhamento", "Configuração dos títulos e regras de apadrinhamento da atlética."),
  sidebarItem("eventos", "Conteúdo", "Eventos", "/admin/eventos", "Eventos, lotes, enquetes e aprovações."),
  sidebarItem("eventos_encerrados", "Conteúdo", "Eventos - Encerrados", "/admin/eventos/encerrados", "Consulta de eventos encerrados.", ["eventos"]),
  sidebarItem("gestao_eventos", "Comercial", "BI Eventos", "/admin/gestao/eventos", "Análise de vendas, lotes, turmas e scan de eventos.", ["eventos"]),
  sidebarItem("gestao_treinos", "Esportes", "BI Treinos", "/admin/gestao/treinos", "Análise de presença, modalidade, turma e desempenho dos treinos.", ["treinos"]),
  sidebarItem("gestao_produtos", "Comercial", "BI Loja", "/admin/gestao/loja", "Análise da loja oficial da atlética, sem misturar mini vendors, ligas ou outros players.", ["loja"]),
  sidebarItem("historico", "Conteúdo", "Histórico", "/admin/historico", "Página histórica e memória institucional da atlética."),
  sidebarItem("ligas", "Conteúdo", "Ligas", "/admin/ligas", "Gestão das ligas acadêmicas da tenant."),
  sidebarItem("comissoes", "Conteúdo", "Comissões", "/admin/comissoes", "Gestão das comissões, identidade visual e sincronização por turma."),
  sidebarItem("diretorio", "Conteúdo", "Diretório", "/admin/diretorio", "Gestão do diretório, identidade visual e acessos administrativos."),
  sidebarItem("arena_games", "Esportes", "Arena Games", "/admin/games", "Gestão da área gamer da atlética."),
  sidebarItem("gym", "Esportes", "Gym Champ", "/admin/gym", "Programas, ranking e painel esportivo da academia."),
  sidebarItem("sharkround", "Esportes", "BoardRound", "/admin/boardround", "Gestão do BoardRound e sua configuração."),
  sidebarItem("treinos", "Esportes", "Treinos", "/admin/treinos", "Treinos, categorias e aprovações esportivas."),
  sidebarItem("treinos_antigos", "Esportes", "Treinos - Antigos", "/admin/treinos/antigos", "Consulta de treinos antigos.", ["treinos"]),
  sidebarItem("denuncias", "Governança", "Denúncias", "/admin/denuncias", "Fila de denúncias e moderação do tenant."),
  sidebarItem("denuncias_banidos", "Governança", "Denúncias - Banidos", "/admin/denuncias/banidos", "Acompanhamento de usuários banidos.", ["denuncias"]),
  sidebarItem("denuncias_comunidade", "Governança", "Denúncias - Comunidade", "/admin/denuncias/comunidade", "Fila de denúncias vindas da comunidade.", ["denuncias"]),
  sidebarItem("denuncias_gym", "Governança", "Denúncias - Gym", "/admin/denuncias/gym", "Ocorrências relacionadas ao módulo de gym.", ["denuncias"]),
  sidebarItem("denuncias_suporte", "Governança", "Denúncias - Suporte", "/admin/denuncias/suporte", "Chamados e escalações de suporte.", ["denuncias"]),
  sidebarItem("logs", "Governança", "Logs", "/admin/logs", "Auditoria técnica e histórico operacional."),
  sidebarItem("permissoes", "Governança", "Permissões", "/admin/permissoes", "Visualização das permissões e matriz por rota."),
  sidebarItem("permissoes_usuarios", "Governança", "Permissões - Usuários", "/admin/permissoes/usuarios", "Cargos e visibilidade por usuário do tenant.", ["permissoes"]),
  sidebarItem("lancamento", "Plataforma", "Lançamento", "/admin/lancamento", "Painel de ativação, pendências e onboarding do tenant."),
  sidebarItem("lancamento_ativacoes", "Plataforma", "Lançamento - Ativações", "/admin/lancamento/ativacoes", "Acompanhamento das ativações do tenant.", ["lancamento"]),
  sidebarItem("lancamento_convites", "Plataforma", "Lançamento - Convites", "/admin/lancamento/convites", "Convites e acessos de lançamento.", ["lancamento"]),
  sidebarItem("lancamento_pendentes", "Plataforma", "Lançamento - Pendentes", "/admin/lancamento/pendentes", "Pendências e validações do lançamento.", ["lancamento"]),
];

const DEFAULT_PROFILE_BY_TENANT_SLUG: Record<string, TenantAdminSidebarProfileKey> = {
  aaaenf: "A",
  aaakn: "B",
};

const buildDefaultProfileDefinition = (
  key: TenantAdminSidebarProfileKey
): TenantAdminSidebarProfileDefinition => ({
  name: key === "A" ? "Perfil A" : key === "B" ? "Perfil B" : `Perfil ${key}`,
  description:
    key === "A"
      ? "Perfil padrão para novas atléticas."
      : key === "B"
        ? "Perfil alternativo para tenants com outro menu admin."
        : "Perfil personalizado para combinar menu admin e app do usuário.",
  adminItems: {},
  appModules: {},
});

const normalizeProfileKey = (value: unknown): TenantAdminSidebarProfileKey | null => {
  const normalized = asString(value).trim();
  return normalized || null;
};

const normalizeAdminItems = (
  raw: unknown
): Partial<Record<TenantAdminSidebarItemKey, boolean>> => {
  const source = asObject(raw) ?? {};
  const next: Partial<Record<TenantAdminSidebarItemKey, boolean>> = {};
  for (const item of TENANT_ADMIN_SIDEBAR_ITEMS) {
    if (typeof source[item.key] === "boolean") {
      next[item.key] = Boolean(source[item.key]);
    }
  }
  return next;
};

const resolveItemVisibility = (
  profile: TenantAdminSidebarProfileDefinition,
  item: TenantAdminSidebarItemDefinition
): boolean => {
  const direct = profile.adminItems[item.key];
  if (typeof direct === "boolean") {
    return direct;
  }

  for (const legacyKey of item.legacyKeys ?? []) {
    const inherited = profile.adminItems[legacyKey];
    if (typeof inherited === "boolean") {
      return inherited;
    }
  }

  return true;
};

const normalizeAppModules = (raw: unknown): Record<string, boolean> => {
  const source = asObject(raw) ?? {};
  const next: Record<string, boolean> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (typeof value === "boolean") {
      next[key] = value;
    }
  });
  return next;
};

const normalizeProfileDefinition = (
  raw: unknown,
  fallbackKey: TenantAdminSidebarProfileKey
): TenantAdminSidebarProfileDefinition => {
  const source = asObject(raw) ?? {};
  const defaultProfile = buildDefaultProfileDefinition(fallbackKey);
  const adminItemsSource = asObject(source.adminItems) ?? source;

  return {
    name: asString(source.name).trim() || defaultProfile.name,
    description: asString(source.description).trim() || defaultProfile.description,
    adminItems: normalizeAdminItems(adminItemsSource),
    appModules: normalizeAppModules(source.appModules),
  };
};

const resolveProfileOrder = (
  source: Record<string, TenantAdminSidebarProfileDefinition>,
  rawOrder: unknown
): TenantAdminSidebarProfileKey[] => {
  const seen = new Set<string>();
  const order: TenantAdminSidebarProfileKey[] = [];

  if (Array.isArray(rawOrder)) {
    rawOrder.forEach((entry) => {
      const key = normalizeProfileKey(entry);
      if (!key || seen.has(key) || !source[key]) return;
      seen.add(key);
      order.push(key);
    });
  }

  Object.keys(source).forEach((key) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
  });

  return order.length > 0 ? order : ["A", "B"];
};

const normalizeProfilesConfig = (raw: unknown): TenantAdminSidebarProfilesConfig => {
  const source = asObject(raw) ?? {};
  const profilesRaw = asObject(source.profiles) ?? source;
  const profileKeys = new Set<string>(["A", "B"]);

  Object.keys(profilesRaw).forEach((key) => {
    const normalized = normalizeProfileKey(key);
    if (normalized) profileKeys.add(normalized);
  });

  const profiles = Array.from(profileKeys).reduce<
    Record<TenantAdminSidebarProfileKey, TenantAdminSidebarProfileDefinition>
  >((acc, key) => {
    acc[key] = normalizeProfileDefinition(profilesRaw[key], key);
    return acc;
  }, {});

  return {
    order: resolveProfileOrder(profiles, source.order),
    profiles,
  };
};

export const createDefaultTenantAdminSidebarProfilesConfig =
  (): TenantAdminSidebarProfilesConfig => ({
    order: ["A", "B"],
    profiles: {
      A: buildDefaultProfileDefinition("A"),
      B: buildDefaultProfileDefinition("B"),
    },
  });

const resolveFirstProfileKey = (
  config?: TenantAdminSidebarProfilesConfig | null
): TenantAdminSidebarProfileKey => {
  if (config?.order?.length) {
    const firstExisting = config.order.find((key) => config.profiles[key]);
    if (firstExisting) return firstExisting;
  }

  const firstObjectKey = config ? Object.keys(config.profiles)[0] : "";
  return firstObjectKey || "A";
};

export const resolveDefaultTenantAdminSidebarProfileKey = (options?: {
  tenantSlug?: string | null;
  config?: TenantAdminSidebarProfilesConfig | null;
}): TenantAdminSidebarProfileKey => {
  const cleanSlug = asString(options?.tenantSlug).trim().toLowerCase();
  const preferred = DEFAULT_PROFILE_BY_TENANT_SLUG[cleanSlug];
  if (preferred && options?.config?.profiles?.[preferred]) {
    return preferred;
  }
  if (preferred && !options?.config) {
    return preferred;
  }
  return resolveFirstProfileKey(options?.config);
};

export const resolveTenantAdminSidebarProfile = (
  config: TenantAdminSidebarProfilesConfig,
  profileKey?: TenantAdminSidebarProfileKey | null
): TenantAdminSidebarProfileDefinition => {
  const cleanKey = normalizeProfileKey(profileKey);
  if (cleanKey && config.profiles[cleanKey]) {
    return config.profiles[cleanKey];
  }

  const fallbackKey = resolveFirstProfileKey(config);
  return config.profiles[fallbackKey] ?? buildDefaultProfileDefinition(fallbackKey);
};

export async function fetchTenantAdminSidebarProfilesConfig(options?: {
  forceRefresh?: boolean;
}): Promise<TenantAdminSidebarProfilesConfig> {
  const cacheKey = "global";
  if (!options?.forceRefresh) {
    const cached = getCachedValue(profilesCache, cacheKey);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data")
    .eq("id", ADMIN_SIDEBAR_PROFILES_DOC_ID)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const configRow = asObject(data);
  const config = normalizeProfilesConfig(configRow?.data);
  setCachedValue(profilesCache, cacheKey, config);
  return config;
}

export async function saveTenantAdminSidebarProfilesConfig(
  config: TenantAdminSidebarProfilesConfig
): Promise<void> {
  const normalized = normalizeProfilesConfig(config);
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: ADMIN_SIDEBAR_PROFILES_DOC_ID,
      data: normalized,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCachedValue(profilesCache, "global", normalized);
}

export async function fetchTenantAdminSidebarProfileAssignment(options: {
  tenantId: string;
  tenantSlug?: string | null;
  forceRefresh?: boolean;
  profilesConfig?: TenantAdminSidebarProfilesConfig | null;
}): Promise<TenantAdminSidebarProfileKey> {
  const tenantId = asString(options.tenantId).trim();
  const profilesConfig =
    options.profilesConfig ?? (await fetchTenantAdminSidebarProfilesConfig());

  if (!tenantId) {
    return resolveDefaultTenantAdminSidebarProfileKey({
      tenantSlug: options.tenantSlug,
      config: profilesConfig,
    });
  }

  if (!options.forceRefresh) {
    const cached = getCachedValue(assignmentCache, tenantId);
    if (cached && profilesConfig.profiles[cached]) return cached;
  }

  const supabase = getSupabaseClient();
  const docId = buildTenantScopedRowId(tenantId, ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID);
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data")
    .eq("id", docId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const assignmentRow = asObject(data);
  const assignmentData = asObject(assignmentRow?.data);
  const storedProfileKey = normalizeProfileKey(assignmentData?.profileKey);
  const profileKey =
    (storedProfileKey && profilesConfig.profiles[storedProfileKey] ? storedProfileKey : null) ??
    resolveDefaultTenantAdminSidebarProfileKey({
      tenantSlug: options.tenantSlug,
      config: profilesConfig,
    });

  setCachedValue(assignmentCache, tenantId, profileKey);
  return profileKey;
}

export async function saveTenantAdminSidebarProfileAssignment(payload: {
  tenantId: string;
  profileKey: TenantAdminSidebarProfileKey;
}): Promise<void> {
  const tenantId = asString(payload.tenantId).trim();
  if (!tenantId) {
    throw new Error("Tenant inválido para salvar o perfil do admin.");
  }

  const profileKey = normalizeProfileKey(payload.profileKey) ?? "A";
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: buildTenantScopedRowId(tenantId, ADMIN_SIDEBAR_ASSIGNMENT_DOC_ID),
      tenant_id: tenantId,
      data: { profileKey },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCachedValue(assignmentCache, tenantId, profileKey);
}

const resolveManagedItemByPath = (
  path: string
): TenantAdminSidebarItemDefinition | null => {
  const cleanPath = asString(path).trim();
  if (!cleanPath.startsWith("/admin")) return null;

  const matchedItems = TENANT_ADMIN_SIDEBAR_ITEMS.filter((item) => {
    if (item.path === "/admin") {
      return cleanPath === "/admin";
    }
    return cleanPath === item.path || cleanPath.startsWith(`${item.path}/`);
  });

  return (
    matchedItems.sort((left, right) => right.path.length - left.path.length)[0] ?? null
  );
};

export const isTenantAdminSidebarItemVisible = (
  config: TenantAdminSidebarProfilesConfig,
  profileKey: TenantAdminSidebarProfileKey,
  itemKey: TenantAdminSidebarItemKey
): boolean => {
  const item = TENANT_ADMIN_SIDEBAR_ITEMS.find((entry) => entry.key === itemKey);
  if (!item) return true;
  return resolveItemVisibility(resolveTenantAdminSidebarProfile(config, profileKey), item);
};

export const isTenantAdminSidebarAppModuleVisible = (
  config: TenantAdminSidebarProfilesConfig,
  profileKey: TenantAdminSidebarProfileKey,
  moduleKey: string
): boolean => resolveTenantAdminSidebarProfile(config, profileKey).appModules[moduleKey] !== false;

export const isTenantAdminSidebarPathVisible = (
  config: TenantAdminSidebarProfilesConfig,
  profileKey: TenantAdminSidebarProfileKey,
  path: string
): boolean => {
  const item = resolveManagedItemByPath(path);
  if (!item) return true;
  return isTenantAdminSidebarItemVisible(config, profileKey, item.key);
};
