import {
  calculateAchievementSummary,
  mergeAchievementCatalogWithDefaults,
  mergePatentesWithDefaults,
  normalizeAchievementStats,
  resolveEffectiveXp,
  resolvePatenteForXp,
  type RuntimeAchievementConfig,
  type RuntimePatenteConfig,
} from "./achievementRuntime";
import { calculateLevel } from "./games";
import { supabaseAdmin } from "./supabaseAdmin";
import { isTenantScopedRowForTenant, parseTenantScopedRowId } from "./tenantScopedCatalog";

const MAX_ACHIEVEMENT_ROWS = 260;
const MAX_PATENTE_ROWS = 60;
const MAX_LOG_ROWS = 600;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

type ScopedAchievementRow = RuntimeAchievementConfig & {
  storageId: string;
};

type ScopedPatenteRow = RuntimePatenteConfig & {
  storageId: string;
};

const normalizeAchievementConfig = (
  storageId: string,
  raw: unknown
): ScopedAchievementRow | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    storageId,
    id: parseTenantScopedRowId(storageId).baseId,
    titulo: asString(obj.titulo, "Conquista").trim().slice(0, 90),
    desc: asString(obj.desc).slice(0, 240),
    xp: Math.max(0, asNumber(obj.xp, 0)),
    target: Math.max(1, asNumber(obj.target, 1)),
    statKey: asString(obj.statKey, "loginCount").trim().slice(0, 80),
    cat: asString(obj.cat, "Social").trim() as RuntimeAchievementConfig["cat"],
    iconName: asString(obj.iconName, "Star").trim().slice(0, 40),
    active: obj.active !== false,
    repeatable: obj.repeatable === true,
  };
};

const normalizePatenteConfig = (
  storageId: string,
  raw: unknown
): ScopedPatenteRow | null => {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    storageId,
    id: parseTenantScopedRowId(storageId).baseId,
    titulo: asString(obj.titulo, "Patente").trim().slice(0, 60),
    minXp: Math.max(0, asNumber(obj.minXp, 0)),
    cor: asString(obj.cor, "text-zinc-400").trim().slice(0, 40),
    iconName: asString(obj.iconName, "Fish").trim().slice(0, 40),
    bg: asString(obj.bg).trim().slice(0, 60) || undefined,
    border: asString(obj.border).trim().slice(0, 60) || undefined,
    text: asString(obj.text).trim().slice(0, 60) || undefined,
  };
};

const selectScopedRowsForTenant = <
  T extends {
    storageId: string;
  },
>(
  rows: T[],
  tenantId?: string | null
): T[] => {
  const cleanTenantId = asString(tenantId).trim();
  if (!cleanTenantId) {
    return rows.filter((row) => !parseTenantScopedRowId(row.storageId).scoped);
  }

  const tenantRows = rows.filter((row) =>
    isTenantScopedRowForTenant(row.storageId, cleanTenantId)
  );
  if (tenantRows.length > 0) {
    return tenantRows;
  }

  return rows.filter((row) => !parseTenantScopedRowId(row.storageId).scoped);
};

const withoutStorageId = <
  T extends {
    storageId: string;
  },
>(
  row: T
): Omit<T, "storageId"> =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "storageId")
  ) as Omit<T, "storageId">;

const fetchAchievementCatalogWithAdmin = async (
  tenantId?: string | null
): Promise<RuntimeAchievementConfig[]> => {
  const { data, error } = await supabaseAdmin
    .from("achievements_config")
    .select("id,titulo,desc,xp,target,statKey,cat,iconName,active,repeatable")
    .limit(MAX_ACHIEVEMENT_ROWS);

  if (error) {
    throw error;
  }

  return selectScopedRowsForTenant(
    (data ?? [])
      .map((row) =>
        normalizeAchievementConfig(asString((row as { id?: unknown }).id), row)
      )
      .filter((row): row is ScopedAchievementRow => row !== null),
    tenantId
  ).map((row) => withoutStorageId(row));
};

