"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Loader2,
  QrCode,
  RotateCcw,
  Users,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { logActivity } from "@/lib/logger";
import {
  fetchEventTitleById,
  fetchAdminEventPresencePage,
  incrementEventPurchaseUserStats,
  setAdminTicketPayment,
} from "@/lib/eventsNativeService";

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

const PAGE_SIZE = 20;
const ALPHA_GROUPS = [
  { id: "todos", label: "Todos", test: () => true },
  { id: "ad", label: "A-D", test: (value: string) => /^[A-D]/i.test(value) },
  { id: "ej", label: "E-J", test: (value: string) => /^[E-J]/i.test(value) },
  { id: "ko", label: "K-O", test: (value: string) => /^[K-O]/i.test(value) },
  { id: "pr", label: "P-R", test: (value: string) => /^[P-R]/i.test(value) },
  { id: "sz", label: "S-Z", test: (value: string) => /^[S-Z]/i.test(value) },
];

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

const parseCurrency = (value: string): number => {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeMergedParticipant = (raw: Record<string, unknown>): MergedParticipant | null => {
  const userId = asString(raw.userId).trim();
  if (!userId) return null;

  const rsvpStatusRaw = asString(raw.rsvpStatus, "maybe").toLowerCase();
  const rsvpStatus: "going" | "maybe" = rsvpStatusRaw === "going" ? "going" : "maybe";

  const pagamentoRaw = asString(raw.pagamento, "pendente").toLowerCase();
  const pagamento: "pago" | "pendente" | "analise" =
    pagamentoRaw === "pago"
      ? "pago"
      : pagamentoRaw === "analise"
      ? "analise"
      : "pendente";

  return {
    id: asString(raw.id, userId),
    userId,
    userName: asString(raw.userName, "Aluno"),
    userAvatar: asString(raw.userAvatar),
    userTurma: asString(raw.userTurma, "-"),
    rsvpStatus,
    pagamento,
    lote: asString(raw.lote, "-"),
    quantidade: Math.max(1, asNumber(raw.quantidade, 1)),
    valorTotal: asString(raw.valorTotal, "-"),
    dataAprovacao: raw.dataAprovacao,
    aprovadoPor: asString(raw.aprovadoPor),
    ticketRequestId: asString(raw.ticketRequestId) || undefined,
  };
};

const buildPresenceRowKey = (row: MergedParticipant): string =>
  row.ticketRequestId?.trim() || row.id.trim() || `${row.userId}:${row.userName}:${row.lote}:${row.valorTotal}`;

const mergeUniquePresenceRows = (
  current: MergedParticipant[],
  next: MergedParticipant[]
): MergedParticipant[] => {
  if (!next.length) return current;
  const known = new Set(current.map((row) => buildPresenceRowKey(row)));
  const merged = [...current];
  next.forEach((row) => {
    const key = buildPresenceRowKey(row);
    if (known.has(key)) return;
    known.add(key);
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

  const [rows, setRows] = useState<MergedParticipant[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [alphaGroup, setAlphaGroup] = useState("todos");
  const [page, setPage] = useState(1);

  const filteredRows = React.useMemo(() => {
    const selected = ALPHA_GROUPS.find((entry) => entry.id === alphaGroup) ?? ALPHA_GROUPS[0];
    return rows.filter((row) => selected.test(row.userName.trim()));
  }, [alphaGroup, rows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [alphaGroup]);

  const loadHeader = useCallback(async () => {
    if (!eventId) return;
    const title = await fetchEventTitleById(eventId);
    if (title) setEventTitle(asString(title, "Evento"));
  }, [eventId]);

  const loadInitial = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const page = await fetchAdminEventPresencePage({
        eventId,
        pageSize: PAGE_SIZE,
        forceRefresh: false,
      });

      const normalized = page.rows
        .map((row) => normalizeMergedParticipant(row))
        .filter((row): row is MergedParticipant => row !== null);

      setRows(normalized);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar lista de presença.", "error");
    } finally {
      setLoading(false);
    }
  }, [eventId, addToast]);

  useEffect(() => {
    void loadHeader();
    void loadInitial();
  }, [loadHeader, loadInitial]);

  const handleLoadMore = async () => {
    if (!eventId || !hasMore || !cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await fetchAdminEventPresencePage({
        eventId,
        pageSize: PAGE_SIZE,
        cursorId: cursor,
        forceRefresh: false,
      });

      const normalized = page.rows
        .map((row) => normalizeMergedParticipant(row))
        .filter((row): row is MergedParticipant => row !== null);

      setRows((prev) => mergeUniquePresenceRows(prev, normalized));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar mais participantes.", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTogglePayment = async (row: MergedParticipant) => {
    if (!row.ticketRequestId) return;

    const isApproving = row.pagamento !== "pago";
    const amount = parseCurrency(row.valorTotal || "0");
    try {
      await setAdminTicketPayment({
        ticketRequestId: row.ticketRequestId,
        isApproving,
        approvedBy: user?.nome || "Admin",
      });

      if (row.userId && Number.isFinite(amount)) {
        await incrementEventPurchaseUserStats({
          userId: row.userId,
          isApproving,
          valorGasto: amount,
          lotName: row.lote,
          eventTitle,
        });
      }

      setRows((prev) =>
        prev.map((entry) => {
          if (entry.ticketRequestId !== row.ticketRequestId) return entry;
          return {
            ...entry,
            pagamento: isApproving ? "pago" : "pendente",
            dataAprovacao: isApproving ? new Date() : null,
            aprovadoPor: isApproving ? user?.nome || "Admin" : "",
          };
        })
      );

      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Eventos/Pagamentos",
          `${isApproving ? "Aprovou" : "Rejeitou"} comprovante de ${row.userName} (${eventTitle})`
        ).catch(() => {});
      }
      addToast(isApproving ? "Pagamento aprovado." : "Pagamento reaberto.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar pagamento.", "error");
    }
  };

  const handleExportCsv = () => {
    if (!rows.length) return;

    const headers = [
      "Nome",
      "Turma",
      "RSVP",
      "Pagamento",
      "Lote",
      "Quantidade",
      "Valor",
      "Data Aprovação",
      "Aprovado Por",
    ];

    const csvRows = rows.map((row) => [
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

    const csvContent = [headers.join(","), ...csvRows.map((line) => line.join(","))].join("\n");
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
                <Users size={18} className="text-emerald-400" /> Lista de Presença
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
          <Link
            href={`/admin/eventos/scan/${eventId}`}
            className="px-3 py-2 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 text-xs font-black uppercase flex items-center gap-2"
          >
            <QrCode size={14} /> Scan Eventos
          </Link>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <div className="text-xs text-zinc-500 uppercase font-black">
          Participantes carregados: {rows.length}
        </div>
        <div className="flex flex-wrap gap-2">
          {ALPHA_GROUPS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setAlphaGroup(entry.id)}
              className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                alphaGroup === entry.id
                  ? "border-emerald-400 bg-emerald-500 text-black"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                <tr>
                  <th className="p-4">Usuário</th>
                  <th className="p-4">Turma</th>
                  <th className="p-4">RSVP</th>
                  <th className="p-4">Pagamento</th>
                  <th className="p-4">Lote</th>
                  <th className="p-4">Valor</th>
                  <th className="p-4">Aprovação</th>
                  <th className="p-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-500">
                      Nenhum participante encontrado.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr key={buildPresenceRowKey(row)} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="relative w-7 h-7 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800">
                            <Image
                              src={row.userAvatar || "https://github.com/shadcn.png"}
                              alt={row.userName}
                              fill
                              className="object-cover"
                              
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
                        {row.aprovadoPor ? `${parseDateTime(row.dataAprovacao)} - ${row.aprovadoPor}` : "-"}
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
                              title={row.pagamento === "pago" ? "Desfazer aprovação" : "Aprovar pagamento"}
                            >
                              {row.pagamento === "pago" ? <RotateCcw size={14} /> : <Check size={14} />}
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

        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
            <span>Página {page} de {totalPages} - {filteredRows.length} registros</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-40">Anterior</button>
              <button disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-40">Próxima</button>
            </div>
          </div>
          <button
            onClick={() => void handleLoadMore()}
            disabled={!hasMore || loadingMore}
            className="py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando participantes
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais participantes ({PAGE_SIZE})
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

