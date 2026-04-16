"use client";

import Image from "next/image";
import { MessageCircle } from "lucide-react";

import type { ReceiptContactProfile } from "@/lib/tenantBranding";

interface ReceiptContactButtonProps {
  recipient: ReceiptContactProfile;
  onClick: () => void;
  disabled?: boolean;
  helperText?: string;
}

export function ReceiptContactButton({
  recipient,
  onClick,
  disabled = false,
  helperText,
}: ReceiptContactButtonProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 overflow-hidden rounded-full border border-emerald-500/30 bg-black">
            <Image
              src={recipient.avatarUrl || "/logo.png"}
              alt={recipient.name}
              fill
              sizes="48px"
              className="object-cover"
              unoptimized={recipient.avatarUrl.startsWith("http")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
              Enviar comprovante
            </p>
            <p className="truncate text-sm font-black text-white">
              {recipient.name}
            </p>
            <p className="truncate text-[11px] text-emerald-100/80">
              {recipient.turma || "Sem turma"}
              {recipient.phone ? ` • ${recipient.phone}` : ""}
            </p>
          </div>
          <MessageCircle size={18} className="text-emerald-300" />
        </div>
      </button>
      {helperText ? (
        <p className="text-[10px] text-zinc-500">{helperText}</p>
      ) : null}
    </div>
  );
}
