export const TENANT_AREA_OPTIONS = [
  { value: "humanas", label: "Humanas" },
  { value: "exatas", label: "Exatas" },
  { value: "biologicas", label: "Biologicas" },
  { value: "saude", label: "Saude" },
] as const;

export type TenantAreaValue = (typeof TENANT_AREA_OPTIONS)[number]["value"];
