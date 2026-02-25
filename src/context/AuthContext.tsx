"use client";
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as AuthProviderUser 
} from "@/lib/supa/auth";
import { 
  doc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, getDocs, increment 
} from "@/lib/supa/firestore"; 
import { auth, db, googleProvider } from "@/lib/backend"; 
import { useRouter, usePathname } from "next/navigation"; 
import { logActivity } from "../lib/logger"; 
import LoadingScreen from "../app/loading";
import { DEFAULT_STATS, DEFAULT_USER_PROPS } from "../constants/userDefaults";
import { isPermissionError } from "@/lib/backendErrors";

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
  { titulo: "TubarÃ£o Branco", minXp: 15000, iconName: "Fish", cor: "text-emerald-400" },
  { titulo: "Barracuda", minXp: 2000, iconName: "Swords", cor: "text-blue-400" },
  { titulo: "Peixe PalhaÃ§o", minXp: 500, iconName: "Fish", cor: "text-orange-400" },
  { titulo: "PlÃ¢ncton", minXp: 0, iconName: "Fish", cor: "text-zinc-400" }
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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // ðŸ¦ˆ ESTADO LOCAL DE GUEST
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
        const qPatentes = query(collection(db, "patentes_config"), orderBy("minXp", "desc"));
        const snapPatentes = await getDocs(qPatentes);
        if (!snapPatentes.empty) {
          setPatentesCache(snapPatentes.docs.map((d) => d.data() as unknown as PatenteConfig));
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
        const snapPlanos = await getDocs(collection(db, "planos"));
        if (!snapPlanos.empty) {
          setPlanosCache(snapPlanos.docs.map((d) => d.data() as unknown as PlanoConfig));
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

  // 2. RECUPERAÃ‡ÃƒO DE SESSÃƒO GUEST (Novo!)
  useEffect(() => {
    const savedGuest = localStorage.getItem("shark_guest_session");
    if (savedGuest) {
        try {
            const guestUser = JSON.parse(savedGuest);
            setIsLocalGuest(true);
            setUser(guestUser);
            // Pequeno delay para garantir que o loading nÃ£o pisque errado
            setTimeout(() => setLoading(false), 500);
        } catch {
            localStorage.removeItem("shark_guest_session");
        }
    }
  }, []);

    // 3. MONITORAR AUTH (SUPABASE)
  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (fbUser: AuthProviderUser | null) => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (isLocalGuest) {
        setLoading(false);
        return;
      }

      if (fbUser) {
        const userRef = doc(db, "users", fbUser.uid);

        unsubscribeUserDoc = onSnapshot(
          userRef,
          (userSnap) => {
            if (userSnap.exists()) {
              const userData = userSnap.data() as User;
              setUser({ ...userData, uid: fbUser.uid, isAnonymous: false });
              setIsAdmin(["master", "admin_geral", "admin_gestor"].includes(userData.role));
            } else {
              const newUser: User = {
                ...DEFAULT_USER_PROPS,
                uid: fbUser.uid,
                nome: fbUser.displayName || "Sem Nome",
                email: fbUser.email || "",
                foto: fbUser.photoURL || "https://github.com/shadcn.png",
                role: "guest",
                status: "ativo",
                stats: { ...DEFAULT_STATS },
                ultimoLoginDiario: new Date().toLocaleDateString("pt-BR"),
                data_adesao: new Date().toISOString()
              } as User;

              void setDoc(userRef, newUser).catch((error: unknown) => {
                if (!isPermissionError(error)) {
                  console.error("Erro ao criar perfil inicial:", error);
                }
              });

              setUser(newUser);
              setIsAdmin(false);
              void logActivity(newUser.uid, newUser.nome, "CREATE", "Usuários", "Novo cadastro via Google");
            }

            setLoading(false);
          },
          (error: unknown) => {
            if (!isPermissionError(error)) {
              console.error("Erro ao sincronizar usuário:", error);
            }
            setUser(null);
            setIsAdmin(false);
            setLoading(false);
          }
        );

        return;
      }

      const savedGuest = localStorage.getItem("shark_guest_session");
      if (!savedGuest) {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        lastMaintenanceUid.current = null;
      }
    });

    return () => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
      unsubscribeAuth();
    };
  }, [isLocalGuest]); 

  // 4. MANUTENÃ‡ÃƒO (ATUALIZAÃ‡ÃƒO DE DADOS)
  useEffect(() => {
    const runMaintenance = async () => {
        // ðŸ¦ˆ TRAVA DE SEGURANÃ‡A: Guest Local NÃƒO roda manutenÃ§Ã£o no banco
        if (!user || isLocalGuest || user.isAnonymous || loading || patentesCache.length === 0) return;
        
        if (lastMaintenanceUid.current === user.uid) return;
        lastMaintenanceUid.current = user.uid;
        
        const userRef = doc(db, "users", user.uid);
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

        // B. LOGIN DIÃRIO
        const hoje = new Date().toLocaleDateString('pt-BR');
        if (user.ultimoLoginDiario !== hoje) {
            updates["stats.loginCount"] = increment(1);
            updates.ultimoLoginDiario = hoje;
            updates.xp = (user.xp || 0) + 10;
            hasUpdates = true;
            // Log apenas se nÃ£o for guest (redundante, mas seguro)
            if (!isLocalGuest) {
                logActivity(user.uid, user.nome, "LOGIN", "Sistema", "Check-in DiÃ¡rio (+10 XP)");
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
                await updateDoc(userRef, updates);
            } catch (err: unknown) {
                if (!isPermissionError(err)) {
                    console.warn("Erro ao atualizar manutenção do usuário:", err);
                }
            }
        }
    };

    runMaintenance();
  }, [user, loading, patentesCache, planosCache, isLocalGuest, calculatePatenteData]);

  // 5. SEGURANÃ‡A E REDIRECIONAMENTOS
  useEffect(() => {
      if (loading || !user) return;

      if ((user.status === 'banned' || user.status === 'bloqueado') && pathname !== '/banned') {
          router.replace('/banned');
      }

      if (user.status !== 'banned' && user.status !== 'bloqueado' && pathname === '/banned') {
          router.replace('/dashboard');
      }
  }, [user, pathname, loading, router]); 

  // --- FUNÃ‡Ã•ES PÃšBLICAS ---

  const loginGoogle = async () => {
    try {
      if (isLocalGuest) {
          localStorage.removeItem("shark_guest_session");
          setIsLocalGuest(false);
          setUser(null);
      }
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login falhou:", error);
    }
  };

  const loginAsGuest = async () => {
    setLoading(true);
    const guestUser: User = {
        ...DEFAULT_USER_PROPS,
        uid: "guest_virtual_" + Date.now(), // ID Ãºnico para a sessÃ£o
        nome: "Visitante TubarÃ£o",
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

    // ðŸ¦ˆ Salva no LocalStorage para persistir no F5
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
            await signOut(auth);
        }
    }
    
    // ðŸ¦ˆ Limpa sessÃ£o local
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
    
    // Se for guest, atualiza sÃ³ localmente
    if (isLocalGuest) {
        const newUser = { ...user, ...data };
        setUser(newUser);
        localStorage.setItem("shark_guest_session", JSON.stringify(newUser));
        return; 
    }

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, data);
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






