"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  LifeBuoy,
  Send,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import Link from "next/link";

import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { isPermissionError } from "@/lib/backendErrors";
import {
  fetchUserSupportRequests,
  submitSupportRequest,
  type SupportCategory,
  type SupportTicketRecord,
} from "../../../lib/reportsService";

const CATEGORY_OPTIONS: Array<{ value: SupportCategory; label: string }> = [
  { value: "geral", label: "Geral" },
  { value: "financeiro", label: "Financeiro" },
  { value: "conta", label: "Conta" },
  { value: "bug", label: "Bug" },
  { value: "denuncia", label: "Denuncia" },
  { value: "sugestorias", label: "Sugestões" },
  { value: "outro", label: "Outro" },
];

const SUBJECT_MAX_CHARS = 50;
const MESSAGE_MAX_CHARS = 300;

export default function SupportPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [category, setCategory] = useState<SupportCategory>("geral");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [history, setHistory] = useState<SupportTicketRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadHistory = async () => {
      if (!user) {
        if (mounted) {
          setHistory([]);
          setLoadingHistory(false);
        }
        return;
      }

      try {
        const tickets = await fetchUserSupportRequests(user.uid, 20);
        if (mounted) setHistory(tickets);
      } catch (error: unknown) {
        if (!isPermissionError(error)) {
          console.error(error);
        }
        if (mounted) setHistory([]);
      } finally {
        if (mounted) setLoadingHistory(false);
      }
    };

    void loadHistory();

    return () => {
      mounted = false;
    };
  }, [user]);

  const handleSubmit = async () => {
    if (!user) {
      addToast("Voce precisa estar logado para abrir chamado.", "error");
      return;
    }

    if (sending) return;

    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    if (!cleanSubject || !cleanMessage) {
      addToast("Preencha assunto e mensagem.", "error");
      return;
    }

    try {
      setSending(true);
      await submitSupportRequest({
        userId: user.uid,
        userName: user.nome,
        userEmail: user.email,
        category,
        subject: cleanSubject,
        message: cleanMessage,
      });

      addToast("Chamado enviado com sucesso.", "success");
      setSubject("");
      setMessage("");

      const refreshed = await fetchUserSupportRequests(user.uid, 20);
      setHistory(refreshed);
    } catch (error: unknown) {
      if (!isPermissionError(error)) {
        console.error(error);
      }
      addToast("Erro ao enviar chamado.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500">
      <header className="p-4 flex items-center gap-4 sticky top-0 bg-[#050505]/90 backdrop-blur-md z-10 border-b border-zinc-900">
        <Link
          href="/configuracoes"
          className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition"
        >
          <ArrowLeft size={24} />
        </Link>
        <h1 className="font-black text-xl italic uppercase tracking-tighter flex items-center gap-2">
          <LifeBuoy size={20} className="text-emerald-500" /> Suporte
        </h1>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-6">
        <section className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg space-y-4">
          <div>
            <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-1">
              Categoria
            </p>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportCategory)}
              className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm text-white outline-none focus:border-emerald-500"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-1">
              Assunto
            </p>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={SUBJECT_MAX_CHARS}
              placeholder="Ex: Nao consigo finalizar meu pedido"
              className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm text-white outline-none focus:border-emerald-500 placeholder:text-zinc-600"
            />
            <p className="mt-1 text-right text-[10px] font-bold uppercase tracking-wide text-zinc-600">
              {subject.length}/{SUBJECT_MAX_CHARS}
            </p>
          </div>

          <div>
            <p className="text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-1">
              Mensagem
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MESSAGE_MAX_CHARS}
              rows={5}
              placeholder="Descreva o que aconteceu"
              className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm text-white outline-none focus:border-emerald-500 placeholder:text-zinc-600 resize-none"
            />
            <p className="mt-1 text-right text-[10px] font-bold uppercase tracking-wide text-zinc-600">
              {message.length}/{MESSAGE_MAX_CHARS}
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={sending}
            className={`w-full font-black py-3 rounded-lg text-xs uppercase tracking-widest transition flex items-center justify-center gap-2 ${
              sending
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20"
            }`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {sending ? "Enviando..." : "Enviar Chamado"}
          </button>
        </section>

        <section className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300">
              Ultimos Chamados
            </h2>
            <span className="text-[10px] text-zinc-500 font-bold uppercase">limite 20</span>
          </div>

          {loadingHistory ? (
            <div className="text-xs text-zinc-500 flex items-center gap-2 py-2">
              <Loader2 size={14} className="animate-spin" /> Carregando historico...
            </div>
          ) : history.length === 0 ? (
            <div className="text-xs text-zinc-500 bg-black/40 rounded-lg border border-zinc-800 p-3 flex items-center gap-2">
              <AlertTriangle size={14} /> Nenhum chamado aberto ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((ticket) => (
                <article
                  key={ticket.id}
                  className="bg-black/40 border border-zinc-800 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{ticket.subject}</p>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        ticket.status === "resolved"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-yellow-500/15 text-yellow-400"
                      }`}
                    >
                      {ticket.status === "resolved" ? "Resolvido" : "Pendente"}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-3">{ticket.message}</p>

                  {ticket.response && (
                    <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-md p-2">
                      <p className="font-bold uppercase text-[10px] mb-1 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Resposta da Diretoria
                      </p>
                      {ticket.response}
                    </div>
                  )}

                  <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                    <Clock size={12} /> {ticket.createdAtLabel}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}


