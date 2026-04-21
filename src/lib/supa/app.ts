// Compat de app para manter a assinatura usada no projeto.
// No Supabase nao existe "app" global como no provedor anterior, entao o objeto e simbolico.

export interface AppInstance {
  name: string;
  options: Record<string, unknown>;
}

let appSingleton: AppInstance | null = null;

export function initializeApp(options: Record<string, unknown>): AppInstance {
  if (appSingleton) return appSingleton;
  appSingleton = {
    name: "supabase-app",
    options,
  };
  return appSingleton;
}

export function getApps(): AppInstance[] {
  return appSingleton ? [appSingleton] : [];
}

export function getApp(): AppInstance {
  if (!appSingleton) {
    throw new Error("App ainda não inicializado.");
  }
  return appSingleton;
}
