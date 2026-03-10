const LOGIN_RETURN_TO_STORAGE_KEY = "usc_login_return_to";

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
