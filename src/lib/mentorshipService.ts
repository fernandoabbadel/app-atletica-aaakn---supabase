import { buildTenantScopedRowId } from "./tenantScopedCatalog";
import { incrementUserStats } from "./supabaseData";
import { getSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;
type CacheEntry<T> = { cachedAt: number; value: T };

const LABELS_DOC_ID = "mentorship_labels";
const LABELS_TTL_MS = 60_000;
const RELATIONS_TTL_MS = 45_000;
const MENTORSHIP_SELECT_COLUMNS =
  "id,tenant_id,mentor_user_id,mentee_user_id,initiator_user_id,status,message,mentor_role_label,mentee_role_label,responded_at,created_at,updated_at";

export type MentorshipStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type MentorshipInviteMode = "mentor" | "mentee";
export type MentorshipRoleSide = "mentor" | "mentee";

export interface MentorshipLabelsConfig {
  hubTitle: string;
  mentorLabel: string;
  menteeLabel: string;
  inviteMentorLabel: string;
  inviteMenteeLabel: string;
  requestHelpText: string;
}

export interface MentorshipUserPreview {
  uid: string;
  nome: string;
  turma: string;
  foto: string;
}

export interface MentorshipRequestRecord {
  id: string;
  tenantId: string;
  mentorUserId: string;
  menteeUserId: string;
  initiatorUserId: string;
  status: MentorshipStatus;
  message: string;
  mentorRoleLabel: string;
  menteeRoleLabel: string;
  respondedAt: string;
  createdAt: string;
  updatedAt: string;
  mentor: MentorshipUserPreview | null;
  mentee: MentorshipUserPreview | null;
}

export interface MentorshipRoleCard {
  user: MentorshipUserPreview;
  relationshipId: string;
  roleLabel: string;
  roleSide: MentorshipRoleSide;
  ownerRoleLabel: string;
  ownerRoleSide: MentorshipRoleSide;
}

export interface MentorshipHubBundle {
  labels: MentorshipLabelsConfig;
  mentor: MentorshipRoleCard | null;
  mentee: MentorshipRoleCard | null;
  incoming: MentorshipRequestRecord[];
  outgoing: MentorshipRequestRecord[];
}

export interface MentorshipProfileBundle {
  labels: MentorshipLabelsConfig;
  mentor: MentorshipRoleCard | null;
  mentee: MentorshipRoleCard | null;
  viewerMentorRequestStatus: MentorshipStatus | "none";
  viewerMenteeRequestStatus: MentorshipStatus | "none";
}

const DEFAULT_MENTORSHIP_LABELS: MentorshipLabelsConfig = {
  hubTitle: "Apadrinhamento",
  mentorLabel: "Padrinho/Madrinha",
  menteeLabel: "Afilhado/Afilhada",
  inviteMentorLabel: "Adicionar como meu padrinho/madrinha",
  inviteMenteeLabel: "Adicionar como meu afilhado/afilhada",
  requestHelpText:
    "Cada perfil pode ter 1 padrinho/madrinha e 1 afilhado/afilhada por atletica.",
};

const MENTORSHIP_LABEL_SPLIT_REGEX = /[\\/|]/;

const labelsCache = new Map<string, CacheEntry<MentorshipLabelsConfig>>();
const hubCache = new Map<string, CacheEntry<MentorshipHubBundle>>();
const profileCache = new Map<string, CacheEntry<MentorshipProfileBundle>>();

const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

const isMissingMentorshipSchema = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const raw = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof raw.code === "string" ? raw.code.trim().toLowerCase() : "";
  const text = [raw.message, raw.details]
    .map((entry) => (typeof entry === "string" ? entry.toLowerCase() : ""))
    .filter((entry) => entry.length > 0)
    .join(" | ");

  return code === "42p01" || text.includes("tenant_mentorships");
};

const normalizeStatus = (value: unknown): MentorshipStatus => {
  const status = asString(value).trim().toLowerCase();
  if (status === "accepted" || status === "rejected" || status === "cancelled") {
    return status;
  }
  return "pending";
};

