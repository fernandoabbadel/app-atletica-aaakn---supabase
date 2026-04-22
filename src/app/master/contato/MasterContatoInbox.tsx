"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  deleteAdminReport,
  fetchSupportReports,
  resolveAdminReport,
  type AdminReportRecord,
} from "@/lib/reportsService";
import {
  dispatchMasterContactPendingChanged,
  markMasterContactReportsRead,
} from "@/lib/masterContactNotifications";

const PAGE_SIZE = 20;

type InboxMode = "pendentes" | "respondidas";

type FaqOrigin = {
  origem?: string;
  secao?: string;
  pergunta?: string;
  idPergunta?: string;
  url?: string;
};

const isResolved = (row: AdminReportRecord): boolean => row.status === "resolvida";

const statusLabel = (row: AdminReportRecord): string =>
  isResolved(row) ? "Respondida" : "Pendente";

const extractFaqOrigin = (message: string): FaqOrigin | null => {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const readValue = (prefix: string) => {
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
    return line ? line.slice(prefix.length).trim() : "";
  };

  const origem = readValue("Origem:");
  if (origem.toLowerCase() !== "faq usc") return null;

  return {
    origem,
    secao: readValue("Seção:"),
    pergunta: readValue("Pergunta:"),
    idPergunta: readValue("ID da pergunta:"),
    url: readValue("URL:"),
  };
};

