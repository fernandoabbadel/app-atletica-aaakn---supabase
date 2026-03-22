import { getSupabaseClient } from "./supabase";
import {
  asNumber,
  asObject,
  asString,
  throwSupabaseError,
} from "./supabaseData";
import { uploadImage } from "./upload";
import { ACHIEVEMENTS_CATALOG } from "./achievements";
import {
  normalizeTenantRole,
  toLegacyTenantRole,
  type TenantScopedRole,
} from "./roles";

export type TenantPaletteKey =
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "orange"
  | "purple"
  | "pink";

export type TenantRole = TenantScopedRole | "admin_tenant" | "master_tenant";
export type TenantInviteRole = Exclude<TenantScopedRole, "master">;
export type TenantMembershipStatus = "pending" | "approved" | "rejected" | "disabled";
export type TenantJoinRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";
export type TenantOnboardingStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface TenantSummary {
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
  paletteKey: TenantPaletteKey;
  visibleInDirectory: boolean;
  allowPublicSignup: boolean;
  status: "active" | "inactive" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export interface TenantPlatformConfig {
  tokenizationActive: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  token: string;
  roleToAssign: TenantInviteRole;
  requiresApproval: boolean;
  maxUses: number;
  usesCount: number;
  expiresAt: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface TenantJoinRequest {
  id: string;
  tenantId: string;
  requesterUserId: string;
  inviteId: string;
  status: TenantJoinRequestStatus;
  requestedRole: TenantScopedRole;
  approvedRole: TenantInviteRole | "";
  requestedAt: string;
  reviewedAt: string;
  rejectionReason: string;
  requesterName: string;
  requesterEmail: string;
  requesterTurma: string;
  requesterPhoto: string;
}

export interface TenantCreatePayload {
  nome: string;
  sigla: string;
  logoUrl?: string;
  cidade?: string;
  faculdade: string;
  curso?: string;
  area?: string;
  cnpj?: string;
  contatoEmail?: string;
  contatoTelefone?: string;
  paletteKey?: TenantPaletteKey;
  allowPublicSignup?: boolean;
}

export interface TenantOnboardingRequest {
  id: string;
  requesterUserId: string;
  nome: string;
  sigla: string;
  logoUrl: string;
  cidade: string;
  faculdade: string;
  curso: string;
  area: string;
  cnpj: string;
  contatoEmail: string;
  contatoTelefone: string;
  paletteKey: TenantPaletteKey;
  allowPublicSignup: boolean;
  status: TenantOnboardingStatus;
  reviewedBy: string;
  reviewedAt: string;
  rejectionReason: string;
  approvedTenantId: string;
  createdAt: string;
  updatedAt: string;
  requesterName: string;
  requesterEmail: string;
  requesterTurma: string;
  requesterPhoto: string;
}

export interface TenantInviteActivationRankingEntry {
  inviterUserId: string;
  inviterName: string;
  inviterEmail: string;
  inviterPhoto: string;
  approvedCount: number;
  pendingCount: number;
  totalCount: number;
  lastActivationAt: string;
}

export interface TenantInviteGenerationRankingEntry {
  inviterUserId: string;
  inviterName: string;
  inviterEmail: string;
  inviterPhoto: string;
  totalInvites: number;
  activeInvites: number;
  inactiveInvites: number;
  totalUses: number;
  lastInviteAt: string;
}

export interface TenantInviteListEntry extends TenantInvite {
  inviterName: string;
  inviterEmail: string;
  inviterTurma: string;
  inviterPhoto: string;
}

export interface TenantInviteActivationListEntry {
  requestId: string;
  tenantId: string;
  inviteId: string;
  inviteToken: string;
  status: TenantJoinRequestStatus;
  requestedAt: string;
  reviewedAt: string;
  approvedRole: TenantInviteRole | "";
  rejectionReason: string;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;
  requesterTurma: string;
  requesterPhoto: string;
  inviterUserId: string;
  inviterName: string;
  inviterEmail: string;
  inviterTurma: string;
  inviterPhoto: string;
}

const TENANT_SELECT_COLUMNS_V1 =
  "id,nome,sigla,slug,faculdade,cidade,curso,area,logo_url,palette_key,allow_public_signup,status,created_at,updated_at";
const TENANT_SELECT_COLUMNS_V3 =
  "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,contato_email,contato_telefone,logo_url,palette_key,visible_in_directory,allow_public_signup,status,created_at,updated_at";
const TENANT_INVITE_SELECT_COLUMNS =
  "id,tenant_id,token,role_to_assign,requires_approval,max_uses,uses_count,expires_at,is_active,created_by,created_at";
const TENANT_JOIN_REQUEST_SELECT_COLUMNS =
  "id,tenant_id,requester_user_id,invite_id,status,requested_role,approved_role,requested_at,reviewed_at,rejection_reason";
const TENANT_ONBOARDING_SELECT_COLUMNS_V1 =
  "id,requester_user_id,nome,sigla,logo_url,cidade,faculdade,curso,area,cnpj,palette_key,allow_public_signup,status,reviewed_by,reviewed_at,rejection_reason,approved_tenant_id,created_at,updated_at";
const TENANT_ONBOARDING_SELECT_COLUMNS_V2 =
  "id,requester_user_id,nome,sigla,logo_url,cidade,faculdade,curso,area,cnpj,contato_email,contato_telefone,palette_key,allow_public_signup,status,reviewed_by,reviewed_at,rejection_reason,approved_tenant_id,created_at,updated_at";

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const parseTenantRole = (
  value: unknown,
  fallback: TenantScopedRole = "visitante"
): TenantScopedRole => normalizeTenantRole(value) || fallback;

const parseMembershipStatus = (
  value: unknown,
  fallback: TenantMembershipStatus = "pending"
): TenantMembershipStatus => {
  const status = asString(value).trim().toLowerCase();
  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "disabled"
  ) {
    return status;
  }
  return fallback;
};

const parseJoinRequestStatus = (
  value: unknown,
  fallback: TenantJoinRequestStatus = "pending"
): TenantJoinRequestStatus => {
  const status = asString(value).trim().toLowerCase();
  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "cancelled"
  ) {
    return status;
  }
  return fallback;
};

const parseOnboardingStatus = (
  value: unknown,
  fallback: TenantOnboardingStatus = "pending"
): TenantOnboardingStatus => {
  const status = asString(value).trim().toLowerCase();
  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "cancelled"
  ) {
    return status;
  }
  return fallback;
};

