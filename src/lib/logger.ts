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

const normalizeToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const hasAnyToken = (haystack: string, tokens: string[]): boolean =>
  tokens.some((token) => haystack.includes(token));

const shouldPersistAuditLog = (
  action: ActionType,
  resource: string,
  detailsString: string
): boolean => {
  const actionKey = action.toUpperCase();
  const resourceKey = normalizeToken(resource);
  const detailsKey = normalizeToken(detailsString);

  // 1) Login da diretoria no painel admin
  if (resourceKey === "adminpainel") {
    return actionKey === "LOGIN";
  }

  // 2) CRUD de produto da lojinha
  if (resourceKey === "lojaproduto") {
    return actionKey === "CREATE" || actionKey === "UPDATE" || actionKey === "DELETE";
  }

  // 3) Aprovar/reprovar comprovantes (eventos, loja, planos)
  if (resourceKey === "lojapagamentos" || resourceKey === "eventospagamentos" || resourceKey === "planospedidos") {
    if (actionKey !== "UPDATE") return false;
    return hasAnyToken(detailsKey, ["aprov", "rejeit", "estorn", "desfaz", "comprov"]);
  }

  // 4) Exclusao de denuncia
  if (resourceKey.startsWith("denuncias")) {
    return actionKey === "DELETE";
  }

  // 4.1) Aprovar/rejeitar fila de pendencias do lancamento
  if (resourceKey === "tenantjoinrequests") {
    return actionKey === "UPDATE";
  }

  // 5) Evento criado/deletado
  if (resourceKey === "eventosadmin") {
    return actionKey === "CREATE" || actionKey === "DELETE";
  }

  return false;
};

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

    if (!shouldPersistAuditLog(action, resource, detailsString)) {
      return;
    }

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
      const errorCode = typeof error.code === "string" ? error.code : "";
      const errorMessage = typeof error.message === "string" ? error.message.toLowerCase() : "";
      const missingOptionalTable =
        errorCode.toUpperCase() === "PGRST205" ||
        (errorMessage.includes("activity_logs") && errorMessage.includes("schema cache"));

      if (missingOptionalTable) {
        if (process.env.NODE_ENV === "development") {
          console.warn("Tabela opcional public.activity_logs ainda nao existe. Pulando auditoria.");
        }
        return;
      }

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
