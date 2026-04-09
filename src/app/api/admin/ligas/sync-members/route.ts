import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const MANAGER_TENANT_ROLES = new Set([
  "master",
  "master_tenant",
  "admin_geral",
  "admin_gestor",
  "admin_tenant",
]);

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

type AuthScope = {
  userId: string;
  userRole: string;
  tenantRole: string;
  tenantStatus: string;
  userTenantId: string;
  isPlatformMaster: boolean;
  canManageTenant: boolean;
};

const getAuthScope = async (request: NextRequest): Promise<AuthScope> => {
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
    .select("uid,role,tenant_id,tenant_role,tenant_status")
    .eq("uid", authData.user.id)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message || "Falha ao carregar perfil.");
  }

  const raw = asObject(userRow);
  const userId = asString(raw?.uid).trim();
  const userRole = asString(raw?.role).trim().toLowerCase();
  const tenantRole = asString(raw?.tenant_role).trim().toLowerCase();
  const tenantStatus = asString(raw?.tenant_status).trim().toLowerCase();
  const userTenantId = asString(raw?.tenant_id).trim();
  const isPlatformMaster = userRole === "master";
  const canManageTenant = isPlatformMaster || MANAGER_TENANT_ROLES.has(tenantRole);

  if (!userId) {
    throw new Error("Perfil do usuario invalido.");
  }

  return {
    userId,
    userRole,
    tenantRole,
    tenantStatus,
    userTenantId,
    isPlatformMaster,
    canManageTenant,
  };
};

const normalizeMembers = (value: unknown): Array<{ userId: string; cargo: string }> => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: Array<{ userId: string; cargo: string }> = [];

  for (const entry of value) {
    const raw = asObject(entry);
    const userId = asString(raw?.id).trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);

    normalized.push({
      userId,
      cargo: asString(raw?.cargo, "Membro").trim().slice(0, 80) || "Membro",
    });
  }

  return normalized;
};

