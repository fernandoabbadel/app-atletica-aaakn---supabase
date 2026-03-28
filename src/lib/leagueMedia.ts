type LeagueLogoSource = {
  logoUrl?: unknown;
  logo?: unknown;
  foto?: unknown;
};

const normalizeImageValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const resolveLeagueLogoSrc = (
  source?: LeagueLogoSource | null,
  fallback = ""
): string => {
  if (!source) return fallback;

  const candidates = [source.logoUrl, source.logo, source.foto]
    .map(normalizeImageValue)
    .filter((value) => value.length > 0);

  return candidates[0] || fallback;
};
