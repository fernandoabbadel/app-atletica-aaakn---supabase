import { syncUserAchievementState } from "./achievementsService";

export type Row = Record<string, unknown>;

export interface DateLike {
  toDate: () => Date;
  toMillis: () => number;
}

export const asObject = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

export const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

export const throwSupabaseError = (error: {
  message: string;
  code?: string | null;
  name?: string | null;
}): never => {
  throw Object.assign(new Error(error.message), {
    code: error.code ?? `db/${error.name ?? "query-failed"}`,
    cause: error,
  });
};

export const toDateLike = (value: unknown): DateLike | null => {
  if (!value) return null;

  if (typeof value === "object" && value !== null) {
    const candidate = (value as { toDate?: unknown }).toDate;
    if (typeof candidate === "function") {
      const parsed = candidate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return {
          toDate: () => parsed,
          toMillis: () => parsed.getTime(),
        };
      }
    }
  }

  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        toDate: () => parsed,
        toMillis: () => parsed.getTime(),
      };
    }
  }

  return null;
};

export const nowDateLike = (): DateLike => {
  const now = new Date();
  return {
    toDate: () => now,
    toMillis: () => now.getTime(),
  };
};

export const normalizeRowTimestamps = (
  row: Row,
  keys: string[] = ["createdAt", "updatedAt", "timestamp", "dataSolicitacao", "dataAprovacao", "date"]
): Row => {
  const next: Row = { ...row };
  keys.forEach((key) => {
    if (key in next) {
      next[key] = toDateLike(next[key]);
    }
  });
  return next;
};

export const toggleArrayValue = (values: string[], item: string): string[] => {
  if (!item) return values;
  return values.includes(item)
    ? values.filter((entry) => entry !== item)
    : [...values, item];
};

export async function incrementUserStats(
  userId: string,
  deltas: Record<string, number>,
  options?: { tenantId?: string | null; xpDelta?: number }
): Promise<void> {
  const cleanUserId = userId.trim();
  if (!cleanUserId) return;

  await syncUserAchievementState({
    userId: cleanUserId,
    tenantId: options?.tenantId,
    deltas,
    xpDelta: options?.xpDelta,
  });
}