export function MasterContatoInbox({ mode }: { mode: InboxMode }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState<AdminReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [responseById, setResponseById] = useState<Record<string, string>>({});

  const isAnsweredMode = mode === "respondidas";

  useEffect(() => {
    setPage(1);
  }, [mode]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const reports = await fetchSupportReports(240);
        if (!mounted) return;
        setRows(reports);
        setResponseById(
          reports.reduce<Record<string, string>>((acc, row) => {
            acc[row.id] = row.respostaAdmin || "";
            return acc;
          }, {})
        );
        if (!isAnsweredMode) {
          markMasterContactReportsRead(reports.filter((row) => !isResolved(row)));
        }
      } catch (error) {
        console.error("Falha ao carregar contatos USC:", error);
        if (mounted) addToast("Não foi possível carregar as mensagens do contato.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [addToast, isAnsweredMode]);

  const filteredRows = useMemo(
    () => rows.filter((row) => (isAnsweredMode ? isResolved(row) : !isResolved(row))),
    [isAnsweredMode, rows]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const handleResolve = async (row: AdminReportRecord) => {
    const response = (responseById[row.id] || "").trim();
    if (!response) return;

    try {
      setBusyId(row.id);
      await resolveAdminReport({
        reportId: row.id,
        originCollection: row.originCollection,
        response,
        reporterId: row.reporterId,
      });
      setRows((prev) =>
        prev.map((entry) =>
          entry.id === row.id ? { ...entry, status: "resolvida", respostaAdmin: response } : entry
        )
      );
      addToast("Mensagem respondida e movida para Respondidas.", "success");
      dispatchMasterContactPendingChanged();
    } catch (error) {
      console.error("Falha ao responder contato USC:", error);
      addToast("Não foi possível responder essa mensagem.", "error");
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (row: AdminReportRecord) => {
    try {
      setBusyId(row.id);
      await deleteAdminReport({
        reportId: row.id,
        originCollection: row.originCollection,
      });
      setRows((prev) => prev.filter((entry) => entry.id !== row.id));
      addToast("Mensagem excluída.", "success");
      dispatchMasterContactPendingChanged();
    } catch (error) {
      console.error("Falha ao excluir contato USC:", error);
      addToast("Não foi possível excluir essa mensagem.", "error");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-20 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/master"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 transition hover:bg-zinc-800"
              aria-label="Voltar ao painel master"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Contato USC</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Caixa de entrada global da landing oficial
              </p>
            </div>
          </div>

          <div className="flex rounded-xl border border-zinc-800 bg-black/40 p-1">
            <Link
              href="/master/contato"
              className={`rounded-lg px-4 py-2 text-[11px] font-black uppercase transition ${
                !isAnsweredMode
                  ? "bg-brand-primary/15 text-brand"
                  : "text-zinc-500 hover:text-white"
              }`}
            >
              Pendentes
            </Link>
            <Link
              href="/master/contato/respondidas"
              className={`rounded-lg px-4 py-2 text-[11px] font-black uppercase transition ${
                isAnsweredMode
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "text-zinc-500 hover:text-white"
              }`}
            >
              Respondidas
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {loading ? (
          <div className="text-xs font-bold uppercase text-zinc-500">Carregando...</div>
        ) : paged.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-500">
            {isAnsweredMode
              ? "Nenhuma mensagem respondida por enquanto."
              : "Nenhuma mensagem pendente da landing USC."}
          </div>
        ) : (
          paged.map((row) => {
            const response = responseById[row.id] || "";
            const isBusy = busyId === row.id;
            const faqOrigin = extractFaqOrigin(row.descricao);
            const registeredTenant =
              row.registeredTenantName ||
              row.registeredTenantSigla ||
              row.registeredTenantSlug ||
              row.registeredTenantId ||
              "";

            return (
              <article
                key={row.id}
                className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{row.autor}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{row.motivo}</p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      isResolved(row) ? "text-emerald-400" : "text-yellow-400"
                    }`}
                  >
                    {statusLabel(row)}
                  </span>
                </div>

                {row.registeredName || registeredTenant ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-wide text-emerald-300">
                      Cadastro encontrado
                    </span>
                    <div className="grid gap-1 text-[11px] text-emerald-50/85 md:grid-cols-2">
                      {row.registeredName ? <span>Nome: {row.registeredName}</span> : null}
                      {registeredTenant ? <span>Tenant: {registeredTenant}</span> : null}
                    </div>
                  </div>
                ) : null}

                {faqOrigin ? (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-100">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-wide text-blue-300">
                      Origem da dúvida no FAQ
                    </span>
                    <div className="grid gap-1 text-[11px] text-blue-100/85 md:grid-cols-2">
                      {faqOrigin.secao ? <span>Seção: {faqOrigin.secao}</span> : null}
                      {faqOrigin.pergunta ? <span>Pergunta: {faqOrigin.pergunta}</span> : null}
                      {faqOrigin.idPergunta ? <span>ID: {faqOrigin.idPergunta}</span> : null}
                      {faqOrigin.url ? <span className="truncate">URL: {faqOrigin.url}</span> : null}
                    </div>
                  </div>
                ) : null}

                <p className="whitespace-pre-wrap rounded-xl border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-300">
                  {row.descricao}
                </p>

                <div className="text-[11px] text-zinc-500">{row.data}</div>

                {!isAnsweredMode ? (
                  <label className="block space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      Resposta do master
                    </span>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={response}
                      onChange={(event) =>
                        setResponseById((prev) => ({ ...prev, [row.id]: event.target.value }))
                      }
                      className="w-full resize-none rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-brand"
                      placeholder="Escreva a resposta para esse contato..."
                    />
                  </label>
                ) : null}

                {row.respostaAdmin ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-emerald-300">
                      Última resposta salva
                    </span>
                    {row.respostaAdmin}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => void handleDelete(row)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Excluir
                  </button>
                  {!isAnsweredMode ? (
                    <button
                      onClick={() => void handleResolve(row)}
                      disabled={isBusy || response.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded-xl border border-brand bg-brand-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-brand hover:bg-brand-primary/15 disabled:opacity-60"
                    >
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Responder e concluir
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}

        {filteredRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2 text-xs font-bold uppercase text-zinc-500">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded-lg border border-zinc-800 px-3 py-2 disabled:opacity-40"
              >
                Voltar
              </button>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-zinc-800 px-3 py-2 disabled:opacity-40"
              >
                Avançar
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