export async function POST(request: NextRequest) {
  try {
    const scope = await getAuthScope(request);
    const body = asObject(await request.json());
    const leagueId = asString(body?.leagueId).trim();
    const requestedTenantId = asString(body?.tenantId).trim();
    const nextMembers = normalizeMembers(body?.members);

    if (!leagueId) {
      return NextResponse.json({ error: "Liga invalida." }, { status: 400 });
    }

    if (!scope.isPlatformMaster) {
      if (!scope.canManageTenant || scope.tenantStatus !== "approved" || !scope.userTenantId) {
        return NextResponse.json({ error: "Sem permissao para gerenciar esta liga." }, { status: 403 });
      }
      if (requestedTenantId && requestedTenantId !== scope.userTenantId) {
        return NextResponse.json({ error: "Tenant informado nao corresponde ao seu perfil." }, { status: 403 });
      }
    }

    const { data: leagueRow, error: leagueError } = await supabaseAdmin
      .from("ligas_config")
      .select("id,tenant_id")
      .eq("id", leagueId)
      .maybeSingle();

    if (leagueError) {
      return NextResponse.json({ error: leagueError.message }, { status: 400 });
    }

    const rawLeague = asObject(leagueRow);
    if (!rawLeague) {
      return NextResponse.json({ error: "Liga nao encontrada." }, { status: 404 });
    }

    const leagueTenantId = asString(rawLeague.tenant_id).trim();
    const effectiveTenantId = requestedTenantId || leagueTenantId || scope.userTenantId;

    if (!effectiveTenantId) {
      return NextResponse.json(
        { error: "Nao foi possivel determinar o tenant da liga." },
        { status: 400 }
      );
    }

    if (!scope.isPlatformMaster && scope.userTenantId !== effectiveTenantId) {
      return NextResponse.json({ error: "Liga fora do seu tenant." }, { status: 403 });
    }

    if (leagueTenantId && leagueTenantId !== effectiveTenantId) {
      return NextResponse.json(
        { error: "O tenant informado nao confere com a liga selecionada." },
        { status: 403 }
      );
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("ligas_membros")
      .select("id,userId,cargo,tenant_id")
      .eq("ligaId", leagueId);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const existingByUserId = new Map(
      (Array.isArray(existingRows) ? existingRows : [])
        .map((row) => {
          const raw = asObject(row);
          const userId = asString(raw?.userId).trim();
          return userId ? [userId, raw ?? {}] : null;
        })
        .filter(
          (entry): entry is [string, Record<string, unknown>] =>
            Array.isArray(entry) && entry.length === 2
        )
    );

    const nextMemberIds = nextMembers.map((member) => member.userId);
    const membersToInsert = nextMembers.filter((member) => !existingByUserId.has(member.userId));
    const membersToUpdate = nextMembers.filter((member) => {
      const current = existingByUserId.get(member.userId);
      const currentCargo = asString(current?.cargo, "Membro").trim().slice(0, 80) || "Membro";
      return Boolean(current) && currentCargo !== member.cargo;
    });
    const removedMemberIds = Array.from(existingByUserId.keys()).filter(
      (memberId) => !nextMemberIds.includes(memberId)
    );

    if (membersToInsert.length > 0) {
      const insertIds = membersToInsert.map((member) => member.userId);
      const { data: usersData, error: usersError } = await supabaseAdmin
        .from("users")
        .select("uid,tenant_id,tenant_status")
        .in("uid", insertIds);

      if (usersError) {
        return NextResponse.json({ error: usersError.message }, { status: 400 });
      }

      const usersById = new Map(
        (Array.isArray(usersData) ? usersData : [])
          .map((row) => {
            const raw = asObject(row);
            const userId = asString(raw?.uid).trim();
            return userId ? [userId, raw ?? {}] : null;
          })
          .filter(
            (entry): entry is [string, Record<string, unknown>] =>
              Array.isArray(entry) && entry.length === 2
          )
      );

      const invalidMembers = membersToInsert
        .map((member) => {
          const user = usersById.get(member.userId);
          const userTenantId = asString(user?.tenant_id).trim();
          const userTenantStatus = asString(user?.tenant_status).trim().toLowerCase();
          if (!user || userTenantId !== effectiveTenantId || userTenantStatus !== "approved") {
            return member.userId;
          }
          return "";
        })
        .filter((value) => value.length > 0);

      if (invalidMembers.length > 0) {
        return NextResponse.json(
          {
            error:
              "Alguns membros selecionados nao pertencem ao tenant ativo ou ainda nao foram aprovados.",
            invalidUserIds: invalidMembers,
          },
          { status: 400 }
        );
      }

      const nowIso = new Date().toISOString();
      const { error: insertError } = await supabaseAdmin.from("ligas_membros").insert(
        membersToInsert.map((member) => ({
          ligaId: leagueId,
          userId: member.userId,
          cargo: member.cargo,
          tenant_id: effectiveTenantId,
          joinedAt: nowIso,
        }))
      );

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }
    }

    for (const member of membersToUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("ligas_membros")
        .update({
          cargo: member.cargo,
          tenant_id: effectiveTenantId,
        })
        .eq("ligaId", leagueId)
        .eq("userId", member.userId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }
    }

    if (removedMemberIds.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from("ligas_membros")
        .delete()
        .eq("ligaId", leagueId)
        .in("userId", removedMemberIds);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 400 });
      }
    }

    const leaguePatch: Record<string, unknown> = {
      membersCount: nextMembers.length,
      updatedAt: new Date().toISOString(),
    };
    if (!leagueTenantId) {
      leaguePatch.tenant_id = effectiveTenantId;
    }

    const { error: leagueUpdateError } = await supabaseAdmin
      .from("ligas_config")
      .update(leaguePatch)
      .eq("id", leagueId);

    if (leagueUpdateError) {
      return NextResponse.json({ error: leagueUpdateError.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      inserted: membersToInsert.length,
      updated: membersToUpdate.length,
      deleted: removedMemberIds.length,
      membersCount: nextMembers.length,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao sincronizar membros da liga.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
