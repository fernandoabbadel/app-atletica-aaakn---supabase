"use client";

import Image from "next/image";
import { Loader2, UserRound } from "lucide-react";

import type { TenantPaymentRecipientOption } from "@/lib/paymentRecipients";

interface PaymentRecipientSelectProps {
  id: string;
  name?: string;
  label?: string;
  options: TenantPaymentRecipientOption[];
  selectedUserId: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (userId: string) => void;
}

export function PaymentRecipientSelect({
  id,
  name,
  label = "Usuarios que podem receber.",
  options,
  selectedUserId,
  loading = false,
  disabled = false,
  onChange,
}: PaymentRecipientSelectProps) {
  const selectedRecipient =
    options.find((entry) => entry.userId === selectedUserId) || null;

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-[10px] font-black uppercase tracking-widest text-zinc-500"
      >
        {label}
      </label>
      <select
        id={id}
        name={name || id}
        value={selectedUserId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || loading}
        className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-60"
      >
        <option value="">Manual / sem usuario vinculado</option>
        {options.map((entry) => (
          <option key={entry.userId} value={entry.userId}>
            {entry.name} - {entry.turma || "Sem turma"}
          </option>
        ))}
      </select>
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          Carregando usuarios aprovados da tenant...
        </div>
      ) : selectedRecipient ? (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-full border border-zinc-700 bg-zinc-950">
            <Image
              src={selectedRecipient.avatarUrl}
              alt={selectedRecipient.name}
              fill
              sizes="44px"
              className="object-cover"
              unoptimized={selectedRecipient.avatarUrl.startsWith("http")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">
              {selectedRecipient.name}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {selectedRecipient.turma || "Sem turma"}
              {selectedRecipient.phone ? ` - ${selectedRecipient.phone}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-3 py-2 text-[11px] text-zinc-500">
          <UserRound size={14} />
          O comprovante vai usar apenas o telefone preenchido manualmente.
        </div>
      )}
    </div>
  );
}
