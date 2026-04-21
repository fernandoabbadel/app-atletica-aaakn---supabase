import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const isTupleEntry = (
  entry: unknown
): entry is [string, Record<string, unknown>] => {
  return (
    Array.isArray(entry) &&
    typeof entry[0] === "string" &&
    entry[0].trim().length > 0 &&
    typeof entry[1] === "object" &&
    entry[1] !== null
  );
};

const MANAGER_TENANT_ROLES = new Set(["master_tenant", "admin_geral", "admin_gestor"]);

type AuthScope = {
  userId: string;
  tenantId: string;
  userRole: string;
  tenantRole: string;
  tenantStatus: string;
  turma: string;
  isTurmaLeader: boolean;
  canManageAll: boolean;
};

const getAuthScope = async (request: NextRequest): Promise<AuthScope> => {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Não autenticado.");
  }

  const {
    data: authData,
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    throw new Error("Sessão inválida.");
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("uid,tenant_id,tenant_status,role,tenant_role,turma,extra")
    .eq("uid", authData.user.id)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message || "Falha ao carregar perfil.");
  }

  const raw = asObject(userRow);
  const userId = asString(raw?.uid).trim();
  const tenantId = asString(raw?.tenant_id).trim();
  const userRole = asString(raw?.role).trim().toLowerCase();
  const tenantRole = asString(raw?.tenant_role).trim().toLowerCase();
  const tenantStatus = asString(raw?.tenant_status).trim().toLowerCase();
  const turma = asString(raw?.turma).trim();
  const extra = asObject(raw?.extra) ?? {};
  const isTurmaLeader = extra.turmaLeader === true;
  const canManageAll = userRole === "master" || MANAGER_TENANT_ROLES.has(tenantRole);

  if (!userId || !tenantId || tenantStatus !== "approved") {
    throw new Error("Seu perfil não pode revisar solicitações neste tenant.");
  }

  if (!canManageAll && !isTurmaLeader) {
    throw new Error("Sem permissão para revisar pendências.");
  }

  if (!canManageAll && !turma) {
    throw new Error("Seu perfil de líder precisa ter turma definida.");
  }

  return {
    userId,
    tenantId,
    userRole,
    tenantRole,
    tenantStatus,
    turma,
    isTurmaLeader,
    canManageAll,
  };
};

const fetchRequesterMap = async (requesterIds: string[]) => {
  const cleanIds = Array.from(new Set(requesterIds.filter((value) => value.trim().length > 0)));
  if (cleanIds.length === 0) return new Map<string, Record<string, unknown>>();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("uid,nome,email,turma,foto")
    .in("uid", cleanIds);

  if (error) throw new Error(error.message || "Falha ao carregar usuários.");

  return new Map(
    (Array.isArray(data) ? data : [])
      .map((row) => {
        const raw = asObject(row);
        const uid = asString(raw?.uid).trim();
        return uid ? [uid, raw ?? {}] : null;
      })
      .filter(isTupleEntry)
  );
};

