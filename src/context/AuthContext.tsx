"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { clearSupabaseBrowserSessionStorage, getSupabaseClient } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation"; 
import { logActivity } from "../lib/logger"; 
import LoadingScreen from "../app/loading";
import { DEFAULT_STATS, DEFAULT_USER_PROPS } from "../constants/userDefaults";
import { ACHIEVEMENTS_CATALOG } from "@/lib/achievements";
import {
  DEFAULT_PATENTE_CONFIG,
  calculateAchievementSummary,
  mergeAchievementCatalogWithDefaults,
  mergePatentesWithDefaults,
  resolveEffectiveXp,
  resolvePatenteForXp,
} from "@/lib/achievementRuntime";
import { getBackendErrorCode, isPermissionError } from "@/lib/backendErrors";
import { ensureAlbumSelfCollected } from "@/lib/albumService";
import {
  applyPlatformMasterTenantOverride,
  getMasterRolePreview,
  MASTER_TENANT_OVERRIDE_EVENT_NAME,
  MASTER_ROLE_PREVIEW_EVENT_NAME,
  MASTER_ROLE_PREVIEW_STORAGE_KEY,
  getMasterTenantOverrideId,
  MASTER_TENANT_OVERRIDE_STORAGE_KEY,
} from "@/lib/tenantContext";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  buildLoginRedirectUrl,
  readStoredLoginReturnTo,
  sanitizeReturnToPath,
  storeLoginReturnTo,
} from "@/lib/authRedirect";
import {
  getAccessRoleCandidates,
  hasAdminPanelAccess,
  isPlatformMaster,
} from "@/lib/roles";
import {
  fetchUserVisualCatalog,
  type UserVisualPatenteConfig,
  type UserVisualPlanConfig,
} from "@/lib/userVisualsService";

// --- TIPAGEM ---
export type UserRole =
  | "guest"
  | "visitante"
  | "user"
  | "mini_vendor"
  | "treinador"
  | "empresa"
  | "admin_treino"
  | "admin_geral"
  | "admin_gestor"
  | "master"
  | "vendas";
export type UserStatus = "ativo" | "inadimplente" | "banned" | "pendente" | "paused" | "bloqueado";

type PatenteConfig = UserVisualPatenteConfig;
type PlanoConfig = UserVisualPlanConfig;

const DEFAULT_PATENTES: PatenteConfig[] = DEFAULT_PATENTE_CONFIG.map((entry) => ({
  titulo: entry.titulo,
  minXp: entry.minXp,
  iconName: entry.iconName,
  cor: entry.cor,
}));

const DEFAULT_ACHIEVEMENT_RUNTIME_CATALOG = mergeAchievementCatalogWithDefaults(
  ACHIEVEMENTS_CATALOG.map((item) => ({
    ...item,
    active: true,
    repeatable: false,
  }))
);

export interface UserStats {
    inviteActivations?: number;
    loginCount?: number;
    postsCount?: number;
    commentsCount?: number;
    likesReceived?: number;
    validReports?: number;
    loginStreak?: number;
    gymCheckins?: number;
    gymEarlyBird?: number;
    gymNightOwl?: number;
    gymStreak?: number;
    arenaMatches?: number;
    arenaWins?: number;
    arenaLosses?: number;
    arenaLoseStreak?: number;
    storeSpent?: number;
    storeItemsCount?: number;
    eventsAttended?: number;
    eventsPromo?: number;
    eventsAcademic?: number;
    solidarityCount?: number;
    accountCreated?: number;
    albumCollected?: number;
    [key: string]: number | undefined; 
}

export interface User {
  uid: string;
  nome: string;
  email: string;
  foto: string;
  role: UserRole | string;

  // Multi-tenant
  tenant_id?: string | null;
  tenant_role?:
    | "visitante"
    | "user"
    | "mini_vendor"
    | "treinador"
    | "empresa"
    | "admin_treino"
    | "admin_geral"
    | "admin_gestor"
    | "master"
    | "vendas"
    | "admin_tenant"
    | "master_tenant"
    | string;
  tenant_status?: "unlinked" | "pending" | "approved" | "rejected" | "disabled" | string;
  
  // Controle
  status?: UserStatus;
  isAnonymous?: boolean; 
  saved_role?: string;
  ultimoLoginDiario?: string;
  data_adesao?: string;
  
  // Gamification
  level?: number;
  xp?: number;
  xpMultiplier?: number;
  heroPower?: number;
  rankingPosition?: number;
  stats?: UserStats; 
  sharkCoins?: number;
  selos?: number;
  
  // Dados Completos
  matricula?: string;
  turma?: string;
  handle?: string;
  telefone?: string;
  instagram?: string;
  bio?: string;
  dailyMatchesPlayed?: number;
  turmaPhoto?: string;
  whatsappPublico?: boolean;
  statusRelacionamento?: string;
  relacionamentoPublico?: boolean;
  dataNascimento?: string;
  esportes?: string[];
  pets?: string;
  apelido?: string;
  idadePublica?: boolean;
  cidadeOrigem?: string;
  idade?: number;

  // Visual & Planos
  plano?: string;        
  patente?: string; 
  patente_icon?: string; 
  patente_cor?: string;  
  tier?: 'bicho' | 'atleta' | 'lenda'; 
  plano_badge?: string;
  plano_cor?: string;
  plano_icon?: string;
  desconto_loja?: number;
  nivel_prioridade?: number;
  
  [key: string]: unknown; 
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  loginGoogle: (options?: { returnTo?: string }) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  checkPermission: (allowedRoles: string[]) => boolean;
  updateUser: (data: Partial<User>) => Promise<void>;
}

const supabase = getSupabaseClient();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizePlanName = (value: unknown): string => {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) return "";

  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.startsWith("plano ")) {
    return cleaned.slice("plano ".length).trim();
  }

  return cleaned;
};

const findPlanByName = (plans: PlanoConfig[], planName: unknown): PlanoConfig | null => {
  const normalizedTarget = normalizePlanName(planName);
  if (!normalizedTarget) return null;
  return plans.find((plan) => normalizePlanName(plan.nome) === normalizedTarget) || null;
};

const isDuplicateKeyError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error);
  return code === "23505";
};

const isNavigatorLockTimeoutError = (error: unknown): boolean => {
  const raw = asRecord(error);
  const candidates = [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
    asString(raw?.hint),
  ]
    .filter((entry) => entry.length > 0)
    .join(" | ")
    .toLowerCase();

  return (
    candidates.includes("navigator lockmanage") ||
    candidates.includes("lockmanager") ||
    (candidates.includes("timed out waiting") && candidates.includes("auth-token"))
  );
};

const isSupabaseRetryableFetchError = (error: unknown): boolean => {
  const raw = asRecord(error);
  const candidates = [
    error instanceof Error ? error.message : "",
    error instanceof Error ? error.name : "",
    asString(raw?.message),
    asString(raw?.name),
    asString(raw?.details),
  ]
    .filter((entry) => entry.length > 0)
    .join(" | ")
    .toLowerCase();

  return (
    candidates.includes("failed to fetch") ||
    candidates.includes("authretryablefetcherror")
  );
};

