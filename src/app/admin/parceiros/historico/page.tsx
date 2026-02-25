"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  fetchAdminPartnerScansPage,
  type PartnerScanRecord,
} from "@/lib/partnersService";

const PAGE_SIZE = 20;

const mergeUniqueScans = (
  current: PartnerScanRecord[],
  next: PartnerScanRecord[]
): PartnerScanRecord[] => {
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

const parseTimestamp = (value: unknown): string => {
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

export default function AdminParceirosHistoricoPage() {
  const { addToast } = useToast();

  const [rows, setRows] = useState<PartnerScanRecord[]>([]);
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
        const page = await fetchAdminPartnerScansPage({
          pageSize: PAGE_SIZE,
          cursorId: reset ? null : cursorId,
          forceRefresh: false,
        });

        if (reset) setRows(page.scans);
        else setRows((prev) => mergeUniqueScans(prev, page.scans));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar historico.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    void loadRows({ reset: true });
  }, [loadRows]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadRows({ reset: false, cursorId: nextCursor });
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
            <h1 className="text-xl font-black uppercase tracking-tight">Historico de Scans</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Leitura paginada de uso de cupons (20 por vez)
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-black/40 text-zinc-500 uppercase font-black">
                <tr>
                  <th className="p-4">Data</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Usuario</th>
                  <th className="p-4">Cupom</th>
                  <th className="p-4">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-zinc-500">
                      Nenhum scan encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const formattedDate = parseTimestamp(row.timestamp);
                    return (
                      <tr key={row.id} className="hover:bg-zinc-800/40">
                        <td className="p-4">
                          {formattedDate === "-"
                            ? `${row.data} ${row.hora}`.trim()
                            : formattedDate}
                        </td>
                        <td className="p-4 font-bold text-white">{row.empresa}</td>
                        <td className="p-4">{row.usuario}</td>
                        <td className="p-4">{row.cupom}</td>
                        <td className="p-4">{row.valorEconomizado}</td>
                      </tr>
                    );
                  })
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
