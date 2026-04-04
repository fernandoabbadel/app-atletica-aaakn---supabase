"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarRange, MapPin, RefreshCw, Search } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  fetchTreinoPresenceCounts,
  fetchTreinosAdminList,
  type TreinoRecord,
} from "@/lib/treinosNativeService";

const PAGE_SIZE = 20;

const normalizeModalidadeName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 40);

const toModalidadeKey = (value: string): string =>
  normalizeModalidadeName(value).toLowerCase();

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

type Props = {
  fixedCategory?: string;
};

export default function TreinosAntigosClient({ fixedCategory = "" }: Props) {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const searchParams = useSearchParams();

  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/treinos") : "/admin/treinos";
  const baseArchiveHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/treinos/antigos")
    : "/admin/treinos/antigos";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [treinos, setTreinos] = useState<TreinoRecord[]>([]);
  const [presenceCounts, setPresenceCounts] = useState<Record<string, number>>({});

  const loadTreinos = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const rows = await fetchTreinosAdminList({
          maxResults: 260,
          forceRefresh,
          tenantId: activeTenantId || undefined,
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
    },
    [activeTenantId, addToast]
  );

  useEffect(() => {
    void loadTreinos(false);
  }, [loadTreinos]);

  const allPastRows = useMemo(
    () =>
      treinos
        .filter((entry) => isPastTreino(entry.dia))
        .sort((left, right) => right.dia.localeCompare(left.dia)),
    [treinos]
  );

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(allPastRows.map((entry) => normalizeModalidadeName(entry.modalidade)).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right)),
    [allPastRows]
  );

  const activeCategoryKey = toModalidadeKey(fixedCategory);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      allPastRows.filter((entry) => {
        if (activeCategoryKey && toModalidadeKey(entry.modalidade) !== activeCategoryKey) {
          return false;
        }
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
      }),
    [activeCategoryKey, allPastRows, normalizedQuery]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const requestedPage = Number(searchParams.get("page") || "1");
  const currentPage =
    Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.min(totalPages, Math.floor(requestedPage))
      : 1;

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredRows]);

  useEffect(() => {
    const treinoIds = pagedRows.map((entry) => entry.id);
    if (treinoIds.length === 0) {
      setPresenceCounts({});
      return;
    }

    const loadPresence = async () => {
      try {
        const counts = await fetchTreinoPresenceCounts({
          treinoIds,
          tenantId: activeTenantId || undefined,
        });
        setPresenceCounts(counts);
      } catch (error: unknown) {
        console.error(error);
        setPresenceCounts({});
      }
    };

    void loadPresence();
  }, [activeTenantId, pagedRows]);

  const buildArchiveHref = (category?: string, page = 1): string => {
    const categoryPath = category
      ? `${baseArchiveHref}/${encodeURIComponent(category)}`
      : baseArchiveHref;
    return page > 1 ? `${categoryPath}?page=${page}` : categoryPath;
  };

  const currentCategoryLabel =
    categoryOptions.find((entry) => toModalidadeKey(entry) === activeCategoryKey) || fixedCategory;

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#050505]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                Arquivo Historico
              </p>
              <h1 className="text-lg font-black uppercase tracking-tight">
                {currentCategoryLabel
                  ? `Treinos Antigos - ${currentCategoryLabel}`
                  : "Treinos Antigos"}
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

        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href={buildArchiveHref(undefined, 1)}
            className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
              !activeCategoryKey
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            Todas
          </Link>
          {categoryOptions.map((category) => {
            const active = toModalidadeKey(category) === activeCategoryKey;
            return (
              <Link
                key={category}
                href={buildArchiveHref(category, 1)}
                className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
                  active
                    ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {category}
              </Link>
            );
          })}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center text-sm text-zinc-400">
            Carregando treinos antigos...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-10 text-center">
            <CalendarRange size={22} className="mx-auto mb-2 text-zinc-500" />
            <p className="text-sm font-bold text-zinc-300">
              Nenhum treino antigo encontrado.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
              Pagina {currentPage} de {totalPages} - {filteredRows.length} treinos encontrados
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="min-w-full bg-zinc-950">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Modalidade</th>
                    <th className="px-4 py-3">Horario</th>
                    <th className="px-4 py-3">Local</th>
                    <th className="px-4 py-3">Responsavel</th>
                    <th className="px-4 py-3">Confirmados</th>
                    <th className="px-4 py-3">Presentes</th>
                    <th className="px-4 py-3 text-right">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((entry) => (
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
                        {Math.max(0, entry.confirmedCount ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        {Math.max(0, presenceCounts[entry.id] ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={
                            tenantSlug
                              ? withTenantSlug(tenantSlug, `/admin/treinos/lista/${entry.id}`)
                              : `/admin/treinos/lista/${entry.id}`
                          }
                          className="inline-flex rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
                        >
                          Abrir lista
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
              <Link
                href={buildArchiveHref(currentCategoryLabel || undefined, Math.max(1, currentPage - 1))}
                className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
                  currentPage === 1
                    ? "pointer-events-none border border-zinc-800 bg-zinc-900 text-zinc-600"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Pagina anterior
              </Link>

              <div className="flex flex-wrap justify-center gap-2">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <Link
                    key={page}
                    href={buildArchiveHref(currentCategoryLabel || undefined, page)}
                    className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
                      page === currentPage
                        ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {page}
                  </Link>
                ))}
              </div>

              <Link
                href={buildArchiveHref(currentCategoryLabel || undefined, Math.min(totalPages, currentPage + 1))}
                className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
                  currentPage >= totalPages
                    ? "pointer-events-none border border-zinc-800 bg-zinc-900 text-zinc-600"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                }`}
              >
                Proxima pagina
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
