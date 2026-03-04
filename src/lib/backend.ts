import { getApp, getApps, initializeApp } from "@/lib/supa/app";
import { getAuth, GoogleAuthProvider } from "@/lib/supa/auth";
import { getFunctions } from "@/lib/supa/functions";
import { initializeFirestore } from "@/lib/supabaseHelpers";
import { getStorage } from "@/lib/supa/storage";

const appConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

// Mantemos a mesma assinatura exportada para evitar alterar o frontend.
const app = getApps().length ? getApp() : initializeApp(appConfig);
const auth = getAuth();
const db = initializeFirestore(app, {
  // Sem realtime por padrao para reduzir custo de leitura no plano free.
  preferPolling: false,
});
const storage = getStorage();
const functions = getFunctions();
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, functions, googleProvider, storage };

