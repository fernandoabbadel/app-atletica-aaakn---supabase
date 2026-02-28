import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { processLock, type LockFunc } from "@supabase/auth-js";

// Reutiliza um singleton no browser para evitar multiplas instancias do cliente.
let browserClient: SupabaseClient | null = null;

const getSupabaseEnv = (): { url: string; anonKey: string } => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase client env vars ausentes (NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }

  return { url, anonKey };
};

const sharedAuthLock: LockFunc = async (name, acquireTimeout, fn) => {
  // Em alguns navegadores mobile o Navigator LockManager falha com timeout.
  // processLock evita esse bug mantendo serializacao local do auth client.
  return processLock(name, Math.max(acquireTimeout, 30_000), fn);
};

const createSupabaseBrowserClient = (): SupabaseClient => {
  const { url, anonKey } = getSupabaseEnv();

  // Mantemos sessao no navegador, mas sem habilitar realtime por padrao.
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: sharedAuthLock,
    },
  });
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
