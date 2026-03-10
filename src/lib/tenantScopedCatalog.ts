const TENANT_ROW_PREFIX = "tenant:";
const TENANT_ROW_SEPARATOR = "::";

const cleanValue = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

export interface ParsedTenantScopedRowId {
  rawId: string;
  baseId: string;
  tenantId: string;
  scoped: boolean;
}

export const parseTenantScopedRowId = (
  rawId: string | null | undefined
): ParsedTenantScopedRowId => {
  const cleanId = cleanValue(rawId);
  if (!cleanId.startsWith(TENANT_ROW_PREFIX)) {
    return {
      rawId: cleanId,
      baseId: cleanId,
      tenantId: "",
      scoped: false,
    };
  }

  const payload = cleanId.slice(TENANT_ROW_PREFIX.length);
  const separatorIndex = payload.indexOf(TENANT_ROW_SEPARATOR);
  if (separatorIndex < 0) {
    return {
      rawId: cleanId,
      baseId: cleanId,
      tenantId: "",
      scoped: false,
    };
  }

  const tenantId = payload.slice(0, separatorIndex).trim();
  const baseId = payload.slice(separatorIndex + TENANT_ROW_SEPARATOR.length).trim();
  if (!tenantId || !baseId) {
    return {
      rawId: cleanId,
      baseId: cleanId,
      tenantId: "",
      scoped: false,
    };
  }

  return {
    rawId: cleanId,
    baseId,
    tenantId,
    scoped: true,
  };
};

export const buildTenantScopedRowId = (
  tenantId: string | null | undefined,
  baseId: string | null | undefined
): string => {
  const cleanTenantId = cleanValue(tenantId);
  const cleanBaseId = cleanValue(baseId);
  if (!cleanBaseId) return "";

  const parsed = parseTenantScopedRowId(cleanBaseId);
  if (!cleanTenantId) {
    return parsed.baseId;
  }
  if (parsed.scoped && parsed.tenantId === cleanTenantId) {
    return parsed.rawId;
  }
  return `${TENANT_ROW_PREFIX}${cleanTenantId}${TENANT_ROW_SEPARATOR}${parsed.baseId}`;
};

export const isTenantScopedRowForTenant = (
  rawId: string | null | undefined,
  tenantId: string | null | undefined
): boolean => {
  const cleanTenantId = cleanValue(tenantId);
  if (!cleanTenantId) return false;
  const parsed = parseTenantScopedRowId(rawId);
  return parsed.scoped && parsed.tenantId === cleanTenantId;
};

