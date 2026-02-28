import type { LucideIcon } from "lucide-react";
import {
  Award,
  Crown,
  Fish,
  Gem,
  Ghost,
  Heart,
  LayoutGrid,
  Medal,
  Rocket,
  ShoppingBag,
  Skull,
  Star,
  Swords,
  Target,
  ThumbsUp,
  Trophy,
  User,
  UserPlus,
  Zap,
} from "lucide-react";

export type PlanColorKey =
  | "yellow"
  | "emerald"
  | "purple"
  | "blue"
  | "red"
  | "orange"
  | "zinc";

export type PlanVisualTheme = {
  key: PlanColorKey;
  textClass: string;
  borderClass: string;
  softBgClass: string;
  badgeClass: string;
  glowClass: string;
  bgClass: string;
};

const PLAN_THEMES: Record<PlanColorKey, PlanVisualTheme> = {
  yellow: {
    key: "yellow",
    textClass: "text-yellow-400",
    borderClass: "border-yellow-500/50",
    softBgClass: "bg-yellow-500/20",
    badgeClass: "text-yellow-500 border-yellow-500/50 bg-yellow-500/10",
    glowClass: "shadow-yellow-500/20",
    bgClass: "bg-yellow-500",
  },
  emerald: {
    key: "emerald",
    textClass: "text-emerald-400",
    borderClass: "border-emerald-500/50",
    softBgClass: "bg-emerald-500/20",
    badgeClass: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10",
    glowClass: "shadow-emerald-500/20",
    bgClass: "bg-emerald-500",
  },
  purple: {
    key: "purple",
    textClass: "text-purple-400",
    borderClass: "border-purple-500/50",
    softBgClass: "bg-purple-500/20",
    badgeClass: "text-purple-400 border-purple-500/50 bg-purple-500/10",
    glowClass: "shadow-purple-500/20",
    bgClass: "bg-purple-500",
  },
  blue: {
    key: "blue",
    textClass: "text-blue-400",
    borderClass: "border-blue-500/50",
    softBgClass: "bg-blue-500/20",
    badgeClass: "text-blue-400 border-blue-500/50 bg-blue-500/10",
    glowClass: "shadow-blue-500/20",
    bgClass: "bg-blue-500",
  },
  red: {
    key: "red",
    textClass: "text-red-500",
    borderClass: "border-red-500/50",
    softBgClass: "bg-red-500/20",
    badgeClass: "text-red-500 border-red-500/50 bg-red-500/10",
    glowClass: "shadow-red-500/20",
    bgClass: "bg-red-500",
  },
  orange: {
    key: "orange",
    textClass: "text-orange-400",
    borderClass: "border-orange-500/50",
    softBgClass: "bg-orange-500/20",
    badgeClass: "text-orange-400 border-orange-500/50 bg-orange-500/10",
    glowClass: "shadow-orange-500/20",
    bgClass: "bg-orange-500",
  },
  zinc: {
    key: "zinc",
    textClass: "text-zinc-400",
    borderClass: "border-zinc-500/50",
    softBgClass: "bg-zinc-500/20",
    badgeClass: "text-zinc-400 border-zinc-500/50 bg-zinc-500/10",
    glowClass: "shadow-zinc-500/10",
    bgClass: "bg-zinc-500",
  },
};

const normalizeToken = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export const PLAN_COLOR_OPTIONS: Array<{ value: PlanColorKey; label: string }> = [
  { value: "zinc", label: "Zinc (Bicho Solto)" },
  { value: "blue", label: "Blue" },
  { value: "emerald", label: "Emerald" },
  { value: "yellow", label: "Yellow" },
  { value: "purple", label: "Purple" },
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
];

export const PLAN_ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ghost", label: "Ghost" },
  { value: "fish", label: "Fish" },
  { value: "star", label: "Star" },
  { value: "crown", label: "Crown" },
  { value: "trophy", label: "Trophy" },
  { value: "gem", label: "Gem" },
  { value: "zap", label: "Zap" },
  { value: "swords", label: "Swords" },
  { value: "rocket", label: "Rocket" },
  { value: "medal", label: "Medal" },
  { value: "heart", label: "Heart" },
  { value: "thumbsup", label: "Thumbs Up" },
  { value: "layoutgrid", label: "Grid" },
  { value: "userplus", label: "User Plus" },
  { value: "target", label: "Target" },
  { value: "shoppingbag", label: "Shopping Bag" },
  { value: "award", label: "Award" },
  { value: "user", label: "User" },
];

export const resolvePlanColorKey = (raw: string | null | undefined): PlanColorKey => {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "zinc";

  if (value in PLAN_THEMES) {
    return value as PlanColorKey;
  }

  if (value.includes("yellow") || value.includes("amber") || value.includes("gold")) {
    return "yellow";
  }
  if (value.includes("emerald") || value.includes("green")) {
    return "emerald";
  }
  if (value.includes("purple") || value.includes("violet")) {
    return "purple";
  }
  if (value.includes("blue") || value.includes("sky") || value.includes("cyan")) {
    return "blue";
  }
  if (value.includes("red") || value.includes("rose")) {
    return "red";
  }
  if (value.includes("orange")) {
    return "orange";
  }

  return "zinc";
};

export const resolvePlanTheme = (raw: string | null | undefined): PlanVisualTheme =>
  PLAN_THEMES[resolvePlanColorKey(raw)];

export const resolvePlanTextClass = (
  raw: string | null | undefined,
  fallback = "text-zinc-400"
): string => {
  const value = (raw ?? "").trim();
  if (value.startsWith("text-")) return value;
  if (!value) return fallback;
  return resolvePlanTheme(value).textClass;
};

const ICONS: Record<string, LucideIcon> = {
  ghost: Ghost,
  star: Star,
  crown: Crown,
  fish: Fish,
  trophy: Trophy,
  gem: Gem,
  zap: Zap,
  swords: Swords,
  sword: Swords,
  skull: Skull,
  rocket: Rocket,
  medal: Medal,
  heart: Heart,
  thumbsup: ThumbsUp,
  like: ThumbsUp,
  layoutgrid: LayoutGrid,
  grid: LayoutGrid,
  userplus: UserPlus,
  target: Target,
  shoppingbag: ShoppingBag,
  shopping: ShoppingBag,
  cart: ShoppingBag,
  award: Award,
  user: User,
};

export const resolvePlanIcon = (
  raw: string | null | undefined,
  fallback: LucideIcon = User
): LucideIcon => {
  const normalized = normalizeToken(raw ?? "");
  if (!normalized) return fallback;
  return ICONS[normalized] || fallback;
};

