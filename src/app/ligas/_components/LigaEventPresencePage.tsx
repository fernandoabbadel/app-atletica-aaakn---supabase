"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Loader2,
  Users,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchAdminEventPresencePage,
  fetchEventTitleById,
} from "@/lib/eventsNativeService";
import { withTenantSlug } from "@/lib/tenantRouting";

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
}

const PAGE_SIZE = 50;

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
  };
};

const buildPresenceRowKey = (row: MergedParticipant): string =>
  row.id.trim() || `${row.userId}:${row.userName}:${row.lote}:${row.valorTotal}`;

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

const escapeCsvCell = (value: string): string => {
  const normalized = String(value ?? "");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
};

export function LigaEventPresencePage({
  eventId,
  leagueId,
}: {
  eventId: string;
  leagueId?: string | null;
}) {
  const { addToast } = useToast();
  const { tenantSlug } = useTenantTheme();

  const [eventTitle, setEventTitle] = useState("Evento");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<MergedParticipant[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const cleanEventId = eventId.trim();
  const cleanLeagueId = asString(leagueId).trim();
  const backPath = cleanLeagueId
    ? `/ligas/${encodeURIComponent(cleanLeagueId)}/eventos`
    : "/ligas/eventos";
  const scopedBackPath = tenantSlug ? withTenantSlug(tenantSlug, backPath) : backPath;

  const loadHeader = useCallback(async () => {
    if (!cleanEventId) return;
    const title = await fetchEventTitleById(cleanEventId);
    if (title) setEventTitle(asString(title, "Evento"));
  }, [cleanEventId]);

  const loadInitial = useCallback(async () => {
    if (!cleanEventId) return;

    setLoading(true);
    try {
      const page = await fetchAdminEventPresencePage({
        eventId: cleanEventId,
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
      addToast("Erro ao carregar lista de presenca.", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, cleanEventId]);

  useEffect(() => {
    void loadHeader();
    void loadInitial();
  }, [loadHeader, loadInitial]);

  const handleLoadMore = async () => {
    if (!cleanEventId || !hasMore || !cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await fetchAdminEventPresencePage({
        eventId: cleanEventId,
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

  const handleExportCsv = async () => {
    if (!cleanEventId || exporting) return;

    setExporting(true);
    try {
      const exportedRows: MergedParticipant[] = [];
      let nextCursor: string | null = null;
      let canContinue = true;

      while (canContinue) {
        const page = await fetchAdminEventPresencePage({
          eventId: cleanEventId,
          pageSize: 200,
          ...(nextCursor ? { cursorId: nextCursor } : {}),
          forceRefresh: false,
        });

        const normalized = page.rows
          .map((row) => normalizeMergedParticipant(row))
          .filter((row): row is MergedParticipant => row !== null);

        exportedRows.push(...normalized);
        nextCursor = page.nextCursor;
        canContinue = page.hasMore && Boolean(nextCursor);
      }

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

      const csvRows = exportedRows.map((row) => [
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

      const csvContent = [headers, ...csvRows]
        .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lista_evento_${cleanEventId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao exportar CSV.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={scopedBackPath}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
                <Users size={18} className="text-emerald-400" />
                Lista de Presenca
              </h1>
              <p className="text-[11px] font-bold text-zinc-500">{eventTitle}</p>
            </div>
          </div>
          <button
            onClick={() => void handleExportCsv()}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            CSV
          </button>
        </div>
      </header>

      <main className="space-y-4 px-6 py-6">
        <div className="text-xs font-black uppercase text-zinc-500">
          Participantes carregados: {rows.length}
        </div>

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="bg-black/40 font-black uppercase text-zinc-500">
                <tr>
                  <th className="p-4">Usuario</th>
                  <th className="p-4">Turma</th>
                  <th className="p-4">RSVP</th>
                  <th className="p-4">Pagamento</th>
                  <th className="p-4">Lote</th>
                  <th className="p-4">Valor</th>
                  <th className="p-4">Aprovacao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center">
                      <Loader2 className="mx-auto animate-spin text-emerald-500" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-zinc-500">
                      Nenhum participante encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={buildPresenceRowKey(row)} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="relative h-7 w-7 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800">
                            <Image
                              src={row.userAvatar || "https://github.com/shadcn.png"}
                              alt={row.userName}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <span className="font-bold text-white">{row.userName}</span>
                        </div>
                      </td>
                      <td className="p-4">{row.userTurma || "-"}</td>
                      <td className="p-4 font-black uppercase text-[10px]">
                        {row.rsvpStatus === "going" ? "Vou" : "Talvez"}
                      </td>
                      <td className="p-4">
                        <span
                          className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${
                            row.pagamento === "pago"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : row.pagamento === "analise"
                              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                              : "border-zinc-700 bg-zinc-800 text-zinc-400"
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <button
          onClick={() => void handleLoadMore()}
          disabled={!hasMore || loadingMore}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-xs font-black uppercase tracking-wide text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {loadingMore ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Carregando participantes
            </>
          ) : (
            <>
              <ChevronDown size={15} />
              Carregar mais participantes ({PAGE_SIZE})
            </>
          )}
        </button>
      </main>
    </div>
  );
}
