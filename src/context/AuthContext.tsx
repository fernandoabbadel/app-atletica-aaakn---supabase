"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation"; 
import { logActivity } from "../lib/logger"; 
import LoadingScreen from "../app/loading";
import { DEFAULT_STATS, DEFAULT_USER_PROPS } from "../constants/userDefaults";
import { getBackendErrorCode, isPermissionError } from "@/lib/backendErrors";

// --- TIPAGEM ---
export type UserRole = "guest" | "user" | "treinador" | "empresa" | "admin_treino" | "admin_geral" | "admin_gestor" | "master" | "vendas";
export type UserStatus = "ativo" | "inadimplente" | "banned" | "pendente" | "paused" | "bloqueado";

interface PatenteConfig {
    titulo: string;
    minXp: number;
    iconName: string;
    cor: string;
}

interface PlanoConfig {
    nome: string;
    cor: string;
    icon: string;
    descontoLoja: number;
    xpMultiplier: number;
    nivelPrioridade: number;
}

const DEFAULT_PATENTES: PatenteConfig[] = [
  { titulo: "Megalodon", minXp: 50000, iconName: "Crown", cor: "text-red-600" },
  { titulo: "Tubarao Branco", minXp: 15000, iconName: "Fish", cor: "text-emerald-400" },
  { titulo: "Barracuda", minXp: 2000, iconName: "Swords", cor: "text-blue-400" },
  { titulo: "Peixe Palhaco", minXp: 500, iconName: "Fish", cor: "text-orange-400" },
  { titulo: "Plancton", minXp: 0, iconName: "Fish", cor: "text-zinc-400" }
];

export interface UserStats {
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
  loginGoogle: () => Promise<void>;
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

