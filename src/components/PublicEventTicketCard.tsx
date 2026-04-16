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
    <main className="min-h-screen bg-[#050505] px-4 py-8 text-white">
      <div className="mx-auto max-w-[360px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="relative h-44 w-full bg-black">
          <Image
            src={imageUrl || "/logo.png"}
            alt={eventTitle}
            fill
            sizes="340px"
            className="object-cover"
            unoptimized={imageUrl.startsWith("http")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-black/35 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                  Ingresso digital
                </p>
                <h1 className="mt-1 line-clamp-2 text-xl font-black uppercase leading-tight text-white">
                  {eventTitle}
                </h1>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${
                  status === "lido"
                    ? "border-red-500/30 bg-red-500/15 text-red-300"
                    : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                }`}
              >
                {status === "lido" ? "Lido" : "Valido"}
              </span>
            </div>
          </div>
        </div>

        <div className="border-y border-zinc-800 bg-black/35 px-4 py-3">
          <div className="space-y-1 text-[11px] text-zinc-300">
            <div className="flex items-center gap-2">
              <CalendarDays size={12} className="text-emerald-300" />
              <span className="truncate">{eventDateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={12} className="text-emerald-300" />
              <span className="truncate">{eventLocation || "Local a confirmar"}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-2xl border border-zinc-800 bg-white px-4 py-5 text-center">
            <QRCodeSVG value={qrValue} size={210} includeMargin />
            <p className="mt-3 text-[10px] font-mono text-zinc-400">{ticketCode}</p>
            <p className="mt-2 text-[10px] text-zinc-500">
              Apresente este QR Code na entrada do evento
            </p>
          </div>

          <div className="mt-4 grid gap-3 border-t border-dashed border-zinc-800 pt-4 text-sm">
            <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Tipo de ingresso
              </p>
              <p className="mt-1 font-bold text-white">{loteName || "Ingresso"}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Titular do ingresso
              </p>
              <p className="mt-1 font-bold text-white">{holderName}</p>
              <p className="text-xs text-zinc-400">{holderTurma || "Sem turma"}</p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-200">
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
