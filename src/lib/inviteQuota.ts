type Row = Record<string, unknown>;

const asRecord = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const MEMBER_INVITE_DAILY_LIMIT = 5;
export const MEMBER_INVITE_BONUS_LIMIT = 5;
export const MEMBER_INVITE_BONUS_DELAY_MS = 60 * 60 * 1000;

export type TenantInviteQuotaStatus = "idle" | "pending" | "granted";

export interface TenantInviteQuotaState {
  baseLimit: number;
  bonusLimit: number;
  totalLimit: number;
  requestedAt: string;
  unlockAt: string;
  bonusDayKey: string;
  status: TenantInviteQuotaStatus;
  canRequestMore: boolean;
  remainingMs: number;
}

type TenantInviteQuotaEntry = {
  requestedAt: string;
  unlockAt: string;
  bonusDayKey: string;
};

const INVITE_QUOTA_EXTRA_KEY = "memberInviteQuotaByTenant";

export const resolveInviteQuotaDayKey = (value?: Date | string | number): string => {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : new Date();

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
};

export const resolveInviteDailyWindowStartIso = (value?: Date | string | number): string =>
  `${resolveInviteQuotaDayKey(value)}T00:00:00-03:00`;

const readTenantInviteQuotaEntry = (
  extra: unknown,
  tenantId: string
): TenantInviteQuotaEntry => {
  const extraData = asRecord(extra) ?? {};
  const byTenant = asRecord(extraData[INVITE_QUOTA_EXTRA_KEY]) ?? {};
  const entry = asRecord(byTenant[tenantId]) ?? {};

  return {
    requestedAt: asString(entry.requestedAt).trim(),
    unlockAt: asString(entry.unlockAt).trim(),
    bonusDayKey: asString(entry.bonusDayKey).trim(),
  };
};

export const resolveTenantInviteQuotaState = (
  extra: unknown,
  tenantId: string,
  nowInput?: Date | string | number
): TenantInviteQuotaState => {
  const now =
    nowInput instanceof Date
      ? nowInput
      : typeof nowInput === "string" || typeof nowInput === "number"
        ? new Date(nowInput)
        : new Date();
  const nowMs = now.getTime();
  const todayKey = resolveInviteQuotaDayKey(now);
  const entry = readTenantInviteQuotaEntry(extra, tenantId);
  const unlockMs = entry.unlockAt ? new Date(entry.unlockAt).getTime() : Number.NaN;

  let status: TenantInviteQuotaStatus = "idle";
  let canRequestMore = true;
  let remainingMs = 0;
  let bonusLimit = 0;

  if (entry.unlockAt && Number.isFinite(unlockMs) && unlockMs > nowMs) {
    status = "pending";
    canRequestMore = false;
    remainingMs = unlockMs - nowMs;
  } else if (entry.bonusDayKey && entry.bonusDayKey === todayKey) {
    status = "granted";
    canRequestMore = false;
    bonusLimit = MEMBER_INVITE_BONUS_LIMIT;
  }

  return {
    baseLimit: MEMBER_INVITE_DAILY_LIMIT,
    bonusLimit,
    totalLimit: MEMBER_INVITE_DAILY_LIMIT + bonusLimit,
    requestedAt: entry.requestedAt,
    unlockAt: entry.unlockAt,
    bonusDayKey: entry.bonusDayKey,
    status,
    canRequestMore,
    remainingMs,
  };
};

export const buildRequestedTenantInviteQuotaExtra = (
  extra: unknown,
  tenantId: string,
  nowInput?: Date | string | number
): Record<string, unknown> => {
  const now =
    nowInput instanceof Date
      ? nowInput
      : typeof nowInput === "string" || typeof nowInput === "number"
        ? new Date(nowInput)
        : new Date();
  const unlockAt = new Date(now.getTime() + MEMBER_INVITE_BONUS_DELAY_MS);
  const extraData = asRecord(extra) ?? {};
  const byTenant = asRecord(extraData[INVITE_QUOTA_EXTRA_KEY]) ?? {};

  return {
    ...extraData,
    [INVITE_QUOTA_EXTRA_KEY]: {
      ...byTenant,
      [tenantId]: {
        requestedAt: now.toISOString(),
        unlockAt: unlockAt.toISOString(),
        bonusDayKey: resolveInviteQuotaDayKey(unlockAt),
      },
    },
  };
};
