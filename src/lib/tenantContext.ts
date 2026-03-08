import {
  isPlatformMaster,
  normalizeTenantRole,
  type TenantScopedRole,
} from "./roles";

export interface TenantContextUserLike {
  role?: unknown;
  tenant_id?: unknown;
  tenant_role?: unknown;
  tenant_status?: unknown;
  master_role_preview?: unknown;
}

export const MASTER_TENANT_OVERRIDE_STORAGE_KEY = "usc_master_tenant_override";
export const MASTER_TENANT_OVERRIDE_EVENT_NAME =
  "usc:master-tenant-override-changed";
export const MASTER_ROLE_PREVIEW_STORAGE_KEY = "usc_master_role_preview";
export const MASTER_ROLE_PREVIEW_EVENT_NAME = "usc:master-role-preview-changed";

const asCleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const getUserTenantId = (
  user: TenantContextUserLike | null | undefined
): string => asCleanString(user?.tenant_id);

export const getMasterTenantOverrideId = (value: unknown): string =>
  asCleanString(value);

export const getMasterRolePreview = (
  value: unknown
): TenantScopedRole | "" => normalizeTenantRole(value);

export const hasMasterTenantOverride = (
  user: TenantContextUserLike | null | undefined,
  masterOverrideTenantId: unknown
): boolean =>
  isPlatformMaster(user) && getMasterTenantOverrideId(masterOverrideTenantId).length > 0;

export const resolveEffectiveTenantId = (
  user: TenantContextUserLike | null | undefined,
  masterOverrideTenantId: unknown
): string => {
  if (isPlatformMaster(user)) {
    return getMasterTenantOverrideId(masterOverrideTenantId);
  }
  return getUserTenantId(user);
};

export const applyPlatformMasterTenantOverride = <
  T extends TenantContextUserLike,
>(
  user: T | null | undefined,
  masterOverrideTenantId: unknown,
  masterRolePreview?: unknown
): T | null | undefined => {
  if (!user || !isPlatformMaster(user)) return user;

  const overrideTenantId = resolveEffectiveTenantId(user, masterOverrideTenantId);
  const rolePreview = getMasterRolePreview(masterRolePreview);
  return {
    ...user,
    tenant_id: overrideTenantId,
    tenant_role: rolePreview || "master_tenant",
    tenant_status: "approved",
    master_role_preview: rolePreview,
  };
};

export const dispatchMasterTenantOverrideChanged = (
  masterOverrideTenantId: unknown
): void => {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(MASTER_TENANT_OVERRIDE_EVENT_NAME, {
      detail: {
        tenantId: getMasterTenantOverrideId(masterOverrideTenantId),
      },
    })
  );
};

export const dispatchMasterRolePreviewChanged = (
  masterRolePreview: unknown
): void => {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(MASTER_ROLE_PREVIEW_EVENT_NAME, {
      detail: {
        role: getMasterRolePreview(masterRolePreview),
      },
    })
  );
};
