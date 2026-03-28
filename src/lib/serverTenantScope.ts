import { fetchTenantBySlug } from "./tenantService";

export interface ServerTenantScope {
  tenantId: string;
  tenantSlug: string;
}

export async function resolveServerTenantScope(options?: {
  tenantSlug?: string | null;
}): Promise<ServerTenantScope> {
  const tenantSlug = (options?.tenantSlug || "").trim().toLowerCase();
  if (!tenantSlug) {
    return {
      tenantId: "",
      tenantSlug: "",
    };
  }

  try {
    const tenant = await fetchTenantBySlug(tenantSlug);
    return {
      tenantId: tenant?.id?.trim() || "",
      tenantSlug: tenant?.slug?.trim().toLowerCase() || tenantSlug,
    };
  } catch {
    return {
      tenantId: "",
      tenantSlug,
    };
  }
}
