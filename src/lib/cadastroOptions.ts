export type CadastroFieldKey =
  | "instagram"
  | "bio"
  | "statusRelacionamento"
  | "pets"
  | "esportes";

export type CadastroFieldConfig = {
  enabled: boolean;
  required: boolean;
};

export type CadastroFieldConfigMap = Record<CadastroFieldKey, CadastroFieldConfig>;

export type CadastroSportOption = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
};

type InternalSportOption = CadastroSportOption & {
  aliases?: string[];
  colorClass?: string;
};

type SportPresentation = {
  id: string;
  label: string;
  emoji: string;
  colorClass: string;
};

const SPORT_COLOR_FALLBACKS = [
  "bg-emerald-500/20 text-emerald-400",
  "bg-blue-500/20 text-blue-300",
  "bg-orange-500/20 text-orange-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-pink-500/20 text-pink-300",
  "bg-violet-500/20 text-violet-300",
];

const DEFAULT_SPORTS_INTERNAL: InternalSportOption[] = [
  { id: "futebol", label: "Futebol", icon: "⚽", enabled: true, colorClass: "bg-green-500/20 text-green-400" },
  { id: "futsal", label: "Futsal", icon: "👟", enabled: true, colorClass: "bg-emerald-500/20 text-emerald-400" },
  { id: "volei", label: "Volei", icon: "🏐", enabled: true, colorClass: "bg-blue-400/20 text-blue-200" },
  { id: "basquete", label: "Basquete", icon: "🏀", enabled: true, colorClass: "bg-orange-500/20 text-orange-400" },
  {
    id: "handball",
    label: "Handball",
    icon: "🤾",
    enabled: true,
    aliases: ["handebol"],
    colorClass: "bg-red-500/20 text-red-400",
  },
  { id: "rugby", label: "Rugby", icon: "🏉", enabled: true, colorClass: "bg-amber-500/20 text-amber-400" },
  { id: "baseball", label: "Baseball", icon: "⚾", enabled: true, colorClass: "bg-zinc-700/40 text-zinc-200" },
  { id: "futevolei", label: "Futevolei", icon: "🏐", enabled: true, colorClass: "bg-sky-500/20 text-sky-300" },
  { id: "beach_tennis", label: "Beach Tennis", icon: "🏖️", enabled: true, colorClass: "bg-yellow-600/20 text-yellow-400" },
  { id: "tenis", label: "Tenis", icon: "🎾", enabled: true, colorClass: "bg-lime-500/20 text-lime-300" },
  { id: "frescobol", label: "Frescobol", icon: "🏓", enabled: true, colorClass: "bg-cyan-500/20 text-cyan-300" },
  { id: "taco", label: "Taco (Bets)", icon: "🏏", enabled: true, colorClass: "bg-purple-500/20 text-purple-300" },
  { id: "peteca", label: "Peteca", icon: "🏸", enabled: true, colorClass: "bg-amber-400/20 text-amber-200" },
  { id: "surf", label: "Surf", icon: "🏄", enabled: true, colorClass: "bg-blue-500/20 text-blue-400" },
  { id: "natacao", label: "Natacao", icon: "🏊", enabled: true, colorClass: "bg-cyan-500/20 text-cyan-400" },
  { id: "canoagem", label: "Canoagem", icon: "🛶", enabled: true, colorClass: "bg-blue-800/20 text-blue-300" },
  { id: "skate", label: "Skate", icon: "🛹", enabled: true, colorClass: "bg-zinc-700/40 text-zinc-200" },
  { id: "dog_walking", label: "Dog Walking", icon: "🐕", enabled: true, colorClass: "bg-orange-900/20 text-orange-300" },
  { id: "truco", label: "Truco", icon: "🃏", enabled: true, colorClass: "bg-rose-500/20 text-rose-300" },
  { id: "sinuca", label: "Sinuca", icon: "🎱", enabled: true, colorClass: "bg-zinc-700/40 text-zinc-200" },
];

export const DEFAULT_STATUS_RELACIONAMENTO_OPTIONS = [
  "Solteiro(a)",
  "Namorando",
  "Casado(a)",
  "Enrolado(a)",
] as const;

