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

const isDuplicateKeyError = (error: unknown): boolean => {
  const code = getBackendErrorCode(error);
  return code === "23505";
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
      code: typeof raw.code === "string" ? raw.code : undefined,
      message: typeof raw.message === "string" ? raw.message : undefined,
      details: typeof raw.details === "string" ? raw.details : undefined,
      hint: typeof raw.hint === "string" ? raw.hint : undefined,
      status: typeof raw.status === "number" ? raw.status : undefined,
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
          .select("nome,cor,icon,descontoLoja,xpMultiplier");

        if (error) throw error;

        if (data && data.length > 0) {
          setPlanosCache(
            data.map((row) => ({
              nome: asString(row.nome, "Plano"),
              cor: asString(row.cor, "text-zinc-400"),
              icon: asString(row.icon, "Fish"),
              descontoLoja: asNumber(row.descontoLoja, 0),
              xpMultiplier: asNumber(row.xpMultiplier, 1),
            }))
          );
        }
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
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

      try {
        const { data: existingRow, error: selectError } = await supabase
          .from("users")
          .select("*")
          .eq("uid", authUser.id)
          .maybeSingle();

        if (selectError) throw selectError;

        if (existingRow) {
          if (!active || currentToken !== syncToken) return;
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
          .select("*")
          .single();

        if (insertError) {
          if (!isDuplicateKeyError(insertError)) {
            throw insertError;
          }

          // Corrida comum: onAuthStateChange e getSession disparam em paralelo no primeiro login.
          const { data: concurrentRow, error: concurrentSelectError } = await supabase
            .from("users")
            .select("*")
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
        setUser(normalized);
        setIsAdmin(false);
        setLoading(false);
        void logActivity(normalized.uid, normalized.nome, "CREATE", "Usuarios", "Novo cadastro via Google");
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error("Erro ao sincronizar usuario:", formatBackendErrorForConsole(error));
        }
        if (!active || currentToken !== syncToken) return;
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
      }
    };

    const handleAuthChange = async (authUser: SupabaseAuthUser | null): Promise<void> => {
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
      }
    };

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthChange(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (!isPermissionError(error)) {
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

      const { data, error } = await supabase
        .from("users")
        .update(dbPatch)
        .eq("uid", currentUser.uid)
        .select("*")
        .single();

      if (error) throw error;

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
        if (!user || isLocalGuest || user.isAnonymous || loading || patentesCache.length === 0) return;
        
        if (lastMaintenanceUid.current === user.uid) return;
        lastMaintenanceUid.current = user.uid;

        const updates: Record<string, unknown> = {};
        let hasUpdates = false;

        // A. AUTO-CURA
        if (user.xp === undefined) { updates.xp = DEFAULT_USER_PROPS.xp; hasUpdates = true; }
        if (user.level === undefined) { updates.level = DEFAULT_USER_PROPS.level; hasUpdates = true; }
        if (user.sharkCoins === undefined) { updates.sharkCoins = DEFAULT_USER_PROPS.sharkCoins; hasUpdates = true; }
        if (!user.patente) { updates.patente = DEFAULT_USER_PROPS.patente; hasUpdates = true; }
        
        if (!user.plano) { updates.plano = DEFAULT_USER_PROPS.plano; hasUpdates = true; }
        if (!user.plano_badge) { updates.plano_badge = DEFAULT_USER_PROPS.plano_badge; hasUpdates = true; }
        if (!user.plano_cor) { updates.plano_cor = DEFAULT_USER_PROPS.plano_cor; hasUpdates = true; }

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

        // D. SINCRONIA DE PLANO
        if (user.plano && user.plano !== "Bicho Solto" && planosCache.length > 0) {
            const planoReal = planosCache.find(p => p.nome === user.plano);
            if (planoReal) {
                if (user.plano_cor !== planoReal.cor || user.plano_icon !== planoReal.icon) {
                    updates.plano_cor = planoReal.cor;
                    updates.plano_icon = planoReal.icon;
                    updates.desconto_loja = planoReal.descontoLoja;
                    updates.xpMultiplier = planoReal.xpMultiplier;
                    hasUpdates = true;
                }
            }
        }

        if (hasUpdates) {
            try {
                await persistUserPatch(user, updates);
            } catch (err: unknown) {
                if (!isPermissionError(err)) {
                    console.warn("Erro ao atualizar manutenÃ§Ã£o do usuÃ¡rio:", err);
                }
            }
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
        console.error("Erro ao atualizar:", error);
      }
    }
  };

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






