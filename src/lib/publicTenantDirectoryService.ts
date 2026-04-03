import { supabaseAdmin } from "./supabaseAdmin";

export const PUBLIC_TENANT_DIRECTORY_LIMIT_MAX = 60;

const PUBLIC_TENANT_SELECT_CANDIDATES = [
  "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,contato_email,contato_telefone,logo_url,palette_key,visible_in_directory,allow_public_signup,status,created_at,updated_at",
  "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,logo_url,palette_key,status,created_at,updated_at",
  "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,logo_url,status,created_at,updated_at",
  "*",
] as const;

export interface PublicTenantDirectoryEntry {
  id: string;
  nome: string;
  sigla: string;
  slug: string;
  faculdade: string;
  cidade: string;
  curso: string;
  area: string;
  cnpj: string;
  contatoEmail: string;
  contatoTelefone: string;
  logoUrl: string;
  paletteKey: string;
  visibleInDirectory: boolean;
  allowPublicSignup: boolean;
  status: "active" | "inactive" | "blocked";
  createdAt: string;
  updatedAt: string;
}

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

const shouldFallbackMissingColumns = (
  error: unknown,
  columns: readonly string[]
): boolean => {
  const message = getSupabaseErrorText(error);
  const isMissingColumnError =
    (message.includes("column") && message.includes("does not exist")) ||
    message.includes("could not find the");
  if (!isMissingColumnError) return false;
  return columns.some((column) => message.includes(column.toLowerCase()));
};

const parseTenantStatus = (
  value: unknown
): "active" | "inactive" | "blocked" => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "inactive" || normalized === "blocked") {
    return normalized;
  }
  return "active";
};

export const parsePublicTenantEntry = (
  row: Record<string, unknown>
): PublicTenantDirectoryEntry | null => {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const slug = typeof row.slug === "string" ? row.slug.trim().toLowerCase() : "";
  if (!id || !slug) return null;

  return {
    id,
    nome: typeof row.nome === "string" ? row.nome.trim() : "",
    sigla: typeof row.sigla === "string" ? row.sigla.trim() : "",
    slug,
    faculdade: typeof row.faculdade === "string" ? row.faculdade.trim() : "",
    cidade: typeof row.cidade === "string" ? row.cidade.trim() : "",
    curso: typeof row.curso === "string" ? row.curso.trim() : "",
    area: typeof row.area === "string" ? row.area.trim() : "",
    cnpj: typeof row.cnpj === "string" ? row.cnpj.trim() : "",
    contatoEmail:
      typeof row.contato_email === "string"
        ? row.contato_email.trim()
        : typeof row.contatoEmail === "string"
          ? row.contatoEmail.trim()
          : "",
    contatoTelefone:
      typeof row.contato_telefone === "string"
        ? row.contato_telefone.trim()
        : typeof row.contatoTelefone === "string"
          ? row.contatoTelefone.trim()
          : "",
    logoUrl:
      typeof row.logo_url === "string"
        ? row.logo_url.trim()
        : typeof row.logoUrl === "string"
          ? row.logoUrl.trim()
          : "",
    paletteKey:
      typeof row.palette_key === "string"
        ? row.palette_key.trim()
        : typeof row.paletteKey === "string" && row.paletteKey.trim()
          ? row.paletteKey.trim()
          : "green",
    visibleInDirectory:
      typeof row.visible_in_directory === "boolean"
        ? row.visible_in_directory
        : typeof row.visibleInDirectory === "boolean"
          ? row.visibleInDirectory
          : true,
    allowPublicSignup:
      typeof row.allow_public_signup === "boolean"
        ? row.allow_public_signup
        : typeof row.allowPublicSignup === "boolean"
          ? row.allowPublicSignup
          : true,
    status: parseTenantStatus(row.status),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
};

export async function fetchPublicTenantRowsWithFallback(
  requestedSlug: string,
  options?: { limit?: number }
): Promise<Record<string, unknown>[]> {
  const cleanRequestedSlug = requestedSlug.trim().toLowerCase();
  const limit = Math.max(
    1,
    Math.min(PUBLIC_TENANT_DIRECTORY_LIMIT_MAX, Math.floor(options?.limit ?? 60))
  );
  let lastSchemaError: unknown = null;
  let shouldFilterActiveStatus = true;
  let shouldFilterDirectoryVisibility = cleanRequestedSlug.length === 0;

  for (const selectColumns of PUBLIC_TENANT_SELECT_CANDIDATES) {
    let query = supabaseAdmin.from("tenants").select(selectColumns);

    if (shouldFilterActiveStatus) {
      query = query.eq("status", "active");
    }

    if (cleanRequestedSlug) {
      query = query.eq("slug", cleanRequestedSlug).limit(1);
      const { data, error } = await query.maybeSingle();
      if (!error) {
        if (!data || typeof data !== "object") return [];
        return [data as Record<string, unknown>];
      }

      if (
        shouldFallbackMissingColumns(error, [
          "contato_email",
          "contato_telefone",
          "visible_in_directory",
          "allow_public_signup",
          "palette_key",
          "logo_url",
          "updated_at",
          "created_at",
        ])
      ) {
        lastSchemaError = error;
        continue;
      }

      if (shouldFilterActiveStatus && shouldFallbackMissingColumns(error, ["status"])) {
        shouldFilterActiveStatus = false;
        lastSchemaError = error;
        continue;
      }

      throw error;
    }

    if (shouldFilterDirectoryVisibility) {
      query = query.eq("visible_in_directory", true);
    }

    const { data, error } = await query.order("nome", { ascending: true }).limit(limit);

    if (!error) {
      return (Array.isArray(data) ? data : []) as unknown as Record<string, unknown>[];
    }

    if (
      shouldFallbackMissingColumns(error, [
        "visible_in_directory",
        "contato_email",
        "contato_telefone",
        "allow_public_signup",
        "palette_key",
        "logo_url",
        "updated_at",
        "created_at",
      ])
    ) {
      lastSchemaError = error;
      continue;
    }

    if (shouldFilterActiveStatus && shouldFallbackMissingColumns(error, ["status"])) {
      shouldFilterActiveStatus = false;
      lastSchemaError = error;
      continue;
    }

    if (
      shouldFilterDirectoryVisibility &&
      shouldFallbackMissingColumns(error, ["visible_in_directory"])
    ) {
      shouldFilterDirectoryVisibility = false;
      lastSchemaError = error;
      continue;
    }

    throw error;
  }

  if (lastSchemaError) {
    console.warn("Diretorio publico de tenants: fallback de schema.", lastSchemaError);
  }
  return [];
}

export async function fetchPublicTenantBySlugWithAdmin(
  tenantSlug: string
): Promise<PublicTenantDirectoryEntry | null> {
  const rows = await fetchPublicTenantRowsWithFallback(tenantSlug, { limit: 1 });
  const entry = parsePublicTenantEntry((rows[0] || {}) as Record<string, unknown>);
  return entry && entry.status === "active" ? entry : null;
}

export async function fetchPublicTenantDirectoryEntries(
  limit: number
): Promise<PublicTenantDirectoryEntry[]> {
  const rows = await fetchPublicTenantRowsWithFallback("", { limit });
  return rows
    .map((row) => parsePublicTenantEntry((row || {}) as Record<string, unknown>))
    .filter(
      (row): row is PublicTenantDirectoryEntry => row !== null && row.status === "active"
    );
}
