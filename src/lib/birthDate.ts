export type BirthDateParts = {
  day: string;
  month: string;
  year: string;
};

const ISO_BIRTH_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const normalizeNumericPart = (value: string, maxLength: number): string =>
  value.replace(/\D/g, "").slice(0, maxLength);

const toPositiveInteger = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export const getBirthYearOptions = (startYear = 1930): string[] => {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];
  for (let year = currentYear; year >= startYear; year -= 1) {
    years.push(String(year));
  }
  return years;
};

export const getDaysInMonth = (monthRaw: string, yearRaw: string): number => {
  const month = toPositiveInteger(monthRaw);
  const year = toPositiveInteger(yearRaw);

  if (!month || month < 1 || month > 12) return 31;
  const safeYear = year ?? new Date().getFullYear();
  return new Date(safeYear, month, 0).getDate();
};

export const normalizeBirthDateParts = (parts: BirthDateParts): BirthDateParts => {
  const year = normalizeNumericPart(parts.year, 4);
  const monthDigits = normalizeNumericPart(parts.month, 2);
  const dayDigits = normalizeNumericPart(parts.day, 2);
  const maxDay = getDaysInMonth(monthDigits, year);

  const monthNumber = toPositiveInteger(monthDigits);
  const dayNumber = toPositiveInteger(dayDigits);

  const normalizedMonth =
    monthNumber && monthNumber >= 1 && monthNumber <= 12
      ? String(monthNumber).padStart(2, "0")
      : monthDigits;
  const normalizedDay =
    dayNumber && dayNumber >= 1 && dayNumber <= maxDay
      ? String(dayNumber).padStart(2, "0")
      : dayDigits;

  return {
    day: normalizedDay,
    month: normalizedMonth,
    year,
  };
};

export const extractBirthDateParts = (value?: string | null): BirthDateParts => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return { day: "", month: "", year: "" };
  }

  const isoCandidate = raw.slice(0, 10);
  const match = isoCandidate.match(ISO_BIRTH_DATE_RE);
  if (match) {
    return normalizeBirthDateParts({
      year: match[1],
      month: match[2],
      day: match[3],
    });
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { day: "", month: "", year: "" };
  }

  return normalizeBirthDateParts({
    year: String(parsed.getFullYear()),
    month: String(parsed.getMonth() + 1),
    day: String(parsed.getDate()),
  });
};

export const buildBirthDateValue = (parts: BirthDateParts): string => {
  const normalized = normalizeBirthDateParts(parts);
  const year = toPositiveInteger(normalized.year);
  const month = toPositiveInteger(normalized.month);
  const day = toPositiveInteger(normalized.day);

  if (!year || !month || !day) return "";
  if (normalized.year.length !== 4) return "";
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > getDaysInMonth(normalized.month, normalized.year)) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const calculateAgeFromBirthDate = (
  value?: string | null,
  now = new Date()
): number | null => {
  const parts = extractBirthDateParts(value);
  const birthDateValue = buildBirthDateValue(parts);
  if (!birthDateValue) return null;

  const birthDate = new Date(`${birthDateValue}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;

  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
};
