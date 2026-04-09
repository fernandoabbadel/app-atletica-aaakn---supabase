export const LEAGUE_ROLE_OPTIONS = [
  "Presidente",
  "Vice-Presidente",
  "Secretaria",
  "Tesouraria",
  "Diretoria",
  "Membro",
] as const;

export type LeagueRoleOption = (typeof LEAGUE_ROLE_OPTIONS)[number];

export const DEFAULT_LEAGUE_ROLE: LeagueRoleOption = "Membro";

const LEAGUE_ROLE_IMPORTANCE = new Map<string, number>([
  ["presidente", 0],
  ["vice-presidente", 1],
  ["secretaria", 2],
  ["tesouraria", 3],
  ["diretoria", 4],
  ["membro", 5],
]);

const normalizeRoleText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const resolveLeagueRoleLabel = (value: unknown): string => {
  const cleanValue = typeof value === "string" ? value.trim() : "";
  const normalized = normalizeRoleText(cleanValue);

  if (!normalized) return DEFAULT_LEAGUE_ROLE;
  if (normalized.startsWith("president")) return "Presidente";
  if (normalized.startsWith("vice president") || normalized === "vice") {
    return "Vice-Presidente";
  }
  if (
    normalized.startsWith("secretar") ||
    normalized.startsWith("secratar") ||
    normalized.startsWith("secretari")
  ) {
    return "Secretaria";
  }
  if (normalized.startsWith("tesour")) return "Tesouraria";
  if (normalized.startsWith("diretor") || normalized.startsWith("diretoria")) {
    return "Diretoria";
  }
  if (normalized.startsWith("membro")) return "Membro";

  return cleanValue || DEFAULT_LEAGUE_ROLE;
};

export const getLeagueRoleImportance = (value: unknown): number => {
  const label = resolveLeagueRoleLabel(value);
  const normalized = normalizeRoleText(label).replace(/\s+/g, "-");
  return LEAGUE_ROLE_IMPORTANCE.get(normalized) ?? Number.MAX_SAFE_INTEGER;
};

export const sortLeagueMembersByRole = <T extends { cargo?: string; nome?: string }>(
  members: T[]
): T[] =>
  [...members].sort((left, right) => {
    const importanceDiff =
      getLeagueRoleImportance(left.cargo) - getLeagueRoleImportance(right.cargo);
    if (importanceDiff !== 0) return importanceDiff;

    const leftRole = resolveLeagueRoleLabel(left.cargo);
    const rightRole = resolveLeagueRoleLabel(right.cargo);
    const roleDiff = leftRole.localeCompare(rightRole, "pt-BR", {
      sensitivity: "base",
    });
    if (roleDiff !== 0) return roleDiff;

    return (left.nome || "").localeCompare(right.nome || "", "pt-BR", {
      sensitivity: "base",
    });
  });
