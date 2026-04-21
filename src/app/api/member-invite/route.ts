import { NextRequest, NextResponse } from "next/server";

import {
  resolveInviteDailyWindowStartIso,
  resolveTenantInviteQuotaState,
} from "@/lib/inviteQuota";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const toPositiveInt = (value: unknown, fallback: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > max) return max;
  return normalized;
};

const buildInviteToken = (): string =>
  `m${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "")}`;

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim() || "";
    if (!token) {
      return NextResponse.json({ error: "Token de convite inválido." }, { status: 400 });
    }

    const { data: inviteRow, error: inviteError } = await supabaseAdmin
      .from("tenant_invites")
      .select(
        "id,tenant_id,token,role_to_assign,requires_approval,max_uses,uses_count,expires_at,is_active,is_revoked,revoked_at,revoked_by,created_by,created_at"
      )
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }

    if (!inviteRow) {
      return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    }

    const invite = asObject(inviteRow);
    const tenantId = asString(invite?.tenant_id).trim();

    let tenantRow: unknown = null;
    if (tenantId) {
      const { data: tenantData, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .select(
          "id,nome,sigla,slug,faculdade,cidade,curso,area,cnpj,contato_email,contato_telefone,logo_url,palette_key,visible_in_directory,allow_public_signup,status,created_at,updated_at"
        )
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantError) {
        return NextResponse.json({ error: tenantError.message }, { status: 400 });
      }

      tenantRow = tenantData;
    }

    return NextResponse.json({ invite: inviteRow, tenant: tenantRow });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao buscar convite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const {
      data: authData,
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const body = asObject(await request.json());
    const tenantId = asString(body?.tenantId).trim();
    const maxUses = 1;
    const expiresInHours = toPositiveInt(body?.expiresInHours, 72, 24 * 7);

    if (!tenantId) {
      return NextResponse.json({ error: "Tenant inválido." }, { status: 400 });
    }

    const userId = authData.user.id;
    const { data: userRow, error: userError } = await supabaseAdmin
      .from("users")
      .select("uid,tenant_id,tenant_status,role,status,extra")
      .eq("uid", userId)
      .maybeSingle();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 400 });
    }

    const userData = asObject(userRow);
    const userTenantId = asString(userData?.tenant_id).trim();
    const tenantStatus = asString(userData?.tenant_status).trim().toLowerCase();
    const accountStatus = asString(userData?.status, "ativo").trim().toLowerCase();
    const role = asString(userData?.role, "user").trim().toLowerCase();
    const quota = resolveTenantInviteQuotaState(userData?.extra, tenantId);

    if (!userTenantId || userTenantId !== tenantId || tenantStatus !== "approved") {
      return NextResponse.json(
        { error: "Seu perfil não pode gerar convite neste tenant." },
        { status: 403 }
      );
    }

    if (accountStatus === "banned" || accountStatus === "bloqueado" || role === "guest") {
      return NextResponse.json(
        { error: "Seu perfil não pode gerar convite no momento." },
        { status: 403 }
      );
    }

    const { count: todayCount, error: dailyCountError } = await supabaseAdmin
      .from("tenant_invites")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("created_by", userId)
      .gte("created_at", resolveInviteDailyWindowStartIso());
    if (dailyCountError) {
      return NextResponse.json({ error: dailyCountError.message }, { status: 400 });
    }
    if (Math.max(0, todayCount ?? 0) >= quota.totalLimit) {
      return NextResponse.json(
        {
          error:
            quota.status === "pending"
              ? "Você já usou sua cota atual. Os 5 convites extras liberam em até 1 hora."
              : `Você já atingiu o limite de ${quota.totalLimit} convites hoje. Use o pedido de mais convites para liberar novos links.`,
        },
        { status: 429 }
      );
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
    const token = buildInviteToken();
    const nowIso = new Date().toISOString();

    const { data: inviteRow, error: inviteError } = await supabaseAdmin
      .from("tenant_invites")
      .insert({
        tenant_id: tenantId,
        token,
        role_to_assign: "user",
        requires_approval: true,
        max_uses: maxUses,
        uses_count: 0,
        expires_at: expiresAt,
        is_active: true,
        created_by: userId,
        created_at: nowIso,
      })
      .select(
        "id,tenant_id,token,role_to_assign,requires_approval,max_uses,uses_count,expires_at,is_active,is_revoked,revoked_at,revoked_by,created_by,created_at"
      )
      .single();

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }

    return NextResponse.json({ invite: inviteRow });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Erro inesperado ao gerar convite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
