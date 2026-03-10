const TENANT_BRAND_SNAPSHOT_STORAGE_KEY = "usc_active_tenant_brand";

const asCleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const resolveStoredTenantScopeId = (tenantId?: string | null): string => {
  const explicitTenantId = asCleanString(tenantId);
  if (explicitTenantId) return explicitTenantId;
  if (typeof window === "undefined") return "";

  try {
    const rawSnapshot = window.localStorage.getItem(TENANT_BRAND_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) return "";

    const parsed = JSON.parse(rawSnapshot) as { tenantId?: unknown } | null;
    return asCleanString(parsed?.tenantId);
  } catch {
    return "";
  }
};
