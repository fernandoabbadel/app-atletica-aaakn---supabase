"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, QrCode, Ticket } from "lucide-react";

import {
  fetchAdminPartnerScansPage,
  fetchPartnerById,
} from "../../../../lib/partnersService";

interface PartnerData {
  id: string;
  nome: string;
}

interface ScanRow {
  id: string;
  usuario: string;
  userId: string;
  cupom: string;
  valorEconomizado: string;
  data: string;
  hora: string;
}

const PAGE_SIZE = 20;

export default function EmpresaHistoricoPage() {
  const params = useParams();
  const empresaId = String(params.id || "").trim();

  const [loadingHeader, setLoadingHeader] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [partner, setPartner] = useState<PartnerData | null>(null);
  const [pages, setPages] = useState<Record<number, ScanRow[]>>({});
  const [nextCursorByPage, setNextCursorByPage] = useState<Record<number, string | null>>({ 0: null });
  const [hasMoreByPage, setHasMoreByPage] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);

  const loadPage = useCallback(async (targetPage: number) => {
    if (!empresaId || targetPage < 1) return;
    if (pages[targetPage]) return;

    const cursorId = nextCursorByPage[targetPage - 1];
    if (targetPage > 1 && !cursorId) return;

    setLoadingPage(true);
    try {
      const result = await fetchAdminPartnerScansPage({
        partnerId: empresaId,
        pageSize: PAGE_SIZE,
        cursorId: cursorId || null,
        forceRefresh: targetPage === 1,
      });

      setPages((prev) => ({ ...prev, [targetPage]: result.scans as ScanRow[] }));
      setNextCursorByPage((prev) => ({ ...prev, [targetPage]: result.nextCursor }));
      setHasMoreByPage((prev) => ({ ...prev, [targetPage]: result.hasMore }));
    } finally {
      setLoadingPage(false);
    }
  }, [empresaId, nextCursorByPage, pages]);

  useEffect(() => {
    let mounted = true;

    const loadPartner = async () => {
      if (!empresaId) {
        if (mounted) setLoadingHeader(false);
        return;
      }

      try {
        const partnerData = await fetchPartnerById(empresaId, { forceRefresh: false });
        if (!mounted) return;
        setPartner(partnerData ? { id: partnerData.id, nome: partnerData.nome } : null);
      } finally {
        if (mounted) setLoadingHeader(false);
      }
    };

    void loadPartner();
    return () => {
      mounted = false;
    };
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId) return;
    void loadPage(page);
  }, [empresaId, page, loadPage]);

  useEffect(() => {
    if (!empresaId) return;
    setPages({});
    setNextCursorByPage({ 0: null });
    setHasMoreByPage({});
    setPage(1);
  }, [empresaId]);

  const rows = useMemo(() => pages[page] || [], [pages, page]);
  const hasNext = Boolean(hasMoreByPage[page]);
  const hasPrev = page > 1;
  const isLoading = loadingHeader || (loadingPage && rows.length === 0);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-20">
      <header className="p-6 sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/empresa/${empresaId}`}
              className="bg-zinc-900 p-2.5 rounded-full hover:bg-zinc-800 border border-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-400" />
            </Link>
            <div>
              <h1 className="text-lg font-black uppercase tracking-tight">
                Histórico de Scans
              </h1>
              <p className="text-[11px] text-zinc-500 font-bold">
                {partner?.nome || "Empresa"}
              </p>
            </div>
          </div>
          <div className="text-[10px] uppercase text-zinc-500 font-bold">
            20 por página
          </div>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-black/40 border-b border-zinc-800 text-zinc-500 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-4">Data</th>
                  <th className="p-4">Aluno</th>
                  <th className="p-4">Cupom</th>
                  <th className="p-4 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50 text-sm text-zinc-300">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/30 transition">
                    <td className="p-4">
                      <div>{row.data}</div>
                      <div className="text-[10px] text-zinc-500">{row.hora}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-white font-medium">{row.usuario}</div>
                      <span className="text-[10px] text-zinc-500">{row.userId}</span>
                    </td>
                    <td className="p-4 flex items-center gap-2">
                      <Ticket size={14} className="text-emerald-500" /> {row.cupom}
                    </td>
                    <td className="p-4 text-right font-mono text-emerald-400 font-bold">
                      {row.valorEconomizado}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-zinc-500 text-xs">
                      <div className="flex items-center justify-center gap-2">
                        <QrCode size={14} /> Nenhum scan registrado.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => setPage((prev) => (prev > 1 ? prev - 1 : prev))}
            disabled={!hasPrev}
            className="px-3 py-2 rounded-lg text-xs font-bold uppercase border border-zinc-800 bg-zinc-900 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800"
          >
            <span className="flex items-center gap-1">
              <ChevronLeft size={14} /> Anterior
            </span>
          </button>
          <span className="text-xs font-bold text-zinc-400 px-2">
            Pagina {page}
          </span>
          <button
            onClick={() => {
              if (!hasNext) return;
              setPage((prev) => prev + 1);
            }}
            disabled={!hasNext}
            className="px-3 py-2 rounded-lg text-xs font-bold uppercase border border-zinc-800 bg-zinc-900 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800"
          >
            <span className="flex items-center gap-1">
              Próxima <ChevronRight size={14} />
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