export async function GET(request: NextRequest) {
  try {
    const scope = await getAuthScope(request);

    const { data: requestsData, error: requestsError } = await supabaseAdmin
      .from("tenant_join_requests")
      .select(
        "id,tenant_id,requester_user_id,invite_id,status,requested_at,reviewed_at,approved_role,rejection_reason"
      )
      .eq("tenant_id", scope.tenantId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(120);

    if (requestsError) {
      return NextResponse.json({ error: requestsError.message }, { status: 400 });
    }

    const rawRequests = (Array.isArray(requestsData) ? requestsData : []).map((row) => asObject(row) ?? {});
    const requesterMap = await fetchRequesterMap(
      rawRequests.map((row) => asString(row.requester_user_id).trim())
    );

    const inviteIds = Array.from(
      new Set(rawRequests.map((row) => asString(row.invite_id).trim()).filter(Boolean))
    );
    const { data: invitesData, error: invitesError } =
      inviteIds.length > 0
        ? await supabaseAdmin
            .from("tenant_invites")
            .select("id,token,created_by")
            .in("id", inviteIds)
        : { data: [], error: null };

    if (invitesError) {
      return NextResponse.json({ error: invitesError.message }, { status: 400 });
    }

    const inviteMap = new Map(
      (Array.isArray(invitesData) ? invitesData : [])
        .map((row) => {
          const raw = asObject(row);
          const id = asString(raw?.id).trim();
          return id ? [id, raw ?? {}] : null;
        })
        .filter(isTupleEntry)
    );

    const inviterMap = await fetchRequesterMap(
      Array.from(inviteMap.values()).map((row) => asString(row.created_by).trim())
    );

    const requests = rawRequests
      .map((row) => {
        const requesterUserId = asString(row.requester_user_id).trim();
        const requester = requesterMap.get(requesterUserId) ?? {};
        const invite = inviteMap.get(asString(row.invite_id).trim()) ?? {};
        const inviter = inviterMap.get(asString(invite.created_by).trim()) ?? {};

        return {
          id: asString(row.id).trim(),
          requesterUserId,
          requesterName: asString(requester.nome).trim(),
          requesterEmail: asString(requester.email).trim(),
          requesterTurma: asString(requester.turma).trim(),
          requesterPhoto: asString(requester.foto).trim(),
          requestedAt: asString(row.requested_at).trim(),
          inviteToken: asString(invite.token).trim(),
          inviterName: asString(inviter.nome).trim(),
          inviterEmail: asString(inviter.email).trim(),
        };
      })
      .filter((row) => row.id.length > 0)
      .filter((row) => scope.canManageAll || row.requesterTurma === scope.turma);

    return NextResponse.json({
      requests,
      leaderTurma: scope.turma,
      canManageAll: scope.canManageAll,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro ao carregar pendências.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = await getAuthScope(request);
    const body = asObject(await request.json());
    const requestId = asString(body?.requestId).trim();
    const action = asString(body?.action).trim().toLowerCase();
    const reason = asString(body?.reason).trim();

    if (!requestId || (action !== "approve" && action !== "reject")) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("tenant_join_requests")
      .select("id,tenant_id,requester_user_id,status")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) {
      return NextResponse.json({ error: requestError.message }, { status: 400 });
    }

    const rawRequest = asObject(requestRow);
    if (!rawRequest) {
      return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
    }

    const requestTenantId = asString(rawRequest.tenant_id).trim();
    const requesterUserId = asString(rawRequest.requester_user_id).trim();
    const requestStatus = asString(rawRequest.status).trim().toLowerCase();

    if (requestTenantId !== scope.tenantId) {
      return NextResponse.json({ error: "Solicitação fora do seu tenant." }, { status: 403 });
    }
    if (requestStatus !== "pending") {
      return NextResponse.json({ error: "Solicitação já revisada." }, { status: 400 });
    }

    if (!scope.canManageAll) {
      const { data: requesterRow, error: requesterError } = await supabaseAdmin
        .from("users")
        .select("uid,turma")
        .eq("uid", requesterUserId)
        .maybeSingle();
      if (requesterError) {
        return NextResponse.json({ error: requesterError.message }, { status: 400 });
      }
      const requesterTurma = asString(asObject(requesterRow)?.turma).trim();
      if (!requesterTurma || requesterTurma !== scope.turma) {
        return NextResponse.json(
          { error: "Essa solicitação não pertence à sua turma." },
          { status: 403 }
        );
      }
    }

    if (action === "approve") {
      const { error } = await supabaseAdmin.rpc("tenant_approve_join_request", {
        p_request_id: requestId,
        p_approved_role: "user",
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabaseAdmin.rpc("tenant_reject_join_request", {
      p_request_id: requestId,
      p_reason: reason || null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro ao revisar pendência.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
