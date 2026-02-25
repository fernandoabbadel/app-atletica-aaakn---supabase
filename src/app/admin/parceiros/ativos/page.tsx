"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Crown, Loader2, Shield, Star } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  fetchAdminPartnersPage,
  fetchAdminPartnersTierCounts,
  type AdminPartnersTierCounts,
  type PartnerRecord,
} from "@/lib/partnersService";

const PAGE_SIZE = 20;

const EMPTY_COUNTS: AdminPartnersTierCounts = {
  total: 0,
  ativos: 0,
  pendentes: 0,
  desativados: 0,
  ouro: 0,
  prata: 0,
  standard: 0,
};

const mergeUniquePartners = (
  current: PartnerRecord[],
  next: PartnerRecord[]
): PartnerRecord[] => {
  if (!next.length) return current;

  const knownIds = new Set(current.map((row) => row.id));
  const merged = [...current];

  next.forEach((row) => {
    if (knownIds.has(row.id)) return;
    knownIds.add(row.id);
    merged.push(row);
  });

  return merged;
};

export default function AdminParceirosAtivosPage() {
  const { addToast } = useToast();

  const [counts, setCounts] = useState<AdminPartnersTierCounts>(EMPTY_COUNTS);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadActivePartners = useCallback(
    async (options?: { reset?: boolean; cursorId?: string | null }) => {
      const reset = options?.reset ?? false;
      const cursorId = options?.cursorId ?? null;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const [tierCounts, page] = await Promise.all([
          fetchAdminPartnersTierCounts({ forceRefresh: false }),
          fetchAdminPartnersPage({
            pageSize: PAGE_SIZE,
            status: "active",
            cursorId: reset ? null : cursorId,
            forceRefresh: false,
          }),
        ]);

        setCounts(tierCounts);
        if (reset) setPartners(page.partners);
        else setPartners((prev) => mergeUniquePartners(prev, page.partners));

        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar parceiros ativos.", "error");
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [addToast]
  );

  useEffect(() => {
    void loadActivePartners({ reset: true });
  }, [loadActivePartners]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    await loadActivePartners({ reset: false, cursorId: nextCursor });
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
            <h1 className="text-xl font-black uppercase tracking-tight">Parceiros Ativos</h1>
            <p className="text-[11px] text-zinc-500 font-bold">
              Contagem consolidada + lista paginada
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-5 max-w-6xl mx-auto">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-zinc-500">Total</p>
            <p className="text-2xl font-black text-white">{counts.total}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-emerald-400">Ativos</p>
            <p className="text-2xl font-black text-emerald-300">{counts.ativos}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-yellow-400">Pendentes</p>
            <p className="text-2xl font-black text-yellow-300">{counts.pendentes}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-red-400">Desativados</p>
            <p className="text-2xl font-black text-red-300">{counts.desativados}</p>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-yellow-400 flex items-center gap-1">
              <Crown size={12} /> Ouro
            </p>
            <p className="text-2xl font-black text-white">{counts.ouro}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-600 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-zinc-300 flex items-center gap-1">
              <Shield size={12} /> Prata
            </p>
            <p className="text-2xl font-black text-white">{counts.prata}</p>
          </div>
          <div className="bg-zinc-900 border border-emerald-500/30 rounded-xl p-4">
            <p className="text-[10px] uppercase font-black text-emerald-400 flex items-center gap-1">
              <Star size={12} /> Standard
            </p>
            <p className="text-2xl font-black text-white">{counts.standard}</p>
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
                  <th className="p-4">Scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="p-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" />
                    </td>
                  </tr>
                ) : partners.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-500">
                      Nenhum parceiro ativo encontrado.
                    </td>
                  </tr>
                ) : (
                  partners.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      <td className="p-4 font-bold text-white">{row.nome}</td>
                      <td className="p-4">{row.categoria || "-"}</td>
                      <td className="p-4 uppercase font-black">{row.tier}</td>
                      <td className="p-4">{row.totalScans || 0}</td>
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