const extractMissingSchemaColumn = (error: unknown): string | null => {
  const raw = asRecord(error);
  const messageParts = [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
  ]
    .filter((entry) => entry.length > 0)
    .join(" | ");

  if (!messageParts) return null;

  const normalized = messageParts.toLowerCase();
  const isMissingColumnError =
    (normalized.includes("column") && normalized.includes("does not exist")) ||
    (normalized.includes("could not find the") && normalized.includes("column")) ||
    normalized.includes("schema cache");

  if (!isMissingColumnError) return null;

  const patterns = [
    /column\s+users\.([a-z0-9_]+)\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
    /column ['"]?([a-z0-9_]+)['"]? does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = messageParts.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
};

const formatBackendErrorForConsole = (error: unknown): unknown => {
  if (error instanceof Error) {
    const extra = error as Error & {
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      status?: unknown;
      statusText?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      code: typeof extra.code === "string" ? extra.code : undefined,
      details: typeof extra.details === "string" ? extra.details : undefined,
      hint: typeof extra.hint === "string" ? extra.hint : undefined,
      status: typeof extra.status === "number" ? extra.status : undefined,
      statusText: typeof extra.statusText === "string" ? extra.statusText : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const raw = error as Record<string, unknown>;
    return {
      constructor:
        typeof (error as { constructor?: unknown }).constructor === "function"
          ? ((error as { constructor: { name?: unknown } }).constructor.name as string | undefined)
          : undefined,
      ownKeys: Object.getOwnPropertyNames(error),
      code: typeof raw.code === "string" ? raw.code : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
      details: typeof raw.details === "string" ? raw.details : undefined,
      hint: typeof raw.hint === "string" ? raw.hint : undefined,
      status: typeof raw.status === "number" ? raw.status : undefined,
      stringified: (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return undefined;
        }
      })(),
      asString: String(error),
    };
  }

  return error;
};

const buildNewUserInsertPayload = (authUser: SupabaseAuthUser): Record<string, unknown> => ({
  // Payload minimo para reduzir falha por drift de schema e deixar defaults do banco preencherem o resto.
  uid: authUser.id,
  nome: getAuthDisplayName(authUser),
  email: authUser.email || "",
  foto: getAuthAvatar(authUser),
  role: "guest",
  status: "ativo",
  stats: { ...DEFAULT_STATS },
  xpMultiplier: DEFAULT_USER_PROPS.xpMultiplier,
  desconto_loja: DEFAULT_USER_PROPS.desconto_loja,
  nivel_prioridade: DEFAULT_USER_PROPS.nivel_prioridade,
  isAnonymous: false,
  ultimoLoginDiario: new Date().toLocaleDateString("pt-BR"),
  data_adesao: new Date().toISOString(),
});

const getAuthDisplayName = (authUser: SupabaseAuthUser): string => {
  const meta = asRecord(authUser.user_metadata) ?? {};
  return (
    asString(meta.full_name) ||
    asString(meta.name) ||
    asString(meta.user_name) ||
    "Sem Nome"
  );
};

const getAuthAvatar = (authUser: SupabaseAuthUser): string => {
  const meta = asRecord(authUser.user_metadata) ?? {};
  return (
    asString(meta.avatar_url) ||
    asString(meta.picture) ||
    asString(meta.photo_url) ||
    "https://github.com/shadcn.png"
  );
};

const normalizeUserRow = (row: unknown, authUser?: SupabaseAuthUser | null): User => {
  const raw = asRecord(row) ?? {};
  const rawStats = asRecord(raw.stats) ?? {};
  const normalizedStats = { ...DEFAULT_STATS, ...rawStats };
  const achievementXpFloor = calculateAchievementSummary(
    DEFAULT_ACHIEVEMENT_RUNTIME_CATALOG,
    normalizedStats
  ).totalUnlockedXp;
  const effectiveXp = resolveEffectiveXp([
    asNumber(raw.xp, DEFAULT_USER_PROPS.xp),
    achievementXpFloor,
  ]);
  const authAnonymous = Boolean(
    (authUser as (SupabaseAuthUser & { is_anonymous?: unknown }) | null | undefined)
      ?.is_anonymous
  );

  return {
    ...(raw as unknown as User),
    uid: asString(raw.uid) || authUser?.id || "",
    nome: asString(raw.nome, authUser ? getAuthDisplayName(authUser) : "Sem Nome"),
    email: asString(raw.email, authUser?.email ?? ""),
    foto: asString(raw.foto, authUser ? getAuthAvatar(authUser) : "https://github.com/shadcn.png"),
    role: asString(raw.role, "guest"),
    status: asString(raw.status, "ativo") as UserStatus,
    level: asNumber(raw.level, DEFAULT_USER_PROPS.level),
    xp: effectiveXp,
    xpMultiplier: asNumber(raw.xpMultiplier, DEFAULT_USER_PROPS.xpMultiplier),
    sharkCoins: asNumber(raw.sharkCoins, DEFAULT_USER_PROPS.sharkCoins),
    selos: asNumber(raw.selos, DEFAULT_USER_PROPS.selos),
    desconto_loja: asNumber(raw.desconto_loja, DEFAULT_USER_PROPS.desconto_loja),
    nivel_prioridade: asNumber(
      raw.nivel_prioridade,
      DEFAULT_USER_PROPS.nivel_prioridade
    ),
    isAnonymous: authUser ? authAnonymous : Boolean(raw.isAnonymous ?? false),
    stats: normalizedStats as unknown as UserStats,
  };
};

const hasCadastroPendente = (user: User): boolean => {
  if (user.isAnonymous) return false;

  const stats = asRecord(user.stats);
  const profileCompleteFlag = stats?.profileComplete;
  const hasExplicitIncompleteFlag =
    typeof profileCompleteFlag === "number" && Number.isFinite(profileCompleteFlag) && profileCompleteFlag < 1;

  const requiredFields = [
    user.apelido,
    user.matricula,
    user.turma,
    user.telefone,
    user.dataNascimento,
    user.cidadeOrigem,
    user.estadoOrigem,
    user.foto,
  ];

  const hasMissingRequiredField = requiredFields.some((value) => asString(value).trim().length === 0);
  return asString(user.role, "guest") === "guest" || hasMissingRequiredField || hasExplicitIncompleteFlag;
};

const isCadastroBypassPath = (pathname: string): boolean => {
  return (
    pathname === "/aguardando-aprovacao" ||
    pathname === "/cadastro" ||
    pathname === "/banned" ||
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/auth")
  );
};

const isTenantPendingBypassPath = (pathname: string): boolean => {
  return (
    pathname === "/aguardando-aprovacao" ||
    pathname === "/cadastro" ||
    pathname === "/banned" ||
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/auth")
  );
};

// Converte patch local (incluindo chaves "stats.x") para payload SQL e estado local final.
const buildUserPatchPayload = (
  currentUser: User,
  patch: Record<string, unknown>
): { dbPatch: Record<string, unknown> } => {
  const nextStats: UserStats = { ...(currentUser.stats || {}) };
  let statsChanged = false;

  const explicitStats = asRecord(patch.stats);
  if (explicitStats) {
    for (const [key, value] of Object.entries(explicitStats)) {
      if (typeof value === "number") {
        nextStats[key] = value;
      }
    }
    statsChanged = true;
  }

  const dbPatch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key === "uid" || key === "stats" || value === undefined) continue;

    if (key.startsWith("stats.")) {
      const statKey = key.slice(6);
      if (statKey && typeof value === "number") {
        nextStats[statKey] = value;
        statsChanged = true;
      }
      continue;
    }

    dbPatch[key] = value;
  }

  if (statsChanged) {
    dbPatch.stats = nextStats;
  }

  return { dbPatch };
};

