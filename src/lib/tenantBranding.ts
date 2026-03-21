const cleanString = (value?: string | null): string =>
  typeof value === "string" ? value.trim() : "";

export const resolveTenantBrandLabel = (
  tenantSigla?: string | null,
  tenantName?: string | null
): string => {
  const sigla = cleanString(tenantSigla);
  if (sigla) return sigla.toUpperCase();

  const name = cleanString(tenantName);
  if (name) return name;

  return "Atletica";
};

export interface TenantFinanceFallback {
  chave: string;
  banco: string;
  titular: string;
  whatsapp: string;
}

export const buildTenantFinanceFallback = (options?: {
  tenantSigla?: string | null;
  tenantName?: string | null;
}): TenantFinanceFallback => ({
  chave: "financeiro@atletica.com.br",
  banco: "Banco da Atletica",
  titular: resolveTenantBrandLabel(options?.tenantSigla, options?.tenantName),
  whatsapp: "",
});
