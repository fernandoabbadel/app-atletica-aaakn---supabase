import { supabaseAdmin } from "./supabaseAdmin";
import { type PartnerRecord } from "./partnersPublicService";

const LANDING_PUBLIC_PARTNERS_SELECT_COLUMNS =
  "id,nome,categoria,tier,status,descricao,imgCapa,imgLogo,createdAt";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const getSupabaseErrorText = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message.toLowerCase() : "";
  }

  const raw = error as Record<string, unknown>;
  return [
    error instanceof Error ? error.message : "",
    typeof raw.message === "string" ? raw.message : "",
    typeof raw.details === "string" ? raw.details : "",
    typeof raw.hint === "string" ? raw.hint : "",
  ]
    .filter((entry) => entry.length > 0)
    .join(" ")
    .toLowerCase();
};

const isMissingTenantIdColumn = (error: unknown): boolean =>
  getSupabaseErrorText(error).includes("tenant_id");

const normalizePartner = (raw: unknown): PartnerRecord | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  const id = asString(obj.id).trim();
  if (!id) return null;

  return {
    id,
    nome: asString(obj.nome, "Parceiro"),
    categoria: asString(obj.categoria, "Parceiro"),
    tier: asString(obj.tier, "standard") as PartnerRecord["tier"],
    status: asString(obj.status, "active") as PartnerRecord["status"],
    cnpj: "",
    responsavel: "",
    email: "",
    telefone: "",
    descricao: asString(obj.descricao),
    endereco: "",
    horario: "",
    insta: "",
    site: "",
    whats: "",
    imgCapa: asString(obj.imgCapa),
    imgLogo: asString(obj.imgLogo),
    mensalidade: 0,
    vendasTotal: 0,
    totalScans: asNumber(obj.totalScans, 0),
    cupons: [],
    createdAt: obj.createdAt,
  };
};

export async function fetchLandingPartnersWithAdmin(
  tenantId: string,
  limit = 120
): Promise<PartnerRecord[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const { data, error } = await supabaseAdmin
    .from("parceiros")
    .select(LANDING_PUBLIC_PARTNERS_SELECT_COLUMNS)
    .eq("tenant_id", cleanTenantId)
    .eq("status", "active")
    .limit(limit);

  if (error) {
    if (isMissingTenantIdColumn(error)) {
      return [];
    }
    throw error;
  }

  const rows = (Array.isArray(data) ? data : [])
    .map((row) => normalizePartner(row))
    .filter((row): row is PartnerRecord => row !== null);

  const rank = { ouro: 0, prata: 1, standard: 2 } as const;
  return rows.sort(
    (left, right) =>
      rank[left.tier] - rank[right.tier] || left.nome.localeCompare(right.nome, "pt-BR")
  );
}
