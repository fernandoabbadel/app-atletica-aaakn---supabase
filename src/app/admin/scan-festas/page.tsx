"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

import { fetchEventsFeed } from "@/lib/eventsNativeService";
import { getSupabaseClient } from "@/lib/supabase";
import { useTenantTheme } from "@/context/TenantThemeContext";

type EventOption = {
  id: string;
  titulo: string;
  data: string;
  hora: string;
};

type ScanResult = {
  orderId: string;
  eventTitle: string;
  holderName: string;
  holderTurma: string;
  ticketLabel: string;
  scannedAt: string;
  alreadyScanned: boolean;
};

export default function ScanFestasPage() {
  const { tenantId } = useTenantTheme();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastPayloadRef = useRef("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [startingScanner, setStartingScanner] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [processingScan, setProcessingScan] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const cleanTenantId = tenantId.trim();
    if (!cleanTenantId) {
      setEvents([]);
      setLoadingEvents(false);
      return;
    }

    let mounted = true;
    setLoadingEvents(true);
    const run = async () => {
      try {
        const rows = await fetchEventsFeed({
          maxResults: 80,
          tenantId: cleanTenantId,
          forceRefresh: true,
        });
        if (!mounted) return;
        const mapped = rows
          .map((row) => ({
            id: String(row.id || "").trim(),
            titulo: String(row.titulo || "Evento").trim(),
            data: String(row.data || "").trim(),
            hora: String(row.hora || "").trim(),
          }))
          .filter((row) => row.id.length > 0);
        setEvents(mapped);
        setSelectedEventId((previous) => previous || mapped[0]?.id || "");
      } catch (error: unknown) {
        console.error(error);
      } finally {
        if (mounted) setLoadingEvents(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.stop();
        } catch {
          // noop
        }
        try {
          scannerRef.current.clear();
        } catch {
          // noop
        }
      }
    };
  }, []);

  const selectedEventLabel = useMemo(
    () => events.find((event) => event.id === selectedEventId)?.titulo || "Selecione a festa",
    [events, selectedEventId]
  );

  const processScan = async (qrPayload: string) => {
    if (!qrPayload.trim() || processingScan) return;
    if (lastPayloadRef.current === qrPayload.trim()) return;

    setProcessingScan(true);
    setErrorMessage("");
    lastPayloadRef.current = qrPayload.trim();

    try {
      const session = await getSupabaseClient().auth.getSession();
      const accessToken = session.data.session?.access_token || "";
      if (!accessToken) {
        throw new Error("Sessao admin nao encontrada.");
      }

      const response = await fetch("/api/admin/event-tickets/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          qrPayload,
          eventId: selectedEventId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ({ error?: string } & Partial<ScanResult>)
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Falha ao validar ingresso.");
      }

      setScanResult({
        orderId: String(payload.orderId || ""),
        eventTitle: String(payload.eventTitle || ""),
        holderName: String(payload.holderName || ""),
        holderTurma: String(payload.holderTurma || ""),
        ticketLabel: String(payload.ticketLabel || ""),
        scannedAt: String(payload.scannedAt || ""),
        alreadyScanned: Boolean(payload.alreadyScanned),
      });
    } catch (error: unknown) {
      console.error(error);
      setScanResult(null);
      setErrorMessage(error instanceof Error ? error.message : "Falha ao validar ingresso.");
    } finally {
      setTimeout(() => {
        lastPayloadRef.current = "";
      }, 1800);
      setProcessingScan(false);
    }
  };

  const startScanner = async () => {
    if (scannerActive || startingScanner) return;
    setStartingScanner(true);
    setErrorMessage("");
    try {
      const html5QrCode = new Html5Qrcode("scan-festas-reader");
      scannerRef.current = html5QrCode;
      const cameras = await Html5Qrcode.getCameras();
      const preferredCamera = cameras.find((camera) =>
        /back|rear|traseira/i.test(camera.label)
      );
      await html5QrCode.start(
        preferredCamera?.id || cameras[0]?.id || { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          void processScan(decodedText);
        },
        () => undefined
      );
      setScannerActive(true);
    } catch (error: unknown) {
      console.error(error);
      setErrorMessage("Nao foi possivel iniciar a camera do scanner.");
      if (scannerRef.current) {
        try {
          scannerRef.current.clear();
        } catch {
          // noop
        }
        scannerRef.current = null;
      }
    } finally {
      setStartingScanner(false);
    }
  };

  const stopScanner = async () => {
    if (!scannerRef.current) return;
    try {
      scannerRef.current.stop();
    } catch {
      // noop
    }
    try {
      scannerRef.current.clear();
    } catch {
      // noop
    }
    scannerRef.current = null;
    setScannerActive(false);
  };

  return (
    <main className="min-h-screen bg-[#050505] p-6 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-400">
                Scan Festas
              </p>
              <h1 className="mt-2 text-3xl font-black uppercase">Baixa de ingressos via QR</h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                Escolha a festa, abra a camera e valide os ingressos. A leitura grava no mesmo
                pagamento do evento quem fez a leitura e quando ela aconteceu.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <p className="font-black uppercase">{selectedEventLabel}</p>
              <p className="text-xs text-emerald-100/70">
                {selectedEventId ? "Pronto para leitura" : "Selecione uma festa"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <section className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div>
              <label
                htmlFor="scan-festas-event"
                className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Festa para validar
              </label>
              <select
                id="scan-festas-event"
                name="scan_festas_event"
                value={selectedEventId}
                onChange={(event) => setSelectedEventId(event.target.value)}
                className="w-full rounded-2xl border border-zinc-700 bg-black px-3 py-3 text-sm text-white outline-none focus:border-emerald-500"
              >
                <option value="">Selecione</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.titulo} {event.data ? `• ${event.data}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <button
                type="button"
                onClick={() => void startScanner()}
                disabled={!selectedEventId || loadingEvents || scannerActive || startingScanner}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black uppercase text-black transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {startingScanner ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                Abrir camera
              </button>
              <button
                type="button"
                onClick={() => void stopScanner()}
                disabled={!scannerActive}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-black uppercase text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                <ScanLine size={16} />
                Parar leitura
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-400">
              {loadingEvents ? "Carregando festas..." : `${events.length} festas disponiveis para validacao.`}
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div
              id="scan-festas-reader"
              className="min-h-[360px] overflow-hidden rounded-3xl border border-dashed border-zinc-700 bg-black/40"
            />

            {processingScan ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300">
                Validando QR code...
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {errorMessage}
              </div>
            ) : null}

            {scanResult ? (
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
                    <ShieldCheck size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                      {scanResult.alreadyScanned ? "Ingresso ja lido" : "Entrada liberada"}
                    </p>
                    <h2 className="mt-1 text-xl font-black uppercase text-white">
                      {scanResult.holderName}
                    </h2>
                    <p className="text-sm text-zinc-400">
                      {scanResult.holderTurma || "Sem turma"} • {scanResult.ticketLabel || "Ingresso"}
                    </p>
                    <p className="mt-3 text-xs text-zinc-500">
                      Pedido #{scanResult.orderId.slice(0, 8).toUpperCase()} • {scanResult.eventTitle}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Leitura registrada em {scanResult.scannedAt}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-4 text-sm text-zinc-500">
                Aponte a camera para o QR code do ingresso para registrar a entrada.
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
