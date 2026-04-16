"use client";

import Image from "next/image";
import { CalendarDays, MapPin, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface PublicEventTicketCardProps {
  qrValue: string;
  imageUrl: string;
  eventTitle: string;
  eventDateLabel: string;
  eventLocation: string;
  loteName: string;
  holderName: string;
  holderTurma: string;
  ticketCode: string;
  status: "ativo" | "lido";
}

export function PublicEventTicketCard({
  qrValue,
  imageUrl,
  eventTitle,
  eventDateLabel,
  eventLocation,
  loteName,
  holderName,
  holderTurma,
  ticketCode,
  status,
}: PublicEventTicketCardProps) {
  return (
    <main className="min-h-screen bg-[#f4f4f4] px-4 py-8 text-zinc-900">
      <div className="mx-auto max-w-[340px] overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <div className="relative h-40 w-full bg-zinc-900">
          <Image
            src={imageUrl || "/logo.png"}
            alt={eventTitle}
            fill
            sizes="340px"
            className="object-cover"
            unoptimized={imageUrl.startsWith("http")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
        </div>

        <div className="bg-gradient-to-r from-fuchsia-700 to-violet-600 px-4 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/80">
                Ingresso digital
              </p>
              <h1 className="mt-1 text-xl font-black uppercase leading-tight">
                {eventTitle}
              </h1>
            </div>
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                status === "lido" ? "bg-red-500/90 text-white" : "bg-lime-400 text-emerald-950"
              }`}
            >
              {status === "lido" ? "Lido" : "Valido"}
            </span>
          </div>

          <div className="mt-3 space-y-1 text-[11px] text-white/85">
            <div className="flex items-center gap-2">
              <CalendarDays size={12} />
              <span>{eventDateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={12} />
              <span>{eventLocation || "Local a confirmar"}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 px-4 py-5 text-center">
            <QRCodeSVG value={qrValue} size={210} includeMargin />
            <p className="mt-3 text-[10px] font-mono text-zinc-400">{ticketCode}</p>
            <p className="mt-2 text-[10px] text-zinc-500">
              Apresente este QR Code na entrada do evento
            </p>
          </div>

          <div className="mt-4 space-y-3 border-t border-dashed border-zinc-200 pt-4 text-sm">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Tipo de ingresso
              </p>
              <p className="mt-1 font-bold text-zinc-900">{loteName || "Ingresso"}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Titular do ingresso
              </p>
              <p className="mt-1 font-bold text-zinc-900">{holderName}</p>
              <p className="text-xs text-zinc-500">{holderTurma || "Sem turma"}</p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
            <div className="flex items-start gap-2">
              <QrCode size={14} className="mt-0.5" />
              <p>
                O QR Code e individual. Depois da leitura, o status deste ingresso muda para
                lido automaticamente.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
