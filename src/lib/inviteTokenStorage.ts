const INVITE_TOKEN_STORAGE_KEY = "usc_pending_invite_token";

export const sanitizeInviteToken = (
  value: string | null | undefined
): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw.slice(0, 256);
};

export const storeInviteToken = (token: string | null | undefined): string => {
  const safeToken = sanitizeInviteToken(token);
  if (typeof window === "undefined") return safeToken;

  if (!safeToken) {
    localStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
    return "";
  }

  localStorage.setItem(INVITE_TOKEN_STORAGE_KEY, safeToken);
  return safeToken;
};

export const readStoredInviteToken = (): string => {
  if (typeof window === "undefined") return "";
  return sanitizeInviteToken(localStorage.getItem(INVITE_TOKEN_STORAGE_KEY));
};

export const clearStoredInviteToken = (): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(INVITE_TOKEN_STORAGE_KEY);
};
