import { db } from "./firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { isFirebasePermissionError } from "./firebaseErrors";

const RULES = {
  POST_COOLDOWN: 60 * 1000,
  LIKE_DEBOUNCE: 500,
  MAX_DAILY_GYM: 1,
};

type SecurityResult = { allowed: boolean; reason?: string };

export const Security = {
  async canUserPost(userId: string): Promise<SecurityResult> {
    try {
      const userRef = doc(db, "users", userId);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        return { allowed: false, reason: "Usuario nao encontrado." };
      }

      const lastPost = snap.data().lastPostTime?.toDate().getTime() || 0;
      const now = Date.now();

      if (now - lastPost < RULES.POST_COOLDOWN) {
        const waitTime = Math.ceil((RULES.POST_COOLDOWN - (now - lastPost)) / 1000);
        return { allowed: false, reason: `Calma tubarao! Espere ${waitTime}s para postar novamente.` };
      }

      await updateDoc(userRef, { lastPostTime: serverTimestamp() });
      return { allowed: true };
    } catch (error: unknown) {
      if (isFirebasePermissionError(error)) {
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

      const lastCheckIn = snap.data().lastGymCheckIn?.toDate() || new Date(0);
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
      if (isFirebasePermissionError(error)) {
        return { allowed: false, reason: "Sem permissao para validar check-in." };
      }
      throw error;
    }
  },

  debounceLike: (lastClickTime: number) => {
    return Date.now() - lastClickTime > RULES.LIKE_DEBOUNCE;
  },
};
