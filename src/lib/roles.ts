export type TenantScopedRole =
  | "visitante"
  | "user"
  | "mini_vendor"
  | "treinador"
  | "empresa"
  | "admin_treino"
  | "admin_geral"
  | "admin_gestor"
  | "master_tenant"
  | "master"
  | "vendas";

type LegacyTenantRole = "admin_tenant" | "master_tenant";

export interface RoleUserLike {
  role?: unknown;
  tenant_role?: unknown;
  tenant_status?: unknown;
  master_role_preview?: unknown;
}

const TENANT_ROLE_SET = new Set<TenantScopedRole>([
  "visitante",
  "user",
  "mini_vendor",
  "treinador",
  "empresa",
  "admin_treino",
  "admin_geral",
  "admin_gestor",
  "master_tenant",
  "master",
  "vendas",
]);

const LEGACY_TO_MODERN: Record<LegacyTenantRole, TenantScopedRole> = {
  admin_tenant: "admin_geral",
  master_tenant: "master_tenant",
};

export const ADMIN_PANEL_FALLBACK_ROLES = new Set<string>([
  "master",
  "master_tenant",
  "admin_geral",
  "admin_gestor",
  "admin_treino",
  "treinador",
]);

export const TENANT_MANAGER_ROLES = new Set<TenantScopedRole>([
  "master_tenant",
  "admin_geral",
  "admin_gestor",
]);

const MASTER_ONLY_ADMIN_PREFIXES = ["/admin/master", "/master"];

const toRoleString = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isMasterOnlyAdminPath = (path: string): boolean => {
  const normalizedPath = path.trim().toLowerCase();
  if (!normalizedPath.startsWith("/")) return false;

  return MASTER_ONLY_ADMIN_PREFIXES.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );
};

export const isPlatformMaster = (user: RoleUserLike | null | undefined): boolean =>
  toRoleString(user?.role) === "master";

export const normalizeTenantRole = (
  value: unknown
): TenantScopedRole | "" => {
  const role = toRoleString(value);
  if (!role) return "";
  if (role === "admin_tenant" || role === "master_tenant") {
    return LEGACY_TO_MODERN[role];
  }
  if (TENANT_ROLE_SET.has(role as TenantScopedRole)) {
    return role as TenantScopedRole;
  }
  if (role === "guest") return "visitante";
  return "";
};

export const toLegacyTenantRole = (
  role: TenantScopedRole
): LegacyTenantRole | TenantScopedRole => {
  if (role === "admin_geral") return "admin_tenant";
  if (role === "master_tenant") return "master_tenant";
  if (role === "master") return "master";
  return role;
};

export const getRoleAliases = (roleRaw: string): string[] => {
  const role = roleRaw.trim().toLowerCase();
  if (!role) return [];

  const aliases = new Set<string>([role]);
  if (role === "admin_geral") aliases.add("admin_tenant");
  if (role === "admin_tenant") aliases.add("admin_geral");
  if (role === "visitante") aliases.add("guest");
  if (role === "guest") aliases.add("visitante");
  return Array.from(aliases);
};

const resolveTenantMembershipRole = (
  user: RoleUserLike | null | undefined
): TenantScopedRole | "" => {
  const tenantRole = normalizeTenantRole(user?.tenant_role);
  if (!tenantRole) return "";
  if (!isPlatformMaster(user) && tenantRole === "master") {
    return "master_tenant";
  }
  return tenantRole;
};

export const resolveEffectiveAccessRole = (
  user: RoleUserLike | null | undefined
): string => {
  if (!user) return "visitante";
  if (isPlatformMaster(user)) {
    const previewRole = normalizeTenantRole(user.master_role_preview);
    return previewRole || "master";
  }

  const tenantRole = resolveTenantMembershipRole(user);
  const tenantStatus = toRoleString(user.tenant_status);
  if (tenantRole && (tenantStatus === "" || tenantStatus === "approved")) {
    return tenantRole;
  }

  const rawRole = toRoleString(user.role);
  if (rawRole === "guest") return "visitante";
  return rawRole || "visitante";
};

export const getAccessRoleCandidates = (
  user: RoleUserLike | null | undefined
): string[] => {
  const candidates = new Set<string>();
  const hasPlatformMasterPreview =
    isPlatformMaster(user) && Boolean(normalizeTenantRole(user?.master_role_preview));

  const effective = resolveEffectiveAccessRole(user);
  getRoleAliases(effective).forEach((role) => candidates.add(role));

  if (hasPlatformMasterPreview) {
    if (!candidates.size) candidates.add("visitante");
    return Array.from(candidates);
  }

  const rawRole = toRoleString(user?.role);
  getRoleAliases(rawRole).forEach((role) => candidates.add(role));

  const tenantRole = resolveTenantMembershipRole(user);
  getRoleAliases(tenantRole).forEach((role) => candidates.add(role));

  if (!candidates.size) candidates.add("visitante");
  return Array.from(candidates);
};

export const hasAdminPanelAccess = (
  user: RoleUserLike | null | undefined
): boolean => {
  const roleCandidates = getAccessRoleCandidates(user);
  return roleCandidates.some((role) => ADMIN_PANEL_FALLBACK_ROLES.has(role));
};

export const canManageTenant = (
  user: RoleUserLike | null | undefined
): boolean => {
  if (isPlatformMaster(user)) {
    const previewRole = normalizeTenantRole(user?.master_role_preview);
    if (!previewRole || previewRole === "master") return true;
    return TENANT_MANAGER_ROLES.has(previewRole);
  }
  const tenantStatus = toRoleString(user?.tenant_status);
  if (tenantStatus && tenantStatus !== "approved") return false;
  const tenantRole = resolveTenantMembershipRole(user);
  return tenantRole ? TENANT_MANAGER_ROLES.has(tenantRole) : false;
};
