import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { processLock, type LockFunc } from "@supabase/auth-js";

// Reutiliza um singleton no browser para evitar multiplas instancias do cliente.
let browserClient: SupabaseClient | null = null;
const SUPABASE_AUTH_PARAM_KEYS = [
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "issued_at",
  "provider_token",
  "provider_refresh_token",
  "token_type",
  "type",
  "code",
] as const;

const getSupabaseEnv = (): { url: string; anonKey: string } => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase client env vars ausentes (NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }

  return { url, anonKey };
};

const getSupabaseAuthStorageKey = (url: string): string => {
  const hostname = new URL(url).hostname;
  const projectRef = hostname.split(".")[0]?.trim();
  return projectRef ? `sb-${projectRef}-auth-token` : "supabase-auth-token";
};

const clearSupabaseAuthStorageByKey = (storageKey: string): void => {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(`${storageKey}-code-verifier`);
  window.localStorage.removeItem(`${storageKey}-user`);
};

type StoredSupabaseSession = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
};

const purgeExpiredSupabaseBrowserSession = (url: string): void => {
  if (typeof window === "undefined") return;

  const storageKey = getSupabaseAuthStorageKey(url);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as StoredSupabaseSession | null;
    const accessToken =
      typeof parsed?.access_token === "string" ? parsed.access_token.trim() : "";
    const refreshToken =
      typeof parsed?.refresh_token === "string" ? parsed.refresh_token.trim() : "";
    const expiresAt =
      typeof parsed?.expires_at === "number"
        ? parsed.expires_at
        : Number(parsed?.expires_at || 0);

    if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      clearSupabaseAuthStorageByKey(storageKey);
      return;
    }

    if (expiresAt * 1000 <= Date.now()) {
      clearSupabaseAuthStorageByKey(storageKey);
    }
  } catch {
    clearSupabaseAuthStorageByKey(storageKey);
  }
};

const sharedAuthLock: LockFunc = async (name, acquireTimeout, fn) => {
  // Em alguns navegadores mobile o Navigator LockManager falha com timeout.
  // processLock evita esse bug mantendo serializacao local do auth client.
  return processLock(name, Math.max(acquireTimeout, 30_000), fn);
};

const getBrowserAuthParams = (): {
  params: URLSearchParams;
  source: "hash" | "search";
} | null => {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  );
  const searchParams = new URLSearchParams(url.search);

  const hasKnownAuthParam = (params: URLSearchParams): boolean =>
    SUPABASE_AUTH_PARAM_KEYS.some((key) => params.has(key));

  if (hasKnownAuthParam(hashParams)) {
    return { params: hashParams, source: "hash" };
  }

  if (hasKnownAuthParam(searchParams)) {
    return { params: searchParams, source: "search" };
  }

  return null;
};

const stripSupabaseAuthParamsFromUrl = (source: "hash" | "search"): void => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const params =
    source === "hash"
      ? new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
      : new URLSearchParams(url.search);

  SUPABASE_AUTH_PARAM_KEYS.forEach((key) => params.delete(key));

  if (source === "hash") {
    const nextHash = params.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  } else {
    url.search = params.toString();
  }

  window.history.replaceState({}, document.title, url.toString());
};

const shouldDetectSessionInUrl = (): boolean => {
  const authParams = getBrowserAuthParams();
  if (!authParams) return false;

  if (authParams.params.has("code")) {
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = Number(authParams.params.get("expires_at") || 0);
  const issuedAt = Number(authParams.params.get("issued_at") || 0);
  const expiresIn = Number(authParams.params.get("expires_in") || 0);
  const inferredIssuedAt =
    expiresAt > 0 && expiresIn > 0 ? Math.max(0, expiresAt - expiresIn) : 0;
  const effectiveIssuedAt = issuedAt > 0 ? issuedAt : inferredIssuedAt;

  const isExpired = expiresAt > 0 && expiresAt <= nowSeconds;
  const isStale = effectiveIssuedAt > 0 && nowSeconds - effectiveIssuedAt > 120;

  if (isExpired || isStale) {
    stripSupabaseAuthParamsFromUrl(authParams.source);
    return false;
  }

  return true;
};

const createSupabaseBrowserClient = (): SupabaseClient => {
  const { url, anonKey } = getSupabaseEnv();

  purgeExpiredSupabaseBrowserSession(url);

  // Mantemos sessao no navegador, mas sem habilitar realtime por padrao.
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: shouldDetectSessionInUrl(),
      lock: sharedAuthLock,
    },
  });
};

export const clearSupabaseBrowserSessionStorage = (): void => {
  if (typeof window === "undefined") return;

  const { url } = getSupabaseEnv();
  clearSupabaseAuthStorageByKey(getSupabaseAuthStorageKey(url));
};

export const getSupabaseClient = (): SupabaseClient => {
  if (typeof window === "undefined") {
    // Em ambiente server usamos uma instancia efemera com a mesma anon key.
    return createSupabaseBrowserClient();
  }

  if (!browserClient) {
    browserClient = createSupabaseBrowserClient();
  }

  return browserClient;
};