const parseTenantStatus = (value: unknown): "active" | "inactive" | "blocked" => {
  const status = asString(value).trim().toLowerCase();
  if (status === "inactive" || status === "blocked") return status;
  return "active";
};

const parsePalette = (value: unknown): TenantPaletteKey => {
  const palette = asString(value).trim().toLowerCase();
  if (
    palette === "green" ||
    palette === "yellow" ||
    palette === "red" ||
    palette === "blue" ||
    palette === "orange" ||
    palette === "purple" ||
    palette === "pink"
  ) {
    return palette;
  }
  return "green";
};

const parseTenant = (row: unknown): TenantSummary | null => {
  const raw = asObject(row);
  if (!raw) return null;

  const id = asString(raw.id).trim();
  if (!id) return null;

  return {
    id,
    nome: asString(raw.nome, "Atletica").trim() || "Atletica",
    sigla: asString(raw.sigla, "ATL").trim() || "ATL",
    slug: asString(raw.slug).trim(),
    faculdade: asString(raw.faculdade).trim(),
    cidade: asString(raw.cidade).trim(),
    curso: asString(raw.curso).trim(),
    area: asString(raw.area).trim(),
    cnpj: asString(raw.cnpj).trim(),
    contatoEmail: asString(raw.contato_email).trim(),
    contatoTelefone: asString(raw.contato_telefone).trim(),
    logoUrl: asString(raw.logo_url).trim(),
    paletteKey: parsePalette(raw.palette_key),
    visibleInDirectory: asBoolean(raw.visible_in_directory, true),
    allowPublicSignup: asBoolean(raw.allow_public_signup, true),
    status: parseTenantStatus(raw.status),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  };
};

const parseInviteRole = (value: unknown): TenantInviteRole => {
  const role = parseTenantRole(value, "user");
  if (
    role === "visitante" ||
    role === "user" ||
    role === "mini_vendor" ||
    role === "treinador" ||
    role === "empresa" ||
    role === "admin_treino" ||
    role === "admin_geral" ||
    role === "admin_gestor" ||
    role === "vendas"
  ) {
    return role;
  }
  return "user";
};

const parseInvite = (row: unknown): TenantInvite | null => {
  const raw = asObject(row);
  if (!raw) return null;

  const id = asString(raw.id).trim();
  const tenantId = asString(raw.tenant_id).trim();
  const token = asString(raw.token).trim();
  if (!id || !tenantId || !token) return null;

  return {
    id,
    tenantId,
    token,
    roleToAssign: parseInviteRole(raw.role_to_assign),
    requiresApproval: asBoolean(raw.requires_approval, true),
    maxUses: Math.max(1, asNumber(raw.max_uses, 25)),
    usesCount: Math.max(0, asNumber(raw.uses_count, 0)),
    expiresAt: asString(raw.expires_at),
    isActive: asBoolean(raw.is_active, true),
    createdBy: asString(raw.created_by),
    createdAt: asString(raw.created_at),
  };
};

const parseJoinRequest = (row: unknown): TenantJoinRequest | null => {
  const raw = asObject(row);
  if (!raw) return null;

  const id = asString(raw.id).trim();
  const tenantId = asString(raw.tenant_id).trim();
  const requesterUserId = asString(raw.requester_user_id).trim();
  if (!id || !tenantId || !requesterUserId) return null;

  const approvedRoleRaw = asString(raw.approved_role).trim();

  return {
    id,
    tenantId,
    requesterUserId,
    inviteId: asString(raw.invite_id).trim(),
    status: parseJoinRequestStatus(raw.status),
    requestedRole: parseTenantRole(raw.requested_role, "visitante"),
    approvedRole: approvedRoleRaw
      ? parseInviteRole(approvedRoleRaw)
      : "",
    requestedAt: asString(raw.requested_at),
    reviewedAt: asString(raw.reviewed_at),
    rejectionReason: asString(raw.rejection_reason),
    requesterName: "",
    requesterEmail: "",
    requesterTurma: "",
    requesterPhoto: "",
  };
};

const parseOnboardingRequest = (row: unknown): TenantOnboardingRequest | null => {
  const raw = asObject(row);
  if (!raw) return null;

  const id = asString(raw.id).trim();
  const requesterUserId = asString(raw.requester_user_id).trim();
  if (!id || !requesterUserId) return null;

  return {
    id,
    requesterUserId,
    nome: asString(raw.nome).trim(),
    sigla: asString(raw.sigla).trim(),
    logoUrl: asString(raw.logo_url).trim(),
    cidade: asString(raw.cidade).trim(),
    faculdade: asString(raw.faculdade).trim(),
    curso: asString(raw.curso).trim(),
    area: asString(raw.area).trim(),
    cnpj: asString(raw.cnpj).trim(),
    contatoEmail: asString(raw.contato_email).trim(),
    contatoTelefone: asString(raw.contato_telefone).trim(),
    paletteKey: parsePalette(raw.palette_key),
    allowPublicSignup: asBoolean(raw.allow_public_signup, true),
    status: parseOnboardingStatus(raw.status),
    reviewedBy: asString(raw.reviewed_by).trim(),
    reviewedAt: asString(raw.reviewed_at).trim(),
    rejectionReason: asString(raw.rejection_reason).trim(),
    approvedTenantId: asString(raw.approved_tenant_id).trim(),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
    requesterName: "",
    requesterEmail: "",
    requesterTurma: "",
    requesterPhoto: "",
  };
};

const parseUserPreview = (
  row: unknown
): { uid: string; nome: string; email: string; turma: string; foto: string } | null => {
  const raw = asObject(row);
  if (!raw) return null;
  const uid = asString(raw.uid).trim();
  if (!uid) return null;

  return {
    uid,
    nome: asString(raw.nome).trim(),
    email: asString(raw.email).trim(),
    turma: asString(raw.turma).trim(),
    foto: asString(raw.foto).trim(),
  };
};

const uniqueIds = (values: string[]): string[] =>
  Array.from(new Set(values.filter((value) => value.trim().length > 0)));

const INVITE_ACTIVATION_ACHIEVEMENTS = ACHIEVEMENTS_CATALOG.filter(
  (achievement) => achievement.statKey === "inviteActivations"
).sort((left, right) => left.target - right.target);

