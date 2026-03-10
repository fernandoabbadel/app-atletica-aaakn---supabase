import {
  asNumber,
  asObject,
  asString,
  throwSupabaseError,
  type Row,
} from "./supabaseData";
import { getSupabaseClient } from "./supabase";

const MAX_DIRECTORY_ROWS = 2000;

export interface TenantMembershipDirectoryEntry {
  membershipId: string;
  tenantId: string;
  userId: string;
  membershipRole: string;
  membershipStatus: string;
  invitedBy: string;
  approvedBy: string;
  approvedAt: string;
  nome: string;
  email: string;
  telefone: string;
  turma: string;
  matricula: string;
  status: string;
  tier: string;
  foto: string;
  xp: number;
  level: number;
  sharkCoins: number;
  planoBadge: string;
  patente: string;
  role: string;
  globalTenantId: string;
  globalTenantRole: string;
  globalTenantStatus: string;
  stats: Row | null;
  extra: Row | null;
  createdAt: unknown;
}

interface FetchTenantMembershipDirectoryOptions {
  tenantId: string;
  statuses?: string[];
  userIds?: string[];
  limit?: number;
}

const normalizeDirectoryEntry = (
  membership: Row,
  user: Row | null
): TenantMembershipDirectoryEntry | null => {
  const userId = asString(membership.user_id).trim();
  const tenantId = asString(membership.tenant_id).trim();
  if (!userId || !tenantId) return null;

  return {
    membershipId: asString(membership.id).trim(),
    tenantId,
    userId,
    membershipRole: asString(membership.role).trim(),
    membershipStatus: asString(membership.status).trim(),
    invitedBy: asString(membership.invited_by).trim(),
    approvedBy: asString(membership.approved_by).trim(),
    approvedAt: asString(membership.approved_at).trim(),
    nome: asString(user?.nome, "Sem nome"),
    email: asString(user?.email),
    telefone: asString(user?.telefone),
    turma: asString(user?.turma, "---"),
    matricula: asString(user?.matricula, "---"),
    status: asString(user?.status, "pendente"),
    tier: asString(user?.tier, "bicho"),
    foto: asString(user?.foto, "https://github.com/shadcn.png"),
    xp: Math.max(0, asNumber(user?.xp, 0)),
    level: Math.max(0, asNumber(user?.level, 0)),
    sharkCoins: Math.max(0, asNumber(user?.sharkCoins, 0)),
    planoBadge: asString(user?.plano_badge),
    patente: asString(user?.patente),
    role: asString(user?.role),
    globalTenantId: asString(user?.tenant_id).trim(),
    globalTenantRole: asString(user?.tenant_role).trim(),
    globalTenantStatus: asString(user?.tenant_status).trim(),
    stats: asObject(user?.stats),
    extra: asObject(user?.extra),
    createdAt: user?.createdAt,
  };
};

export const isPrimaryTenantForDirectoryEntry = (
  entry: Pick<TenantMembershipDirectoryEntry, "tenantId" | "globalTenantId">
): boolean => {
  return (
    entry.tenantId.trim().length > 0 &&
    entry.tenantId.trim() === entry.globalTenantId.trim()
  );
};

export const resolveTenantScopedXp = (
  entry: Pick<TenantMembershipDirectoryEntry, "tenantId" | "globalTenantId" | "xp">
): number => {
  return isPrimaryTenantForDirectoryEntry(entry) ? Math.max(0, entry.xp) : 0;
};

export const resolveTenantScopedStats = (
  entry: Pick<TenantMembershipDirectoryEntry, "tenantId" | "globalTenantId" | "stats">
): Row => {
  return isPrimaryTenantForDirectoryEntry(entry) ? entry.stats ?? {} : {};
};

export async function fetchTenantMembershipDirectory(
  options: FetchTenantMembershipDirectoryOptions
): Promise<TenantMembershipDirectoryEntry[]> {
  const tenantId = options.tenantId.trim();
  if (!tenantId) return [];

  const statuses = (options.statuses ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const userIdsFilter = (options.userIds ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const limit = Math.max(
    1,
    Math.min(MAX_DIRECTORY_ROWS, Math.floor(options.limit ?? MAX_DIRECTORY_ROWS))
  );

  const supabase = getSupabaseClient();
  let membershipsRequest = supabase
    .from("tenant_memberships")
    .select("id,tenant_id,user_id,role,status,invited_by,approved_by,approved_at")
    .eq("tenant_id", tenantId)
    .limit(limit);

  if (statuses.length > 0) {
    membershipsRequest = membershipsRequest.in("status", statuses);
  }

  if (userIdsFilter.length > 0) {
    membershipsRequest = membershipsRequest.in("user_id", userIdsFilter);
  }

  const { data: membershipsData, error: membershipsError } = await membershipsRequest;
  if (membershipsError) throwSupabaseError(membershipsError);

  const memberships = (membershipsData ?? [])
    .map((row) => asObject(row))
    .filter((row): row is Row => row !== null);
  if (memberships.length === 0) return [];

  const userIds = memberships
    .map((row) => asString(row.user_id).trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  if (userIds.length === 0) return [];

  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select(
      [
        "uid",
        "nome",
        "email",
        "telefone",
        "turma",
        "matricula",
        "status",
        "tier",
        "foto",
        "xp",
        "level",
        "sharkCoins",
        "plano_badge",
        "patente",
        "role",
        "tenant_id",
        "tenant_role",
        "tenant_status",
        "stats",
        "extra",
        "createdAt",
      ].join(",")
    )
    .in("uid", userIds)
    .limit(userIds.length);
  if (usersError) throwSupabaseError(usersError);

  const userMap = new Map<string, Row>();
  (usersData ?? [])
    .map((row) => asObject(row))
    .filter((row): row is Row => row !== null)
    .forEach((row) => {
      const uid = asString(row.uid).trim();
      if (uid) {
        userMap.set(uid, row);
      }
    });

  return memberships
    .map((membership) =>
      normalizeDirectoryEntry(
        membership,
        userMap.get(asString(membership.user_id).trim()) ?? null
      )
    )
    .filter((entry): entry is TenantMembershipDirectoryEntry => entry !== null)
    .sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
}
