import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type UserRow = {
  uid?: string | null;
  nome?: string | null;
  foto?: string | null;
  turma?: string | null;
  tenant_id?: string | null;
  stats?: unknown;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const cleanText = (value: unknown, fallback = ""): string =>
  asString(value, fallback).trim();

const getBearerToken = (request: Request): string => {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const jsonError = (message: string, status: number) =>
  NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );

const isMissingSchemaColumn = (error: unknown, column: string): boolean => {
  const raw = asObject(error);
  const message = [raw?.message, raw?.details, raw?.hint]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .join(" ")
    .toLowerCase();
  return message.includes("could not find") && message.includes(column.toLowerCase());
};

const countRows = async (
  table: "users_followers" | "users_following",
  userId: string,
  tenantId: string
): Promise<number> => {
  let query = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("userId", userId);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
};

const userSummary = (row: UserRow, fallback: Record<string, unknown>) => ({
  uid: cleanText(row.uid, cleanText(fallback.uid)),
  nome: cleanText(row.nome, cleanText(fallback.nome, "Atleta")).slice(0, 120) || "Atleta",
  foto: cleanText(row.foto, cleanText(fallback.foto)),
  turma: cleanText(row.turma, cleanText(fallback.turma, "Geral")).slice(0, 40) || "Geral",
});

export async function POST(request: Request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return jsonError("Sessão ausente para seguir perfil.", 401);
  }

  const body = asObject(await request.json().catch(() => null));
  if (!body) {
    return jsonError("Payload inválido.", 400);
  }

  const viewerUid = cleanText(body.viewerUid);
  const targetUid = cleanText(body.targetUid);
  const tenantIdFromClient = cleanText(body.tenantId);
  const currentlyFollowing = asBoolean(body.currentlyFollowing, false);
  const viewerData = asObject(body.viewerData) ?? {};
  const targetData = asObject(body.targetData) ?? {};

  if (!viewerUid || !targetUid || viewerUid === targetUid) {
    return jsonError("Relação de follow inválida.", 400);
  }

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    const authUid = cleanText(authData.user?.id);
    if (authError || !authUid) {
      return jsonError("Sessão inválida para seguir perfil.", 401);
    }

    if (authUid !== viewerUid) {
      return jsonError("Sem permissão para seguir por outro usuário.", 403);
    }

    const [viewerUserRes, targetUserRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("uid,nome,foto,turma,tenant_id,stats")
        .eq("uid", viewerUid)
        .maybeSingle(),
      supabaseAdmin
        .from("users")
        .select("uid,nome,foto,turma,tenant_id,stats")
        .eq("uid", targetUid)
        .maybeSingle(),
    ]);

    if (viewerUserRes.error) throw viewerUserRes.error;
    if (targetUserRes.error) throw targetUserRes.error;
    if (!viewerUserRes.data || !targetUserRes.data) {
      return jsonError("Usuário não encontrado para follow.", 404);
    }

    const viewerRow = viewerUserRes.data as UserRow;
    const targetRow = targetUserRes.data as UserRow;
    const effectiveTenantId = tenantIdFromClient || cleanText(viewerRow.tenant_id);

    if (
      effectiveTenantId &&
      (cleanText(viewerRow.tenant_id) !== effectiveTenantId ||
        cleanText(targetRow.tenant_id) !== effectiveTenantId)
    ) {
      return jsonError("Não é permitido seguir usuários de outra atlética.", 403);
    }

    const viewer = userSummary(viewerRow, viewerData);
    const target = userSummary(targetRow, targetData);
    const followedAt = new Date().toISOString();

    if (currentlyFollowing) {
      const [followersDelete, followingDelete] = await Promise.all([
        supabaseAdmin
          .from("users_followers")
          .delete()
          .eq("userId", targetUid)
          .eq("uid", viewerUid),
        supabaseAdmin
          .from("users_following")
          .delete()
          .eq("userId", viewerUid)
          .eq("uid", targetUid),
      ]);
      if (followersDelete.error) throw followersDelete.error;
      if (followingDelete.error) throw followingDelete.error;
    } else {
      const [followersUpsert, followingUpsert] = await Promise.all([
        supabaseAdmin.from("users_followers").upsert(
          {
            userId: targetUid,
            uid: viewerUid,
            nome: viewer.nome,
            foto: viewer.foto,
            turma: viewer.turma,
            followedAt,
            ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}),
          },
          { onConflict: "userId,uid" }
        ),
        supabaseAdmin.from("users_following").upsert(
          {
            userId: viewerUid,
            uid: targetUid,
            nome: target.nome,
            foto: target.foto,
            turma: target.turma,
            followedAt,
            ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}),
          },
          { onConflict: "userId,uid" }
        ),
      ]);
      if (followersUpsert.error) throw followersUpsert.error;
      if (followingUpsert.error) throw followingUpsert.error;

      const notificationPayload = {
        userId: targetUid,
        title: "Novo Seguidor!",
        message: `${viewer.nome} começou a te seguir.`,
        link: `/perfil/${viewerUid}`,
        read: false,
        type: "social",
        createdAt: followedAt,
        updatedAt: followedAt,
        ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}),
      };
      const notification = await supabaseAdmin.from("notifications").insert(notificationPayload);
      if (notification.error && effectiveTenantId && isMissingSchemaColumn(notification.error, "tenant_id")) {
        const legacyNotificationPayload: Record<string, unknown> = { ...notificationPayload };
        delete legacyNotificationPayload.tenant_id;
        await supabaseAdmin.from("notifications").insert(legacyNotificationPayload);
      }
    }

    const [followersCount, followingCount] = await Promise.all([
      countRows("users_followers", targetUid, effectiveTenantId),
      countRows("users_following", viewerUid, effectiveTenantId),
    ]);

    const targetStats = asObject(targetRow.stats) ?? {};
    const viewerStats = asObject(viewerRow.stats) ?? {};
    const [targetStatsUpdate, viewerStatsUpdate] = await Promise.all([
      supabaseAdmin
        .from("users")
        .update({
          stats: { ...targetStats, followersCount },
          updatedAt: followedAt,
        })
        .eq("uid", targetUid),
      supabaseAdmin
        .from("users")
        .update({
          stats: { ...viewerStats, followingCount },
          updatedAt: followedAt,
        })
        .eq("uid", viewerUid),
    ]);
    if (targetStatsUpdate.error) throw targetStatsUpdate.error;
    if (viewerStatsUpdate.error) throw viewerStatsUpdate.error;

    return NextResponse.json(
      {
        isFollowing: !currentlyFollowing,
        followersCount,
        followingCount,
      },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  } catch (error) {
    console.error("Erro no follow server-side:", error);
    return jsonError("Falha ao seguir perfil.", 500);
  }
}