const uniqueIds = (values: string[]): string[] =>
  Array.from(new Set(values.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));

const buildLabelsDocId = (tenantId: string): string =>
  buildTenantScopedRowId(tenantId, LABELS_DOC_ID) || LABELS_DOC_ID;

const normalizeLabels = (raw: unknown): MentorshipLabelsConfig => {
  const source = asObject(raw) ?? {};
  return {
    hubTitle:
      asString(source.hubTitle).trim().slice(0, 60) || DEFAULT_MENTORSHIP_LABELS.hubTitle,
    mentorLabel:
      asString(source.mentorLabel).trim().slice(0, 80) || DEFAULT_MENTORSHIP_LABELS.mentorLabel,
    menteeLabel:
      asString(source.menteeLabel).trim().slice(0, 80) || DEFAULT_MENTORSHIP_LABELS.menteeLabel,
    inviteMentorLabel:
      asString(source.inviteMentorLabel).trim().slice(0, 120) ||
      DEFAULT_MENTORSHIP_LABELS.inviteMentorLabel,
    inviteMenteeLabel:
      asString(source.inviteMenteeLabel).trim().slice(0, 120) ||
      DEFAULT_MENTORSHIP_LABELS.inviteMenteeLabel,
    requestHelpText:
      asString(source.requestHelpText).trim().slice(0, 220) ||
      DEFAULT_MENTORSHIP_LABELS.requestHelpText,
  };
};

const normalizeRoleLabel = (value: unknown, fallback: string): string =>
  asString(value).trim().slice(0, 80) || fallback;

const uniqueStrings = (values: string[]): string[] =>
  Array.from(new Set(values.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));

