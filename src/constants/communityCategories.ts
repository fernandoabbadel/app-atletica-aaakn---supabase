export const DEFAULT_COMMUNITY_CATEGORIES = [
  "Geral",
  "Futebol",
  "Vôlei",
  "Basquete",
  "Handebol",
  "Sinuca",
  "Truco",
  "Natação",
  "Bateria",
  "Cheerleaders",
  "Sugestões",
];

export const normalizeCommunityCategoryName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 40);

export const normalizeCommunityCategories = (value: unknown): string[] => {
  const source = Array.isArray(value) ? value : DEFAULT_COMMUNITY_CATEGORIES;
  const unique = new Set<string>();

  source.forEach((item) => {
    if (typeof item !== "string") return;
    const clean = normalizeCommunityCategoryName(item);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (unique.has(key)) return;
    unique.add(key);
  });

  if (unique.size === 0) {
    return [...DEFAULT_COMMUNITY_CATEGORIES];
  }

  const normalized: string[] = [];
  source.forEach((item) => {
    if (typeof item !== "string") return;
    const clean = normalizeCommunityCategoryName(item);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!unique.has(key)) return;
    unique.delete(key);
    normalized.push(clean);
  });

  return normalized;
};