const registerInviteActivationForInviter = async (payload: {
  inviterUserId: string;
  tenantId: string;
}): Promise<void> => {
  const inviterUserId = payload.inviterUserId.trim();
  const tenantId = payload.tenantId.trim();
  if (!inviterUserId || !tenantId) return;

  const supabase = getSupabaseClient();
  const { data: inviterRow, error: inviterError } = await supabase
    .from("users")
    .select("uid,nome,stats")
    .eq("uid", inviterUserId)
    .maybeSingle();
  if (inviterError) throwSupabaseError(inviterError);

  const inviter = asObject(inviterRow);
  if (!inviter) return;

  const inviterName = asString(inviter.nome, "Atleta");
  const currentStats = asObject(inviter.stats) ?? {};
  const currentCount = Math.max(0, asNumber(currentStats.inviteActivations, 0));

  for (const achievement of INVITE_ACTIVATION_ACHIEVEMENTS) {
    if (currentCount < achievement.target) {
      continue;
    }

    const { data: existingLog, error: existingLogError } = await supabase
      .from("achievements_logs")
      .select("id")
      .eq("userId", inviterUserId)
      .eq("achievementId", achievement.id)
      .maybeSingle();
    if (existingLogError) throwSupabaseError(existingLogError);
    if (existingLog) continue;

    const { error: insertLogError } = await supabase.from("achievements_logs").insert({
      userId: inviterUserId,
      userName: inviterName,
      achievementId: achievement.id,
      achievementTitle: achievement.titulo,
      xp: achievement.xp,
      timestamp: new Date().toISOString(),
      data: {
        tenantId,
        statKey: "inviteActivations",
        progress: currentCount,
      },
    });
    if (insertLogError) throwSupabaseError(insertLogError);
  }
};

const fetchUsersPreviewMap = async (
  userIds: string[],
  fields = "uid,nome,email,turma,foto"
): Promise<
  Map<string, { uid: string; nome: string; email: string; turma: string; foto: string }>
> => {
  const cleanUserIds = uniqueIds(userIds);
  if (cleanUserIds.length === 0) return new Map();

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("users").select(fields).in("uid", cleanUserIds);
  if (error || !Array.isArray(data)) {
    if (error) throwSupabaseError(error);
    return new Map();
  }

  return new Map(
    data
      .map((row) => parseUserPreview(row))
      .filter(
        (
          row
        ): row is { uid: string; nome: string; email: string; turma: string; foto: string } =>
          row !== null
      )
      .map((row) => [row.uid, row])
  );
};

const isRpcFunctionSignatureError = (
  error: unknown,
  functionName: string
): boolean => {
  const raw = asObject(error);
  const text = [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
    asString(raw?.hint),
  ]
    .filter((entry) => entry.length > 0)
    .join(" ")
    .toLowerCase();

  return text.includes(functionName.toLowerCase()) && text.includes("does not exist");
};

const shouldFallbackMissingColumns = (
  error: unknown,
  columns: string[]
): boolean => {
  const raw = asObject(error);
  const message = [
    error instanceof Error ? error.message : "",
    asString(raw?.message),
    asString(raw?.details),
    asString(raw?.hint),
  ]
    .filter((entry) => entry.length > 0)
    .join(" ")
    .toLowerCase();

  if (!message.includes("column") || !message.includes("does not exist")) return false;
  return columns.some((column) => message.includes(column.toLowerCase()));
};

export async function fetchTenantPlatformConfig(): Promise<TenantPlatformConfig> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_platform_config")
    .select("id,tokenization_active,updated_by,updated_at")
    .eq("id", "global")
    .maybeSingle();
  if (error) {
    const message = [
      asString(error.message).toLowerCase(),
      asString(error.details).toLowerCase(),
      asString(error.hint).toLowerCase(),
    ].join(" ");
    const isRecoverable =
      error.code === "42P01" ||
      error.code === "PGRST204" ||
      message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("permission denied");
    if (!isRecoverable) throwSupabaseError(error);
    return {
      tokenizationActive: true,
      updatedBy: "",
      updatedAt: "",
    };
  }

  const row = asObject(data);
  return {
    tokenizationActive: asBoolean(row?.tokenization_active, true),
    updatedBy: asString(row?.updated_by),
    updatedAt: asString(row?.updated_at),
  };
}

export async function setTenantLaunchTokenizationActive(active: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("tenant_set_launch_tokenization", {
    p_active: active,
  });
  if (error) throwSupabaseError(error);
}

export async function fetchManageableTenants(options?: {
  includeAll?: boolean;
}): Promise<TenantSummary[]> {
  const supabase = getSupabaseClient();
  const includeAll = options?.includeAll ?? false;

  if (includeAll) {
    let { data, error } = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS_V3)
      .order("nome", { ascending: true });
    if (
      error &&
      shouldFallbackMissingColumns(error, [
        "contato_email",
        "contato_telefone",
        "visible_in_directory",
      ])
    ) {
      const fallbackResult = await supabase
        .from("tenants")
        .select(TENANT_SELECT_COLUMNS_V1)
        .order("nome", { ascending: true });
      data = fallbackResult.data as unknown as typeof data;
      error = fallbackResult.error;
    }
    if (error) throwSupabaseError(error);

    return (Array.isArray(data) ? data : [])
      .map((row) => parseTenant(row))
      .filter((row): row is TenantSummary => row !== null);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message || "Falha ao identificar usuario autenticado.");
  }

  const userId = asString(authData.user?.id).trim();
  if (!userId) return [];

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id,role,status")
    .eq("user_id", userId)
    .eq("status", "approved")
    .in("role", ["master", "admin_geral", "admin_gestor", "master_tenant", "admin_tenant"]);
  if (membershipError) throwSupabaseError(membershipError);

  const tenantIds = uniqueIds(
    (Array.isArray(memberships) ? memberships : []).map((row) =>
      asString((row as { tenant_id?: unknown }).tenant_id)
    )
  );
  if (tenantIds.length === 0) return [];

  let { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_COLUMNS_V3)
    .in("id", tenantIds)
    .order("nome", { ascending: true });
  if (
    error &&
    shouldFallbackMissingColumns(error, [
      "contato_email",
      "contato_telefone",
      "visible_in_directory",
    ])
  ) {
    const fallbackResult = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS_V1)
      .in("id", tenantIds)
      .order("nome", { ascending: true });
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  return (Array.isArray(data) ? data : [])
    .map((row) => parseTenant(row))
    .filter((row): row is TenantSummary => row !== null);
}

