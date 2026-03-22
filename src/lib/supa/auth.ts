import { getSupabaseClient } from "../supabase";
import { buildAbsoluteAppUrl } from "../authRedirect";

export interface User {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  raw: unknown;
}

export interface AuthInstance {
  currentUser: User | null;
}

export class GoogleAuthProvider {
  // Classe placeholder para manter a chamada signInWithPopup(auth, googleProvider).
}

type AuthCallback = (user: User | null) => void;

type SupabaseAuthLikeUser = {
  id?: unknown;
  email?: unknown;
  app_metadata?: unknown;
  user_metadata?: unknown;
  is_anonymous?: unknown;
};

const authSingleton: AuthInstance = {
  currentUser: null,
};

let initialized = false;
const listeners = new Set<AuthCallback>();
let unsubscribeSupabaseAuth: (() => void) | null = null;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const isAuthLockTimeoutError = (error: unknown): boolean => {
  const raw = asObject(error);
  const text = [
    error instanceof Error ? error.message : "",
    asString(raw?.message) ?? "",
    asString(raw?.details) ?? "",
  ]
    .join(" | ")
    .toLowerCase();

  return (
    text.includes("navigator lockmanage") ||
    text.includes("lockmanager") ||
    (text.includes("timed out") && text.includes("auth-token"))
  );
};

const mapUser = (rawUser: unknown): User | null => {
  const user = rawUser as SupabaseAuthLikeUser | null;
  if (!user || typeof user !== "object") return null;

  const metadata = asObject(user.user_metadata) ?? {};
  const appMetadata = asObject(user.app_metadata) ?? {};

  const uid = asString(user.id);
  if (!uid) return null;

  const displayName =
    asString(metadata.full_name) ??
    asString(metadata.name) ??
    asString(metadata.user_name) ??
    asString(appMetadata.provider) ??
    null;

  const photoURL =
    asString(metadata.avatar_url) ??
    asString(metadata.picture) ??
    asString(metadata.photo_url) ??
    null;

  return {
    id: uid,
    uid,
    email: asString(user.email),
    displayName,
    photoURL,
    isAnonymous: Boolean(user.is_anonymous),
    raw: rawUser,
  };
};

const emitAuthState = (user: User | null): void => {
  authSingleton.currentUser = user;
  for (const listener of listeners) {
    try {
      listener(user);
    } catch (error: unknown) {
      console.error("Erro em listener de auth:", error);
    }
  }
};

const ensureInitialized = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;

  const supabase = getSupabaseClient();

  try {
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error) {
      if (!isAuthLockTimeoutError(error)) {
        console.error("Auth bootstrap: erro ao obter sessao.", error);
      }
    } else {
      emitAuthState(mapUser(sessionData.session?.user ?? null));
    }
  } catch (error: unknown) {
    if (!isAuthLockTimeoutError(error)) {
      console.error("Auth bootstrap: falha inesperada ao inicializar sessao.", error);
    }
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    emitAuthState(mapUser(session?.user ?? null));
  });

  unsubscribeSupabaseAuth = () => {
    data.subscription.unsubscribe();
    unsubscribeSupabaseAuth = null;
    initialized = false;
  };
};

export function getAuth(): AuthInstance {
  void ensureInitialized();
  return authSingleton;
}

export function onAuthStateChanged(
  auth: AuthInstance,
  callback: AuthCallback
): () => void {
  listeners.add(callback);

  // Dispara imediatamente com o estado atual, como no SDK antigo.
  callback(auth.currentUser);
  void ensureInitialized();

  return () => {
    listeners.delete(callback);
    if (!listeners.size && unsubscribeSupabaseAuth) {
      unsubscribeSupabaseAuth();
    }
  };
}

export async function signInWithPopup(
  _auth: AuthInstance,
  _provider: GoogleAuthProvider
): Promise<{ user: User | null }> {
  void _auth;
  void _provider;
  const supabase = getSupabaseClient();

  const redirectTo = buildAbsoluteAppUrl("/visitante");

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: false,
    },
  });

  if (error) {
    const err = Object.assign(new Error(error.message), {
      code: error.code ?? "auth/oauth-sign-in-failed",
      cause: error,
    });
    throw err;
  }

  // Em fluxo OAuth com redirect normalmente nao ha user imediato.
  return { user: authSingleton.currentUser ?? null };
}

export async function signOut(_auth: AuthInstance): Promise<void> {
  void _auth;
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: error.code ?? "auth/signout-failed",
      cause: error,
    });
  }
  emitAuthState(null);
}

export async function deleteUser(user: User | null): Promise<void> {
  // Em cliente anon key nao ha delete direto de usuario. Mantemos comportamento seguro.
  if (!user) return;

  const supabase = getSupabaseClient();

  // Tentativa opcional via Edge Function/RPC, sem acoplar o frontend a uma implementacao unica.
  const edgeAttempt = await supabase.functions.invoke("auth-delete-self", {
    body: { userId: user.uid },
  });

  if (edgeAttempt.error) {
    throw Object.assign(new Error(edgeAttempt.error.message), {
      code: edgeAttempt.error.name ?? "auth/delete-user-not-supported",
      cause: edgeAttempt.error,
    });
  }
}
