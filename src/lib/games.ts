export interface HeroStats {
  inteligencia: number;
  forca: number;
  stamina: number;
  hp: number;
  ataque: number;
  defesa: number;
}

export interface UserStatsSource {
  stats?: Record<string, number | undefined>;
  xp?: number;
  plano_badge?: string;
}

export const calculateLevel = (xp: number) => {
  if (xp < 50) return 1;
  if (xp < 150) return 2;
  if (xp < 350) return 3;
  if (xp < 750) return 4;
  if (xp < 1350) return 5;
  if (xp < 2150) return 6;
  return 6 + Math.floor((xp - 2150) / 1000);
};

export const getNextLevelXP = (level: number) => {
  if (level === 1) return 50;
  if (level === 2) return 150;
  if (level === 3) return 350;
  if (level === 4) return 750;
  if (level === 5) return 1350;
  if (level === 6) return 2150;
  return 2150 + ((level - 6) * 1000);
};

export const calculateUserStats = (user: UserStatsSource): HeroStats => {
  const stats = user.stats || {};
  const xp = user.xp || 0;
  const currentLevel = calculateLevel(xp);
  const calc = (base: number, bonus: number) => Math.floor(base + bonus);

  return {
    forca: calc(20, ((stats.gymCheckins || 0) * 0.1) + ((stats.confirmedTrainings || 0) * 1)),
    inteligencia: calc(20, ((stats.postsCount || 0) * 0.1) + ((stats.commentsCount || 0) * 0.1) + ((stats.albumCollected || 0) * 0.1) + ((stats.followingCount || 0) * 0.1)),
    stamina: calc(50, ((stats.loginCount || 0) * 0.1) + ((stats.streak7Cycles || 0) * 1) + ((stats.streak30Cycles || 0) * 5) + ((stats.eventsAttended || 0) * 5) + ((stats.confirmedTrainings || 0) * 1)),
    defesa: calc(20, ((stats.storeSpent || 0) * 0.1) + ((stats.followersCount || 0) * 0.1) + (user.plano_badge ? 30 : 0)),
    ataque: calc(25, ((stats.arenaWins || 0) * 0.1) - ((stats.arenaLosses || 0) * 0.05)),
    hp: calc(200, currentLevel * 50),
  };
};
