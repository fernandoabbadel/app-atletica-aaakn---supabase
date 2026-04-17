import { NextRequest, NextResponse } from "next/server";

import { normalizePaymentConfig } from "@/lib/commerceCatalog";
import { findEventTicketEntry, parseEventTicketQrPayload } from "@/lib/eventTickets";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  LeagueAdminApiError,
  asObject,
  asString,
  getLeagueAdminAuthScope,
} from "../../ligas/_auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const scope = await getLeagueAdminAuthScope(request);
    const canScanEvents =
      scope.isPlatformMaster ||
      (scope.tenantStatus === "approved" &&
        (scope.canManageTenant || scope.tenantRole === "vendas" || scope.userRole === "vendas"));
    if (!canScanEvents) {
      throw new LeagueAdminApiError("Sem permissao para validar ingressos.", 403);
    }
    const { data: readerProfileRow } = await supabaseAdmin
      .from("users")
      .select("uid,nome,turma")
      .eq("uid", scope.userId)
      .maybeSingle();
    const readerProfile = asObject(readerProfileRow) ?? {};
    const readerName = asString(readerProfile.nome) || scope.userId;
    const readerTurma = asString(readerProfile.turma);

    const body = asObject(await request.json());
    const qrPayload = asString(body?.qrPayload);
    const selectedEventId = asString(body?.eventId);
    const manualOrderId = asString(body?.orderId);
    const manualTicketToken = asString(body?.ticketToken);
    const parsedPayload =
      parseEventTicketQrPayload(qrPayload) ||
      (manualOrderId
        ? {
            orderId: manualOrderId,
            ticketToken: manualTicketToken,
          }
        : null);
    if (!parsedPayload?.orderId) {
      throw new LeagueAdminApiError("QR code invalido para ingresso.", 400);
    }

    const { data: orderRow, error: orderError } = await supabaseAdmin
      .from("solicitacoes_ingressos")
      .select("id,tenant_id,eventoId,eventoNome,userName,userTurma,status,payment_config")
      .eq("id", parsedPayload.orderId)
      .maybeSingle();
    if (orderError) {
      throw new LeagueAdminApiError(orderError.message, 400);
    }

    const order = asObject(orderRow);
    if (!order) {
      throw new LeagueAdminApiError("Pedido do ingresso nao encontrado.", 404);
    }

    const orderTenantId = asString(order.tenant_id);
    const eventId = asString(order.eventoId);
    if (selectedEventId && selectedEventId !== eventId) {
      throw new LeagueAdminApiError("Esse ingresso pertence a outro evento.", 400);
    }
    if (!scope.isPlatformMaster && scope.userTenantId !== orderTenantId) {
      throw new LeagueAdminApiError("Ingresso fora do tenant ativo.", 403);
    }
    if (!["aprovado", "approved", "pago", "paid", "entregue", "presente"].includes(asString(order.status).toLowerCase())) {
      throw new LeagueAdminApiError("Pagamento ainda nao aprovado para check-in.", 400);
    }

    const paymentConfig = normalizePaymentConfig(order.payment_config);
    const ticketEntry = parsedPayload.ticketToken
      ? findEventTicketEntry(paymentConfig, parsedPayload.ticketToken)
      : paymentConfig?.ticketEntries?.find((entry) => entry.status !== "lido") ||
        paymentConfig?.ticketEntries?.[0] ||
        null;
    if (!ticketEntry || !paymentConfig?.ticketEntries) {
      throw new LeagueAdminApiError("Ingresso nao encontrado para esse QR code.", 404);
    }

    const alreadyScanned = ticketEntry.status === "lido";
    const scannedAt = new Date().toISOString();
    const nextTicketEntries = paymentConfig.ticketEntries.map((entry) =>
      entry.token === ticketEntry.token
        ? {
            ...entry,
            status: "lido" as const,
            scannedAt: entry.scannedAt || scannedAt,
            scannedByUserId: entry.scannedByUserId || scope.userId,
            scannedByUserName: entry.scannedByUserName || readerName,
            scannedByUserTurma: entry.scannedByUserTurma || readerTurma,
          }
        : entry
    );

    const { error: updateError } = await supabaseAdmin
      .from("solicitacoes_ingressos")
      .update({
        payment_config: {
          ...paymentConfig,
          ticketEntries: nextTicketEntries,
        },
      })
      .eq("id", parsedPayload.orderId);
    if (updateError) {
      throw new LeagueAdminApiError(updateError.message, 400);
    }

    const updatedEntry = nextTicketEntries.find((entry) => entry.token === ticketEntry.token);
    return NextResponse.json({
      ok: true,
      alreadyScanned,
      orderId: parsedPayload.orderId,
      eventId,
      eventTitle: asString(order.eventoNome),
      holderName: asString(updatedEntry?.holderName || order.userName),
      holderTurma: asString(updatedEntry?.holderTurma || order.userTurma),
      ticketLabel: asString(updatedEntry?.label),
      scannedAt: asString(updatedEntry?.scannedAt || scannedAt),
      status: "lido",
    });
  } catch (error: unknown) {
    if (error instanceof LeagueAdminApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Erro ao validar ingresso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