const mergeUserSnapshot = (previous: User | null, next: User): User =>
  previous && previous.uid === next.uid ? { ...previous, ...next } : next;

const shouldHydrateFullUserProfile = (pathname: string): boolean =>
  pathname === "/cadastro" || pathname.startsWith("/configuracoes");

const needsApprovedPlanReconciliation = (user: User): boolean => {
  const planNormalized = normalizePlanName(user.plano);
  return (
    !planNormalized ||
    planNormalized === "visitante" ||
    planNormalized === "bicho" ||
    planNormalized === "bicho solto"
  );
};

const hasMissingVisualMetadata = (user: User): boolean =>
  !user.patente ||
  !user.patente_icon ||
  !user.patente_cor ||
  !user.plano ||
  !user.plano_badge ||
  !user.plano_cor ||
  !user.plano_icon ||
  user.desconto_loja === undefined ||
  user.xpMultiplier === undefined ||
  user.nivel_prioridade === undefined;

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_SESSION_SELECT_COLUMNS =
  "uid,nome,email,foto,role,status,saved_role,tenant_id,tenant_role,tenant_status,ultimoLoginDiario,data_adesao,level,xp,xpMultiplier,stats,sharkCoins,selos,matricula,turma,telefone,dataNascimento,apelido,cidadeOrigem,estadoOrigem,plano,patente,patente_icon,patente_cor,tier,plano_badge,plano_cor,plano_icon,plano_status,desconto_loja,nivel_prioridade,isAnonymous";
const USER_PROFILE_SELECT_COLUMNS =
  "uid,nome,email,foto,role,status,saved_role,tenant_id,tenant_role,tenant_status,ultimoLoginDiario,data_adesao,level,xp,xpMultiplier,stats,sharkCoins,selos,matricula,turma,telefone,instagram,bio,whatsappPublico,statusRelacionamento,relacionamentoPublico,dataNascimento,esportes,pets,apelido,idadePublica,cidadeOrigem,estadoOrigem,plano,patente,patente_icon,patente_cor,tier,plano_badge,plano_cor,plano_icon,plano_status,desconto_loja,nivel_prioridade,isAnonymous,turmaPhoto,capa,extra,createdAt";
const USER_SESSION_SELECT_COLUMNS_LIST = USER_SESSION_SELECT_COLUMNS.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const USER_PROFILE_SELECT_COLUMNS_LIST = USER_PROFILE_SELECT_COLUMNS.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const MISSING_USER_WRITE_COLUMNS = new Set<string>();
const MISSING_USER_SELECT_COLUMNS = new Set<string>();
const SESSION_REFRESH_TTL_MS = 60_000;
const FULL_PROFILE_REFRESH_TTL_MS = 300_000;
const VISUAL_MAINTENANCE_TTL_MS = 600_000;

const filterMissingUsersWriteColumns = (
  patch: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) => !MISSING_USER_WRITE_COLUMNS.has(key.toLowerCase())
    )
  );

const filterMissingUsersSelectColumns = (columns: string[]): string[] =>
  columns.filter((column) => !MISSING_USER_SELECT_COLUMNS.has(column.toLowerCase()));

const removeMissingColumnFromSelection = (
  currentColumns: string[],
  missingColumn: string
): string[] | null => {
  const nextColumns = currentColumns.filter(
    (column) => column.toLowerCase() !== missingColumn.toLowerCase()
  );
  if (nextColumns.length === currentColumns.length) return null;
  return nextColumns;
};