  return {
    ...(raw as unknown as User),
    uid: asString(raw.uid) || authUser?.id || "",
    nome: asString(raw.nome, authUser ? getAuthDisplayName(authUser) : "Sem Nome"),
    email: asString(raw.email, authUser?.email ?? ""),
    foto: asString(raw.foto, authUser ? getAuthAvatar(authUser) : "https://github.com/shadcn.png"),
    role: asString(raw.role, "guest"),
    status: asString(raw.status, "ativo") as UserStatus,
    isAnonymous: Boolean(raw.isAnonymous ?? false),
    stats: rawStats as unknown as UserStats,
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

  dbPatch.updatedAt = new Date().toISOString();
  return { dbPatch };
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_SELECT_COLUMNS =
  "uid,nome,email,foto,role,status,ultimoLoginDiario,data_adesao,level,xp,stats,sharkCoins,selos,matricula,turma,telefone,instagram,bio,whatsappPublico,statusRelacionamento,relacionamentoPublico,dataNascimento,esportes,pets,apelido,idadePublica,cidadeOrigem,plano,patente,patente_icon,patente_cor,tier,plano_badge,plano_cor,plano_icon,plano_status,capa,estadoOrigem,extra,createdAt,updatedAt";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Ã°Å¸Â¦Ë† ESTADO LOCAL DE GUEST
  const [isLocalGuest, setIsLocalGuest] = useState(false);
  
  const [patentesCache, setPatentesCache] = useState<PatenteConfig[]>([]); 
  const [planosCache, setPlanosCache] = useState<PlanoConfig[]>([]);
  const lastMaintenanceUid = useRef<string | null>(null);
  const lastUserRefreshAtRef = useRef(0);
  const syncingAuthUidRef = useRef<string | null>(null);
  const authSyncFallbackUidRef = useRef<string | null>(null);

  const router = useRouter();
  const pathname = usePathname(); 

  // 1. CARREGAMENTO INICIAL UNIFICADO
  useEffect(() => {
    setMounted(true);

    const fetchData = async () => {
      try {
        const { data, error } = await supabase
          .from("patentes_config")
          .select("titulo,minXp,iconName,cor")
          .order("minXp", { ascending: false });

        if (error) throw error;

        if (data && data.length > 0) {
          setPatentesCache(
            data.map((row) => ({
              titulo: asString(row.titulo, "Patente"),
              minXp: asNumber(row.minXp, 0),
              iconName: asString(row.iconName, "Fish"),
              cor: asString(row.cor, "text-zinc-400"),
            }))
          );
        } else {
          setPatentesCache(DEFAULT_PATENTES);
        }
      } catch (error: unknown) {
        setPatentesCache(DEFAULT_PATENTES);
        if (!isPermissionError(error)) {
          console.error("Erro ao carregar patentes:", error);
        }
      }

      try {
        const { data, error } = await supabase
          .from("planos")
          .select("nome,cor,icon,descontoLoja,xpMultiplier,nivelPrioridade");

        if (error) throw error;

        if (data && data.length > 0) {
          setPlanosCache(
            data.map((row) => ({
              nome: asString(row.nome, "Plano"),
              cor: asString(row.cor, "zinc"),
              icon: asString(row.icon, "ghost"),
              descontoLoja: asNumber(row.descontoLoja, 0),
              xpMultiplier: asNumber(row.xpMultiplier, 1),
              nivelPrioridade: asNumber(row.nivelPrioridade, 1),
            }))
          );
        }
      } catch (error: unknown) {
        if (!isPermissionError(error) && !isNavigatorLockTimeoutError(error)) {
          console.error("Erro ao carregar planos:", error);
        }
      }
    };
    fetchData();
  }, []);

  // Helper: Calcula Patente
  const calculatePatenteData = useCallback((xp: number) => {
      if (patentesCache.length === 0) return null;
      const found = patentesCache.find(p => xp >= p.minXp);
      return found || patentesCache[patentesCache.length - 1]; 
  }, [patentesCache]);

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
        const { data: existingRow, error: selectError } = await supabase
          .from("users")
          .select(USER_SELECT_COLUMNS)
          .eq("uid", authUser.id)
          .maybeSingle();

        if (selectError) throw selectError;

        if (existingRow) {
          if (!active || currentToken !== syncToken) return;
          authSyncFallbackUidRef.current = null;
          const normalized = normalizeUserRow(existingRow, authUser);
          setUser(normalized);
          setIsAdmin(["master", "admin_geral", "admin_gestor"].includes(String(normalized.role)));
          setLoading(false);
          return;
        }

        const newUserPayload = buildNewUserInsertPayload(authUser);

        let insertedRow: Record<string, unknown> | null = null;
        const { data: insertData, error: insertError } = await supabase
          .from("users")
          .insert(newUserPayload)
          .select(USER_SELECT_COLUMNS)
          .single();

        if (insertError) {
          if (!isDuplicateKeyError(insertError)) {
            throw insertError;
          }

          // Corrida comum: onAuthStateChange e getSession disparam em paralelo no primeiro login.
          const { data: concurrentRow, error: concurrentSelectError } = await supabase
            .from("users")
            .select(USER_SELECT_COLUMNS)
            .eq("uid", authUser.id)
            .maybeSingle();

          if (concurrentSelectError) throw concurrentSelectError;
          if (!concurrentRow) throw insertError;
          insertedRow = concurrentRow as Record<string, unknown>;
        } else {
          insertedRow = (insertData as Record<string, unknown>) ?? null;
        }

        if (!insertedRow) {
          throw new Error("Falha ao criar usuario no banco.");
        }
        if (!active || currentToken !== syncToken) return;

        const normalized = normalizeUserRow(insertedRow, authUser);
        authSyncFallbackUidRef.current = null;
        setUser(normalized);
        setIsAdmin(false);
        setLoading(false);
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
    async (currentUser: User, patch: Record<string, unknown>): Promise<User> => {
      const { dbPatch } = buildUserPatchPayload(currentUser, patch);
      const mutablePatch: Record<string, unknown> = { ...dbPatch };
      let data: Record<string, unknown> | null = null;

      while (Object.keys(mutablePatch).length > 0) {
        const updateResult = await supabase
          .from("users")
          .update(mutablePatch)
          .eq("uid", currentUser.uid)
          .select(USER_SELECT_COLUMNS)
          .maybeSingle();

        if (!updateResult.error) {
          data = (updateResult.data as Record<string, unknown> | null) ?? null;
          break;
        }

        const missingColumn = extractMissingSchemaColumn(updateResult.error);
        if (!missingColumn) throw updateResult.error;

        const removableKey =
          Object.keys(mutablePatch).find((key) => key.toLowerCase() === missingColumn.toLowerCase()) ?? null;
        if (!removableKey) throw updateResult.error;
        delete mutablePatch[removableKey];
      }

      if (!data) {
        const recoveryPayload: Record<string, unknown> = {
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
        };

        const { data: recoveredRow, error: recoveryError } = await supabase
          .from("users")
          .upsert(recoveryPayload, { onConflict: "uid" })
          .select(USER_SELECT_COLUMNS)
          .single();

        if (recoveryError) throw recoveryError;

        const recoveredNormalized = normalizeUserRow(recoveredRow);
        setUser(recoveredNormalized);
        setIsAdmin(["master", "admin_geral", "admin_gestor"].includes(String(recoveredNormalized.role)));
        return recoveredNormalized;
      }

      const normalized = normalizeUserRow(data);
      setUser(normalized);
      setIsAdmin(["master", "admin_geral", "admin_gestor"].includes(String(normalized.role)));
      return normalized;
    },
    []
  );