export async function fetchPublicTenants(options?: {
  limit?: number;
}): Promise<TenantSummary[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 80)));
  const supabase = getSupabaseClient();

  let { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_COLUMNS_V3)
    .eq("status", "active")
    .eq("visible_in_directory", true)
    .order("nome", { ascending: true })
    .limit(limit);
  if (
    error &&
    shouldFallbackMissingColumns(error, [
      "contato_email",
      "contato_telefone",
      "visible_in_directory",
    ])
  ) {
    const fallbackResult = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS_V1)
      .eq("status", "active")
      .order("nome", { ascending: true })
      .limit(limit);
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  return (Array.isArray(data) ? data : [])
    .map((row) => parseTenant(row))
    .filter((row): row is TenantSummary => row !== null);
}

export async function fetchTenantById(tenantId: string): Promise<TenantSummary | null> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return null;

  const supabase = getSupabaseClient();
  let { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_COLUMNS_V3)
    .eq("id", cleanTenantId)
    .maybeSingle();
  if (
    error &&
    shouldFallbackMissingColumns(error, [
      "contato_email",
      "contato_telefone",
      "visible_in_directory",
    ])
  ) {
    const fallbackResult = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS_V1)
      .eq("id", cleanTenantId)
      .maybeSingle();
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  return parseTenant(data);
}

export async function fetchTenantBySlug(tenantSlug: string): Promise<TenantSummary | null> {
  const cleanTenantSlug = tenantSlug.trim().toLowerCase();
  if (!cleanTenantSlug) return null;

  const supabase = getSupabaseClient();
  let { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_COLUMNS_V3)
    .ilike("slug", cleanTenantSlug)
    .maybeSingle();
  if (
    error &&
    shouldFallbackMissingColumns(error, [
      "contato_email",
      "contato_telefone",
      "visible_in_directory",
    ])
  ) {
    const fallbackResult = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS_V1)
      .ilike("slug", cleanTenantSlug)
      .maybeSingle();
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  return parseTenant(data);
}

export async function createTenantWithMaster(
  payload: TenantCreatePayload
): Promise<string> {
  const supabase = getSupabaseClient();
  const payloadV2 = {
    p_nome: payload.nome,
    p_sigla: payload.sigla,
    p_logo_url: payload.logoUrl ?? null,
    p_cidade: payload.cidade ?? null,
    p_faculdade: payload.faculdade,
    p_curso: payload.curso ?? null,
    p_area: payload.area ?? null,
    p_cnpj: payload.cnpj ?? null,
    p_contato_email: payload.contatoEmail ?? null,
    p_contato_telefone: payload.contatoTelefone ?? null,
    p_palette_key: payload.paletteKey ?? "green",
    p_allow_public_signup: payload.allowPublicSignup ?? true,
  };
  const payloadLegacy = {
    p_nome: payload.nome,
    p_sigla: payload.sigla,
    p_logo_url: payload.logoUrl ?? null,
    p_cidade: payload.cidade ?? null,
    p_faculdade: payload.faculdade,
    p_curso: payload.curso ?? null,
    p_area: payload.area ?? null,
    p_cnpj: payload.cnpj ?? null,
    p_palette_key: payload.paletteKey ?? "green",
    p_allow_public_signup: payload.allowPublicSignup ?? true,
  };

  let { data, error } = await supabase.rpc("tenant_create_with_master", payloadV2);
  if (error && isRpcFunctionSignatureError(error, "tenant_create_with_master")) {
    const legacyResult = await supabase.rpc("tenant_create_with_master", payloadLegacy);
    data = legacyResult.data;
    error = legacyResult.error;
  }
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }

  throw new Error("Tenant criado, mas o banco nao retornou o identificador.");
}

export async function submitTenantOnboardingRequest(
  payload: TenantCreatePayload
): Promise<string> {
  const supabase = getSupabaseClient();
  const payloadV2 = {
    p_nome: payload.nome,
    p_sigla: payload.sigla,
    p_logo_url: payload.logoUrl ?? null,
    p_cidade: payload.cidade ?? null,
    p_faculdade: payload.faculdade,
    p_curso: payload.curso ?? null,
    p_area: payload.area ?? null,
    p_cnpj: payload.cnpj ?? null,
    p_contato_email: payload.contatoEmail ?? null,
    p_contato_telefone: payload.contatoTelefone ?? null,
    p_palette_key: payload.paletteKey ?? "green",
    p_allow_public_signup: payload.allowPublicSignup ?? true,
  };
  const payloadLegacy = {
    p_nome: payload.nome,
    p_sigla: payload.sigla,
    p_logo_url: payload.logoUrl ?? null,
    p_cidade: payload.cidade ?? null,
    p_faculdade: payload.faculdade,
    p_curso: payload.curso ?? null,
    p_area: payload.area ?? null,
    p_cnpj: payload.cnpj ?? null,
    p_palette_key: payload.paletteKey ?? "green",
    p_allow_public_signup: payload.allowPublicSignup ?? true,
  };

  let { data, error } = await supabase.rpc("tenant_submit_onboarding_request", payloadV2);
  if (error && isRpcFunctionSignatureError(error, "tenant_submit_onboarding_request")) {
    const legacyResult = await supabase.rpc("tenant_submit_onboarding_request", payloadLegacy);
    data = legacyResult.data;
    error = legacyResult.error;
  }
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }
  throw new Error("Solicitacao criada, mas o banco nao retornou o id.");
}

