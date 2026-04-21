import { NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MANAGER_TENANT_ROLES = new Set([
  "master",
  "master_tenant",
  "admin_geral",
  "admin_gestor",
  "admin_tenant",
]);

export class LeagueAdminApiError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "LeagueAdminApiError";
    this.status = status;
    this.details = details;
  }
}

export type LeagueAdminAuthScope = {
  userId: string;
  userRole: string;
  tenantRole: string;
  tenantStatus: string;
  userTenantId: string;
  isPlatformMaster: boolean;
  canManageTenant: boolean;
};

export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
  const text = [asString(raw.message), asString(raw.details), asString(raw.hint)]
    .filter((entry) => entry.length > 0)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /column\s+(["']?)([a-z0-9_]+)\1\s+does not exist/i,
    /could not find the ['"]?([a-z0-9_]+)['"]? column/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const extracted = match[2] ?? match[1];
    if (extracted) return extracted;
  }

  return null;
};

export const removeMissingColumnFromPayload = (
  payload: Record<string, unknown>,
  missingColumn: string
): Record<string, unknown> | null => {
  const normalizedMissing = missingColumn.trim().toLowerCase();
  if (!normalizedMissing) return null;

  const nextEntries = Object.entries(payload).filter(
    ([key]) => key.toLowerCase() !== normalizedMissing
  );
  if (nextEntries.length === Object.keys(payload).length) return null;
  return Object.fromEntries(nextEntries);
};

export const getLeagueAdminAuthScope = async (
  request: NextRequest
): Promise<LeagueAdminAuthScope> => {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new LeagueAdminApiError("Não autenticado.", 401);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authData.user) {
    throw new LeagueAdminApiError("Sessão inválida.", 401);
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("uid,role,tenant_id,tenant_role,tenant_status")
    .eq("uid", authData.user.id)
    .maybeSingle();

  if (userError) {
    throw new LeagueAdminApiError(userError.message || "Falha ao carregar perfil.", 400);
  }

  const raw = asObject(userRow);
  const userId = asString(raw?.uid).trim();
  const userRole = asString(raw?.role).trim().toLowerCase();
  const tenantRole = asString(raw?.tenant_role).trim().toLowerCase();
  const tenantStatus = asString(raw?.tenant_status).trim().toLowerCase();
  const userTenantId = asString(raw?.tenant_id).trim();
  const isPlatformMaster = userRole === "master";
  const canManageTenant = isPlatformMaster || MANAGER_TENANT_ROLES.has(tenantRole);

  if (!userId) {
    throw new LeagueAdminApiError("Perfil do usuário inválido.", 400);
  }

  return {
    userId,
    userRole,
    tenantRole,
    tenantStatus,
    userTenantId,
    isPlatformMaster,
    canManageTenant,
  };
};

const validateRequestedTenantId = (
  scope: LeagueAdminAuthScope,
  requestedTenantId: string
): void => {
  if (scope.isPlatformMaster) return;

  if (!scope.canManageTenant || scope.tenantStatus !== "approved" || !scope.userTenantId) {
    throw new LeagueAdminApiError("Sem permissão para gerenciar este tenant.", 403);
  }

  if (requestedTenantId && requestedTenantId !== scope.userTenantId) {
    throw new LeagueAdminApiError(
      "Tenant informado não corresponde ao seu perfil.",
      403
    );
  }
};

export const resolveLeagueTenantContext = async <TRow extends Record<string, unknown>>(
  request: NextRequest,
  payload: {
    leagueId: string;
    requestedTenantId?: string;
    leagueSelect: string;
  }
): Promise<{
  scope: LeagueAdminAuthScope;
  effectiveTenantId: string;
  leagueTenantId: string;
  leagueRow: TRow;
}> => {
  const leagueId = payload.leagueId.trim();
  if (!leagueId) {
    throw new LeagueAdminApiError("Liga inválida.", 400);
  }

  const requestedTenantId = (payload.requestedTenantId || "").trim();
  const scope = await getLeagueAdminAuthScope(request);
  validateRequestedTenantId(scope, requestedTenantId);

  const { data: leagueRowRaw, error: leagueError } = await supabaseAdmin
    .from("ligas_config")
    .select(payload.leagueSelect)
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError) {
    throw new LeagueAdminApiError(leagueError.message, 400);
  }

  const leagueRow = asObject(leagueRowRaw) as TRow | null;
  if (!leagueRow) {
    throw new LeagueAdminApiError("Liga não encontrada.", 404);
  }

  const leagueTenantId = asString(leagueRow.tenant_id).trim();
  const effectiveTenantId = requestedTenantId || leagueTenantId || scope.userTenantId;

  if (!effectiveTenantId) {
    throw new LeagueAdminApiError(
      "Não foi possível determinar o tenant da liga.",
      400
    );
  }

  if (!scope.isPlatformMaster && scope.userTenantId !== effectiveTenantId) {
    throw new LeagueAdminApiError("Liga fora do seu tenant.", 403);
  }

  if (leagueTenantId && leagueTenantId !== effectiveTenantId) {
    throw new LeagueAdminApiError(
      "O tenant informado não confere com a liga selecionada.",
      403
    );
  }

  return {
    scope,
    effectiveTenantId,
    leagueTenantId,
    leagueRow,
  };
};

export const resolveEventTenantContext = async <TRow extends Record<string, unknown>>(
  request: NextRequest,
  payload: {
    eventId: string;
    requestedTenantId?: string;
    eventSelect: string;
  }
): Promise<{
  scope: LeagueAdminAuthScope;
  effectiveTenantId: string;
  eventTenantId: string;
  eventRow: TRow;
}> => {
  const eventId = payload.eventId.trim();
  if (!eventId) {
    throw new LeagueAdminApiError("Evento inválido.", 400);
  }

  const requestedTenantId = (payload.requestedTenantId || "").trim();
  const scope = await getLeagueAdminAuthScope(request);
  validateRequestedTenantId(scope, requestedTenantId);

  const { data: eventRowRaw, error: eventError } = await supabaseAdmin
    .from("eventos")
    .select(payload.eventSelect)
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new LeagueAdminApiError(eventError.message, 400);
  }

  const eventRow = asObject(eventRowRaw) as TRow | null;
  if (!eventRow) {
    throw new LeagueAdminApiError("Evento não encontrado.", 404);
  }

  const eventTenantId = asString(eventRow.tenant_id).trim();
  const effectiveTenantId = requestedTenantId || eventTenantId || scope.userTenantId;

  if (!effectiveTenantId) {
    throw new LeagueAdminApiError(
      "Não foi possível determinar o tenant do evento.",
      400
    );
  }

  if (!scope.isPlatformMaster && scope.userTenantId !== effectiveTenantId) {
    throw new LeagueAdminApiError("Evento fora do seu tenant.", 403);
  }

  if (eventTenantId && eventTenantId !== effectiveTenantId) {
    throw new LeagueAdminApiError(
      "O tenant informado não confere com o evento selecionado.",
      403
    );
  }

  return {
    scope,
    effectiveTenantId,
    eventTenantId,
    eventRow,
  };
};