const runUsersRowQueryWithSelectFallback = async (
  runQuery: (
    selectColumns: string
  ) => PromiseLike<{ data: unknown; error: unknown }>,
  preferredColumns?: string[]
): Promise<Record<string, unknown> | null> => {
  let mutableColumns = filterMissingUsersSelectColumns(
    [...(preferredColumns ?? USER_SESSION_SELECT_COLUMNS_LIST)]
  );

  if (mutableColumns.length === 0) {
    return null;
  }

  while (mutableColumns.length > 0) {
    const { data, error } = await runQuery(mutableColumns.join(","));
    if (!error) return asRecord(data) ?? null;

    const missingColumn = extractMissingSchemaColumn(error);
    if (!missingColumn) throw error;
    MISSING_USER_SELECT_COLUMNS.add(missingColumn.toLowerCase());

    const nextColumns = removeMissingColumnFromSelection(mutableColumns, missingColumn);
    if (!nextColumns || nextColumns.length === 0) throw error;
    mutableColumns = nextColumns;
  }

  return null;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [masterOverrideTenantId, setMasterOverrideTenantId] = useState("");
  const [masterRolePreview, setMasterRolePreview] = useState("");
  
  // Ã°Å¸Â¦Ë† ESTADO LOCAL DE GUEST
  const [isLocalGuest, setIsLocalGuest] = useState(false);

  const lastMaintenanceUid = useRef<string | null>(null);
  const lastMaintenanceAtRef = useRef(0);
  const lastUserRefreshAtRef = useRef(0);
  const lastFullProfileUidRef = useRef<string | null>(null);
  const lastFullProfileAtRef = useRef(0);
  const lastPlanReconcileKeyRef = useRef<string | null>(null);
  const lastPlanReconcileAtRef = useRef(0);
  const lastVisualMaintenanceKeyRef = useRef<string | null>(null);
  const lastVisualMaintenanceAtRef = useRef(0);
  const syncingAuthUidRef = useRef<string | null>(null);
  const authSyncFallbackUidRef = useRef<string | null>(null);

  const router = useRouter();
  const pathnameRaw = usePathname();
  const routePathInfo = useMemo(
    () => parseTenantScopedPath(pathnameRaw ? pathnameRaw.split("?")[0] : "/"),
    [pathnameRaw]
  );
  const pathname = routePathInfo.scopedPath;
  const resolveScopedAuthPath = useCallback(
    (scopedPath: string): string => {
      const normalizedPath = scopedPath.startsWith("/") ? scopedPath : `/${scopedPath}`;
      if (routePathInfo.tenantSlug) {
        return withTenantSlug(routePathInfo.tenantSlug, normalizedPath);
      }

      const storedReturnTo = readStoredLoginReturnTo();
      const storedPathInfo = parseTenantScopedPath(storedReturnTo || "");
      if (storedPathInfo.tenantSlug) {
        return withTenantSlug(storedPathInfo.tenantSlug, normalizedPath);
      }

      return normalizedPath;
    },
    [routePathInfo.tenantSlug]
  );
  const effectiveUser = useMemo(
    () =>
      applyPlatformMasterTenantOverride(
        user,
        masterOverrideTenantId,
        masterRolePreview
      ) ?? null,
    [masterOverrideTenantId, masterRolePreview, user]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper: Calcula Patente
  const calculatePatenteData = useCallback((xp: number, patentes: PatenteConfig[]) => {
      const runtimePatentes = mergePatentesWithDefaults(
        patentes.map((patente) => ({
          id:
            patente.titulo
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-") || `patente-${patente.minXp}`,
          titulo: patente.titulo,
          minXp: patente.minXp,
          cor: patente.cor,
          iconName: patente.iconName,
        }))
      );
      const found = resolvePatenteForXp(runtimePatentes, xp);
      if (!found) return null;
      return {
        titulo: found.titulo,
        minXp: found.minXp,
        iconName: found.iconName,
        cor: found.cor,
      };
  }, []);

  // 2. RECUPERAÃƒâ€¡ÃƒÆ’O DE SESSÃƒÆ’O GUEST (Novo!)
  useEffect(() => {
    const savedGuest = localStorage.getItem("shark_guest_session");
    if (savedGuest) {
        try {
            const guestUser = JSON.parse(savedGuest);
            setIsLocalGuest(true);
            setUser(guestUser);
            // Pequeno delay para garantir que o loading nÃƒÂ£o pisque errado
            setTimeout(() => setLoading(false), 500);
        } catch {
            localStorage.removeItem("shark_guest_session");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setMasterOverrideTenantId(
      getMasterTenantOverrideId(
        localStorage.getItem(MASTER_TENANT_OVERRIDE_STORAGE_KEY)
      )
    );
    setMasterRolePreview(
      getMasterRolePreview(localStorage.getItem(MASTER_ROLE_PREVIEW_STORAGE_KEY))
    );

    const onStorage = (event: StorageEvent) => {
      if (event.key === MASTER_TENANT_OVERRIDE_STORAGE_KEY) {
        setMasterOverrideTenantId(getMasterTenantOverrideId(event.newValue));
        return;
      }
      if (event.key === MASTER_ROLE_PREVIEW_STORAGE_KEY) {
        setMasterRolePreview(getMasterRolePreview(event.newValue));
      }
    };
    const onOverrideChanged = (event: Event) => {
      const rawEvent = event as CustomEvent<{ tenantId?: unknown }>;
      setMasterOverrideTenantId(
        getMasterTenantOverrideId(rawEvent.detail?.tenantId)
      );
    };
    const onRolePreviewChanged = (event: Event) => {
      const rawEvent = event as CustomEvent<{ role?: unknown }>;
      setMasterRolePreview(getMasterRolePreview(rawEvent.detail?.role));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      MASTER_TENANT_OVERRIDE_EVENT_NAME,
      onOverrideChanged as EventListener
    );
    window.addEventListener(
      MASTER_ROLE_PREVIEW_EVENT_NAME,
      onRolePreviewChanged as EventListener
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        MASTER_TENANT_OVERRIDE_EVENT_NAME,
        onOverrideChanged as EventListener
      );
      window.removeEventListener(
        MASTER_ROLE_PREVIEW_EVENT_NAME,
        onRolePreviewChanged as EventListener
      );
    };
  }, []);

  // 3. MONITORAR AUTH (SUPABASE NATIVO)
  useEffect(() => {
    let active = true;
    let syncToken = 0;

    const syncAuthenticatedUser = async (authUser: SupabaseAuthUser): Promise<void> => {
      const currentToken = ++syncToken;
      const authUid = authUser.id;

      // Evita corrida local entre `onAuthStateChange` e `getSession` no primeiro login.
      if (syncingAuthUidRef.current === authUid) {
        return;
      }
      syncingAuthUidRef.current = authUid;

      try {
        // Bootstrap auth com snapshot minimo; o perfil completo sobe depois so quando a rota pede.
        const existingRow = await runUsersRowQueryWithSelectFallback(
          (columns) =>
            supabase
              .from("users")
              .select(columns)
              .eq("uid", authUser.id)
              .maybeSingle(),
          USER_SESSION_SELECT_COLUMNS_LIST
        );

        if (existingRow) {
          if (!active || currentToken !== syncToken) return;
          authSyncFallbackUidRef.current = null;
          const normalized = normalizeUserRow(existingRow, authUser);
          setUser((previous) => mergeUserSnapshot(previous, normalized));
          setIsAdmin(hasAdminPanelAccess(normalized));
          setLoading(false);
          void ensureAlbumSelfCollected(normalized.uid).catch(() => {});
          return;
        }

        const newUserPayload = buildNewUserInsertPayload(authUser);

        let insertedRow: Record<string, unknown> | null = null;
        try {
          insertedRow = await runUsersRowQueryWithSelectFallback(
            (columns) =>
              supabase
                .from("users")
                .insert(newUserPayload)
                .select(columns)
                .single(),
            USER_SESSION_SELECT_COLUMNS_LIST
          );
        } catch (insertError: unknown) {
          if (!isDuplicateKeyError(insertError)) throw insertError;

          // Corrida comum: onAuthStateChange e getSession disparam em paralelo no primeiro login.
          const concurrentRow = await runUsersRowQueryWithSelectFallback(
            (columns) =>
              supabase
                .from("users")
                .select(columns)
                .eq("uid", authUser.id)
                .maybeSingle(),
            USER_SESSION_SELECT_COLUMNS_LIST
          );
          if (!concurrentRow) throw insertError;
          insertedRow = concurrentRow;
        }

        if (!insertedRow) {
          throw new Error("Falha ao criar usuario no banco.");
        }
        if (!active || currentToken !== syncToken) return;

        const normalized = normalizeUserRow(insertedRow, authUser);
        authSyncFallbackUidRef.current = null;
        setUser((previous) => mergeUserSnapshot(previous, normalized));
        setIsAdmin(false);
        setLoading(false);
        void ensureAlbumSelfCollected(normalized.uid).catch(() => {});
        void logActivity(normalized.uid, normalized.nome, "CREATE", "Usuarios", "Novo cadastro via Google");
      } catch (error: unknown) {
        if (!isPermissionError(error) && !isNavigatorLockTimeoutError(error)) {
          console.warn("Falha na sincronizacao do usuario (fallback ativo):", formatBackendErrorForConsole(error));
        }
        if (!active || currentToken !== syncToken) return;

        // Fallback local: mantem sessao autenticada ativa mesmo se a sincronizacao SQL falhar.
        // Isso evita loop de "faca login" enquanto corrigimos schema/RLS no Supabase.
        const fallbackUser = normalizeUserRow(
          {
            ...DEFAULT_USER_PROPS,
            uid: authUser.id,
            nome: getAuthDisplayName(authUser),
            email: authUser.email || "",
            foto: getAuthAvatar(authUser),
            role: "guest",
            status: "ativo",
            stats: { ...DEFAULT_STATS },
          },
          authUser
        );

        authSyncFallbackUidRef.current = authUser.id;
        setUser(fallbackUser);
        setIsAdmin(false);
        setLoading(false);
      } finally {
        if (syncingAuthUidRef.current === authUid) {
          syncingAuthUidRef.current = null;
        }
      }
    };

    const handleAuthChange = async (authUser: SupabaseAuthUser | null): Promise<void> => {
      if (authUser && syncingAuthUidRef.current === authUser.id) {
        // Ja existe uma sincronizacao em andamento para este usuario; evita invalidar o token e travar loading.
        return;
      }

      syncToken += 1;

      if (isLocalGuest) {
        setLoading(false);
        return;
      }

      if (authUser) {
        setLoading(true);
        await syncAuthenticatedUser(authUser);
        return;
      }

      const savedGuest = localStorage.getItem("shark_guest_session");
      if (!savedGuest) {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        lastMaintenanceUid.current = null;
        lastMaintenanceAtRef.current = 0;
        lastFullProfileUidRef.current = null;
        lastFullProfileAtRef.current = 0;
        lastPlanReconcileKeyRef.current = null;
        lastPlanReconcileAtRef.current = 0;
        lastVisualMaintenanceKeyRef.current = null;
        lastVisualMaintenanceAtRef.current = 0;
        lastUserRefreshAtRef.current = 0;
        authSyncFallbackUidRef.current = null;
      }
    };

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthChange(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (!isPermissionError(error) && !isNavigatorLockTimeoutError(error)) {
          console.error("Erro ao recuperar sessao:", error);
        }
        if (isSupabaseRetryableFetchError(error)) {
          clearSupabaseBrowserSessionStorage();
        }
        if (active) {
          setLoading(false);
        }
        return;
      }

      void handleAuthChange(data.session?.user ?? null);
    });

    return () => {
      active = false;
      authSubscription.subscription.unsubscribe();
    };
  }, [isLocalGuest]);

  const persistUserPatch = useCallback(
    async (
      currentUser: User,
      patch: Record<string, unknown>,
      options?: { selectColumns?: string[] }
    ): Promise<User> => {
      const { dbPatch } = buildUserPatchPayload(currentUser, patch);
      const mutablePatch: Record<string, unknown> = filterMissingUsersWriteColumns({
        ...dbPatch,
      });
      let data: Record<string, unknown> | null = null;
      const selectColumns = options?.selectColumns ?? USER_SESSION_SELECT_COLUMNS_LIST;
      let mutableSelectColumns = filterMissingUsersSelectColumns([
        ...selectColumns,
      ]);

      if (Object.keys(mutablePatch).length === 0) {
        return currentUser;
      }

      while (Object.keys(mutablePatch).length > 0 && mutableSelectColumns.length > 0) {
        const updateResult = await supabase
          .from("users")
          .update(mutablePatch)
          .eq("uid", currentUser.uid)
          .select(mutableSelectColumns.join(","))
          .maybeSingle();

        if (!updateResult.error) {
          data = (updateResult.data as Record<string, unknown> | null) ?? null;
          break;
        }

        const missingColumn = extractMissingSchemaColumn(updateResult.error);
        if (!missingColumn) throw updateResult.error;

        const removableKey =
          Object.keys(mutablePatch).find((key) => key.toLowerCase() === missingColumn.toLowerCase()) ?? null;
        if (removableKey) {
          MISSING_USER_WRITE_COLUMNS.add(removableKey.toLowerCase());
          delete mutablePatch[removableKey];
          continue;
        }

        MISSING_USER_SELECT_COLUMNS.add(missingColumn.toLowerCase());
        const nextSelectColumns = removeMissingColumnFromSelection(
          mutableSelectColumns,
          missingColumn
        );
        if (!nextSelectColumns || nextSelectColumns.length === 0) throw updateResult.error;
        mutableSelectColumns = nextSelectColumns;
      }

      if (!data) {
        const recoveryPayload = filterMissingUsersWriteColumns({
          ...DEFAULT_USER_PROPS,
          uid: currentUser.uid,
          nome: asString(currentUser.nome, "Sem Nome"),
          email: asString(currentUser.email, ""),
          foto: asString(currentUser.foto, "https://github.com/shadcn.png"),
          role: asString(currentUser.role, "guest"),
          status: asString(currentUser.status, "ativo"),
          stats: { ...DEFAULT_STATS, ...(currentUser.stats || {}) },
          ultimoLoginDiario:
            asString(currentUser.ultimoLoginDiario) || new Date().toLocaleDateString("pt-BR"),
          data_adesao: asString(currentUser.data_adesao) || new Date().toISOString(),
          ...mutablePatch,
        });

        const recoveredRow = await runUsersRowQueryWithSelectFallback(
          (columns) =>
            supabase
              .from("users")
              .upsert(recoveryPayload, { onConflict: "uid" })
              .select(columns)
              .single(),
          mutableSelectColumns
        );
        if (!recoveredRow) throw new Error("Falha ao recuperar perfil do usuario.");

        const recoveredNormalized = normalizeUserRow(recoveredRow);
        setUser((previous) => mergeUserSnapshot(previous, recoveredNormalized));
        setIsAdmin(hasAdminPanelAccess(recoveredNormalized));
        return recoveredNormalized;
      }

      const normalized = normalizeUserRow(data);
      setUser((previous) => mergeUserSnapshot(previous, normalized));
      setIsAdmin(hasAdminPanelAccess(normalized));
      return normalized;
    },
    []
  );

  // 4. MANUTENCAO LEVE + RECONCILIACAO SOB DEMANDA
  useEffect(() => {
    const runMaintenance = async () => {
        // Guest local nao roda manutencao no banco.
        if (!user || isLocalGuest || user.isAnonymous || loading) {
          return;
        }

        const now = Date.now();
        const maintenanceKey = [
          user.uid,
          asString(user.ultimoLoginDiario),
          String(asNumber(user.xp, 0)),
          normalizePlanName(user.plano),
          asString(user.plano_icon).toLowerCase(),
          asString(user.plano_cor).toLowerCase(),
          asString(user.patente).toLowerCase(),
          asString(user.patente_icon).toLowerCase(),
          asString(user.patente_cor).toLowerCase(),
          JSON.stringify(user.stats ?? {}),
        ].join("::");

        if (
          lastMaintenanceUid.current === maintenanceKey &&
          now - lastMaintenanceAtRef.current < SESSION_REFRESH_TTL_MS
        ) return;

        const updates: Record<string, unknown> = {};
        let hasUpdates = false;
        let maintenanceFailed = false;

        // A. AUTO-CURA
        if (user.xp === undefined) { updates.xp = DEFAULT_USER_PROPS.xp; hasUpdates = true; }
        if (user.level === undefined) { updates.level = DEFAULT_USER_PROPS.level; hasUpdates = true; }
        if (user.sharkCoins === undefined) { updates.sharkCoins = DEFAULT_USER_PROPS.sharkCoins; hasUpdates = true; }
        if (!user.patente) { updates.patente = DEFAULT_USER_PROPS.patente; hasUpdates = true; }

        const currentStats = user.stats || {};
        const missingStatKeys = Object.keys(DEFAULT_STATS).some(key => currentStats[key] === undefined);
        if (!user.stats || missingStatKeys) {
            updates.stats = { ...DEFAULT_STATS, ...currentStats };
            hasUpdates = true;
        }

        if (user.stats && user.stats.albumCollected === undefined) {
            updates["stats.albumCollected"] = 0;
            hasUpdates = true;
        }

        // B. LOGIN DIÃƒÂRIO
        const hoje = new Date().toLocaleDateString('pt-BR');
        if (user.ultimoLoginDiario !== hoje) {
            updates["stats.loginCount"] = (currentStats.loginCount || 0) + 1;
            updates.ultimoLoginDiario = hoje;
            updates.xp = (user.xp || 0) + 10;
            hasUpdates = true;
            // Log apenas se nÃƒÂ£o for guest (redundante, mas seguro)
            if (!isLocalGuest) {
                logActivity(user.uid, user.nome, "LOGIN", "Sistema", "Check-in DiÃƒÂ¡rio (+10 XP)");
            }
        }

        const statsPatch = asRecord(updates.stats) ?? {};
        const effectiveStatsForXp: Record<string, unknown> = {
            ...DEFAULT_STATS,
            ...currentStats,
            ...statsPatch,
        };
        if (typeof updates["stats.loginCount"] === "number") {
            effectiveStatsForXp.loginCount = updates["stats.loginCount"];
        }
        if (typeof updates["stats.albumCollected"] === "number") {
            effectiveStatsForXp.albumCollected = updates["stats.albumCollected"];
        }
        const effectiveStoredXp = asNumber(updates.xp, asNumber(user.xp, 0));
        const canonicalXp = resolveEffectiveXp([
            effectiveStoredXp,
            asNumber(user.xp, 0),
            calculateAchievementSummary(
                DEFAULT_ACHIEVEMENT_RUNTIME_CATALOG,
                effectiveStatsForXp
            ).totalUnlockedXp,
        ]);
        if (canonicalXp !== effectiveStoredXp) {
            updates.xp = canonicalXp;
            hasUpdates = true;
        }

        const visualMaintenanceKey = [
            user.uid,
            String(canonicalXp),
            normalizePlanName(user.plano),
            asString(user.plano_icon).toLowerCase(),
            asString(user.plano_cor).toLowerCase(),
            asString(user.patente).toLowerCase(),
            asString(user.patente_icon).toLowerCase(),
            asString(user.patente_cor).toLowerCase(),
        ].join("::");
        const shouldRunVisualMaintenance =
            hasMissingVisualMetadata(user) ||
            lastVisualMaintenanceKeyRef.current !== visualMaintenanceKey ||
            now - lastVisualMaintenanceAtRef.current >= VISUAL_MAINTENANCE_TTL_MS;

        if (shouldRunVisualMaintenance) {
            let patentes: PatenteConfig[] = DEFAULT_PATENTES;
            let planos: PlanoConfig[] = [];

            try {
                const catalog = await fetchUserVisualCatalog();
                if (catalog.patentes.length > 0) {
                    patentes = catalog.patentes;
                }
                planos = catalog.plans;
            } catch (catalogError: unknown) {
                if (
                    !isPermissionError(catalogError) &&
                    !isNavigatorLockTimeoutError(catalogError) &&
                    !isSupabaseRetryableFetchError(catalogError)
                ) {
                    console.warn("Falha ao carregar catalogo visual do usuario:", catalogError);
                }
            }

            const primaryPlan = [...planos].sort((left, right) => {
                if (left.nivelPrioridade !== right.nivelPrioridade) {
                    return left.nivelPrioridade - right.nivelPrioridade;
                }

                return normalizePlanName(left.nome).localeCompare(
                    normalizePlanName(right.nome),
                    "pt-BR",
                    { sensitivity: "base" }
                );
            })[0];
            const defaultPlanName = primaryPlan?.nome || DEFAULT_USER_PROPS.plano;
            const defaultPlanBadge = primaryPlan?.nome || DEFAULT_USER_PROPS.plano_badge;
            const defaultPlanColor = primaryPlan?.cor || DEFAULT_USER_PROPS.plano_cor;
            const defaultPlanIcon = primaryPlan?.icon || DEFAULT_USER_PROPS.plano_icon;
            const defaultPlanDiscount =
                primaryPlan?.descontoLoja ?? DEFAULT_USER_PROPS.desconto_loja;
            const defaultPlanXpMultiplier =
                primaryPlan?.xpMultiplier ?? DEFAULT_USER_PROPS.xpMultiplier;
            const defaultPlanPriority =
                primaryPlan?.nivelPrioridade ?? DEFAULT_USER_PROPS.nivel_prioridade;
            const defaultPlanTier: "bicho" | "atleta" | "lenda" =
                normalizePlanName(defaultPlanName).includes("lenda")
                    ? "lenda"
                    : normalizePlanName(defaultPlanName).includes("atleta")
                        ? "atleta"
                        : "bicho";

            const roleNormalized = typeof user.role === "string" ? user.role.toLowerCase() : "";
            const planNormalized = normalizePlanName(updates.plano ?? user.plano);
            if (roleNormalized && roleNormalized !== "guest" && planNormalized === "visitante") {
                updates.plano = defaultPlanName;
                updates.plano_badge = defaultPlanBadge;
                updates.plano_cor = defaultPlanColor;
                updates.plano_icon = defaultPlanIcon;
                updates.desconto_loja = defaultPlanDiscount;
                updates.xpMultiplier = defaultPlanXpMultiplier;
                updates.nivel_prioridade = defaultPlanPriority;
                updates.tier = defaultPlanTier;
                hasUpdates = true;
            }

            if (!user.plano) { updates.plano = defaultPlanName; hasUpdates = true; }
            if (!user.plano_badge) { updates.plano_badge = defaultPlanBadge; hasUpdates = true; }
            if (!user.plano_cor) { updates.plano_cor = defaultPlanColor; hasUpdates = true; }
            if (!user.plano_icon) { updates.plano_icon = defaultPlanIcon; hasUpdates = true; }
            if (user.desconto_loja === undefined) { updates.desconto_loja = defaultPlanDiscount; hasUpdates = true; }
            if (user.xpMultiplier === undefined) { updates.xpMultiplier = defaultPlanXpMultiplier; hasUpdates = true; }
            if (user.nivel_prioridade === undefined) { updates.nivel_prioridade = defaultPlanPriority; hasUpdates = true; }

            const patenteAlvo = calculatePatenteData(canonicalXp, patentes);
            if (patenteAlvo) {
                if (
                    user.patente !== patenteAlvo.titulo ||
                    user.patente_icon !== patenteAlvo.iconName ||
                    user.patente_cor !== patenteAlvo.cor
                ) {
                    updates.patente = patenteAlvo.titulo;
                    updates.patente_icon = patenteAlvo.iconName;
                    updates.patente_cor = patenteAlvo.cor;
                    hasUpdates = true;
                }
            }

            const planReconcileKey = [
                user.uid,
                normalizePlanName(user.plano),
                asString(user.tenant_id).trim(),
            ].join("::");
            const shouldRunPlanReconcile =
                needsApprovedPlanReconciliation(user) &&
                (
                    lastPlanReconcileKeyRef.current !== planReconcileKey ||
                    now - lastPlanReconcileAtRef.current >= VISUAL_MAINTENANCE_TTL_MS
                );

            if (shouldRunPlanReconcile) {
                try {
                    const { data: latestApprovedRequest, error: latestApprovedError } = await supabase
                        .from("solicitacoes_adesao")
                        .select("planoNome,status,updatedAt,dataSolicitacao")
                        .eq("userId", user.uid)
                        .eq("status", "aprovado")
                        .order("updatedAt", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!latestApprovedError && latestApprovedRequest) {
                        const approvedPlanName = normalizePlanName(latestApprovedRequest.planoNome);
                        const approvedPlan = findPlanByName(planos, latestApprovedRequest.planoNome);
                        const planoAtual = normalizePlanName(updates.plano ?? user.plano);

                        if (approvedPlan && approvedPlanName && approvedPlanName !== planoAtual) {
                            updates.plano = approvedPlan.nome;
                            updates.plano_badge = approvedPlan.nome;
                            updates.plano_cor = approvedPlan.cor;
                            updates.plano_icon = approvedPlan.icon;
                            updates.desconto_loja = approvedPlan.descontoLoja;
                            updates.xpMultiplier = approvedPlan.xpMultiplier;
                            updates.nivel_prioridade = approvedPlan.nivelPrioridade;
                            updates.tier = approvedPlanName.includes("lenda")
                                ? "lenda"
                                : approvedPlanName.includes("atleta")
                                    ? "atleta"
                                    : "bicho";
                            hasUpdates = true;
                        }
                    }
                } catch (reconcileError: unknown) {
                    maintenanceFailed = true;
                    if (!isPermissionError(reconcileError) && !isNavigatorLockTimeoutError(reconcileError)) {
                        console.warn("Falha ao reconciliar plano aprovado:", reconcileError);
                    }
                } finally {
                    lastPlanReconcileKeyRef.current = planReconcileKey;
                    lastPlanReconcileAtRef.current = Date.now();
                }
            }

            const effectivePlanName = updates.plano ?? user.plano;
            const planoReal = findPlanByName(planos, effectivePlanName);
            if (planoReal) {
                const resolvedTier: "bicho" | "atleta" | "lenda" =
                    normalizePlanName(planoReal.nome).includes("lenda")
                        ? "lenda"
                        : normalizePlanName(planoReal.nome).includes("atleta")
                            ? "atleta"
                            : "bicho";
                const currentPlanBadge = asString(updates.plano_badge ?? user.plano_badge);
                const currentPlanColor = asString(updates.plano_cor ?? user.plano_cor);
                const currentPlanIcon = asString(updates.plano_icon ?? user.plano_icon);
                const currentDiscount = Number(updates.desconto_loja ?? user.desconto_loja ?? 0);
                const currentXpMultiplier = Number(updates.xpMultiplier ?? user.xpMultiplier ?? 1);
                const currentPriority = Number(updates.nivel_prioridade ?? user.nivel_prioridade ?? 1);
                const currentTier = asString(updates.tier ?? user.tier);

                if (currentPlanBadge !== planoReal.nome) {
                    updates.plano_badge = planoReal.nome;
                    hasUpdates = true;
                }
                if (
                    currentPlanColor !== planoReal.cor ||
                    currentPlanIcon !== planoReal.icon ||
                    currentDiscount !== planoReal.descontoLoja ||
                    currentXpMultiplier !== planoReal.xpMultiplier ||
                    currentPriority !== planoReal.nivelPrioridade
                ) {
                    updates.plano_cor = planoReal.cor;
                    updates.plano_icon = planoReal.icon;
                    updates.desconto_loja = planoReal.descontoLoja;
                    updates.xpMultiplier = planoReal.xpMultiplier;
                    updates.nivel_prioridade = planoReal.nivelPrioridade;
                    hasUpdates = true;
                }
                if (currentTier !== resolvedTier) {
                    updates.tier = resolvedTier;
                    hasUpdates = true;
                }
            }

            lastVisualMaintenanceKeyRef.current = visualMaintenanceKey;
            lastVisualMaintenanceAtRef.current = Date.now();
        }

        if (hasUpdates) {
            try {
                await persistUserPatch(user, updates, {
                    selectColumns: USER_SESSION_SELECT_COLUMNS_LIST,
                });
            } catch (err: unknown) {
                maintenanceFailed = true;
                if (!isPermissionError(err)) {
                    console.warn("Erro ao atualizar manutencao do usuario:", err);
                }
            }
        }

        if (!maintenanceFailed) {
            lastMaintenanceUid.current = maintenanceKey;
            lastMaintenanceAtRef.current = Date.now();
        }
    };

    void runMaintenance();
  }, [user, loading, isLocalGuest, calculatePatenteData, persistUserPatch]);

  // 5. SEGURANÃƒâ€¡A E REDIRECIONAMENTOS
  useEffect(() => {
      if (loading || !user) return;

      if ((user.status === 'banned' || user.status === 'bloqueado') && pathname !== '/banned') {
          router.replace('/banned');
      }

      if (user.status !== 'banned' && user.status !== 'bloqueado' && pathname === '/banned') {
          router.replace('/dashboard');
      }
  }, [user, pathname, loading, router]); 

  useEffect(() => {
      if (loading || !user || isLocalGuest) return;
      if (user.status === "banned" || user.status === "bloqueado") return;

      const tenantStatus = asString(user.tenant_status).trim().toLowerCase();
      const tenantId = asString(user.tenant_id).trim();
      const isPendingTenant = tenantStatus === "pending" && tenantId.length > 0;

      if (isPendingTenant) {
          if (isTenantPendingBypassPath(pathname)) return;
          router.replace(resolveScopedAuthPath("/aguardando-aprovacao"));
          return;
      }

      if (pathname === "/aguardando-aprovacao") {
          router.replace(resolveScopedAuthPath("/dashboard"));
      }
  }, [isLocalGuest, loading, pathname, resolveScopedAuthPath, router, user]);

  useEffect(() => {
      if (loading || !user || isLocalGuest) return;
      if (user.status === "banned" || user.status === "bloqueado") return;
      if (
        asString(user.tenant_status).trim().toLowerCase() === "pending" &&
        asString(user.tenant_id).trim().length > 0
      ) return;
      if (pathname === "/login") return;
      if (isCadastroBypassPath(pathname)) return;
      if (authSyncFallbackUidRef.current === user.uid) return;

      if (hasCadastroPendente(user)) {
          router.replace(resolveScopedAuthPath("/cadastro"));
      }
  }, [user, loading, pathname, resolveScopedAuthPath, router, isLocalGuest]);

  // --- FUNÃƒâ€¡Ãƒâ€¢ES PÃƒÅ¡BLICAS ---

  const loginGoogle = async (options?: { returnTo?: string }) => {
    try {
      if (isLocalGuest) {
          localStorage.removeItem("shark_guest_session");
          setIsLocalGuest(false);
          setUser(null);
      }
      const desiredReturnTo = sanitizeReturnToPath(options?.returnTo);
      storeLoginReturnTo(desiredReturnTo);
      const redirectTo = buildLoginRedirectUrl(desiredReturnTo);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) {
        throw error;
      }
    } catch (error: unknown) {
      console.error("Login falhou:", error);
    }
  };

  const loginAsGuest = async () => {
    setLoading(true);
    const guestUser: User = {
        ...DEFAULT_USER_PROPS,
        uid: "guest_virtual_" + Date.now(), // ID ÃƒÂºnico para a sessÃƒÂ£o
        nome: "Visitante USC",
        email: "visitante@usc.app",
        foto: "/logo.png",
        
        role: "guest",
        status: "ativo",
        isAnonymous: true, // Flag importante para o RouteGuard

        stats: { ...DEFAULT_STATS, loginCount: 1, albumCollected: 0 },
        plano: "Visitante",
        patente: "Visitante",
        tier: "bicho",
        level: 1,
        xp: 0
    } as User;

    // Ã°Å¸Â¦Ë† Salva no LocalStorage para persistir no F5
    localStorage.setItem("shark_guest_session", JSON.stringify(guestUser));

    setIsLocalGuest(true);
    setUser(guestUser);
    setIsAdmin(false);
    
    // Pequeno delay para a UI reagir
    setTimeout(() => {
        setLoading(false);
    }, 500);
  };

  const logout = async () => {
    if (user) {
        if (!user.uid.startsWith("guest_virtual")) {
            await logActivity(user.uid, user.nome, "LOGIN", "Sistema", "Logout realizado").catch(() => {});
            const { error } = await supabase.auth.signOut();
            if (error && !isPermissionError(error)) {
              console.error("Erro ao sair:", error);
            }
        }
    }
    
    // Ã°Å¸Â¦Ë† Limpa sessÃƒÂ£o local
    localStorage.removeItem("shark_guest_session");
    
    setIsLocalGuest(false);
    setUser(null);
    setIsAdmin(false);
    lastMaintenanceUid.current = null;
    lastMaintenanceAtRef.current = 0;
    lastUserRefreshAtRef.current = 0;
    lastFullProfileUidRef.current = null;
    lastFullProfileAtRef.current = 0;
    lastPlanReconcileKeyRef.current = null;
    lastPlanReconcileAtRef.current = 0;
    lastVisualMaintenanceKeyRef.current = null;
    lastVisualMaintenanceAtRef.current = 0;
    authSyncFallbackUidRef.current = null;
    router.push("/");
  };

  const checkPermission = (allowedRoles: string[]) => {
    if (!effectiveUser) return false;
    if (isPlatformMaster(effectiveUser)) return true;

    const normalizedAllowed = new Set(
      allowedRoles.map((role) => role.trim().toLowerCase()).filter(Boolean)
    );
    if (!normalizedAllowed.size) return false;

    const candidates = getAccessRoleCandidates(effectiveUser);
    return candidates.some((role) => normalizedAllowed.has(role));
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;
    
    // Se for guest, atualiza sÃƒÂ³ localmente
    if (isLocalGuest) {
        const newUser = { ...user, ...data };
        setUser(newUser);
        localStorage.setItem("shark_guest_session", JSON.stringify(newUser));
        return; 
    }

    try {
      await persistUserPatch(user, data as Record<string, unknown>, {
        selectColumns: USER_PROFILE_SELECT_COLUMNS_LIST,
      });
      lastFullProfileUidRef.current = user.uid;
      lastFullProfileAtRef.current = Date.now();
    } catch (error: unknown) {
      if (!isPermissionError(error)) {
        const formatted = formatBackendErrorForConsole(error);
        const printable =
          typeof formatted === "string"
            ? formatted
            : (() => {
                try {
                  return JSON.stringify(formatted);
                } catch {
                  return String(formatted);
                }
              })();
        const safePrintable =
          printable === "{}" ? "empty-object error (provavel RLS/policy em public.users)" : printable;
        console.error(`Erro ao atualizar: ${safePrintable}; raw=${String(error)}`);
      }
      throw error;
    }
  };

  useEffect(() => {
    if (!user || isLocalGuest || user.isAnonymous) return;
    if (!shouldHydrateFullUserProfile(pathname)) return;

    const now = Date.now();
    if (
      lastFullProfileUidRef.current === user.uid &&
      now - lastFullProfileAtRef.current < FULL_PROFILE_REFRESH_TTL_MS
    ) {
      return;
    }

    let active = true;
    const hydrate = async () => {
      try {
        const data = await runUsersRowQueryWithSelectFallback(
          (columns) =>
            supabase
              .from("users")
              .select(columns)
              .eq("uid", user.uid)
              .maybeSingle(),
          USER_PROFILE_SELECT_COLUMNS_LIST
        );
        if (!data || !active) return;

        const normalized = normalizeUserRow(data);
        lastFullProfileUidRef.current = user.uid;
        lastFullProfileAtRef.current = Date.now();
        setUser((previous) => mergeUserSnapshot(previous, normalized));
        setIsAdmin(hasAdminPanelAccess(normalized));
      } catch (error: unknown) {
        if (!isPermissionError(error) && !isNavigatorLockTimeoutError(error)) {
          console.warn("Falha ao hidratar perfil completo:", formatBackendErrorForConsole(error));
        }
      }
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, [pathname, user, isLocalGuest]);

  useEffect(() => {
    if (!user || isLocalGuest || user.isAnonymous) return;

    const now = Date.now();
    if (now - lastUserRefreshAtRef.current < SESSION_REFRESH_TTL_MS) return;
    lastUserRefreshAtRef.current = now;

    const refresh = async () => {
      try {
        const data = await runUsersRowQueryWithSelectFallback(
          (columns) =>
            supabase
              .from("users")
              .select(columns)
              .eq("uid", user.uid)
              .maybeSingle(),
          USER_SESSION_SELECT_COLUMNS_LIST
        );
        if (!data) return;

        const normalized = normalizeUserRow(data);
        setUser((previous) => {
          const merged = mergeUserSnapshot(previous, normalized);
          if (!previous) return merged;

          const previousSignature = [
            asString(previous.plano),
            asString(previous.plano_badge),
            asString(previous.plano_cor),
            asString(previous.plano_icon),
            asString(previous.tier),
            asString(previous.status),
            asString(previous.role),
            asString(previous.patente),
            asString(previous.patente_icon),
            asString(previous.patente_cor),
            String(asNumber(previous.xp, 0)),
            JSON.stringify(previous.stats ?? {}),
          ].join("|");
          const nextSignature = [
            asString(merged.plano),
            asString(merged.plano_badge),
            asString(merged.plano_cor),
            asString(merged.plano_icon),
            asString(merged.tier),
            asString(merged.status),
            asString(merged.role),
            asString(merged.patente),
            asString(merged.patente_icon),
            asString(merged.patente_cor),
            String(asNumber(merged.xp, 0)),
            JSON.stringify(merged.stats ?? {}),
          ].join("|");

          return previousSignature === nextSignature ? previous : merged;
        });

        setIsAdmin(hasAdminPanelAccess(normalized));
      } catch (error: unknown) {
        if (!isPermissionError(error) && !isNavigatorLockTimeoutError(error)) {
          console.warn("Falha ao atualizar snapshot do usuario:", formatBackendErrorForConsole(error));
        }
      }
    };

    void refresh();
  }, [pathname, user, isLocalGuest]);

  if (!mounted) return null;

  if (loading) {
      return <LoadingScreen />;
  }

  return (
    <AuthContext.Provider value={{ user: effectiveUser, loading, isAdmin, loginGoogle, loginAsGuest, logout, checkPermission, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return context;
};









