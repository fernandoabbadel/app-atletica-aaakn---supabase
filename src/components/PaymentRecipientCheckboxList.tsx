"use client";

import { useMemo } from "react";
import Image from "next/image";
import { Loader2, UserRound } from "lucide-react";

import type { TenantPaymentRecipientOption } from "@/lib/paymentRecipients";

interface PaymentRecipientCheckboxListProps {
  id: string;
  label?: string;
  helperText?: string;
  emptyText?: string;
  options: TenantPaymentRecipientOption[];
  selectedUserIds: string[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (userIds: string[]) => void;
}

export function PaymentRecipientCheckboxList({
  id,
  label = "Liberar comprovantes para",
  helperText = "Marque quem pode receber o comprovante deste item.",
  emptyText = "Nenhum recebedor cadastrado para esta area.",
  options,
  selectedUserIds,
  loading = false,
  disabled = false,
  onChange,
}: PaymentRecipientCheckboxListProps) {
  const selectedSet = useMemo(
    () =>
      new Set(
        selectedUserIds.map((entry) => String(entry || "").trim()).filter(Boolean)
      ),
    [selectedUserIds]
  );

  const toggleUser = (userId: string) => {
    const cleanUserId = userId.trim();
    if (!cleanUserId || disabled || loading) return;

    if (selectedSet.has(cleanUserId)) {
      onChange(selectedUserIds.filter((entry) => entry !== cleanUserId));
      return;
    }

    onChange([...selectedUserIds, cleanUserId]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
            {label}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">{helperText}</p>
        </div>
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-300">
          {selectedSet.size}
        </span>
      </div>

      <div
        id={`${id}-list`}
        className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-black/20 p-2"
      >
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-[11px] text-zinc-500">
            <Loader2 size={14} className="animate-spin" />
            Carregando recebedores...
          </div>
        ) : options.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-black/20 px-3 py-3 text-[11px] text-zinc-500">
            <UserRound size={14} />
            {emptyText}
          </div>
        ) : (
          options.map((entry) => {
            const checked = selectedSet.has(entry.userId);
            return (
              <label
                key={entry.userId || `${entry.name}:${entry.phone}`}
                className={`flex min-h-14 items-center gap-3 rounded-lg border p-3 transition ${
                  checked
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-zinc-800 bg-black/20 hover:border-zinc-600"
                } ${disabled ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || loading}
                  onChange={() => toggleUser(entry.userId)}
                  className="h-4 w-4 shrink-0 accent-emerald-500"
                />
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-950">
                  <Image
                    src={entry.avatarUrl || "/logo.png"}
                    alt={entry.name}
                    fill
                    sizes="36px"
                    className="object-cover"
                    unoptimized={entry.avatarUrl?.startsWith("http")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{entry.name}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {entry.turma || "Sem turma"}
                    {entry.phone ? ` - ${entry.phone}` : ""}
                  </p>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
