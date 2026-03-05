"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, RefreshCw, Search, Tag } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { isEventExpiredByGrace } from "@/lib/eventDateUtils";
import { fetchEventsFeed } from "@/lib/eventsNativeService";

const EVENT_ARCHIVE_GRACE_MS = 24 * 60 * 60 * 1000;

interface ArchivedEventRow {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  tipo: string;
  status: string;
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const toArchivedEventRow = (raw: Record<string, unknown>): ArchivedEventRow => ({
  id: asString(raw.id),
  titulo: asString(raw.titulo, "Evento"),
  data: asString(raw.data),
  hora: asString(raw.hora),
  local: asString(raw.local),
  tipo: asString(raw.tipo, "Geral"),
  status: asString(raw.status, "ativo"),
});

const formatDate = (value: string): string => {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return value;
};

export default function AdminEventosEncerradosPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<ArchivedEventRow[]>([]);

  const loadEvents = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const rows = await fetchEventsFeed({
        maxResults: 260,
        includeInactive: true,
        includePast: true,
        forceRefresh,
      });
      const normalized = rows.map((row) => toArchivedEventRow(row));
      setEvents(normalized);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar eventos encerrados.", "error");
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadEvents(false);
  }, [loadEvents]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events
      .filter((entry) => isEventExpiredByGrace(entry.data, entry.hora, EVENT_ARCHIVE_GRACE_MS))
      .filter((entry) => {
        if (!normalizedQuery) return true;
        const joined = [entry.titulo, entry.local, entry.tipo, entry.data, entry.hora]
          .join(" ")
          .toLowerCase();
        return joined.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const leftTs = Date.parse(`${left.data} ${left.hora || "00:00"}`);
        const rightTs = Date.parse(`${right.data} ${right.hora || "00:00"}`);
        if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) return rightTs - leftTs;
        return right.data.localeCompare(left.data);
      });
  }, [events, query]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#050505]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/eventos"
              className="rounded-full bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                Arquivo Historico
              </p>
              <h1 className="text-lg font-black uppercase tracking-tight">
                Eventos Encerrados
              </h1>
            </div>
          </div>

          <button
            onClick={() => void loadEvents(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3">
          <label className="flex items-center gap-2 text-zinc-400">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por titulo, tipo, local ou data..."
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
            />
          </label>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center text-sm text-zinc-400">
            Carregando eventos encerrados...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center">
            <Calendar size={22} className="mx-auto mb-2 text-zinc-500" />
            <p className="text-sm font-bold text-zinc-300">
              Nenhum evento encerrado encontrado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="min-w-full bg-zinc-950">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Evento</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Local</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-zinc-900 text-sm text-zinc-200 last:border-b-0 hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3 font-bold text-white">
                      {formatDate(entry.data)}
                    </td>
                    <td className="px-4 py-3">{entry.hora || "-"}</td>
                    <td className="px-4 py-3">{entry.titulo}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <Tag size={12} className="text-emerald-500" />
                        {entry.tipo || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{entry.local || "-"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] font-black uppercase text-zinc-300">
                        {entry.status || "encerrado"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/admin/eventos/lista/${entry.id}`}
                          className="inline-flex rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
                        >
                          Lista
                        </Link>
                        <Link
                          href={`/admin/eventos`}
                          className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-200 hover:border-zinc-500"
                        >
                          Editar
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
