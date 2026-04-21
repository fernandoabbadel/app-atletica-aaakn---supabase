"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, QrCode } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { getSupabaseClient } from "@/lib/supabase";

type OrderRow = {
  id: string;
  userName: string;
  userTurma: string;
  status: string;
  loteNome: string;
  quantidade: number;
  valorTotal: string;
  payment_config?: { ticketEntries?: Array<{ status?: string; scannedAt?: string }> } | null;
};

const PAGE_SIZE = 20;
const GROUPS = [
  { id: "todos", label: "Todos", test: () => true },
  { id: "ad", label: "A-D", test: (value: string) => /^[A-D]/i.test(value) },
  { id: "ej", label: "E-J", test: (value: string) => /^[E-J]/i.test(value) },
  { id: "ko", label: "K-O", test: (value: string) => /^[K-O]/i.test(value) },
  { id: "pr", label: "P-R", test: (value: string) => /^[P-R]/i.test(value) },
  { id: "sz", label: "S-Z", test: (value: string) => /^[S-Z]/i.test(value) },
];

export default function AdminEventoScanPage() {
  const params = useParams<{ id: string }>();
  const eventId = params?.id?.trim() || "";
  const { addToast } = useToast();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [eventTitle, setEventTitle] = useState("Evento");
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState("");
  const [group, setGroup] = useState("todos");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: eventData }, { data, error }] = await Promise.all([
      supabase.from("eventos").select("titulo").eq("id", eventId).maybeSingle(),
      supabase
        .from("solicitacoes_ingressos")
        .select("id,userName,userTurma,status,loteNome,quantidade,valorTotal,payment_config")
        .eq("eventoId", eventId)
        .order("userName", { ascending: true })
        .limit(1000),
    ]);
    if (eventData?.titulo) setEventTitle(String(eventData.titulo));
    if (error) {
      addToast("Erro ao carregar check-ins do evento.", "error");
    } else {
      setRows((data ?? []) as OrderRow[]);
    }
    setLoading(false);
  }, [addToast, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const activeGroup = GROUPS.find((entry) => entry.id === group) ?? GROUPS[0];
    return rows.filter((row) => activeGroup.test(row.userName.trim()));
  }, [group, rows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [group]);

  const checkinCount = (row: OrderRow): number =>
    row.payment_config?.ticketEntries?.filter((entry) => entry.status === "lido" || entry.scannedAt).length ?? 0;

  const handleManualCheckin = async (row: OrderRow) => {
    setProcessingId(row.id);
    try {
      const session = await getSupabaseClient().auth.getSession();
      const token = session.data.session?.access_token || "";
      const response = await fetch("/api/admin/event-tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: row.id, eventId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Falha ao fazer check-in.");
      addToast("Check-in manual registrado.", "success");
      await load();
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Falha ao fazer check-in.", "error");
    } finally {
      setProcessingId("");
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/eventos" className="rounded-xl border border-zinc-800 bg-black p-3 text-zinc-300"><ArrowLeft size={18} /></Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Scan Eventos</p>
              <h1 className="text-2xl font-black uppercase">{eventTitle}</h1>
            </div>
          </div>
          <Link href="/admin/scan-eventos" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black uppercase text-black">
            <QrCode size={16} /> Abrir camera
          </Link>
        </header>

        <div className="flex flex-wrap gap-2">
          {GROUPS.map((entry) => (
            <button key={entry.id} onClick={() => setGroup(entry.id)} className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${group === entry.id ? "border-emerald-400 bg-emerald-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-400"}`}>
              {entry.label}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="bg-black/50 text-zinc-500 uppercase">
                <tr>
                  <th className="p-4">Usuário</th>
                  <th className="p-4">Turma</th>
                  <th className="p-4">Pagamento</th>
                  <th className="p-4">Lote</th>
                  <th className="p-4">Check-in</th>
                  <th className="p-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {loading ? (
                  <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-emerald-400" /></td></tr>
                ) : visibleRows.map((row) => {
                  const checked = checkinCount(row);
                  return (
                    <tr key={row.id} className="hover:bg-zinc-900">
                      <td className="p-4 font-bold text-white">{row.userName}</td>
                      <td className="p-4 text-zinc-300">{row.userTurma || "-"}</td>
                      <td className="p-4 text-zinc-300">{row.status}</td>
                      <td className="p-4 text-zinc-300">{row.quantidade}x {row.loteNome} - R$ {row.valorTotal}</td>
                      <td className="p-4 text-emerald-300">{checked}/{Math.max(1, row.quantidade)}</td>
                      <td className="p-4 text-right">
                        <button onClick={() => void handleManualCheckin(row)} disabled={processingId === row.id} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 font-black uppercase text-black disabled:opacity-50">
                          {processingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Check-in
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
            <span>Página {page} de {totalPages} - {filteredRows.length} registros</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </div>
    </main>
  );
}