export const resolveMentorshipRoleOptions = (
  labels: Pick<MentorshipLabelsConfig, "mentorLabel" | "menteeLabel">,
  side: MentorshipRoleSide
): string[] => {
  const rawLabel = side === "mentor" ? labels.mentorLabel : labels.menteeLabel;
  const fallback =
    side === "mentor"
      ? DEFAULT_MENTORSHIP_LABELS.mentorLabel
      : DEFAULT_MENTORSHIP_LABELS.menteeLabel;
  const values = uniqueStrings(
    rawLabel
      .split(MENTORSHIP_LABEL_SPLIT_REGEX)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
  return values.length > 0 ? values : [fallback];
};

const resolveStoredRoleLabel = (
  row: Pick<MentorshipRequestRecord, "mentorRoleLabel" | "menteeRoleLabel">,
  labels: Pick<MentorshipLabelsConfig, "mentorLabel" | "menteeLabel">,
  side: MentorshipRoleSide
): string => {
  const fallback = resolveMentorshipRoleOptions(labels, side)[0];
  const value = side === "mentor" ? row.mentorRoleLabel : row.menteeRoleLabel;
  return normalizeRoleLabel(value, fallback);
};

const normalizeUserPreview = (raw: unknown): MentorshipUserPreview | null => {
  const row = asObject(raw);
  if (!row) return null;
  const uid = asString(row.uid).trim();
  if (!uid) return null;
  return {
    uid,
    nome: asString(row.nome, "Atleta").trim() || "Atleta",
    turma: asString(row.turma, "Sem turma").trim() || "Sem turma",
    foto: asString(row.foto).trim(),
  };
};

const parseRequest = (row: unknown): MentorshipRequestRecord | null => {
  const raw = asObject(row);
  if (!raw) return null;
  const id = asString(raw.id).trim();
  const tenantId = asString(raw.tenant_id).trim();
  const mentorUserId = asString(raw.mentor_user_id).trim();
  const menteeUserId = asString(raw.mentee_user_id).trim();
  const initiatorUserId = asString(raw.initiator_user_id).trim();
  if (!id || !tenantId || !mentorUserId || !menteeUserId || !initiatorUserId) return null;

  return {
    id,
    tenantId,
    mentorUserId,
    menteeUserId,
    initiatorUserId,
    status: normalizeStatus(raw.status),
    message: asString(raw.message).trim(),
    mentorRoleLabel: asString(raw.mentor_role_label).trim(),
    menteeRoleLabel: asString(raw.mentee_role_label).trim(),
    respondedAt: asString(raw.responded_at).trim(),
    createdAt: asString(raw.created_at).trim(),
    updatedAt: asString(raw.updated_at).trim(),
    mentor: null,
    mentee: null,
  };
};

const hydrateRequests = async (
  rows: MentorshipRequestRecord[]
): Promise<MentorshipRequestRecord[]> => {
  const userIds = uniqueIds(
    rows.flatMap((row) => [row.mentorUserId, row.menteeUserId])
  );
  const usersMap = await fetchUsersPreviewMap(userIds);

  return rows.map((row) => ({
    ...row,
    mentor: usersMap.get(row.mentorUserId) || null,
    mentee: usersMap.get(row.menteeUserId) || null,
  }));
};

const buildRoleCard = (
  row: MentorshipRequestRecord | null,
  counterpart: MentorshipUserPreview | null,
  options: {
    labels: MentorshipLabelsConfig;
    side: MentorshipRoleSide;
    ownerSide: MentorshipRoleSide;
  }
): MentorshipRoleCard | null => {
  if (!row || !counterpart) return null;
  return {
    user: counterpart,
    relationshipId: row.id,
    roleLabel: resolveStoredRoleLabel(row, options.labels, options.side),
    roleSide: options.side,
    ownerRoleLabel: resolveStoredRoleLabel(row, options.labels, options.ownerSide),
    ownerRoleSide: options.ownerSide,
  };
};

const clearMentorshipCaches = (tenantId?: string, userId?: string): void => {
  const cleanTenantId = asString(tenantId).trim();
  const cleanUserId = asString(userId).trim();

  labelsCache.forEach((_, key) => {
    if (!cleanTenantId || key === cleanTenantId) {
      labelsCache.delete(key);
    }
  });
  hubCache.forEach((_, key) => {
    if (
      (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) &&
      (!cleanUserId || key.endsWith(`:${cleanUserId}`))
    ) {
      hubCache.delete(key);
    }
  });
  profileCache.forEach((_, key) => {
    if (
      (!cleanTenantId || key.startsWith(`${cleanTenantId}:`)) &&
      (!cleanUserId ||
        key.includes(`:${cleanUserId}:`) ||
        key.endsWith(`:${cleanUserId}`))
    ) {
      profileCache.delete(key);
    }
  });
};

async function fetchUsersPreviewMap(
  userIds: string[]
): Promise<Map<string, MentorshipUserPreview>> {
  const cleanUserIds = uniqueIds(userIds);
  if (cleanUserIds.length === 0) return new Map();

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uid,nome,turma,foto")
    .in("uid", cleanUserIds);
  if (error) throwSupabaseError(error);

  return new Map(
    (Array.isArray(data) ? data : [])
      .map((row) => normalizeUserPreview(row))
      .filter((row): row is MentorshipUserPreview => row !== null)
      .map((row) => [row.uid, row])
  );
}

async function fetchAllMentorshipRowsForTenant(tenantId: string): Promise<MentorshipRequestRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_mentorships")
    .select(MENTORSHIP_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingMentorshipSchema(error)) return [];
    throwSupabaseError(error);
  }

  const parsed = (Array.isArray(data) ? data : [])
    .map((row) => parseRequest(row))
    .filter((row): row is MentorshipRequestRecord => row !== null);
  return hydrateRequests(parsed);
}

async function ensureInviteSlotAvailable(options: {
  tenantId: string;
  mentorUserId: string;
  menteeUserId: string;
  ignoreRelationshipId?: string;
}): Promise<void> {
  const tenantRows = await fetchAllMentorshipRowsForTenant(options.tenantId);
  const activeRows = tenantRows.filter((row) => {
    if (options.ignoreRelationshipId && row.id === options.ignoreRelationshipId) return false;
    return row.status === "pending" || row.status === "accepted";
  });

  const mentorOccupied = activeRows.some((row) => row.mentorUserId === options.mentorUserId);
  if (mentorOccupied) {
    throw new Error("Esse perfil ja tem um afilhado/afilhada ativo ou pendente.");
  }

  const menteeOccupied = activeRows.some((row) => row.menteeUserId === options.menteeUserId);
  if (menteeOccupied) {
    throw new Error("Esse perfil ja tem um padrinho/madrinha ativo ou pendente.");
  }
}

