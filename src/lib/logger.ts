import { getSupabaseClient } from "./supabase";
import { isPermissionError } from "./backendErrors";

export type ActionType =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "ERROR"
  | "LIKE"
  | "QUIZ"
  | "FOLLOW"
  | "UNFOLLOW"
  | "GAME_CYCLE";

export const logActivity = async (
  userId: string,
  userName: string,
  action: ActionType,
  resource: string,
  details: unknown
) => {
  try {
    const supabase = getSupabaseClient();
    const detailsString =
      typeof details === "object" && details !== null ? JSON.stringify(details) : String(details);

    // Tabela opcional no bootstrap inicial. Se nao existir ainda, o catch evita quebrar o fluxo principal.
    const { error } = await supabase.from("activity_logs").insert({
      userId,
      userName: userName || "Anonimo",
      action,
      resource,
      details: detailsString,
      timestamp: new Date().toISOString(),
    });

    if (error) {
      throw Object.assign(new Error(error.message), {
        code: error.code ?? `db/${error.name ?? "insert-failed"}`,
        cause: error,
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`[LOG]: ${userName} realizou ${action} em ${resource}`);
    }
  } catch (error: unknown) {
    if (!isPermissionError(error)) {
      console.error("Erro ao salvar log:", error);
    }
  }
};
