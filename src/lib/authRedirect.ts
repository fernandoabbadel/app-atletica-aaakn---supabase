const LOGIN_RETURN_TO_STORAGE_KEY = "usc_login_return_to";

const normalizePublicOrigin = (value: string | null | undefined): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";

  const withProtocol =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : raw.startsWith("localhost") || raw.startsWith("127.0.0.1")
        ? `http://${raw}`
        : `https://${raw}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return "";
  }
};

export const sanitizeReturnToPath = (value: string | null | undefined): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard";
  if (raw.startsWith("/login")) return "/dashboard";
  return raw;
};

export const buildLoginPath = (returnTo?: string): string => {
  const safeReturnTo = sanitizeReturnToPath(returnTo);
  return `/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
};

export const resolvePublicAppOrigin = (): string => {
  const envOrigin =
    normalizePublicOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (envOrigin) return envOrigin;

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "";
};

export const buildAbsoluteAppUrl = (path: string): string | undefined => {
  const origin = resolvePublicAppOrigin();
  if (!origin) return undefined;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
};

export const buildLoginRedirectUrl = (returnTo?: string): string | undefined =>
  buildAbsoluteAppUrl(buildLoginPath(returnTo));

export const storeLoginReturnTo = (returnTo?: string): string => {
  const safeReturnTo = sanitizeReturnToPath(returnTo);
  if (typeof window !== "undefined") {
    localStorage.setItem(LOGIN_RETURN_TO_STORAGE_KEY, safeReturnTo);
  }
  return safeReturnTo;
};

export const readStoredLoginReturnTo = (): string | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LOGIN_RETURN_TO_STORAGE_KEY);
  if (!stored) return null;
  return sanitizeReturnToPath(stored);
};

export const consumeStoredLoginReturnTo = (): string | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LOGIN_RETURN_TO_STORAGE_KEY);
  localStorage.removeItem(LOGIN_RETURN_TO_STORAGE_KEY);
  if (!stored) return null;
  return sanitizeReturnToPath(stored);
};

export const clearStoredLoginReturnTo = (): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LOGIN_RETURN_TO_STORAGE_KEY);
};
