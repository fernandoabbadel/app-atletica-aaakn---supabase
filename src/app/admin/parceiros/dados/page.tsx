"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { fetchAdminPartnersPage, type PartnerRecord } from "@/lib/partnersService";

const PAGE_SIZE = 20;

const mergeUniquePartners = (
  current: PartnerRecord[],
  next: PartnerRecord[]
): PartnerRecord[] => {
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

const parseDate = (value: unknown): string => {
  if (!value) return "-";
  if (value instanceof Date) return value.toLocaleDateString("pt-BR");
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("pt-BR");
    }
  }

  if (typeof value === "object" && value !== null) {
    const candidate = (value as { toDate?: unknown }).toDate;
    if (typeof candidate === "function") {
      const parsed = candidate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("pt-BR");
      }
    }
  }

  return "-";
};

export default function AdminParceirosDadosPage() {
  const { addToast } = useToast();

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
          status: "all",
          forceRefresh: false,
        });

        if (reset) setRows(page.partners);
        else setRows((prev) => mergeUniquePartners(prev, page.partners));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar dados cadastrais.", "error");
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
            <h1 className="text-xl font-black uppercase tracking-tight">Dados Cadastrais</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Lista de contatos e documentos paginada
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
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Responsavel</th>
                  <th className="p-4">CNPJ</th>
                  <th className="p-4">Telefone</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Cadastro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-zinc-500">
                      Nenhum parceiro encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="p-4 font-bold text-white">{row.nome}</td>
                      <td className="p-4">{row.responsavel || "-"}</td>
                      <td className="p-4">{row.cnpj || "-"}</td>
                      <td className="p-4">{row.telefone || "-"}</td>
                      <td className="p-4">{row.email || "-"}</td>
                      <td className="p-4">{parseDate(row.createdAt)}</td>
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
