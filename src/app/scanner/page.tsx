"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { getSupabaseClient } from "@/lib/supabase";
import { getAccessRoleCandidates } from "@/lib/roles";
import { parseKnownAppQrPayload } from "@/lib/qrPayloads";
import { withTenantSlug } from "@/lib/tenantRouting";

type ScannerStatus = {
  tone: "info" | "success" | "error";
  title: string;
  detail?: string;
};

const toneClass: Record<ScannerStatus["tone"], string> = {
  info: "border-zinc-800 bg-zinc-950 text-zinc-200",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  error: "border-red-500/30 bg-red-500/10 text-red-100",
};

const normalizeTurmaSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-") || "t8";

export default function FloatingScannerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastPayloadRef = useRef("");
  const processingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<ScannerStatus>({
    tone: "info",
    title: "Leitor pronto",
    detail: "Abra a câmera para iniciar.",
  });

  const roles = useMemo(() => getAccessRoleCandidates(user), [user]);
  const canScanTreino = roles.some((role) =>
    ["admin_treino", "treinador", "master_tenant", "master"].includes(role)
  );
  const canScanEvento = roles.some((role) =>
    ["vendas", "master_tenant", "master"].includes(role)
  ) || Boolean(user?.uid);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      await scanner.clear();
    } catch {
      // scanner ja pode ter sido desmontado pelo navegador.
    } finally {
      scannerRef.current = null;
      setActive(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  const validateEventTicket = async (qrPayload: string) => {
    if (!canScanEvento) {
      setStatus({
        tone: "error",
        title: "Sem permissão",
        detail: "Seu perfil não pode validar ingressos de evento.",
      });
      return;
    }

    const session = await getSupabaseClient().auth.getSession();
    const token = session.data.session?.access_token || "";
    const response = await fetch("/api/admin/event-tickets/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ qrPayload }),
    });
    const payload = await response.json().catch(() => null);
    setStatus(
      response.ok
        ? {
            tone: "success",
            title: payload?.alreadyScanned ? "Ingresso ja lido" : "Entrada liberada",
            detail: `${payload?.holderName || "Ingresso"} - ${payload?.eventTitle || "Evento"}`,
          }
        : {
            tone: "error",
            title: "Falha no check-in",
            detail: payload?.error || "Não foi possível validar esse ingresso.",
          }
    );
  };

  const openTrainingPresence = (payload: {
    treinoId: string;
    userId: string;
    tenantId: string;
  }) => {
    if (!canScanTreino) {
      setStatus({
        tone: "error",
        title: "Sem permissão",
        detail: "Seu perfil não pode registrar presença em treino.",
      });
      return;
    }
    if (payload.tenantId && tenantId && payload.tenantId !== tenantId) {
      setStatus({
        tone: "error",
        title: "QR de outro tenant",
        detail: "Esse QR pertence a outra atlética.",
      });
      return;
    }

    const path = `/admin/treinos/lista/${encodeURIComponent(payload.treinoId)}?uid=${encodeURIComponent(payload.userId)}&scanSource=floating`;
    router.push(tenantSlug ? withTenantSlug(tenantSlug, path) : path);
  };

  const openAlbumCapture = (payload: { userId: string; userTurma: string }) => {
    if (!user?.uid) {
      setStatus({
        tone: "error",
        title: "Login necessario",
        detail: "Entre na sua conta para registrar o QR de usuário.",
      });
      return;
    }

    const turmaSlug = normalizeTurmaSlug(payload.userTurma || user.turma || "t8");
    const path = `/album/${encodeURIComponent(turmaSlug)}?targetUid=${encodeURIComponent(payload.userId)}`;
    router.push(tenantSlug ? withTenantSlug(tenantSlug, path) : path);
  };

  const handleScan = async (decoded: string) => {
    const clean = decoded.trim();
    if (!clean || lastPayloadRef.current === clean || processingRef.current) return;
    lastPayloadRef.current = clean;
    setTimeout(() => {
      if (lastPayloadRef.current === clean) lastPayloadRef.current = "";
    }, 1800);

    processingRef.current = true;
    setStatus({ tone: "info", title: "QR lido", detail: "Identificando destino..." });
    try {
      const payload = parseKnownAppQrPayload(clean);
      if (!payload) {
        setStatus({
          tone: "error",
          title: "QR não reconhecido",
          detail: "Use um QR de ingresso, treino ou usuário do app.",
        });
        return;
      }

      if (payload.kind === "evento-ingresso") {
        await validateEventTicket(clean);
        return;
      }

      if (payload.kind === "treino-presenca") {
        openTrainingPresence(payload);
        return;
      }

      openAlbumCapture(payload);
    } catch (error: unknown) {
      setStatus({
        tone: "error",
        title: "Erro ao processar QR",
        detail: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      processingRef.current = false;
    }
  };

  const start = async () => {
    if (active || starting) return;
    setStarting(true);
    setStatus({ tone: "info", title: "Abrindo câmera", detail: "Aguardando permissão." });
    try {
      const scanner = new Html5Qrcode("floating-main-scanner");
      scannerRef.current = scanner;
      const cameras = await Html5Qrcode.getCameras().catch(() => []);
      const camera =
        cameras.find((entry) => /back|rear|traseira|environment/i.test(entry.label)) ||
        cameras[0];
      await scanner.start(
        camera?.id || { facingMode: "environment" },
        {
          fps: 12,
          qrbox: (width, height) => {
            const edge = Math.max(1, Math.min(width, height));
            const size = Math.min(320, Math.max(220, Math.floor(edge * 0.72)));
            return { width: size, height: size };
          },
          disableFlip: false,
        },
        (decoded) => void handleScan(decoded),
        () => undefined
      );
      setActive(true);
      setStatus({ tone: "info", title: "Câmera ativa", detail: "Leitura automática ligada." });
    } catch {
      setStatus({
        tone: "error",
        title: "Câmera indisponível",
        detail: "Não foi possível abrir a câmera neste dispositivo.",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">
            Scanner
          </p>
          <h1 className="mt-2 text-2xl font-black uppercase">Leitura automática</h1>
        </div>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => void start()}
              disabled={starting || active}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 p-3 text-sm font-black uppercase text-black disabled:opacity-50"
            >
              {starting ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              Abrir câmera
            </button>
            <button
              type="button"
              onClick={() => void stopScanner()}
              disabled={!active}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-black p-3 text-sm font-black uppercase text-zinc-200 disabled:opacity-50"
            >
              <ScanLine size={16} />
              Parar leitura
            </button>
          </div>
        </section>

        <div
          id="floating-main-scanner"
          className="qr-reader-surface min-h-[360px] overflow-hidden rounded-3xl border border-dashed border-zinc-700 bg-black"
        />

        <div className={`rounded-xl border p-4 text-sm ${toneClass[status.tone]}`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {status.tone === "success" ? <ShieldCheck size={18} /> : status.tone === "error" ? <ScanLine size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <div>
              <p className="font-black uppercase tracking-wide">{status.title}</p>
              {status.detail ? <p className="mt-1 text-xs opacity-80">{status.detail}</p> : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
