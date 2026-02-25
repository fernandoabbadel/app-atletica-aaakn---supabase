"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Power,
  Search,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  fetchAdminPartnersPage,
  setPartnerStatus,
  type PartnerRecord,
  type PartnerStatus,
} from "@/lib/partnersService";

const PAGE_SIZE = 20;

type StatusFilter = PartnerStatus | "all";

const mergeUniquePartners = (
  current: PartnerRecord[],
  next: PartnerRecord[]
): PartnerRecord[] => {
  if (!next.length) return current;

  const ids = new Set(current.map((row) => row.id));
  const merged = [...current];

  next.forEach((row) => {
    if (ids.has(row.id)) return;
    ids.add(row.id);
    merged.push(row);
  });

  return merged;
};

const statusLabel: Record<PartnerStatus, string> = {
  active: "Ativo",
  pending: "Pendente",
  disabled: "Desativado",
};

const statusClass: Record<PartnerStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  pending: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  disabled: "bg-red-500/10 text-red-300 border-red-500/30",
};

export default function AdminParceirosEmpresasPage() {
  const { addToast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<PartnerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadRows = useCallback(
    async (options?: { reset?: boolean; cursorId?: string | null }) => {
      const reset = options?.reset ?? false;
      const cursorId = options?.cursorId ?? null;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const page = await fetchAdminPartnersPage({
          pageSize: PAGE_SIZE,
          cursorId: reset ? null : cursorId,
          status: statusFilter,
          forceRefresh: false,
        });

        if (reset) setRows(page.partners);
        else setRows((prev) => mergeUniquePartners(prev, page.partners));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar empresas.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [addToast, statusFilter]
  );

  useEffect(() => {
    void loadRows({ reset: true });
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) =>
      `${row.nome} ${row.categoria} ${row.email} ${row.responsavel}`
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadRows({ reset: false, cursorId: nextCursor });
  };

  const handleToggleStatus = async (row: PartnerRecord) => {
    const nextStatus: PartnerStatus =
      row.status === "active" ? "disabled" : "active";

    try {
      await setPartnerStatus({ partnerId: row.id, status: nextStatus });
      setRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id ? { ...entry, status: nextStatus } : entry
        )
      );
      addToast("Status atualizado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar status.", "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/parceiros"
            className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
          >
            <ArrowLeft size={18} className="text-zinc-300" />
          </Link>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight">Empresas Parceiras</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Query paginada (20 por leitura de lista)
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <section className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative w-full md:max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar empresa"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex gap-2">
            {[
              { id: "all", label: "Todos" },
              { id: "active", label: "Ativos" },
              { id: "pending", label: "Pendentes" },
              { id: "disabled", label: "Desativados" },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setStatusFilter(option.id as StatusFilter)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase border transition ${
                  statusFilter === option.id
                    ? "bg-white text-black border-white"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                <tr>
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Categoria</th>
                  <th className="p-4">Plano</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Scans</th>
                  <th className="p-4 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-zinc-500">
                      Nenhuma empresa encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="p-4">
                        <p className="font-bold text-white">{row.nome}</p>
                        <p className="text-zinc-500">{row.email || "-"}</p>
                      </td>
                      <td className="p-4">{row.categoria || "-"}</td>
                      <td className="p-4 uppercase font-black">{row.tier}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded border text-[10px] uppercase font-black ${statusClass[row.status]}`}
                        >
                          {statusLabel[row.status]}
                        </span>
                      </td>
                      <td className="p-4">{row.totalScans || 0}</td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/parceiros/${row.id}`}
                            target="_blank"
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Abrir pagina publica"
                          >
                            <ExternalLink size={15} />
                          </Link>
                          <button
                            onClick={() => void handleToggleStatus(row)}
                            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                            title="Alternar status"
                          >
                            {row.status === "disabled" ? (
                              <ShieldCheck size={15} />
                            ) : (
                              <Power size={15} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {!loading && hasMore && (
          <button
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="w-full py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase tracking-wide hover:bg-zinc-800 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loadingMore ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Carregando
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Carregar mais
              </>
            )}
          </button>
        )}
      </main>
    </div>
  );
}