export async function fetchMyTenantOnboardingRequests(options?: {
  status?: TenantOnboardingStatus;
  limit?: number;
}): Promise<TenantOnboardingRequest[]> {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message || "Falha ao identificar usuario autenticado.");
  }

  const userId = asString(authData.user?.id).trim();
  if (!userId) return [];

  const limit = Math.max(1, Math.min(50, Math.floor(options?.limit ?? 10)));
  let query = supabase
    .from("tenant_onboarding_requests")
    .select(TENANT_ONBOARDING_SELECT_COLUMNS_V2)
    .eq("requester_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  let { data, error } = await query;
  if (error && shouldFallbackMissingColumns(error, ["contato_email", "contato_telefone"])) {
    let fallbackQuery = supabase
      .from("tenant_onboarding_requests")
      .select(TENANT_ONBOARDING_SELECT_COLUMNS_V1)
      .eq("requester_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (options?.status) {
      fallbackQuery = fallbackQuery.eq("status", options.status);
    }

    const fallbackResult = await fallbackQuery;
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  return (Array.isArray(data) ? data : [])
    .map((row) => parseOnboardingRequest(row))
    .filter((row): row is TenantOnboardingRequest => row !== null);
}

export async function fetchTenantOnboardingRequests(options?: {
  status?: TenantOnboardingStatus;
  limit?: number;
}): Promise<TenantOnboardingRequest[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const supabase = getSupabaseClient();

  let query = supabase
    .from("tenant_onboarding_requests")
    .select(TENANT_ONBOARDING_SELECT_COLUMNS_V2)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  let { data, error } = await query;
  if (error && shouldFallbackMissingColumns(error, ["contato_email", "contato_telefone"])) {
    let fallbackQuery = supabase
      .from("tenant_onboarding_requests")
      .select(TENANT_ONBOARDING_SELECT_COLUMNS_V1)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (options?.status) {
      fallbackQuery = fallbackQuery.eq("status", options.status);
    }

    const fallbackResult = await fallbackQuery;
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);

  const requests = (Array.isArray(data) ? data : [])
    .map((row) => parseOnboardingRequest(row))
    .filter((row): row is TenantOnboardingRequest => row !== null);
  if (requests.length === 0) return [];

  const requesterIds = uniqueIds(requests.map((entry) => entry.requesterUserId));
  if (requesterIds.length === 0) return requests;

  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("uid,nome,email,turma,foto")
    .in("uid", requesterIds);
  if (usersError || !Array.isArray(usersData)) return requests;

  const usersMap = new Map(
    usersData
      .map((row) => parseUserPreview(row))
      .filter(
        (row): row is { uid: string; nome: string; email: string; turma: string; foto: string } =>
          row !== null
      )
      .map((row) => [row.uid, row])
  );

  return requests.map((request) => {
    const requester = usersMap.get(request.requesterUserId);
    if (!requester) return request;

    return {
      ...request,
      requesterName: requester.nome,
      requesterEmail: requester.email,
      requesterTurma: requester.turma,
      requesterPhoto: requester.foto,
    };
  });
}

export async function approveTenantOnboardingRequest(requestId: string): Promise<string> {
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId) throw new Error("Solicitacao invalida.");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_approve_onboarding_request", {
    p_request_id: cleanRequestId,
  });
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }
  throw new Error("Solicitacao aprovada, mas o banco nao retornou o tenant.");
}

export async function rejectTenantOnboardingRequest(payload: {
  requestId: string;
  reason?: string;
}): Promise<void> {
  const cleanRequestId = payload.requestId.trim();
  if (!cleanRequestId) throw new Error("Solicitacao invalida.");

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("tenant_reject_onboarding_request", {
    p_request_id: cleanRequestId,
    p_reason: payload.reason?.trim() || null,
  });
  if (error) throwSupabaseError(error);
}

export async function fetchTenantInvites(
  tenantId: string,
  options?: { limit?: number }
): Promise<TenantInvite[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 20)));
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_invites")
    .select(TENANT_INVITE_SELECT_COLUMNS)
    .eq("tenant_id", cleanTenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throwSupabaseError(error);

  return (Array.isArray(data) ? data : [])
    .map((row) => parseInvite(row))
    .filter((row): row is TenantInvite => row !== null);
}

export async function fetchTenantInviteListEntries(
  tenantId: string,
  options?: { limit?: number }
): Promise<TenantInviteListEntry[]> {
  const invites = await fetchTenantInvites(tenantId, options);
  if (invites.length === 0) return [];

  const usersMap = await fetchUsersPreviewMap(invites.map((invite) => invite.createdBy));

  return invites.map((invite) => {
    const inviter = usersMap.get(invite.createdBy);
    return {
      ...invite,
      inviterName: inviter?.nome || "",
      inviterEmail: inviter?.email || "",
      inviterTurma: inviter?.turma || "",
      inviterPhoto: inviter?.foto || "",
    };
  });
}

export async function createTenantInvite(payload: {
  tenantId: string;
  roleToAssign?: TenantInviteRole;
  maxUses?: number;
  expiresInHours?: number;
  requiresApproval?: boolean;
}): Promise<TenantInvite> {
  const cleanTenantId = payload.tenantId.trim();
  if (!cleanTenantId) throw new Error("Tenant invalido para criar convite.");

  const roleToAssign: TenantInviteRole = "user";
  const roleToAssignForRpc = toLegacyTenantRole(roleToAssign);
  const maxUses = Math.max(1, Math.min(500, Math.floor(payload.maxUses ?? 25)));
  const expiresInHours = Math.max(
    1,
    Math.min(24 * 30, Math.floor(payload.expiresInHours ?? 72))
  );
  const requiresApproval = payload.requiresApproval ?? true;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_create_invite", {
    p_tenant_id: cleanTenantId,
    p_role_to_assign: roleToAssignForRpc,
    p_max_uses: maxUses,
    p_expires_in_hours: expiresInHours,
    p_requires_approval: requiresApproval,
  });
  if (error) throwSupabaseError(error);

  const rawResult = Array.isArray(data) ? asObject(data[0]) : asObject(data);
  const inviteId = asString(rawResult?.invite_id || rawResult?.id).trim();

  if (inviteId) {
    const { data: inviteRow, error: inviteError } = await supabase
      .from("tenant_invites")
      .select(TENANT_INVITE_SELECT_COLUMNS)
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError) throwSupabaseError(inviteError);

    const parsedInvite = parseInvite(inviteRow);
    if (parsedInvite) return parsedInvite;
  }

  const token = asString(rawResult?.token).trim();
  if (!token) throw new Error("Convite criado, mas token nao retornado.");

  return {
    id: inviteId || `tmp-${Date.now()}`,
    tenantId: cleanTenantId,
    token,
    roleToAssign,
    requiresApproval,
    maxUses,
    usesCount: 0,
    expiresAt: asString(rawResult?.expires_at),
    isActive: true,
    createdBy: "",
    createdAt: new Date().toISOString(),
  };
}

