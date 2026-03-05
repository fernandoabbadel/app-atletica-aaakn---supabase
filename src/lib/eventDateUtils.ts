const MONTHS_PT_BR: Record<string, number> = {
  JAN: 0,
  FEV: 1,
  MAR: 2,
  ABR: 3,
  MAI: 4,
  JUN: 5,
  JUL: 6,
  AGO: 7,
  SET: 8,
  OUT: 9,
  NOV: 10,
  DEZ: 11,
};

const parseClock = (timeRaw: unknown): { hours: number; minutes: number } => {
  const value = typeof timeRaw === "string" ? timeRaw.trim() : "";
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.isFinite(Number(hoursRaw)) ? Number(hoursRaw) : 0;
  const minutes = Number.isFinite(Number(minutesRaw)) ? Number(minutesRaw) : 0;
  return { hours, minutes };
};

export const parseEventDateTimeMs = (dateRawInput: unknown, timeRawInput: unknown): number | null => {
  const dateRaw = typeof dateRawInput === "string" ? dateRawInput.trim() : "";
  if (!dateRaw) return null;

  const { hours, minutes } = parseClock(timeRawInput);

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    const [year, month, day] = dateRaw.split("-").map((part) => Number(part));
    const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)) {
    const [day, month, year] = dateRaw.split("/").map((part) => Number(part));
    const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized = dateRaw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = normalized.split(" ").filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const day = Number(parts[0]);
    const monthToken = parts[1].slice(0, 3);
    const month = MONTHS_PT_BR[monthToken];
    const year =
      parts.length >= 3 && /^\d{4}$/.test(parts[2]) ? Number(parts[2]) : new Date().getFullYear();
    if (Number.isFinite(day) && month !== undefined && Number.isFinite(year)) {
      const parsed = new Date(year, month, day, hours, minutes, 0, 0).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  const fallback = Date.parse(`${dateRaw} ${typeof timeRawInput === "string" ? timeRawInput : "00:00"}`);
  return Number.isFinite(fallback) ? fallback : null;
};

export const isEventExpiredByGrace = (
  dateRawInput: unknown,
  timeRawInput: unknown,
  graceMs = 0
): boolean => {
  const eventMs = parseEventDateTimeMs(dateRawInput, timeRawInput);
  if (eventMs === null) return false;
  return eventMs + Math.max(0, graceMs) < Date.now();
};

export const parseTreinoDayEndMs = (dayRawInput: unknown): number | null => {
  const dayRaw = typeof dayRawInput === "string" ? dayRawInput.trim() : "";
  if (!dayRaw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
    const [year, month, day] = dayRaw.split("-").map((part) => Number(part));
    const parsed = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dayRaw)) {
    const [day, month, year] = dayRaw.split("/").map((part) => Number(part));
    const parsed = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Date.parse(dayRaw);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
};

export const isTreinoDayExpired = (dayRawInput: unknown, graceMs = 0): boolean => {
  const endMs = parseTreinoDayEndMs(dayRawInput);
  if (endMs === null) return false;
  return endMs + Math.max(0, graceMs) < Date.now();
};
