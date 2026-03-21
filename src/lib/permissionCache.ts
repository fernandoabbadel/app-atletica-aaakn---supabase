import { resolveStoredTenantScopeId } from "./activeTenantSnapshot";

export const LEGACY_PERMISSION_MATRIX_STORAGE_KEY = "shark_permissions";

export const buildPermissionMatrixStorageKey = (
  tenantId?: string | null,
  scope: "tenant" | "platform" | "effective" = "tenant"
): string => {
  const cleanTenantId = resolveStoredTenantScopeId(
    typeof tenantId === "string" ? tenantId.trim() : ""
  );

  if (cleanTenantId) {
    if (scope === "effective") {
      return `usc:permissions:effective:${cleanTenantId}`;
    }
    return `usc:permissions:${cleanTenantId}`;
  }

  if (scope === "effective") {
    return "usc:permissions:effective";
  }

  return scope === "platform"
    ? "usc:permissions:platform"
    : "usc:permissions:default";
};

export const clearLegacyPermissionMatrixStorage = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_PERMISSION_MATRIX_STORAGE_KEY);
};
