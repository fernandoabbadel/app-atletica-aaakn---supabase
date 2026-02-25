"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Loader2,
  RotateCcw,
  Users,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import {
  fetchEventTitleById,
  fetchAdminEventRsvpsPage,
  fetchAdminEventSalesPage,
  setAdminTicketPayment,
} from "@/lib/eventsNativeService";

interface RsvpItem {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "maybe";
}

interface SaleItem {
  id: string;
  userId: string;
  userName: string;
  userTurma: string;
  status: "aprovado" | "pendente" | "analise";
  loteNome: string;
  quantidade: number;
  valorTotal: string;
  dataAprovacao?: unknown;
  aprovadoPor?: string;
}

interface MergedParticipant {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  rsvpStatus: "going" | "maybe";
  pagamento: "pago" | "pendente" | "analise";
  lote: string;
  quantidade: number;
  valorTotal: string;
  dataAprovacao?: unknown;
  aprovadoPor?: string;
  ticketRequestId?: string;
}

const PAGE_SIZE = 10;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseDateTime = (value: unknown): string => {
  if (!value) return "-";
  if (value instanceof Date) return value.toLocaleString("pt-BR");

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("pt-BR");
    }
  }

  if (typeof value === "object" && value !== null) {
    const candidate = (value as { toDate?: unknown }).toDate;
    if (typeof candidate === "function") {
      const parsed = candidate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString("pt-BR");
      }
    }
  }

  return "-";
};

const normalizeRsvp = (raw: Record<string, unknown>): RsvpItem | null => {
  const userId = asString(raw.userId).trim();
  if (!userId) return null;

  const statusRaw = asString(raw.status, "maybe").toLowerCase();
  const status: "going" | "maybe" = statusRaw === "going" ? "going" : "maybe";

  return {
    id: asString(raw.id, userId),
    userId,
    userName: asString(raw.userName, "Aluno"),
    userAvatar: asString(raw.userAvatar),
    userTurma: asString(raw.userTurma, "-"),
    status,
  };
};

const normalizeSale = (raw: Record<string, unknown>): SaleItem | null => {
  const id = asString(raw.id).trim();
  const userId = asString(raw.userId).trim();
  if (!id || !userId) return null;

  const statusRaw = asString(raw.status, "pendente").toLowerCase();
  const status: SaleItem["status"] =
    statusRaw === "aprovado"
      ? "aprovado"
      : statusRaw === "analise"
      ? "analise"
      : "pendente";

  return {
    id,
    userId,
    userName: asString(raw.userName, "Aluno"),
    userTurma: asString(raw.userTurma, "-"),
    status,
    loteNome: asString(raw.loteNome, "-"),
    quantidade: Math.max(1, asNumber(raw.quantidade, 1)),
    valorTotal: asString(raw.valorTotal, "0"),
    dataAprovacao: raw.dataAprovacao,
    aprovadoPor: asString(raw.aprovadoPor),
  };
};

const mergeUniqueById = <T extends { id: string }>(current: T[], next: T[]): T[] => {
  if (!next.length) return current;

  const known = new Set(current.map((row) => row.id));
  const merged = [...current];
  next.forEach((row) => {
    if (known.has(row.id)) return;
    known.add(row.id);
    merged.push(row);
  });
  return merged;
};