export async function createMemberInvite(payload: {
  tenantId: string;
  maxUses?: number;
  expiresInHours?: number;
}): Promise<TenantInvite> {
  const cleanTenantId = payload.tenantId.trim();
  if (!cleanTenantId) throw new Error("Tenant invalido para criar convite.");

  const maxUses = Math.max(1, Math.min(5, Math.floor(payload.maxUses ?? 1)));
  const expiresInHours = Math.max(
    1,
    Math.min(24 * 7, Math.floor(payload.expiresInHours ?? 72))
  );

  const supabase = getSupabaseClient();
  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throwSupabaseError(sessionError);

  const accessToken = asString(sessionData.session?.access_token).trim();
  if (!accessToken) {
    throw new Error("Sessao invalida para gerar convite.");
  }

  try {
    const response = await fetch("/api/member-invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        tenantId: cleanTenantId,
        maxUses,
        expiresInHours,
      }),
    });

    const responseData = (await response.json()) as { invite?: unknown; error?: string };
    if (!response.ok) {
      throw new Error(asString(responseData.error, "Erro ao gerar convite."));
    }

    const parsedInvite = parseInvite(responseData.invite);
    if (parsedInvite) return parsedInvite;
    throw new Error("Convite criado, mas o payload retornado veio incompleto.");
  } catch (fallbackError: unknown) {
    const errorMessage =
      fallbackError instanceof Error ? fallbackError.message : "";
    const canFallbackToRpc =
      errorMessage.length === 0 ||
      errorMessage.toLowerCase().includes("failed to fetch") ||
      errorMessage.toLowerCase().includes("network") ||
      errorMessage.toLowerCase().includes("json");

    if (!canFallbackToRpc) {
      throw fallbackError;
    }
  }

  const { data, error } = await supabase.rpc("tenant_create_member_invite", {
    p_tenant_id: cleanTenantId,
    p_max_uses: maxUses,
    p_expires_in_hours: expiresInHours,
  });
  if (error) throwSupabaseError(error);

  const rawResult = Array.isArray(data) ? asObject(data[0]) : asObject(data);
  const inviteId = asString(rawResult?.invite_id || rawResult?.id).trim();
  const token = asString(rawResult?.token).trim();
  const expiresAt = asString(rawResult?.expires_at).trim();

  if (!token) throw new Error("Convite criado, mas token nao retornado.");

  return {
    id: inviteId || `tmp-${Date.now()}`,
    tenantId: cleanTenantId,
    token,
    roleToAssign: "user",
    requiresApproval: true,
    maxUses,
    usesCount: 0,
    expiresAt,
    isActive: true,
    createdBy: "",
    createdAt: new Date().toISOString(),
  };
}

export async function fetchTenantJoinRequests(
  tenantId: string,
  options?: {
    status?: TenantJoinRequestStatus;
    limit?: number;
  }
): Promise<TenantJoinRequest[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const supabase = getSupabaseClient();

  let query = supabase
    .from("tenant_join_requests")
    .select(TENANT_JOIN_REQUEST_SELECT_COLUMNS)
    .eq("tenant_id", cleanTenantId)
    .order("requested_at", { ascending: false })
    .limit(limit);

  const status = options?.status;
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throwSupabaseError(error);

  const requests = (Array.isArray(data) ? data : [])
    .map((row) => parseJoinRequest(row))
    .filter((row): row is TenantJoinRequest => row !== null);
  if (requests.length === 0) return [];

  const usersMap = await fetchUsersPreviewMap(requests.map((request) => request.requesterUserId));

  return requests.map((request) => {
    const requester = usersMap.get(request.requesterUserId);
    if (!requester) return request;

    return {
      ...request,
      requesterName: requester.nome,
      requesterEmail: requester.email,
      requesterTurma: requester.turma,
      requesterPhoto: requester.foto,
    };
  });
}

export async function fetchTenantInviteActivationListEntries(
  tenantId: string,
  options?: { limit?: number }
): Promise<TenantInviteActivationListEntry[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 80)));
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("tenant_join_requests")
    .select(TENANT_JOIN_REQUEST_SELECT_COLUMNS)
    .eq("tenant_id", cleanTenantId)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throwSupabaseError(error);

  const requests = (Array.isArray(data) ? data : [])
    .map((row) => parseJoinRequest(row))
    .filter((row): row is TenantJoinRequest => row !== null);
  if (requests.length === 0) return [];

  const invites = await fetchTenantInvites(cleanTenantId, { limit: 200 });
  const invitesMap = new Map(invites.map((invite) => [invite.id, invite]));
  const usersMap = await fetchUsersPreviewMap([
    ...requests.map((request) => request.requesterUserId),
    ...invites.map((invite) => invite.createdBy),
  ]);

  return requests.map((request) => {
    const requester = usersMap.get(request.requesterUserId);
    const invite = invitesMap.get(request.inviteId);
    const inviter = invite ? usersMap.get(invite.createdBy) : undefined;

    return {
      requestId: request.id,
      tenantId: request.tenantId,
      inviteId: request.inviteId,
      inviteToken: invite?.token || "",
      status: request.status,
      requestedAt: request.requestedAt,
      reviewedAt: request.reviewedAt,
      approvedRole: request.approvedRole,
      rejectionReason: request.rejectionReason,
      requesterUserId: request.requesterUserId,
      requesterName: requester?.nome || request.requesterName,
      requesterEmail: requester?.email || request.requesterEmail,
      requesterTurma: requester?.turma || request.requesterTurma,
      requesterPhoto: requester?.foto || request.requesterPhoto,
      inviterUserId: invite?.createdBy || "",
      inviterName: inviter?.nome || "",
      inviterEmail: inviter?.email || "",
      inviterTurma: inviter?.turma || "",
      inviterPhoto: inviter?.foto || "",
    };
  });
}

export async function approveTenantJoinRequest(payload: {
  requestId: string;
  approvedRole?: TenantInviteRole;
}): Promise<void> {
  const requestId = payload.requestId.trim();
  if (!requestId) throw new Error("Solicitacao invalida.");

  const approvedRole = payload.approvedRole ?? "user";
  const supabase = getSupabaseClient();
  const { data: requestRow, error: requestError } = await supabase
    .from("tenant_join_requests")
    .select("tenant_id,invite_id,status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throwSupabaseError(requestError);

  const request = asObject(requestRow) ?? {};
  const tenantId = asString(request.tenant_id).trim();
  const inviteId = asString(request.invite_id).trim();
  const currentStatus = asString(request.status).trim();

  let inviterUserId = "";
  if (inviteId) {
    const { data: inviteRow, error: inviteError } = await supabase
      .from("tenant_invites")
      .select("created_by")
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError) throwSupabaseError(inviteError);
    inviterUserId = asString(asObject(inviteRow)?.created_by).trim();
  }

  const { error } = await supabase.rpc("tenant_approve_join_request", {
    p_request_id: requestId,
    p_approved_role: toLegacyTenantRole(approvedRole),
  });
  if (error) throwSupabaseError(error);

  if (currentStatus === "pending" && inviterUserId && tenantId) {
    await registerInviteActivationForInviter({ inviterUserId, tenantId });
  }
}

