import { db } from "./backend";
import { doc, getDoc, updateDoc, serverTimestamp } from "@/lib/supabaseHelpers";
import { isPermissionError } from "./backendErrors";

const RULES = {
  POST_COOLDOWN: 60 * 1000,
  LIKE_DEBOUNCE: 500,
  MAX_DAILY_GYM: 1,
};

type SecurityResult = { allowed: boolean; reason?: string };
const localPostCooldownFallback = new Map<string, number>();

const toDateSafe = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  return null;
};

const isMissingSchemaColumnError = (error: unknown, columnName: string): boolean => {
  if (typeof error !== "object" || error === null) return false;

  const raw = error as { message?: unknown };
  const message = typeof raw.message === "string" ? raw.message.toLowerCase() : "";
  const normalizedColumn = columnName.toLowerCase();

  return (
    message.includes(normalizedColumn) &&
    (message.includes("schema cache") || (message.includes("column") && message.includes("does not exist")))
  );
};

export const Security = {
  async canUserPost(userId: string): Promise<SecurityResult> {
    try {
      const userRef = doc(db, "users", userId);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        return { allowed: false, reason: "Usuario nao encontrado." };
      }

      const userData = snap.data() as { lastPostTime?: unknown };
      const persistedLastPost = toDateSafe(userData.lastPostTime)?.getTime() || 0;
      const localLastPost = localPostCooldownFallback.get(userId) || 0;
      const lastPost = Math.max(persistedLastPost, localLastPost);
      const now = Date.now();

      if (now - lastPost < RULES.POST_COOLDOWN) {
        const waitTime = Math.ceil((RULES.POST_COOLDOWN - (now - lastPost)) / 1000);
        return { allowed: false, reason: `Calma tubarao! Espere ${waitTime}s para postar novamente.` };
      }

      try {
        await updateDoc(userRef, { lastPostTime: serverTimestamp() });
      } catch (error: unknown) {
        if (!isMissingSchemaColumnError(error, "lastPostTime")) {
          throw error;
        }
        // Fallback local para manter cooldown funcionando nesta sessao enquanto a coluna nao existe.
        localPostCooldownFallback.set(userId, now);
      }

      localPostCooldownFallback.set(userId, now);
      return { allowed: true };
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        return { allowed: false, reason: "Sem permissao para essa acao agora." };
      }
      throw error;
    }
  },

  async canCheckInGym(userId: string): Promise<SecurityResult> {
    try {
      const userRef = doc(db, "users", userId);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        return { allowed: false };
      }

      const userData = snap.data() as { lastGymCheckIn?: unknown };
      const lastCheckIn = toDateSafe(userData.lastGymCheckIn) || new Date(0);
      const today = new Date();

      if (
        lastCheckIn.getDate() === today.getDate() &&
        lastCheckIn.getMonth() === today.getMonth() &&
        lastCheckIn.getFullYear() === today.getFullYear()
      ) {
        return { allowed: false, reason: "Voce ja treinou hoje! O descanso tambem faz parte do treino." };
      }

      return { allowed: true };
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        return { allowed: false, reason: "Sem permissao para validar check-in." };
      }
      throw error;
    }
  },

  debounceLike: (lastClickTime: number) => {
    return Date.now() - lastClickTime > RULES.LIKE_DEBOUNCE;
  },
};


