export interface TenantBrandSnapshot {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantSigla: string;
  tenantCourse: string;
  tenantLogoUrl: string;
}

export const TENANT_BRAND_SNAPSHOT_STORAGE_KEY = "usc_active_tenant_brand";

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeTenantBrandSnapshot = (
  value: unknown
): TenantBrandSnapshot | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  return {
    tenantId: asString(raw.tenantId),
    tenantSlug: asString(raw.tenantSlug),
    tenantName: asString(raw.tenantName),
    tenantSigla: asString(raw.tenantSigla),
    tenantCourse: asString(raw.tenantCourse),
    tenantLogoUrl: asString(raw.tenantLogoUrl),
  };
};

export const readTenantBrandSnapshot = (): TenantBrandSnapshot | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(TENANT_BRAND_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeTenantBrandSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

export const writeTenantBrandSnapshot = (
  payload: TenantBrandSnapshot
): void => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      TENANT_BRAND_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignora falha de storage
  }
};