  // 4. MANUTENÃƒâ€¡ÃƒÆ’O (ATUALIZAÃƒâ€¡ÃƒÆ’O DE DADOS)
  useEffect(() => {
    const runMaintenance = async () => {
        // Ã°Å¸Â¦Ë† TRAVA DE SEGURANÃƒâ€¡A: Guest Local NÃƒÆ’O roda manutenÃƒÂ§ÃƒÂ£o no banco
        if (
          !user ||
          isLocalGuest ||
          user.isAnonymous ||
          loading ||
          patentesCache.length === 0 ||
          planosCache.length === 0
        ) {
          return;
        }

        const maintenanceKey = [
          user.uid,
          normalizePlanName(user.plano),
          asString(user.plano_icon).toLowerCase(),
          asString(user.plano_cor).toLowerCase(),
          planosCache
            .map((plan) => `${normalizePlanName(plan.nome)}:${plan.icon}:${plan.cor}:${plan.descontoLoja}:${plan.xpMultiplier}:${plan.nivelPrioridade}`)
            .sort()
            .join("|"),
        ].join("::");

        if (lastMaintenanceUid.current === maintenanceKey) return;

        const updates: Record<string, unknown> = {};
        let hasUpdates = false;
        let maintenanceFailed = false;
        const primaryPlan = [...planosCache].sort((left, right) => {
          if (left.nivelPrioridade !== right.nivelPrioridade) {
            return left.nivelPrioridade - right.nivelPrioridade;
          }

          return normalizePlanName(left.nome).localeCompare(normalizePlanName(right.nome), "pt-BR", {
            sensitivity: "base",
          });
        })[0];
        const defaultPlanName = primaryPlan?.nome || DEFAULT_USER_PROPS.plano;
        const defaultPlanBadge = primaryPlan?.nome || DEFAULT_USER_PROPS.plano_badge;
        const defaultPlanColor = primaryPlan?.cor || DEFAULT_USER_PROPS.plano_cor;
        const defaultPlanIcon = primaryPlan?.icon || DEFAULT_USER_PROPS.plano_icon;
        const defaultPlanDiscount = primaryPlan?.descontoLoja ?? DEFAULT_USER_PROPS.desconto_loja;
        const defaultPlanXpMultiplier = primaryPlan?.xpMultiplier ?? DEFAULT_USER_PROPS.xpMultiplier;
        const defaultPlanPriority = primaryPlan?.nivelPrioridade ?? DEFAULT_USER_PROPS.nivel_prioridade;
        const defaultPlanTier: "bicho" | "atleta" | "lenda" =
          normalizePlanName(defaultPlanName).includes("lenda")
            ? "lenda"
            : normalizePlanName(defaultPlanName).includes("atleta")
            ? "atleta"
            : "bicho";

        // A. AUTO-CURA
        if (user.xp === undefined) { updates.xp = DEFAULT_USER_PROPS.xp; hasUpdates = true; }
        if (user.level === undefined) { updates.level = DEFAULT_USER_PROPS.level; hasUpdates = true; }
        if (user.sharkCoins === undefined) { updates.sharkCoins = DEFAULT_USER_PROPS.sharkCoins; hasUpdates = true; }
        if (!user.patente) { updates.patente = DEFAULT_USER_PROPS.patente; hasUpdates = true; }

        const roleNormalized = typeof user.role === "string" ? user.role.toLowerCase() : "";
        const planNormalized = normalizePlanName(user.plano);
        // Corrige contaminacao de fallback "Visitante" em usuarios reais apos falhas transitórias de auth sync.
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

        // C. SINCRONIA DE PATENTE
        const patenteAlvo = calculatePatenteData(user.xp || 0);
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

        // D. RECONCILIACAO COM ULTIMA SOLICITACAO APROVADA
        if (planosCache.length > 0) {
            const planoAtual = normalizePlanName(user.plano);
            const precisaReconciliarPlano =
                !planoAtual ||
                planoAtual === "visitante" ||
                planoAtual === "bicho" ||
                planoAtual === "bicho solto";

            if (precisaReconciliarPlano) {
                try {
                    const { data: latestApprovedRequest, error: latestApprovedError } = await supabase
                        .from("solicitacoes_adesao")
                        .select("planoNome, status, updatedAt, dataSolicitacao")
                        .eq("userId", user.uid)
                        .eq("status", "aprovado")
                        .order("updatedAt", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!latestApprovedError && latestApprovedRequest) {
                        const approvedPlanName = normalizePlanName(latestApprovedRequest.planoNome);
                        const approvedPlan = findPlanByName(planosCache, latestApprovedRequest.planoNome);

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
                }
            }
        }

        // E. SINCRONIA DE PLANO
        const effectivePlanName = updates.plano ?? user.plano;
        const planoReal = findPlanByName(planosCache, effectivePlanName);
        if (planoReal) {
            const currentPlanColor = asString(updates.plano_cor ?? user.plano_cor);
            const currentPlanIcon = asString(updates.plano_icon ?? user.plano_icon);
            const currentDiscount = Number(updates.desconto_loja ?? user.desconto_loja ?? 0);
            const currentXpMultiplier = Number(updates.xpMultiplier ?? user.xpMultiplier ?? 1);
            const currentPriority = Number(updates.nivel_prioridade ?? user.nivel_prioridade ?? 1);

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
        }

        if (hasUpdates) {
            try {
                await persistUserPatch(user, updates);
            } catch (err: unknown) {
                maintenanceFailed = true;
                if (!isPermissionError(err)) {
                    console.warn("Erro ao atualizar manutenÃ§Ã£o do usuÃ¡rio:", err);
                }
            }
        }

        if (!maintenanceFailed) {
            lastMaintenanceUid.current = maintenanceKey;
        }
    };

    runMaintenance();
  }, [user, loading, patentesCache, planosCache, isLocalGuest, calculatePatenteData, persistUserPatch]);

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
      if (isCadastroBypassPath(pathname)) return;
      if (authSyncFallbackUidRef.current === user.uid) return;

      if (hasCadastroPendente(user)) {
          router.replace("/cadastro");
      }
  }, [user, loading, pathname, router, isLocalGuest]);

  // --- FUNÃƒâ€¡Ãƒâ€¢ES PÃƒÅ¡BLICAS ---

  const loginGoogle = async () => {
    try {
      if (isLocalGuest) {
          localStorage.removeItem("shark_guest_session");
          setIsLocalGuest(false);
          setUser(null);
      }
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined;

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
        nome: "Visitante Tubarao",
        email: "visitante@aaakn.com",
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
        router.push("/dashboard");
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
    authSyncFallbackUidRef.current = null;
    router.push("/");
  };

  const checkPermission = (allowedRoles: string[]) => {
    if (!user) return false;
    if (user.role === "master") return true;
    return allowedRoles.includes(user.role as string);
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
      await persistUserPatch(user, data as Record<string, unknown>);
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

    const now = Date.now();
    if (now - lastUserRefreshAtRef.current < 15_000) return;
    lastUserRefreshAtRef.current = now;

    const refresh = async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select(USER_SELECT_COLUMNS)
          .eq("uid", user.uid)
          .maybeSingle();

        if (error) throw error;
        if (!data) return;

        const normalized = normalizeUserRow(data);
        setUser((previous) => {
          if (!previous) return normalized;

          const previousSignature = [
            asString(previous.plano),
            asString(previous.plano_badge),
            asString(previous.plano_cor),
            asString(previous.plano_icon),
            asString(previous.tier),
            asString(previous.status),
            asString(previous.role),
          ].join("|");
          const nextSignature = [
            asString(normalized.plano),
            asString(normalized.plano_badge),
            asString(normalized.plano_cor),
            asString(normalized.plano_icon),
            asString(normalized.tier),
            asString(normalized.status),
            asString(normalized.role),
          ].join("|");

          return previousSignature === nextSignature ? previous : normalized;
        });

        setIsAdmin(["master", "admin_geral", "admin_gestor"].includes(String(normalized.role)));
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
    <AuthContext.Provider value={{ user, loading, isAdmin, loginGoogle, loginAsGuest, logout, checkPermission, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return context;
};









