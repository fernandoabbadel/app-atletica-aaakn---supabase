const TENANT_AREA_LABELS = {
  Humanas: "Humanas",
  Exatas: "Exatas",
  "Biológicas": "Biológicas",
  "Saúde": "Saúde",
} as const;

export type TenantAreaValue = keyof typeof TENANT_AREA_LABELS;

const TENANT_AREA_ALIASES: Record<string, TenantAreaValue> = {
  humanas: "Humanas",
  exatas: "Exatas",
  biologicas: "Biológicas",
  "biológicas": "Biológicas",
  saude: "Saúde",
  "saúde": "Saúde",
};

export const TENANT_AREA_OPTIONS = Object.values(TENANT_AREA_LABELS).map((label) => ({
  value: label,
  label,
})) as ReadonlyArray<{ value: TenantAreaValue; label: TenantAreaValue }>;

const normalizeTenantAreaToken = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const normalizeTenantAreaLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed in TENANT_AREA_LABELS) {
    return trimmed;
  }

  return TENANT_AREA_ALIASES[normalizeTenantAreaToken(trimmed)] || trimmed;
};
