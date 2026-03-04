"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarRange, MapPin, RefreshCw, Search } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  fetchTreinosAdminList,
  type TreinoRecord,
} from "@/lib/treinosNativeService";

const isPastTreino = (isoDate: string): boolean => {
  if (!isoDate) return false;
  const endOfDay = new Date(`${isoDate}T23:59:59`);
  if (Number.isNaN(endOfDay.getTime())) return false;
  return endOfDay.getTime() < Date.now();
};

const formatDate = (isoDate: string): string => {
  if (!isoDate) return "-";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
};

export default function AdminTreinosAntigosPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [treinos, setTreinos] = useState<TreinoRecord[]>([]);

  const loadTreinos = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const rows = await fetchTreinosAdminList({
        maxResults: 260,
        forceRefresh,
      });
      setTreinos(rows);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar treinos antigos.", "error");
      setTreinos([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadTreinos(false);
  }, [loadTreinos]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return treinos
      .filter((entry) => isPastTreino(entry.dia))
      .filter((entry) => {
        if (!normalizedQuery) return true;
        const joined = [
          entry.modalidade,
          entry.local,
          entry.treinador,
          entry.dia,
          entry.horario,
        ]
          .join(" ")
          .toLowerCase();
        return joined.includes(normalizedQuery);
      })
      .sort((left, right) => right.dia.localeCompare(left.dia));
  }, [treinos, query]);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#050505]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/treinos"
              className="rounded-full bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                Arquivo Historico
              </p>
              <h1 className="text-lg font-black uppercase tracking-tight">
                Treinos Antigos
              </h1>
            </div>
          </div>

          <button
            onClick={() => void loadTreinos(true)}
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
              placeholder="Buscar por modalidade, local, treinador ou data..."
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
            />
          </label>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center text-sm text-zinc-400">
            Carregando treinos antigos...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center">
            <CalendarRange size={22} className="mx-auto mb-2 text-zinc-500" />
            <p className="text-sm font-bold text-zinc-300">
              Nenhum treino antigo encontrado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="min-w-full bg-zinc-950">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Modalidade</th>
                  <th className="px-4 py-3">Horario</th>
                  <th className="px-4 py-3">Local</th>
                  <th className="px-4 py-3">Responsavel</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Confirmados</th>
                  <th className="px-4 py-3 text-right">Acao</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-zinc-900 text-sm text-zinc-200 last:border-b-0 hover:bg-zinc-900/60"
                  >
                    <td className="px-4 py-3 font-bold text-white">
                      {formatDate(entry.dia)}
                    </td>
                    <td className="px-4 py-3">{entry.modalidade || "-"}</td>
                    <td className="px-4 py-3">{entry.horario || "-"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} className="text-emerald-500" />
                        {entry.local || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{entry.treinador || "-"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                          entry.status === "cancelado"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {entry.status || "ativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {Array.isArray(entry.confirmados)
                        ? entry.confirmados.length
                        : 0}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/treinos/${entry.id}`}
                        className="inline-flex rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Abrir
                      </Link>
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