export async function rejectTenantJoinRequest(payload: {
  requestId: string;
  reason?: string;
}): Promise<void> {
  const requestId = payload.requestId.trim();
  if (!requestId) throw new Error("Solicitacao invalida.");

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("tenant_reject_join_request", {
    p_request_id: requestId,
    p_reason: payload.reason?.trim() || null,
  });
  if (error) throwSupabaseError(error);
}

export async function requestJoinWithInvite(token: string): Promise<string> {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error("Token de convite invalido.");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_request_join_with_invite", {
    p_token: cleanToken,
  });
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }
  throw new Error("Solicitacao criada, mas o banco nao retornou o id.");
}

export async function requestJoinManual(tenantId: string): Promise<string> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) throw new Error("Tenant invalido.");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_request_join_manual", {
    p_tenant_id: cleanTenantId,
  });
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }
  throw new Error("Solicitacao criada, mas o banco nao retornou o id.");
}

export async function fetchPendingMembershipStatusForCurrentUser(): Promise<{
  tenantId: string;
  role: TenantScopedRole;
  status: TenantMembershipStatus;
} | null> {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message || "Falha ao identificar usuario autenticado.");
  }

  const userId = asString(authData.user?.id).trim();
  if (!userId) return null;

  const { data: currentUserRow, error: currentUserError } = await supabase
    .from("users")
    .select("tenant_id,tenant_role,tenant_status")
    .eq("uid", userId)
    .maybeSingle();
  if (currentUserError) throwSupabaseError(currentUserError);

  const currentUser = asObject(currentUserRow);
  const preferredTenantId = asString(currentUser?.tenant_id).trim();

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id,role,status,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throwSupabaseError(error);

  const rows = (Array.isArray(data) ? data : [])
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const matchingPreferredMembership =
    preferredTenantId.length > 0
      ? rows.find((entry) => asString(entry.tenant_id).trim() === preferredTenantId)
      : null;
  const pendingMembership =
    rows.find((entry) => parseMembershipStatus(entry.status, "pending") === "pending") || null;
  const approvedMembership =
    rows.find((entry) => parseMembershipStatus(entry.status, "pending") === "approved") || null;
  const selectedMembership =
    matchingPreferredMembership || pendingMembership || approvedMembership || rows[0] || null;

  if (!selectedMembership) {
    if (!preferredTenantId) return null;
    return {
      tenantId: preferredTenantId,
      role: parseTenantRole(currentUser?.tenant_role, "visitante"),
      status: parseMembershipStatus(currentUser?.tenant_status, "pending"),
    };
  }

  const tenantId = asString(selectedMembership.tenant_id).trim();
  if (!tenantId) return null;

  return {
    tenantId,
    role: parseTenantRole(
      selectedMembership.role,
      parseTenantRole(currentUser?.tenant_role, "visitante")
    ),
    status: parseMembershipStatus(
      selectedMembership.status,
      parseMembershipStatus(currentUser?.tenant_status, "pending")
    ),
  };
}

export async function updateTenantStatus(payload: {
  tenantId: string;
  status: "active" | "inactive" | "blocked";
}): Promise<void> {
  const tenantId = payload.tenantId.trim();
  if (!tenantId) throw new Error("Tenant invalido.");

  const status = payload.status;
  if (status !== "active" && status !== "inactive" && status !== "blocked") {
    throw new Error("Status de tenant invalido.");
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("tenants")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", tenantId);

  if (error) throwSupabaseError(error);
}

export async function updateTenantProfile(payload: {
  tenantId: string;
  nome?: string;
  sigla?: string;
  logoUrl?: string;
  cidade?: string;
  faculdade?: string;
  curso?: string;
  area?: string;
  cnpj?: string;
  contatoEmail?: string;
  contatoTelefone?: string;
  paletteKey?: TenantPaletteKey;
  visibleInDirectory?: boolean;
  allowPublicSignup?: boolean;
  status?: "active" | "inactive" | "blocked";
}): Promise<void> {
  const tenantId = payload.tenantId.trim();
  if (!tenantId) throw new Error("Tenant invalido.");

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const setTrimmed = (key: string, value: unknown) => {
    if (typeof value !== "string") return;
    patch[key] = value.trim();
  };

  setTrimmed("nome", payload.nome);
  setTrimmed("sigla", payload.sigla);
  setTrimmed("logo_url", payload.logoUrl);
  setTrimmed("cidade", payload.cidade);
  setTrimmed("faculdade", payload.faculdade);
  setTrimmed("curso", payload.curso);
  setTrimmed("area", payload.area);
  setTrimmed("cnpj", payload.cnpj);
  setTrimmed("contato_email", payload.contatoEmail);
  setTrimmed("contato_telefone", payload.contatoTelefone);

  if (payload.paletteKey) patch.palette_key = payload.paletteKey;
  if (typeof payload.visibleInDirectory === "boolean") {
    patch.visible_in_directory = payload.visibleInDirectory;
  }
  if (typeof payload.allowPublicSignup === "boolean") {
    patch.allow_public_signup = payload.allowPublicSignup;
  }
  if (payload.status) patch.status = payload.status;

  const supabase = getSupabaseClient();
  let { error } = await supabase.from("tenants").update(patch).eq("id", tenantId);
  if (
    error &&
    shouldFallbackMissingColumns(error, [
      "contato_email",
      "contato_telefone",
      "visible_in_directory",
    ])
  ) {
    const fallbackPatch = { ...patch };
    delete fallbackPatch.contato_email;
    delete fallbackPatch.contato_telefone;
    delete fallbackPatch.visible_in_directory;
    const fallbackResult = await supabase
      .from("tenants")
      .update(fallbackPatch)
      .eq("id", tenantId);
    error = fallbackResult.error;
  }
  if (error) throwSupabaseError(error);
}

export async function fetchTenantInviteActivationRanking(
  tenantId: string,
  options?: { limit?: number }
): Promise<TenantInviteActivationRankingEntry[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const limit = Math.max(1, Math.min(50, Math.floor(options?.limit ?? 10)));
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc("tenant_invite_activation_ranking", {
    p_tenant_id: cleanTenantId,
    p_limit: limit,
  });
  if (error) throwSupabaseError(error);

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return [];

  const parseCount = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    return 0;
  };

  const parsedRows = rows
    .map((row) => {
      const raw = asObject(row);
      if (!raw) return null;

      const inviterUserId = asString(raw.inviter_user_id).trim();
      if (!inviterUserId) return null;

      return {
        inviterUserId,
        approvedCount: parseCount(raw.approved_count),
        pendingCount: parseCount(raw.pending_count),
        totalCount: parseCount(raw.total_count),
        lastActivationAt: asString(raw.last_activation_at),
      };
    })
    .filter(
      (
        row
      ): row is {
        inviterUserId: string;
        approvedCount: number;
        pendingCount: number;
        totalCount: number;
        lastActivationAt: string;
      } => row !== null
    );

  if (parsedRows.length === 0) return [];

  const inviterIds = uniqueIds(parsedRows.map((row) => row.inviterUserId));
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("uid,nome,email,foto")
    .in("uid", inviterIds);
  if (usersError) throwSupabaseError(usersError);

  const usersMap = new Map<string, { nome: string; email: string; foto: string }>();
  (Array.isArray(usersData) ? usersData : []).forEach((entry) => {
    const raw = asObject(entry);
    if (!raw) return;
    const uid = asString(raw.uid).trim();
    if (!uid) return;
    usersMap.set(uid, {
      nome: asString(raw.nome).trim(),
      email: asString(raw.email).trim(),
      foto: asString(raw.foto).trim(),
    });
  });

  return parsedRows.map((row) => {
    const profile = usersMap.get(row.inviterUserId);
    return {
      inviterUserId: row.inviterUserId,
      inviterName: profile?.nome || "",
      inviterEmail: profile?.email || "",
      inviterPhoto: profile?.foto || "",
      approvedCount: row.approvedCount,
      pendingCount: row.pendingCount,
      totalCount: row.totalCount,
      lastActivationAt: row.lastActivationAt,
    };
  });
}

