import { getSupabaseClient } from "./supabase";
import { asNumber, asObject, asString, throwSupabaseError } from "./supabaseData";

export type TenantPaletteKey =
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "orange"
  | "purple"
  | "pink";

export type TenantRole = "visitante" | "user" | "admin_tenant" | "master_tenant";
export type TenantMembershipStatus = "pending" | "approved" | "rejected" | "disabled";
export type TenantJoinRequestStatus =
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
  logoUrl: string;
  paletteKey: TenantPaletteKey;
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
  roleToAssign: Exclude<TenantRole, "master_tenant">;
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
  requestedRole: TenantRole;
  approvedRole: Exclude<TenantRole, "master_tenant"> | "";
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
  paletteKey?: TenantPaletteKey;
  allowPublicSignup?: boolean;
}

const TENANT_SELECT_COLUMNS =
  "id,nome,sigla,slug,faculdade,cidade,curso,area,logo_url,palette_key,allow_public_signup,status,created_at,updated_at";
const TENANT_INVITE_SELECT_COLUMNS =
  "id,tenant_id,token,role_to_assign,requires_approval,max_uses,uses_count,expires_at,is_active,created_by,created_at";
const TENANT_JOIN_REQUEST_SELECT_COLUMNS =
  "id,tenant_id,requester_user_id,invite_id,status,requested_role,approved_role,requested_at,reviewed_at,rejection_reason";

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const parseTenantRole = (value: unknown, fallback: TenantRole = "visitante"): TenantRole => {
  const role = asString(value).trim().toLowerCase();
  if (
    role === "visitante" ||
    role === "user" ||
    role === "admin_tenant" ||
    role === "master_tenant"
  ) {
    return role;
  }
  return fallback;
};

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
    logoUrl: asString(raw.logo_url).trim(),
    paletteKey: parsePalette(raw.palette_key),
    allowPublicSignup: asBoolean(raw.allow_public_signup, true),
    status: parseTenantStatus(raw.status),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  };
};

const parseInviteRole = (
  value: unknown
): Exclude<TenantRole, "master_tenant"> => {
  const role = asString(value).trim().toLowerCase();
  if (role === "visitante" || role === "admin_tenant") return role;
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

export async function fetchTenantPlatformConfig(): Promise<TenantPlatformConfig> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_platform_config")
    .select("id,tokenization_active,updated_by,updated_at")
    .eq("id", "global")
    .maybeSingle();
  if (error) throwSupabaseError(error);

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
    const { data, error } = await supabase
      .from("tenants")
      .select(TENANT_SELECT_COLUMNS)
      .order("nome", { ascending: true });
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
    .in("role", ["master_tenant", "admin_tenant"]);
  if (membershipError) throwSupabaseError(membershipError);

  const tenantIds = uniqueIds(
    (Array.isArray(memberships) ? memberships : []).map((row) =>
      asString((row as { tenant_id?: unknown }).tenant_id)
    )
  );
  if (tenantIds.length === 0) return [];

  const { data, error } = await supabase
    .from("tenants")
    .select(TENANT_SELECT_COLUMNS)
    .in("id", tenantIds)
    .order("nome", { ascending: true });
  if (error) throwSupabaseError(error);

  return (Array.isArray(data) ? data : [])
    .map((row) => parseTenant(row))
    .filter((row): row is TenantSummary => row !== null);
}

export async function createTenantWithMaster(
  payload: TenantCreatePayload
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_create_with_master", {
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
  });
  if (error) throwSupabaseError(error);

  if (typeof data === "string" && data.trim()) return data.trim();
  if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
    return data[0].trim();
  }

  throw new Error("Tenant criado, mas o banco nao retornou o identificador.");
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

export async function createTenantInvite(payload: {
  tenantId: string;
  roleToAssign?: Exclude<TenantRole, "master_tenant">;
  maxUses?: number;
  expiresInHours?: number;
  requiresApproval?: boolean;
}): Promise<TenantInvite> {
  const cleanTenantId = payload.tenantId.trim();
  if (!cleanTenantId) throw new Error("Tenant invalido para criar convite.");

  const roleToAssign = payload.roleToAssign ?? "user";
  const maxUses = Math.max(1, Math.min(500, Math.floor(payload.maxUses ?? 25)));
  const expiresInHours = Math.max(
    1,
    Math.min(24 * 30, Math.floor(payload.expiresInHours ?? 72))
  );
  const requiresApproval = payload.requiresApproval ?? true;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("tenant_create_invite", {
    p_tenant_id: cleanTenantId,
    p_role_to_assign: roleToAssign,
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

  const requesterIds = uniqueIds(requests.map((request) => request.requesterUserId));
  if (requesterIds.length === 0) return requests;

  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("uid,nome,email,turma,foto")
    .in("uid", requesterIds);

  if (usersError || !Array.isArray(usersData)) {
    return requests;
  }

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

export async function approveTenantJoinRequest(payload: {
  requestId: string;
  approvedRole?: Exclude<TenantRole, "master_tenant">;
}): Promise<void> {
  const requestId = payload.requestId.trim();
  if (!requestId) throw new Error("Solicitacao invalida.");

  const approvedRole = payload.approvedRole ?? "user";
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("tenant_approve_join_request", {
    p_request_id: requestId,
    p_approved_role: approvedRole,
  });
  if (error) throwSupabaseError(error);
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
  role: TenantRole;
  status: TenantMembershipStatus;
} | null> {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message || "Falha ao identificar usuario autenticado.");
  }

  const userId = asString(authData.user?.id).trim();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id,role,status,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const row = asObject(data);
  if (!row) return null;

  const tenantId = asString(row.tenant_id).trim();
  if (!tenantId) return null;

  return {
    tenantId,
    role: parseTenantRole(row.role, "visitante"),
    status: parseMembershipStatus(row.status, "pending"),
  };
}
