import { DEFAULT_STATS } from "@/constants/userDefaults";
import {
  ACHIEVEMENTS_CATALOG,
  type Achievement,
  type AchievementCategory,
} from "./achievements";

export interface RuntimeAchievementConfig {
  id: string;
  titulo: string;
  desc: string;
  xp: number;
  target: number;
  statKey: string;
  cat: AchievementCategory;
  iconName: string;
  iconEmoji?: string;
  active?: boolean;
  repeatable?: boolean;
}

export interface RuntimeAchievementProgress extends RuntimeAchievementConfig {
  progress: number;
  isUnlocked: boolean;
  keyExists: boolean;
}

export interface RuntimePatenteConfig {
  id: string;
  titulo: string;
  minXp: number;
  cor: string;
  iconName: string;
  bg?: string;
  border?: string;
  text?: string;
}

export interface RuntimeAchievementSummary {
  list: RuntimeAchievementProgress[];
  unlockedCount: number;
  totalUnlockedXp: number;
  missingKeys: string[];
}

export const DEFAULT_PATENTE_CONFIG: RuntimePatenteConfig[] = [
  {
    id: "p1",
    titulo: "Plancton",
    minXp: 0,
    cor: "text-zinc-400",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/30",
    text: "text-zinc-400",
    iconName: "Fish",
  },
  {
    id: "p2",
    titulo: "Peixe Palhaco",
    minXp: 500,
    cor: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    iconName: "Fish",
  },
  {
    id: "p3",
    titulo: "Barracuda",
    minXp: 2000,
    cor: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    iconName: "Swords",
  },
  {
    id: "p4",
    titulo: "Elite Roxa",
    minXp: 5000,
    cor: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    text: "text-purple-400",
    iconName: "Fish",
  },
  {
    id: "p5",
    titulo: "Elite Verde",
    minXp: 15000,
    cor: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    iconName: "Fish",
  },
  {
    id: "p6",
    titulo: "Megalodon",
    minXp: 50000,
    cor: "text-red-600",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-600",
    iconName: "Crown",
  },
];

const DEFAULT_ACHIEVEMENTS_BY_ID = new Map(
  ACHIEVEMENTS_CATALOG.map((item) => [item.id, item] as const)
);

const ACHIEVEMENT_STAT_ALIASES: Record<string, string[]> = {
  arenaLossStreak: ["arenaLoseStreak"],
  moneySpent: ["storeSpent"],
  storeOrders: ["storeItemsCount"],
  uniqueProductsBought: ["storeItemsCount"],
  semesterPlanActive: ["planUpdates"],
  promoTicketsBought: ["eventsPromo"],
  academicEvents: ["eventsAcademic"],
  socialActions: ["solidarityCount"],
  confirmedTrainings: ["gymCheckins", "treinoPresenceConfirmed"],
  freshersHuntScans: ["scansT8"],
  eventEntries: ["eventsAttended"],
};

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const normalizeCategory = (value: string): AchievementCategory => {
  if (
    value === "Geral" ||
    value === "Gym" ||
    value === "Games" ||
    value === "Social" ||
    value === "Loja" ||
    value === "Eventos"
  ) {
    return value;
  }
  return "Geral";
};

const normalizeAchievement = (
  entry: RuntimeAchievementConfig | Achievement
): RuntimeAchievementConfig => {
  const active = "active" in entry ? entry.active !== false : true;
  const repeatable = "repeatable" in entry ? Boolean(entry.repeatable) : false;

  return {
    id: asString(entry.id).trim(),
    titulo: asString(entry.titulo, "Conquista").trim(),
    desc: asString(entry.desc).trim(),
    xp: Math.max(0, asNumber(entry.xp, 0)),
    target: Math.max(1, asNumber(entry.target, 1)),
    statKey: asString(entry.statKey).trim(),
    cat: normalizeCategory(asString(entry.cat, "Geral")),
    iconName: asString(entry.iconName, "Star").trim(),
    iconEmoji: asString(entry.iconEmoji).trim() || undefined,
    active,
    repeatable,
  };
};

const normalizePatente = (
  entry: RuntimePatenteConfig
): RuntimePatenteConfig => ({
  id: asString(entry.id).trim(),
  titulo: asString(entry.titulo, "Patente").trim(),
  minXp: Math.max(0, asNumber(entry.minXp, 0)),
  cor: asString(entry.cor, "text-zinc-400").trim(),
  bg: asString(entry.bg).trim() || undefined,
  border: asString(entry.border).trim() || undefined,
  text: asString(entry.text).trim() || undefined,
  iconName: asString(entry.iconName, "Fish").trim(),
});