export const DEFAULT_PET_OPTIONS = [
  { id: "cachorro", label: "Cachorro", icon: "🐶" },
  { id: "gato", label: "Gato", icon: "🐱" },
  { id: "ambos", label: "Ambos", icon: "🐶🐱" },
  { id: "nenhum", label: "Sem Pet", icon: "🚫" },
] as const;

export const getDefaultCadastroFieldConfig = (): CadastroFieldConfigMap => ({
  instagram: { enabled: true, required: false },
  bio: { enabled: true, required: false },
  statusRelacionamento: { enabled: true, required: false },
  pets: { enabled: true, required: false },
  esportes: { enabled: true, required: false },
});

const normalizeText = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const prettyLabelFromId = (id: string): string =>
  id
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Modalidade";

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const normalizeCadastroSportId = (value: string): string => {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "modalidade";
};

export const normalizeCadastroSportOption = (
  value: Partial<CadastroSportOption>
): CadastroSportOption | null => {
  const label = typeof value.label === "string" ? value.label.trim().slice(0, 40) : "";
  const id = normalizeCadastroSportId(
    typeof value.id === "string" && value.id.trim() ? value.id : label
  );
  if (!id) return null;

  const icon =
    typeof value.icon === "string" && value.icon.trim().slice(0, 6)
      ? value.icon.trim().slice(0, 6)
      : "🏅";

  return {
    id,
    label: label || prettyLabelFromId(id),
    icon,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };
};

export const dedupeCadastroSportOptions = (
  options: readonly Partial<CadastroSportOption>[]
): CadastroSportOption[] => {
  const map = new Map<string, CadastroSportOption>();

  options.forEach((entry) => {
    const normalized = normalizeCadastroSportOption(entry);
    if (!normalized) return;
    map.set(normalized.id, normalized);
  });

  return Array.from(map.values()).sort((left, right) =>
    left.label.localeCompare(right.label, "pt-BR")
  );
};

export const getDefaultCadastroSportOptions = (): CadastroSportOption[] =>
  DEFAULT_SPORTS_INTERNAL.map(({ id, label, icon, enabled }) => ({
    id,
    label,
    icon,
    enabled,
  }));

const buildSportRegistry = (options?: readonly Partial<CadastroSportOption>[]) => {
  const merged = dedupeCadastroSportOptions([
    ...DEFAULT_SPORTS_INTERNAL,
    ...(options ?? []),
  ]);
  const metadataById = new Map(
    DEFAULT_SPORTS_INTERNAL.map((entry) => [entry.id, entry] as const)
  );
  const registry = new Map<string, SportPresentation>();

  merged.forEach((entry) => {
    const internalEntry = metadataById.get(entry.id);
    const colorClass =
      internalEntry?.colorClass ||
      SPORT_COLOR_FALLBACKS[hashString(entry.id) % SPORT_COLOR_FALLBACKS.length];
    const presentation: SportPresentation = {
      id: entry.id,
      label: entry.label,
      emoji: entry.icon,
      colorClass,
    };
    registry.set(normalizeText(entry.id), presentation);
    registry.set(normalizeText(entry.label), presentation);

    if (internalEntry?.aliases?.length) {
      internalEntry.aliases.forEach((alias) => {
        registry.set(normalizeText(alias), presentation);
      });
    }
  });

  return registry;
};

export const normalizeSelectedSportIds = (
  values: readonly string[],
  options?: readonly Partial<CadastroSportOption>[]
): string[] => {
  const registry = buildSportRegistry(options);
  const unique = new Set<string>();

  values.forEach((value) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const match = registry.get(normalized);
    unique.add(match?.id || normalizeCadastroSportId(value));
  });

  return Array.from(unique);
};

export const getSportPresentation = (
  value: string,
  options?: readonly Partial<CadastroSportOption>[]
): SportPresentation => {
  const registry = buildSportRegistry(options);
  const normalized = normalizeText(value);
  const existing = normalized ? registry.get(normalized) : null;
  if (existing) return existing;

  const id = normalizeCadastroSportId(value);
  return {
    id,
    label: prettyLabelFromId(id),
    emoji: "🏅",
    colorClass: SPORT_COLOR_FALLBACKS[hashString(id) % SPORT_COLOR_FALLBACKS.length],
  };
};
