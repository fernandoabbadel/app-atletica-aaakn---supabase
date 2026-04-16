import { NextRequest, NextResponse } from "next/server";

import { normalizePaymentConfig, type CommercePaymentConfig } from "@/lib/commerceCatalog";
import { ensureEventTicketEntries } from "@/lib/eventTickets";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MANAGER_TENANT_ROLES = new Set([
  "master",
  "master_tenant",
  "admin_geral",
  "admin_gestor",
  "admin_tenant",
]);

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
    }

    const body = asObject(await request.json());
    const orderId = asString(body?.orderId);
    if (!orderId) {
      return NextResponse.json({ error: "Pedido invalido." }, { status: 400 });
    }

    const { data: profileRow, error: profileError } = await supabaseAdmin
      .from("users")
      .select("uid,role,tenant_id,tenant_role")
      .eq("uid", authData.user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    const profile = asObject(profileRow) ?? {};
    const requesterId = asString(profile.uid);
    const requesterRole = asString(profile.role).toLowerCase();
    const requesterTenantId = asString(profile.tenant_id);
    const requesterTenantRole = asString(profile.tenant_role).toLowerCase();
    const canManageTenant =
      requesterRole === "master" || MANAGER_TENANT_ROLES.has(requesterTenantRole);

    const { data: orderRow, error: orderError } = await supabaseAdmin
      .from("solicitacoes_ingressos")
      .select(
        "id,userId,tenant_id,status,eventoId,eventoNome,userName,userTurma,loteNome,quantidade,payment_config"
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 400 });
    }

    const order = asObject(orderRow);
    if (!order) {
      return NextResponse.json({ error: "Pedido nao encontrado." }, { status: 404 });
    }

    const orderUserId = asString(order.userId);
    const orderTenantId = asString(order.tenant_id);
    const isOwner = requesterId && requesterId === orderUserId;
    const isTenantManager = canManageTenant && requesterTenantId && requesterTenantId === orderTenantId;
    if (!isOwner && !isTenantManager && requesterRole !== "master") {
      return NextResponse.json({ error: "Sem permissao para este pedido." }, { status: 403 });
    }

    const normalizedStatus = asString(order.status).toLowerCase();
    if (normalizedStatus !== "aprovado" && normalizedStatus !== "approved") {
      return NextResponse.json(
        { error: "O ingresso so fica disponivel depois da aprovacao do pagamento." },
        { status: 400 }
      );
    }

    const paymentConfig = ensureEventTicketEntries({
      paymentConfig: normalizePaymentConfig(order.payment_config),
      orderId,
      quantity: Math.max(1, Math.floor(Number(order.quantidade || 1) || 1)),
      eventId: asString(order.eventoId),
      eventTitle: asString(order.eventoNome),
      loteName: asString(order.loteNome),
      holderName: asString(order.userName),
      holderTurma: asString(order.userTurma),
    });

    const { error: updateError } = await supabaseAdmin
      .from("solicitacoes_ingressos")
      .update({
        payment_config: paymentConfig,
      })
      .eq("id", orderId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      paymentConfig: paymentConfig satisfies CommercePaymentConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro ao preparar ingresso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
