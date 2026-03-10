import { getSupabaseClient } from "./supabase";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export interface TurmaLeaderPendingRequest {
  id: string;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;
  requesterTurma: string;
  requesterPhoto: string;
  requestedAt: string;
  inviteToken: string;
  inviterName: string;
  inviterEmail: string;
}

interface TurmaLeaderPendingResponse {
  requests: TurmaLeaderPendingRequest[];
  leaderTurma: string;
  canManageAll: boolean;
}

const getAccessToken = async (): Promise<string> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || "Falha ao identificar a sessao.");

  const token = asString(data.session?.access_token).trim();
  if (!token) throw new Error("Sessao invalida.");
  return token;
};

export async function fetchTurmaLeaderPendingRequests(): Promise<TurmaLeaderPendingResponse> {
  const accessToken = await getAccessToken();
  const response = await fetch("/api/turma-leader/pendentes", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    requests?: unknown;
    leaderTurma?: unknown;
    canManageAll?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(asString(payload.error, "Erro ao carregar pendencias da turma."));
  }

  const requests = Array.isArray(payload.requests)
    ? payload.requests
        .map((entry) => {
          const raw = asObject(entry);
          if (!raw) return null;
          const id = asString(raw.id).trim();
          if (!id) return null;
          return {
            id,
            requesterUserId: asString(raw.requesterUserId).trim(),
            requesterName: asString(raw.requesterName).trim(),
            requesterEmail: asString(raw.requesterEmail).trim(),
            requesterTurma: asString(raw.requesterTurma).trim(),
            requesterPhoto: asString(raw.requesterPhoto).trim(),
            requestedAt: asString(raw.requestedAt).trim(),
            inviteToken: asString(raw.inviteToken).trim(),
            inviterName: asString(raw.inviterName).trim(),
            inviterEmail: asString(raw.inviterEmail).trim(),
          } satisfies TurmaLeaderPendingRequest;
        })
        .filter((entry): entry is TurmaLeaderPendingRequest => entry !== null)
    : [];

  return {
    requests,
    leaderTurma: asString(payload.leaderTurma).trim(),
    canManageAll: Boolean(payload.canManageAll),
  };
}

export async function reviewTurmaLeaderPendingRequest(payload: {
  requestId: string;
  action: "approve" | "reject";
  reason?: string;
}): Promise<void> {
  const accessToken = await getAccessToken();
  const response = await fetch("/api/turma-leader/pendentes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const responsePayload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(asString(responsePayload.error, "Erro ao revisar solicitacao."));
  }
}
