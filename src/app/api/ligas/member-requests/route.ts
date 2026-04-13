import { NextRequest, NextResponse } from "next/server";

import {
  asObject,
  asString,
  extractMissingSchemaColumn,
  removeMissingColumnFromPayload,
} from "@/app/api/admin/ligas/_auth";
import { DEFAULT_LEAGUE_ROLE, resolveLeagueRoleLabel } from "@/lib/leagueRoles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const getLeagueDataField = (value: unknown): Record<string, unknown> =>
  asObject(asObject(value)?.data) ?? {};

const mergeLeagueCompatData = (
  currentData: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> => ({
  ...currentData,
  ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
});

const nowIso = (): string => new Date().toISOString();

const normalizeMemberIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => {
          const raw = asObject(entry);
          return asString(raw?.id).trim();
        })
        .filter((entry) => entry.length > 0)
    )
  );
};

const normalizeMemberRequests = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: Array<Record<string, unknown>> = [];

  value.forEach((entry) => {
    const raw = asObject(entry);
    if (!raw) return;

    const userId = asString(raw.userId, asString(raw.requesterUserId)).trim();
    if (!userId || seen.has(userId)) return;
    seen.add(userId);

    normalized.push({
      id: asString(raw.id).trim() || crypto.randomUUID(),
      userId,
      nome: asString(raw.nome, "Atleta").trim() || "Atleta",
      foto: asString(raw.foto).trim(),
      turma: asString(raw.turma).trim(),
      requestedRole:
        resolveLeagueRoleLabel(asString(raw.requestedRole, DEFAULT_LEAGUE_ROLE)).slice(0, 80) ||
        DEFAULT_LEAGUE_ROLE,
      createdAt: asString(raw.createdAt).trim() || nowIso(),
    });
  });

  return normalized;
};

const getAuthScope = async (request: NextRequest) => {
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Nao autenticado.");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authData.user) {
    throw new Error("Sessao invalida.");
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("uid,nome,foto,turma,role,tenant_id,tenant_status")
    .eq("uid", authData.user.id)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message || "Falha ao carregar perfil.");
  }

  const raw = asObject(userRow);
  const userId = asString(raw?.uid).trim();
  const userRole = asString(raw?.role).trim().toLowerCase();
  const tenantId = asString(raw?.tenant_id).trim();
  const tenantStatus = asString(raw?.tenant_status).trim().toLowerCase();

  if (!userId) {
    throw new Error("Perfil do usuario invalido.");
  }

  if (userRole !== "master" && (!tenantId || tenantStatus !== "approved")) {
    throw new Error("Seu perfil ainda nao pode solicitar entrada na liga.");
  }

  return {
    userId,
    nome: asString(raw?.nome).trim() || "Atleta",
    foto: asString(raw?.foto).trim(),
    turma: asString(raw?.turma).trim(),
    userRole,
    tenantId,
  };
};

export async function POST(request: NextRequest) {
  try {
    const scope = await getAuthScope(request);
    const body = asObject(await request.json());
    const leagueId = asString(body?.leagueId).trim();
    const requestedRole =
      resolveLeagueRoleLabel(asString(body?.requestedRole, DEFAULT_LEAGUE_ROLE)).slice(0, 80) ||
      DEFAULT_LEAGUE_ROLE;

    if (!leagueId) {
      return NextResponse.json({ error: "Liga invalida." }, { status: 400 });
    }

    const { data: leagueRowRaw, error: leagueError } = await supabaseAdmin
      .from("ligas_config")
      .select("id,tenant_id,membros,data")
      .eq("id", leagueId)
      .maybeSingle();

    if (leagueError) {
      return NextResponse.json({ error: leagueError.message }, { status: 400 });
    }

    const leagueRow = asObject(leagueRowRaw);
    if (!leagueRow) {
      return NextResponse.json({ error: "Liga nao encontrada." }, { status: 404 });
    }

    const leagueTenantId = asString(leagueRow.tenant_id).trim();
    if (scope.userRole !== "master" && leagueTenantId && leagueTenantId !== scope.tenantId) {
      return NextResponse.json({ error: "Liga fora do seu tenant." }, { status: 403 });
    }

    const currentData = getLeagueDataField(leagueRow);
    const currentMemberIds = Array.from(
      new Set([
        ...normalizeMemberIds(leagueRow.membros),
        ...normalizeMemberIds(currentData.membros),
      ])
    );
    if (currentMemberIds.includes(scope.userId)) {
      return NextResponse.json({ error: "Voce ja faz parte desta liga." }, { status: 409 });
    }

    const currentRequests = normalizeMemberRequests(currentData.memberRequests);
    const existingRequest = currentRequests.find(
      (entry) => asString(entry.userId).trim() === scope.userId
    );

    if (existingRequest) {
      return NextResponse.json({ request: existingRequest, alreadyPending: true });
    }

    const nextRequest = {
      id: crypto.randomUUID(),
      userId: scope.userId,
      nome: scope.nome,
      ...(scope.foto ? { foto: scope.foto } : {}),
      ...(scope.turma ? { turma: scope.turma } : {}),
      requestedRole,
      createdAt: nowIso(),
    } satisfies Record<string, unknown>;

    let updatePayload: Record<string, unknown> = {
      memberRequests: [...currentRequests, nextRequest],
      updatedAt: nowIso(),
    };
    updatePayload = {
      ...updatePayload,
      data: mergeLeagueCompatData(currentData, updatePayload),
    };

    while (Object.keys(updatePayload).length > 0) {
      const { error } = await supabaseAdmin
        .from("ligas_config")
        .update(updatePayload)
        .eq("id", leagueId);

      if (!error) {
        return NextResponse.json({ request: nextRequest });
      }

      const missingColumn = extractMissingSchemaColumn(error);
      if (!missingColumn) {
        return NextResponse.json({ error: error.message || "Falha ao enviar solicitacao." }, { status: 400 });
      }

      const nextPayload = removeMissingColumnFromPayload(updatePayload, missingColumn);
      if (!nextPayload) {
        return NextResponse.json({ error: error.message || "Falha ao enviar solicitacao." }, { status: 400 });
      }
      updatePayload = nextPayload;
    }

    return NextResponse.json({ error: "Falha ao enviar solicitacao." }, { status: 400 });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro ao enviar solicitacao para a liga.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
