import { httpsCallable } from "@/lib/supa/functions";

import { functions } from "./backend";
import { getBackendErrorCode } from "./backendErrors";
import { throwSupabaseError } from "./supabaseData";
import { getSupabaseClient } from "./supabase";

type CacheEntry<T> = {
  cachedAt: number;
  value: T;
};

type RawRow = Record<string, unknown>;

const TTL_MS = 25_000;
const MAX_ARENA_USERS = 180;

const CALLABLE_ARENA_BATTLE_RESULT = "arenaRegisterBattleResult";
const CALLABLE_ARENA_FLEE = "arenaRegisterFlee";

const usersCache = new Map<string, CacheEntry<ArenaUserRecord[]>>();

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

const getCache = <T>(cache: Map<string, CacheEntry<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void => {
  cache.set(key, { cachedAt: Date.now(), value });
};

const isIndexRequired = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (code?.includes("failed-precondition")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("index") && message.includes("query");
  }
  return false;
};

const shouldFallbackToClient = (error: unknown): boolean => {
  const code = getBackendErrorCode(error)?.toLowerCase();
  if (!code) return true;

  return (
    code.includes("functions/not-found") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/internal") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/cancelled") ||
    code.includes("functions/unknown")
  );
};

async function callWithFallback<TReq, TRes>(
  callableName: string,
  payload: TReq,
  fallbackFn: () => Promise<TRes>
): Promise<TRes> {
  try {
    const callable = httpsCallable<TReq, TRes>(functions, callableName);
    const response = await callable(payload);
    return response.data;
  } catch (error: unknown) {
    if (shouldFallbackToClient(error)) {
      return fallbackFn();
    }
    throw error;
  }
}

async function queryRows(maxResults: number): Promise<RawRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uid,nome,apelido,turma,foto,xp,sharkCoins,stats")
    .order("xp", { ascending: false })
    .limit(maxResults);
  if (error) {
    if (!isIndexRequired(error)) throwSupabaseError(error);
    const fallback = await supabase
      .from("users")
      .select("uid,nome,apelido,turma,foto,xp,sharkCoins,stats")
      .limit(maxResults);
    if (fallback.error) throwSupabaseError(fallback.error);
    return (fallback.data ?? []) as unknown as RawRow[];
  }
  return (data ?? []) as unknown as RawRow[];
}

const nowIso = (): string => new Date().toISOString();

async function applyArenaUserDelta(payload: {
  userId: string;
  xpDelta?: number;
  sharkCoinsDelta?: number;
  winsDelta?: number;
  lossesDelta?: number;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uid,xp,sharkCoins,stats")
    .eq("uid", payload.userId)
    .maybeSingle();
  if (error) throwSupabaseError(error);
  if (!data) return;

  const stats = asObject(data.stats) ?? {};
  const nextStats: Record<string, unknown> = { ...stats };
  if (payload.winsDelta) {
    nextStats.arenaWins = asNumber(stats.arenaWins, 0) + payload.winsDelta;
  }
  if (payload.lossesDelta) {
    nextStats.arenaLosses = asNumber(stats.arenaLosses, 0) + payload.lossesDelta;
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({
      xp: Math.max(0, asNumber(data.xp, 0) + (payload.xpDelta ?? 0)),
      sharkCoins: Math.max(0, asNumber(data.sharkCoins, 0) + (payload.sharkCoinsDelta ?? 0)),
      stats: nextStats,
      updatedAt: nowIso(),
    })
    .eq("uid", payload.userId);
  if (updateError) throwSupabaseError(updateError);
}

export interface ArenaUserRecord {
  id: string;
  nome: string;
  apelido: string;
  turma: string;
  foto: string;
  xp: number;
  sharkCoins: number;
  stats: Record<string, unknown>;
}

const normalizeArenaUser = (raw: RawRow): ArenaUserRecord => {
  const stats = asObject(raw.stats) ?? {};
  return {
    id: asString(raw.uid || raw.id),
    nome: asString(raw.nome, "Atleta"),
    apelido: asString(raw.apelido),
    turma: asString(raw.turma, "Geral"),
    foto: asString(raw.foto, "https://github.com/shadcn.png"),
    xp: asNumber(raw.xp, 0),
    sharkCoins: asNumber(raw.sharkCoins, 0),
    stats,
  };
};

export async function fetchArenaUsers(options?: {
  maxResults?: number;
  forceRefresh?: boolean;
}): Promise<ArenaUserRecord[]> {
  const maxResults = boundedLimit(options?.maxResults ?? 100, MAX_ARENA_USERS);
  const forceRefresh = options?.forceRefresh ?? false;
  const cacheKey = `${maxResults}`;

  if (!forceRefresh) {
    const cached = getCache(usersCache, cacheKey);
    if (cached) return cached;
  }

  const rows = await queryRows(maxResults);

  const users = rows
    .map((row) => normalizeArenaUser(row))
    .sort((left, right) => right.xp - left.xp)
    .slice(0, maxResults);

  setCache(usersCache, cacheKey, users);
  return users;
}

export async function registerArenaBattleResult(payload: {
  attackerId: string;
  attackerName: string;
  defenderId: string;
  defenderName: string;
  result: "victory" | "defeat" | "draw";
  rounds: number;
  rewardXp?: number;
}): Promise<void> {
  const attackerId = payload.attackerId.trim();
  const defenderId = payload.defenderId.trim();
  if (!attackerId || !defenderId) return;

  const rewardXp = Math.max(0, Math.floor(payload.rewardXp ?? 0));
  const requestPayload = {
    ...payload,
    attackerId,
    defenderId,
    rewardXp,
  };

  await callWithFallback<typeof requestPayload, { ok: boolean }>(
    CALLABLE_ARENA_BATTLE_RESULT,
    requestPayload,
    async () => {
      const supabase = getSupabaseClient();
      const { error: insertError } = await supabase.from("arena_matches").insert({
        attackerId,
        attackerName: payload.attackerName.trim() || "Atleta",
        defenderId,
        defenderName: payload.defenderName.trim() || "Rival",
        result: payload.result,
        rounds: Math.max(1, Math.floor(payload.rounds)),
        date: nowIso(),
      });
      if (insertError) throwSupabaseError(insertError);

      if (payload.result === "victory" || payload.result === "draw") {
        await applyArenaUserDelta({
          userId: attackerId,
          xpDelta: Math.max(1, rewardXp),
          winsDelta: 1,
          sharkCoinsDelta: 10,
        });
      } else {
        await applyArenaUserDelta({
          userId: attackerId,
          lossesDelta: 1,
          xpDelta: 5,
        });
        if (defenderId !== attackerId) {
          await applyArenaUserDelta({
            userId: defenderId,
            xpDelta: 10,
            winsDelta: 1,
          });
        }
      }

      return { ok: true };
    }
  );

  usersCache.clear();
}

export async function registerArenaFlee(payload: {
  defenderId: string;
}): Promise<void> {
  const defenderId = payload.defenderId.trim();
  if (!defenderId) return;

  await callWithFallback<typeof payload, { ok: boolean }>(
    CALLABLE_ARENA_FLEE,
    payload,
    async () => {
      await applyArenaUserDelta({ userId: defenderId, xpDelta: 5, winsDelta: 1 });
      return { ok: true };
    }
  );

  usersCache.clear();
}

export function clearArenaCaches(): void {
  usersCache.clear();
}


