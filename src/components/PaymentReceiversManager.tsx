"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Check, Loader2, Search, Trash2, UserPlus, X } from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  fetchTenantPaymentReceiverDirectory,
  saveTenantPaymentRecipients,
  type TenantPaymentRecipientOption,
} from "@/lib/paymentRecipients";

interface PaymentReceiversManagerProps {
  tenantId: string;
  open: boolean;
  recipients: TenantPaymentRecipientOption[];
  onClose: () => void;
  onSaved: (recipients: TenantPaymentRecipientOption[]) => void;
}

const normalizeSearch = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function PaymentReceiversManager({
  tenantId,
  open,
  recipients,
  onClose,
  onSaved,
}: PaymentReceiversManagerProps) {
  const { addToast } = useToast();
  const [directory, setDirectory] = useState<TenantPaymentRecipientOption[]>([]);
  const [draft, setDraft] = useState<TenantPaymentRecipientOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(recipients);
    setSearch("");
  }, [open, recipients]);

  useEffect(() => {
    if (!open || !tenantId.trim()) return;

    let mounted = true;
    setLoading(true);
    const run = async () => {
      try {
        const rows = await fetchTenantPaymentReceiverDirectory(tenantId);
        if (mounted) setDirectory(rows);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) {
          setDirectory([]);
          addToast("Erro ao carregar usuarios da tenant.", "error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, open, tenantId]);

  const selectedIds = useMemo(
    () => new Set(draft.map((entry) => entry.userId).filter(Boolean)),
    [draft]
  );
  const filteredDirectory = useMemo(() => {
    const term = normalizeSearch(search);
    const rows = directory.filter((entry) => !selectedIds.has(entry.userId));
    if (!term) return rows.slice(0, 60);
    return rows
      .filter((entry) =>
        normalizeSearch(`${entry.name} ${entry.turma} ${entry.phone}`).includes(term)
      )
      .slice(0, 60);
  }, [directory, search, selectedIds]);

  const addRecipient = useCallback((recipient: TenantPaymentRecipientOption) => {
    setDraft((previous) => {
      if (previous.some((entry) => entry.userId === recipient.userId)) return previous;
      return [...previous, recipient];
    });
  }, []);

  const removeRecipient = useCallback((userId: string) => {
    setDraft((previous) => previous.filter((entry) => entry.userId !== userId));
  }, []);

  const handleSave = async () => {
    if (!tenantId.trim()) {
      addToast("Tenant nao identificado.", "error");
      return;
    }
    try {
      setSaving(true);
      const saved = await saveTenantPaymentRecipients(tenantId, draft);
      onSaved(saved);
      addToast("Recebedores atualizados.", "success");
      onClose();
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar recebedores.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-black/40 p-5">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide">
              Adicionar recebedores
            </h2>
            <p className="mt-1 text-[11px] text-zinc-500">
              Somente estes usuarios aparecem nas listas de comprovante.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                Usuarios que podem receber.
              </p>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-300">
                {draft.length}
              </span>
            </div>
            <div className="space-y-2">
              {draft.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                  Nenhum recebedor adicionado ainda.
                </div>
              ) : (
                draft.map((entry) => (
                  <div
                    key={entry.userId || `${entry.name}:${entry.phone}`}
                    className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3"
                  >
                    <div className="relative h-10 w-10 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900">
                      <Image
                        src={entry.avatarUrl || "/logo.png"}
                        alt={entry.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized={entry.avatarUrl?.startsWith("http")}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{entry.name}</p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {entry.turma || "Sem turma"} {entry.phone ? `- ${entry.phone}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRecipient(entry.userId)}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              Buscar usuarios aprovados
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2">
              <Search size={14} className="text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, turma ou telefone"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
              />
            </div>

            <div className="space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  Carregando...
                </div>
              ) : filteredDirectory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
                  Nenhum usuario disponivel para adicionar.
                </div>
              ) : (
                filteredDirectory.map((entry) => (
                  <button
                    key={entry.userId || `${entry.name}:${entry.phone}`}
                    type="button"
                    onClick={() => addRecipient(entry)}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-black/20 p-3 text-left transition hover:border-emerald-500/30 hover:bg-emerald-500/5"
                  >
                    <div className="relative h-10 w-10 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900">
                      <Image
                        src={entry.avatarUrl || "/logo.png"}
                        alt={entry.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized={entry.avatarUrl?.startsWith("http")}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{entry.name}</p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {entry.turma || "Sem turma"} {entry.phone ? `- ${entry.phone}` : ""}
                      </p>
                    </div>
                    <UserPlus size={15} className="text-emerald-300" />
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-800 bg-black/30 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Salvar recebedores
          </button>
        </div>
      </div>
    </div>
  );
}