export async function fetchTenantInviteGenerationRanking(
  tenantId: string,
  options?: { limit?: number }
): Promise<TenantInviteGenerationRankingEntry[]> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) return [];

  const limit = Math.max(1, Math.min(50, Math.floor(options?.limit ?? 10)));
  const invites = await fetchTenantInvites(cleanTenantId, { limit: 200 });
  const grouped = new Map<
    string,
    {
      totalInvites: number;
      activeInvites: number;
      inactiveInvites: number;
      totalUses: number;
      lastInviteAt: string;
    }
  >();

  invites.forEach((invite) => {
    const inviterUserId = invite.createdBy.trim();
    if (!inviterUserId) return;

    const current = grouped.get(inviterUserId) ?? {
      totalInvites: 0,
      activeInvites: 0,
      inactiveInvites: 0,
      totalUses: 0,
      lastInviteAt: "",
    };

    current.totalInvites += 1;
    current.totalUses += Math.max(0, invite.usesCount);
    if (invite.isActive) current.activeInvites += 1;
    else current.inactiveInvites += 1;

    if (!current.lastInviteAt || invite.createdAt > current.lastInviteAt) {
      current.lastInviteAt = invite.createdAt;
    }

    grouped.set(inviterUserId, current);
  });

  const inviterIds = Array.from(grouped.keys());
  if (inviterIds.length === 0) return [];

  const supabase = getSupabaseClient();
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("uid,nome,email,foto")
    .in("uid", inviterIds);
  if (usersError) throwSupabaseError(usersError);

  const usersMap = new Map<string, { nome: string; email: string; foto: string }>();
  (Array.isArray(usersData) ? usersData : []).forEach((entry) => {
    const raw = asObject(entry);
    if (!raw) return;
    const uid = asString(raw.uid).trim();
    if (!uid) return;
    usersMap.set(uid, {
      nome: asString(raw.nome).trim(),
      email: asString(raw.email).trim(),
      foto: asString(raw.foto).trim(),
    });
  });

  return inviterIds
    .map((inviterUserId) => {
      const stats = grouped.get(inviterUserId);
      if (!stats) return null;
      const profile = usersMap.get(inviterUserId);
      return {
        inviterUserId,
        inviterName: profile?.nome || "",
        inviterEmail: profile?.email || "",
        inviterPhoto: profile?.foto || "",
        totalInvites: stats.totalInvites,
        activeInvites: stats.activeInvites,
        inactiveInvites: stats.inactiveInvites,
        totalUses: stats.totalUses,
        lastInviteAt: stats.lastInviteAt,
      };
    })
    .filter((row): row is TenantInviteGenerationRankingEntry => row !== null)
    .sort((left, right) => {
      if (right.totalInvites !== left.totalInvites) {
        return right.totalInvites - left.totalInvites;
      }
      if (right.totalUses !== left.totalUses) {
        return right.totalUses - left.totalUses;
      }
      return right.lastInviteAt.localeCompare(left.lastInviteAt);
    })
    .slice(0, limit);
}

export async function uploadTenantLogo(payload: {
  tenantId: string;
  file: File;
}): Promise<string> {
  const tenantId = payload.tenantId.trim();
  if (!tenantId) throw new Error("Tenant invalido para upload da logo.");
  if (!(payload.file instanceof File)) {
    throw new Error("Arquivo de logo invalido.");
  }

  const { url, error } = await uploadImage(payload.file, `tenants/${tenantId}/branding`, {
    scopeKey: `tenant:${tenantId}:logo`,
    maxBytes: 2 * 1024 * 1024,
    maxWidth: 1600,
    maxHeight: 1600,
    maxPixels: 2_560_000,
    compressionMaxWidth: 1200,
    compressionMaxHeight: 1200,
    compressionMaxBytes: 140 * 1024,
    fileName: `logo-${tenantId}`,
    upsert: true,
    appendVersionQuery: true,
  });
  if (error || !url) {
    throw new Error(error || "Upload da logo concluido, mas sem URL publica retornada.");
  }

  return url;
}

export async function uploadTenantDraftLogo(payload: {
  file: File;
  scope?: "master" | "onboarding";
}): Promise<string> {
  if (!(payload.file instanceof File)) {
    throw new Error("Arquivo de logo invalido.");
  }

  const draftScope = payload.scope === "master" ? "master" : "onboarding";
  const { url, error } = await uploadImage(
    payload.file,
    `tenant-drafts/${draftScope}/logos`,
    {
      scopeKey: `tenant-draft:${draftScope}:logo`,
      maxBytes: 2 * 1024 * 1024,
      maxWidth: 1600,
      maxHeight: 1600,
      maxPixels: 2_560_000,
      compressionMaxWidth: 1200,
      compressionMaxHeight: 1200,
      compressionMaxBytes: 140 * 1024,
      fileName: `logo-${Date.now()}`,
      upsert: true,
      appendVersionQuery: true,
    }
  );

  if (error || !url) {
    throw new Error(error || "Upload da logo concluido, mas sem URL publica retornada.");
  }

  return url;
}