const fetchPatentesWithAdmin = async (
  tenantId?: string | null
): Promise<RuntimePatenteConfig[]> => {
  const { data, error } = await supabaseAdmin
    .from("patentes_config")
    .select("id,titulo,minXp,cor,iconName,bg,border,text")
    .order("minXp", { ascending: true })
    .limit(MAX_PATENTE_ROWS);

  if (error) {
    throw error;
  }

  return selectScopedRowsForTenant(
    (data ?? [])
      .map((row) =>
        normalizePatenteConfig(asString((row as { id?: unknown }).id), row)
      )
      .filter((row): row is ScopedPatenteRow => row !== null),
    tenantId
  ).map((row) => withoutStorageId(row));
};

const fetchAchievementLogRowsWithAdmin = async (
  userId: string,
  tenantId?: string | null
): Promise<Array<Record<string, unknown>>> => {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return [];

  const { data, error } = await supabaseAdmin
    .from("achievements_logs")
    .select("achievementId,achievementTitle,xp,data,timestamp")
    .eq("userId", cleanUserId)
    .order("timestamp", { ascending: false })
    .limit(MAX_LOG_ROWS);

  if (error) {
    throw error;
  }

  const cleanTenantId = asString(tenantId).trim();
  return ((data as Array<Record<string, unknown>> | null) ?? []).filter((row) => {
    if (!cleanTenantId) return true;
    const dataPayload = asObject(row.data);
    const logTenantId = asString(dataPayload?.tenantId).trim();
    return !logTenantId || logTenantId === cleanTenantId;
  });
};

const sumAchievementLogsXp = (
  logs: Array<Record<string, unknown>>,
  catalog: RuntimeAchievementConfig[]
): number => {
  if (!logs.length) return 0;

  const catalogById = new Map(catalog.map((item) => [item.id, item] as const));
  const catalogByTitle = new Map(
    catalog.map((item) => [item.titulo.trim().toLowerCase(), item] as const)
  );
  const seenKeys = new Set<string>();
  let total = 0;

  logs.forEach((row) => {
    const achievementId = asString(row.achievementId).trim();
    const achievementTitle = asString(row.achievementTitle).trim();
    const matchedCatalog =
      catalogById.get(achievementId) ||
      catalogByTitle.get(achievementTitle.toLowerCase()) ||
      null;
    const dedupeKey = achievementId || achievementTitle.toLowerCase();
    if (!dedupeKey || seenKeys.has(dedupeKey)) return;

    seenKeys.add(dedupeKey);
    total += Math.max(0, asNumber(row.xp, matchedCatalog?.xp ?? 0));
  });

  return total;
};

export async function enrichPublicProfileBundleWithAchievements(
  payload: Record<string, unknown>,
  tenantId?: string | null
): Promise<Record<string, unknown>> {
  const profile = asObject(payload.profile);
  if (!profile) {
    return payload;
  }

  const userId = asString(profile.uid).trim();
  if (!userId) {
    return payload;
  }

  const [catalogRows, patentesRows, logRows] = await Promise.all([
    fetchAchievementCatalogWithAdmin(tenantId),
    fetchPatentesWithAdmin(tenantId),
    fetchAchievementLogRowsWithAdmin(userId, tenantId),
  ]);

  const catalog = mergeAchievementCatalogWithDefaults(
    (catalogRows as RuntimeAchievementConfig[]) ?? []
  );
  const patentes = mergePatentesWithDefaults(
    (patentesRows as RuntimePatenteConfig[]) ?? []
  );
  const stats = normalizeAchievementStats(asObject(profile.stats));
  const summary = calculateAchievementSummary(catalog, stats);
  const logXpTotal = sumAchievementLogsXp(logRows, catalog);
  const displayXp = resolveEffectiveXp([
    asNumber(profile.xp, 0),
    summary.totalUnlockedXp,
    logXpTotal,
  ]);
  const patente = resolvePatenteForXp(patentes, displayXp);

  return {
    ...payload,
    profile: {
      ...profile,
      stats,
      xp: displayXp,
      level: calculateLevel(displayXp),
      patente: patente?.titulo || asString(profile.patente),
      patente_icon: patente?.iconName || asString(profile.patente_icon),
      patente_cor: patente?.cor || asString(profile.patente_cor),
    },
  };
}