async function fetchRelationshipById(
  tenantId: string,
  relationshipId: string
): Promise<MentorshipRequestRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_mentorships")
    .select(MENTORSHIP_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", relationshipId)
    .maybeSingle();
  if (error) {
    if (isMissingMentorshipSchema(error)) return null;
    throwSupabaseError(error);
  }

  const parsed = parseRequest(data);
  if (!parsed) return null;
  const hydrated = await hydrateRequests([parsed]);
  return hydrated[0] || null;
}

async function fetchRelationshipByPair(options: {
  tenantId: string;
  mentorUserId: string;
  menteeUserId: string;
}): Promise<MentorshipRequestRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenant_mentorships")
    .select(MENTORSHIP_SELECT_COLUMNS)
    .eq("tenant_id", options.tenantId)
    .eq("mentor_user_id", options.mentorUserId)
    .eq("mentee_user_id", options.menteeUserId)
    .maybeSingle();
  if (error) {
    if (isMissingMentorshipSchema(error)) return null;
    throwSupabaseError(error);
  }

  const parsed = parseRequest(data);
  if (!parsed) return null;
  const hydrated = await hydrateRequests([parsed]);
  return hydrated[0] || null;
}

export async function fetchMentorshipLabels(options: {
  tenantId: string;
  forceRefresh?: boolean;
}): Promise<MentorshipLabelsConfig> {
  const tenantId = options.tenantId.trim();
  if (!tenantId) return DEFAULT_MENTORSHIP_LABELS;

  if (!options.forceRefresh) {
    const cached = getCache(labelsCache, tenantId, LABELS_TTL_MS);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("id,data")
    .eq("id", buildLabelsDocId(tenantId))
    .maybeSingle();
  if (error) throwSupabaseError(error);

  const next = normalizeLabels(asObject(asObject(data)?.data));
  setCache(labelsCache, tenantId, next);
  return next;
}

export async function saveMentorshipLabels(
  payload: MentorshipLabelsConfig,
  options: { tenantId: string }
): Promise<MentorshipLabelsConfig> {
  const tenantId = options.tenantId.trim();
  if (!tenantId) throw new Error("Tenant invalido para salvar configuracao.");

  const next = normalizeLabels(payload);
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_config").upsert(
    {
      id: buildLabelsDocId(tenantId),
      tenant_id: tenantId,
      data: next,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throwSupabaseError(error);

  setCache(labelsCache, tenantId, next);
  clearMentorshipCaches(tenantId);
  return next;
}

export async function fetchMentorshipHubBundle(options: {
  tenantId: string;
  userId: string;
  forceRefresh?: boolean;
}): Promise<MentorshipHubBundle> {
  const tenantId = options.tenantId.trim();
  const userId = options.userId.trim();
  if (!tenantId || !userId) {
    return {
      labels: DEFAULT_MENTORSHIP_LABELS,
      mentor: null,
      mentee: null,
      incoming: [],
      outgoing: [],
    };
  }

  const cacheKey = `${tenantId}:${userId}`;
  if (!options.forceRefresh) {
    const cached = getCache(hubCache, cacheKey, RELATIONS_TTL_MS);
    if (cached) return cached;
  }

  const [labels, tenantRows] = await Promise.all([
    fetchMentorshipLabels({ tenantId, forceRefresh: options.forceRefresh }),
    fetchAllMentorshipRowsForTenant(tenantId),
  ]);

  const userRows = tenantRows.filter(
    (row) => row.mentorUserId === userId || row.menteeUserId === userId
  );
  const acceptedMentorRow =
    userRows.find((row) => row.status === "accepted" && row.menteeUserId === userId) || null;
  const acceptedMenteeRow =
    userRows.find((row) => row.status === "accepted" && row.mentorUserId === userId) || null;

  const incoming = userRows.filter(
    (row) =>
      row.status === "pending" &&
      row.initiatorUserId !== userId &&
      (row.mentorUserId === userId || row.menteeUserId === userId)
  );
  const outgoing = userRows.filter(
    (row) => row.status === "pending" && row.initiatorUserId === userId
  );

  const bundle: MentorshipHubBundle = {
    labels,
    mentor: buildRoleCard(acceptedMentorRow, acceptedMentorRow?.mentor || null, {
      labels,
      side: "mentor",
      ownerSide: "mentee",
    }),
    mentee: buildRoleCard(acceptedMenteeRow, acceptedMenteeRow?.mentee || null, {
      labels,
      side: "mentee",
      ownerSide: "mentor",
    }),
    incoming,
    outgoing,
  };
  setCache(hubCache, cacheKey, bundle);
  return bundle;
}

export async function fetchMentorshipProfileBundle(options: {
  tenantId: string;
  targetUserId: string;
  viewerUserId?: string | null;
  forceRefresh?: boolean;
}): Promise<MentorshipProfileBundle> {
  const tenantId = options.tenantId.trim();
  const targetUserId = options.targetUserId.trim();
  const viewerUserId = asString(options.viewerUserId).trim();
  if (!tenantId || !targetUserId) {
    return {
      labels: DEFAULT_MENTORSHIP_LABELS,
      mentor: null,
      mentee: null,
      viewerMentorRequestStatus: "none",
      viewerMenteeRequestStatus: "none",
    };
  }

  const cacheKey = `${tenantId}:${targetUserId}:${viewerUserId || "anon"}`;
  if (!options.forceRefresh) {
    const cached = getCache(profileCache, cacheKey, RELATIONS_TTL_MS);
    if (cached) return cached;
  }

  const [labels, tenantRows] = await Promise.all([
    fetchMentorshipLabels({ tenantId, forceRefresh: options.forceRefresh }),
    fetchAllMentorshipRowsForTenant(tenantId),
  ]);

  const targetRows = tenantRows.filter(
    (row) => row.mentorUserId === targetUserId || row.menteeUserId === targetUserId
  );
  const acceptedMentorRow =
    targetRows.find((row) => row.status === "accepted" && row.menteeUserId === targetUserId) ||
    null;
  const acceptedMenteeRow =
    targetRows.find((row) => row.status === "accepted" && row.mentorUserId === targetUserId) ||
    null;

  const viewerMentorRow =
    viewerUserId
      ? tenantRows.find(
          (row) =>
            row.mentorUserId === targetUserId &&
            row.menteeUserId === viewerUserId &&
            (row.status === "pending" || row.status === "accepted")
        ) || null
      : null;
  const viewerMenteeRow =
    viewerUserId
      ? tenantRows.find(
          (row) =>
            row.mentorUserId === viewerUserId &&
            row.menteeUserId === targetUserId &&
            (row.status === "pending" || row.status === "accepted")
        ) || null
      : null;

  const bundle: MentorshipProfileBundle = {
    labels,
    mentor: buildRoleCard(acceptedMentorRow, acceptedMentorRow?.mentor || null, {
      labels,
      side: "mentor",
      ownerSide: "mentee",
    }),
    mentee: buildRoleCard(acceptedMenteeRow, acceptedMenteeRow?.mentee || null, {
      labels,
      side: "mentee",
      ownerSide: "mentor",
    }),
    viewerMentorRequestStatus: viewerMentorRow?.status || "none",
    viewerMenteeRequestStatus: viewerMenteeRow?.status || "none",
  };
  setCache(profileCache, cacheKey, bundle);
  return bundle;
}

export async function sendMentorshipInvite(payload: {
  tenantId: string;
  currentUserId: string;
  targetUserId: string;
  mode: MentorshipInviteMode;
  message?: string;
}): Promise<MentorshipRequestRecord> {
  const tenantId = payload.tenantId.trim();
  const currentUserId = payload.currentUserId.trim();
  const targetUserId = payload.targetUserId.trim();
  if (!tenantId || !currentUserId || !targetUserId) {
    throw new Error("Dados invalidos para enviar convite de apadrinhamento.");
  }
  if (currentUserId === targetUserId) {
    throw new Error("Voce nao pode se relacionar consigo mesmo.");
  }

  const mentorUserId = payload.mode === "mentor" ? targetUserId : currentUserId;
  const menteeUserId = payload.mode === "mentor" ? currentUserId : targetUserId;
  const existingRelationship = await fetchRelationshipByPair({
    tenantId,
    mentorUserId,
    menteeUserId,
  });

  if (
    existingRelationship &&
    (existingRelationship.status === "pending" || existingRelationship.status === "accepted")
  ) {
    throw new Error(
      existingRelationship.status === "accepted"
        ? "Esse vinculo de apadrinhamento ja esta ativo."
        : "Ja existe um convite de apadrinhamento pendente para esse par."
    );
  }

  await ensureInviteSlotAvailable({
    tenantId,
    mentorUserId,
    menteeUserId,
    ignoreRelationshipId: existingRelationship?.id,
  });

  const supabase = getSupabaseClient();
  const basePayload = {
    initiator_user_id: currentUserId,
    status: "pending",
    message: asString(payload.message).trim().slice(0, 240) || null,
    mentor_role_label: null,
    mentee_role_label: null,
    responded_at: null,
    updated_at: new Date().toISOString(),
  };
  const query = existingRelationship
    ? supabase
        .from("tenant_mentorships")
        .update(basePayload)
        .eq("tenant_id", tenantId)
        .eq("id", existingRelationship.id)
    : supabase.from("tenant_mentorships").insert({
        tenant_id: tenantId,
        mentor_user_id: mentorUserId,
        mentee_user_id: menteeUserId,
        ...basePayload,
      });
  const { data, error } = await query.select(MENTORSHIP_SELECT_COLUMNS).single();
  if (error) {
    if (isMissingMentorshipSchema(error)) {
      throw new Error("Aplique a migracao de apadrinhamento no Supabase.");
    }
    throwSupabaseError(error);
  }

  clearMentorshipCaches(tenantId, currentUserId);
  clearMentorshipCaches(tenantId, targetUserId);
  const hydrated = await hydrateRequests(
    [parseRequest(data)].filter((row): row is MentorshipRequestRecord => row !== null)
  );
  return hydrated[0];
}

export async function respondToMentorshipInvite(payload: {
  tenantId: string;
  relationshipId: string;
  currentUserId: string;
  action: "accept" | "reject" | "cancel" | "remove";
  mentorRoleLabel?: string;
  menteeRoleLabel?: string;
}): Promise<void> {
  const tenantId = payload.tenantId.trim();
  const relationshipId = payload.relationshipId.trim();
  const currentUserId = payload.currentUserId.trim();
  if (!tenantId || !relationshipId || !currentUserId) {
    throw new Error("Convite de apadrinhamento invalido.");
  }

  const row = await fetchRelationshipById(tenantId, relationshipId);
  if (!row) {
    throw new Error("Convite nao encontrado.");
  }

  const isParticipant =
    row.mentorUserId === currentUserId || row.menteeUserId === currentUserId;
  if (!isParticipant) {
    throw new Error("Sem permissao para responder esse convite.");
  }

  if (payload.action === "remove") {
    if (row.status !== "accepted") {
      throw new Error("So da para remover um vinculo ja aceito.");
    }
  } else if (row.status !== "pending") {
    throw new Error("Esse convite ja foi resolvido.");
  }

  if (payload.action === "cancel") {
    if (row.initiatorUserId !== currentUserId) {
      throw new Error("So quem enviou pode cancelar esse convite.");
    }
  } else if (payload.action !== "remove" && row.initiatorUserId === currentUserId) {
    throw new Error("A resposta deve ser dada pela outra pessoa.");
  }

  const nextStatus: MentorshipStatus =
    payload.action === "accept"
      ? "accepted"
      : payload.action === "reject"
      ? "rejected"
      : "cancelled";

  let mentorRoleLabel: string | null = null;
  let menteeRoleLabel: string | null = null;
  if (nextStatus === "accepted") {
    const labels = await fetchMentorshipLabels({ tenantId });
    await ensureInviteSlotAvailable({
      tenantId,
      mentorUserId: row.mentorUserId,
      menteeUserId: row.menteeUserId,
      ignoreRelationshipId: row.id,
    });
    mentorRoleLabel = normalizeRoleLabel(
      payload.mentorRoleLabel,
      resolveMentorshipRoleOptions(labels, "mentor")[0]
    );
    menteeRoleLabel = normalizeRoleLabel(
      payload.menteeRoleLabel,
      resolveMentorshipRoleOptions(labels, "mentee")[0]
    );
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("tenant_mentorships")
    .update({
      status: nextStatus,
      mentor_role_label: mentorRoleLabel,
      mentee_role_label: menteeRoleLabel,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", relationshipId);
  if (error) {
    if (isMissingMentorshipSchema(error)) {
      throw new Error("Aplique a migracao de apadrinhamento no Supabase.");
    }
    throwSupabaseError(error);
  }

  if (nextStatus === "accepted") {
    await Promise.all([
      incrementUserStats(row.mentorUserId, { menteesCount: 1 }, { tenantId }),
      incrementUserStats(row.menteeUserId, { mentorsCount: 1 }, { tenantId }),
    ]);
  } else if (payload.action === "remove") {
    await Promise.all([
      incrementUserStats(row.mentorUserId, { menteesCount: -1 }, { tenantId }),
      incrementUserStats(row.menteeUserId, { mentorsCount: -1 }, { tenantId }),
    ]);
  }

  clearMentorshipCaches(tenantId, row.mentorUserId);
  clearMentorshipCaches(tenantId, row.menteeUserId);
}

export async function updateMentorshipRoleLabel(payload: {
  tenantId: string;
  relationshipId: string;
  currentUserId: string;
  roleSide: MentorshipRoleSide;
  roleLabel: string;
}): Promise<void> {
  const tenantId = payload.tenantId.trim();
  const relationshipId = payload.relationshipId.trim();
  const currentUserId = payload.currentUserId.trim();
  const requestedRoleLabel = payload.roleLabel.trim();
  if (!tenantId || !relationshipId || !currentUserId || !requestedRoleLabel) {
    throw new Error("Rotulo de apadrinhamento invalido.");
  }

  const row = await fetchRelationshipById(tenantId, relationshipId);
  if (!row) {
    throw new Error("Vinculo nao encontrado.");
  }
  if (row.status !== "accepted") {
    throw new Error("So da para editar o rotulo de um vinculo ativo.");
  }

  const isParticipant =
    row.mentorUserId === currentUserId || row.menteeUserId === currentUserId;
  if (!isParticipant) {
    throw new Error("Sem permissao para editar esse rotulo.");
  }

  const editableRoleSide: MentorshipRoleSide =
    row.mentorUserId === currentUserId ? "mentor" : "mentee";
  if (payload.roleSide !== editableRoleSide) {
    throw new Error("Voce so pode editar o seu proprio rotulo.");
  }

  const labels = await fetchMentorshipLabels({ tenantId });
  const validOptions = resolveMentorshipRoleOptions(labels, editableRoleSide);
  const nextRoleLabel = normalizeRoleLabel(
    validOptions.find((option) => option.trim().toLowerCase() === requestedRoleLabel.toLowerCase()),
    validOptions[0]
  );

  const patch =
    editableRoleSide === "mentor"
      ? { mentor_role_label: nextRoleLabel }
      : { mentee_role_label: nextRoleLabel };

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("tenant_mentorships")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", relationshipId);
  if (error) {
    if (isMissingMentorshipSchema(error)) {
      throw new Error("Aplique a migracao de apadrinhamento no Supabase.");
    }
    throwSupabaseError(error);
  }

  clearMentorshipCaches(tenantId, row.mentorUserId);
  clearMentorshipCaches(tenantId, row.menteeUserId);
}
