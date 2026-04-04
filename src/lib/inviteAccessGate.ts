import { isPlatformMaster } from "./roles";
import { withTenantSlug } from "./tenantRouting";

export const INVITE_REQUIRED_PATH = "/convite-necessario";

type InviteGateUserLike = {
  tenant_id?: unknown;
  tenant_status?: unknown;
  isAnonymous?: unknown;
  role?: unknown;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const isInviteRequiredPath = (pathname: string): boolean =>
  pathname === INVITE_REQUIRED_PATH;

export const resolveInviteRequiredPath = (tenantSlug?: string | null): string => {
  const cleanTenantSlug = asString(tenantSlug).toLowerCase();
  return cleanTenantSlug ? withTenantSlug(cleanTenantSlug, INVITE_REQUIRED_PATH) : INVITE_REQUIRED_PATH;
};

export const hasTenantParticipationAccess = (
  user: InviteGateUserLike | null | undefined,
  tenantId?: string | null
): boolean => {
  const cleanTenantId = asString(tenantId);
  const userTenantId = asString(user?.tenant_id);
  const tenantStatus = asString(user?.tenant_status).toLowerCase();

  if (!cleanTenantId || !userTenantId || cleanTenantId !== userTenantId) {
    return false;
  }

  return tenantStatus === "" || tenantStatus === "approved" || tenantStatus === "pending";
};

export const resolveTenantInviteGateRedirect = (payload: {
  user: InviteGateUserLike | null | undefined;
  tenantId?: string | null;
  tenantSlug?: string | null;
  allowPublicSignup?: boolean | null;
  hasInviteToken?: boolean;
}): string | null => {
  const { user, allowPublicSignup, hasInviteToken = false } = payload;
  const cleanTenantSlug = asString(payload.tenantSlug).toLowerCase();
  const cleanTenantId = asString(payload.tenantId);

  if (!user || Boolean(user.isAnonymous) || isPlatformMaster(user)) {
    return null;
  }

  if (!cleanTenantId && !cleanTenantSlug) {
    return null;
  }

  if (allowPublicSignup !== false) {
    return null;
  }

  if (hasTenantParticipationAccess(user, cleanTenantId)) {
    return null;
  }

  if (hasInviteToken) {
    return cleanTenantSlug ? withTenantSlug(cleanTenantSlug, "/cadastro") : "/cadastro";
  }

  return resolveInviteRequiredPath(cleanTenantSlug);
};