export const mergeAchievementCatalogWithDefaults = (
  entries: Array<RuntimeAchievementConfig>
): RuntimeAchievementConfig[] => {
  const provided = entries.map((entry) => normalizeAchievement(entry));
  const seenIds = new Set(provided.map((entry) => entry.id));
  const mergedProvided = provided.map((entry) => {
    const fallback = DEFAULT_ACHIEVEMENTS_BY_ID.get(entry.id);
    return {
      ...entry,
      iconEmoji: entry.iconEmoji || fallback?.iconEmoji,
    };
  });

  const missingDefaults = ACHIEVEMENTS_CATALOG.filter((item) => !seenIds.has(item.id)).map(
    (item) => normalizeAchievement(item)
  );

  return [...mergedProvided, ...missingDefaults].sort(
    (left, right) =>
      left.cat.localeCompare(right.cat, "pt-BR") ||
      left.titulo.localeCompare(right.titulo, "pt-BR")
  );
};

export const mergePatentesWithDefaults = (
  entries: Array<RuntimePatenteConfig>
): RuntimePatenteConfig[] => {
  if (!entries.length) {
    return DEFAULT_PATENTE_CONFIG.map((entry) => normalizePatente(entry));
  }

  const normalized = entries.map((entry) => normalizePatente(entry));
  return normalized
    .map((entry) => {
      const fallback = DEFAULT_PATENTE_CONFIG.find((item) => item.id === entry.id);
      return {
        ...fallback,
        ...entry,
        bg: entry.bg || fallback?.bg,
        border: entry.border || fallback?.border,
        text: entry.text || entry.cor || fallback?.text,
      };
    })
    .sort((left, right) => left.minXp - right.minXp);
};

export const normalizeAchievementStats = (
  stats: Record<string, unknown> | null | undefined
): Record<string, number> => {
  const safeStats = stats ?? {};
  const output: Record<string, number> = {};

  Object.entries({ ...DEFAULT_STATS, ...safeStats }).forEach(([key, value]) => {
    output[key] = Math.max(0, asNumber(value, 0));
  });

  return output;
};

export const resolveAchievementProgressValue = (
  stats: Record<string, unknown> | null | undefined,
  statKey: string
): { value: number; keyExists: boolean } => {
  const normalizedStats = normalizeAchievementStats(stats);
  const aliases = ACHIEVEMENT_STAT_ALIASES[statKey] ?? [];
  const candidateKeys = [statKey, ...aliases];

  let maxValue = 0;
  let keyExists = false;

  candidateKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalizedStats, key)) {
      keyExists = true;
      maxValue = Math.max(maxValue, asNumber(normalizedStats[key], 0));
    }
  });

  return { value: maxValue, keyExists };
};

export const calculateAchievementSummary = (
  catalog: Array<RuntimeAchievementConfig>,
  stats: Record<string, unknown> | null | undefined
): RuntimeAchievementSummary => {
  const safeCatalog = catalog
    .map((item) => normalizeAchievement(item))
    .filter((item) => item.active !== false);
  const missingKeys: string[] = [];
  let unlockedCount = 0;
  let totalUnlockedXp = 0;

  const list = safeCatalog.map((achievement) => {
    const progressMeta = resolveAchievementProgressValue(stats, achievement.statKey);
    const isUnlocked = progressMeta.value >= achievement.target;

    if (!progressMeta.keyExists && !missingKeys.includes(achievement.statKey)) {
      missingKeys.push(achievement.statKey);
    }

    if (isUnlocked) {
      unlockedCount += 1;
      totalUnlockedXp += achievement.xp;
    }

    return {
      ...achievement,
      progress: progressMeta.value,
      isUnlocked,
      keyExists: progressMeta.keyExists,
    };
  });

  list.sort((left, right) => {
    if (left.isUnlocked === right.isUnlocked) {
      return left.titulo.localeCompare(right.titulo, "pt-BR");
    }
    return left.isUnlocked ? -1 : 1;
  });

  return {
    list,
    unlockedCount,
    totalUnlockedXp,
    missingKeys,
  };
};

export const resolveEffectiveXp = (values: Array<number | null | undefined>): number => {
  let highest = 0;

  values.forEach((current) => {
    highest = Math.max(highest, Math.max(0, asNumber(current, 0)));
  });

  return highest;
};

export const resolvePatenteForXp = (
  patentes: Array<RuntimePatenteConfig>,
  xp: number
): RuntimePatenteConfig | null => {
  const ordered = mergePatentesWithDefaults(patentes);
  let selected: RuntimePatenteConfig | null = ordered[0] ?? null;

  ordered.forEach((patente) => {
    if (xp >= patente.minXp) {
      selected = patente;
    }
  });

  return selected;
};