export default function AdminEventoListaPage() {
  const params = useParams<{ id: string }>();
  const eventId = params?.id?.trim() || "";

  const { user } = useAuth();
  const { addToast } = useToast();

  const [eventTitle, setEventTitle] = useState("Evento");
  const [loading, setLoading] = useState(true);

  const [rsvps, setRsvps] = useState<RsvpItem[]>([]);
  const [sales, setSales] = useState<SaleItem[]>([]);

  const [rsvpsCursor, setRsvpsCursor] = useState<string | null>(null);
  const [salesCursor, setSalesCursor] = useState<string | null>(null);
  const [hasMoreRsvps, setHasMoreRsvps] = useState(false);
  const [hasMoreSales, setHasMoreSales] = useState(false);

  const [loadingMoreRsvps, setLoadingMoreRsvps] = useState(false);
  const [loadingMoreSales, setLoadingMoreSales] = useState(false);

  const loadHeader = useCallback(async () => {
    if (!eventId) return;
    const title = await fetchEventTitleById(eventId);
    if (title) setEventTitle(asString(title, "Evento"));
  }, [eventId]);

  const loadInitial = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const [rsvpPage, salesPage] = await Promise.all([
        fetchAdminEventRsvpsPage({
          eventId,
          pageSize: PAGE_SIZE,
          forceRefresh: false,
        }),
        fetchAdminEventSalesPage({
          eventId,
          pageSize: PAGE_SIZE,
          forceRefresh: false,
        }),
      ]);

      setRsvps(
        rsvpPage.rows
          .map((row) => normalizeRsvp(row))
          .filter((row): row is RsvpItem => row !== null)
      );
      setSales(
        salesPage.rows
          .map((row) => normalizeSale(row))
          .filter((row): row is SaleItem => row !== null)
      );

      setRsvpsCursor(rsvpPage.nextCursor);
      setSalesCursor(salesPage.nextCursor);
      setHasMoreRsvps(rsvpPage.hasMore);
      setHasMoreSales(salesPage.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar lista de presenca.", "error");
    } finally {
      setLoading(false);
    }
  }, [eventId, addToast]);

  useEffect(() => {
    void loadHeader();
    void loadInitial();
  }, [loadHeader, loadInitial]);

  const mergedRows = useMemo<MergedParticipant[]>(() => {
    const byUser = new Map<string, MergedParticipant>();

    rsvps.forEach((row) => {
      byUser.set(row.userId, {
        id: row.id,
        userId: row.userId,
        userName: row.userName,
        userAvatar: row.userAvatar,
        userTurma: row.userTurma,
        rsvpStatus: row.status,
        pagamento: "pendente",
        lote: "-",
        quantidade: 1,
        valorTotal: "-",
      });
    });

    sales.forEach((sale) => {
      const existing = byUser.get(sale.userId);
      byUser.set(sale.userId, {
        id: existing?.id || sale.id,
        userId: sale.userId,
        userName: sale.userName || existing?.userName || "Aluno",
        userAvatar: existing?.userAvatar || "",
        userTurma: sale.userTurma || existing?.userTurma || "-",
        rsvpStatus: "going",
        pagamento: sale.status === "aprovado" ? "pago" : sale.status,
        lote: sale.loteNome || "-",
        quantidade: sale.quantidade || 1,
        valorTotal: sale.valorTotal || "-",
        dataAprovacao: sale.dataAprovacao,
        aprovadoPor: sale.aprovadoPor,
        ticketRequestId: sale.id,
      });
    });

    return Array.from(byUser.values()).sort((a, b) =>
      a.userName.localeCompare(b.userName, "pt-BR")
    );
  }, [rsvps, sales]);

  const handleLoadMoreRsvps = async () => {
    if (!eventId || !hasMoreRsvps || !rsvpsCursor || loadingMoreRsvps) return;

    setLoadingMoreRsvps(true);
    try {
      const page = await fetchAdminEventRsvpsPage({
        eventId,
        pageSize: PAGE_SIZE,
        cursorId: rsvpsCursor,
        forceRefresh: false,
      });

      const normalized = page.rows
        .map((row) => normalizeRsvp(row))
        .filter((row): row is RsvpItem => row !== null);

      setRsvps((prev) => mergeUniqueById(prev, normalized));
      setRsvpsCursor(page.nextCursor);
      setHasMoreRsvps(page.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar mais RSVP.", "error");
    } finally {
      setLoadingMoreRsvps(false);
    }
  };

  const handleLoadMoreSales = async () => {
    if (!eventId || !hasMoreSales || !salesCursor || loadingMoreSales) return;

    setLoadingMoreSales(true);
    try {
      const page = await fetchAdminEventSalesPage({
        eventId,
        pageSize: PAGE_SIZE,
        cursorId: salesCursor,
        forceRefresh: false,
      });

      const normalized = page.rows
        .map((row) => normalizeSale(row))
        .filter((row): row is SaleItem => row !== null);

      setSales((prev) => mergeUniqueById(prev, normalized));
      setSalesCursor(page.nextCursor);
      setHasMoreSales(page.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar mais vendas.", "error");
    } finally {
      setLoadingMoreSales(false);
    }
  };

  const handleTogglePayment = async (row: MergedParticipant) => {
    if (!row.ticketRequestId) return;

    const isApproving = row.pagamento !== "pago";
    try {
      await setAdminTicketPayment({
        ticketRequestId: row.ticketRequestId,
        isApproving,
        approvedBy: user?.nome || "Admin",
      });

      setSales((prev) =>
        prev.map((sale) => {
          if (sale.id !== row.ticketRequestId) return sale;
          return {
            ...sale,
            status: isApproving ? "aprovado" : "pendente",
            dataAprovacao: isApproving ? new Date() : null,
            aprovadoPor: isApproving ? user?.nome || "Admin" : "",
          };
        })
      );
      addToast(isApproving ? "Pagamento aprovado." : "Pagamento reaberto.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar pagamento.", "error");
    }
  };

  const handleExportCsv = () => {
    if (!mergedRows.length) return;

    const headers = [
      "Nome",
      "Turma",
      "RSVP",
      "Pagamento",
      "Lote",
      "Quantidade",
      "Valor",
      "Data Aprovacao",
      "Aprovado Por",
    ];

    const rows = mergedRows.map((row) => [
      row.userName,
      row.userTurma,
      row.rsvpStatus,
      row.pagamento,
      row.lote,
      String(row.quantidade),
      row.valorTotal,
      parseDateTime(row.dataAprovacao),
      row.aprovadoPor || "-",
    ]);

    const csvContent = [headers.join(","), ...rows.map((line) => line.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lista_evento_${eventId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/eventos"
              className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                <Users size={18} className="text-emerald-400" /> Lista de Presenca
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">{eventTitle}</p>
            </div>
          </div>
          <button
            onClick={handleExportCsv}
            className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-xs font-black uppercase flex items-center gap-2"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <div className="text-xs text-zinc-500 uppercase font-black">
          RSVP carregados: {rsvps.length} � Vendas carregadas: {sales.length}
        </div>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                <tr>
                  <th className="p-4">Usuario</th>
                  <th className="p-4">Turma</th>
                  <th className="p-4">RSVP</th>
                  <th className="p-4">Pagamento</th>
                  <th className="p-4">Lote</th>
                  <th className="p-4">Valor</th>
                  <th className="p-4">Aprovacao</th>
                  <th className="p-4 text-right">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : mergedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-500">
                      Nenhum participante encontrado.
                    </td>
                  </tr>
                ) : (
                  mergedRows.map((row) => (
                    <tr key={`${row.userId}:${row.id}`} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="relative w-7 h-7 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800">
                            <Image
                              src={row.userAvatar || "https://github.com/shadcn.png"}
                              alt={row.userName}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                          <Link
                            href={`/admin/usuarios/${row.userId}`}
                            className="font-bold text-white hover:text-emerald-400"
                            target="_blank"
                          >
                            {row.userName}
                          </Link>
                        </div>
                      </td>
                      <td className="p-4">{row.userTurma || "-"}</td>
                      <td className="p-4 uppercase font-black text-[10px]">
                        {row.rsvpStatus === "going" ? "Vou" : "Talvez"}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${
                            row.pagamento === "pago"
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                              : row.pagamento === "analise"
                              ? "bg-yellow-500/10 text-yellow-300 border-yellow-500/30"
                              : "bg-zinc-800 text-zinc-400 border-zinc-700"
                          }`}
                        >
                          {row.pagamento}
                        </span>
                      </td>
                      <td className="p-4">{row.lote || "-"}</td>
                      <td className="p-4">{row.valorTotal || "-"}</td>
                      <td className="p-4 text-zinc-400">
                        {row.aprovadoPor ? `${parseDateTime(row.dataAprovacao)} � ${row.aprovadoPor}` : "-"}
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end">
                          {row.ticketRequestId ? (
                            <button
                              onClick={() => void handleTogglePayment(row)}
                              className={`p-2 rounded-lg border ${
                                row.pagamento === "pago"
                                  ? "bg-zinc-900 text-zinc-300 border-zinc-700"
                                  : "bg-emerald-600 text-white border-emerald-500"
                              }`}
                              title={
                                row.pagamento === "pago"
                                  ? "Desfazer aprovacao"
                                  : "Aprovar pagamento"
                              }
                            >
                              {row.pagamento === "pago" ? (
                                <RotateCcw size={14} />
                              ) : (
                                <Check size={14} />
                              )}
                            </button>
                          ) : (
                            <span className="text-zinc-600 text-[10px]">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => void handleLoadMoreRsvps()}
            disabled={!hasMoreRsvps || loadingMoreRsvps}
            className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loadingMoreRsvps ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando RSVP
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais RSVP (10)
              </>
            )}
          </button>

          <button
            onClick={() => void handleLoadMoreSales()}
            disabled={!hasMoreSales || loadingMoreSales}
            className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loadingMoreSales ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando vendas
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais vendas (10)
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}


