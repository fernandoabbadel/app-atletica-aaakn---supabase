"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { getSupabaseClient } from "@/lib/supabase";
import { getAccessRoleCandidates, isPlatformMaster } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

type ScanMode = "album" | "treino" | "evento";
type Option = { id: string; title: string; date?: string; hour?: string };

const extractUserIdFromQr = (rawValue: string): string => {
  const raw = rawValue.trim();
  if (!raw) return "";
  if (/^[A-Za-z0-9_-]{24,60}$/.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.uid || parsed.userId || parsed.targetUid || parsed.id;
    if (typeof value === "string" && /^[A-Za-z0-9_-]{24,60}$/.test(value.trim())) return value.trim();
  } catch {}
  try {
    const url = new URL(raw);
    for (const key of ["uid", "userId", "targetUid", "id"]) {
      const value = url.searchParams.get(key)?.trim();
      if (value && /^[A-Za-z0-9_-]{24,60}$/.test(value)) return value;
    }
  } catch {}
  return "";
};

const isEventInScanWindow = (event: Option, platformMaster: boolean): boolean => {
  if (platformMaster) return true;
  const eventDate = new Date(`${event.date || ""}T${event.hour || "00:00"}`);
  if (Number.isNaN(eventDate.getTime())) return false;
  const now = new Date();
  const start = new Date(eventDate);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(eventDate);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return now >= start && now <= end;
};

export default function FloatingScannerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastPayloadRef = useRef("");
  const [mode, setMode] = useState<ScanMode>("album");
  const [treinos, setTreinos] = useState<Option[]>([]);
  const [eventos, setEventos] = useState<Option[]>([]);
  const [selectedTreinoId, setSelectedTreinoId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");

  const roles = useMemo(() => getAccessRoleCandidates(user), [user]);
  const canScanTreino = roles.some((role) => ["admin_treino", "treinador", "master_tenant", "master"].includes(role));
  const canScanEvento = roles.some((role) => ["vendas", "master_tenant", "master"].includes(role));
  const platformMaster = isPlatformMaster(user);

  useEffect(() => {
    if (canScanTreino) setMode("treino");
    else if (canScanEvento) setMode("evento");
    else setMode("album");
  }, [canScanEvento, canScanTreino]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const load = async () => {
      const cleanTenantId = tenantId.trim();
      if (canScanTreino) {
        let query = supabase
          .from("treinos")
          .select("id,modalidade,dia,horario,tenant_id,status")
          .eq("status", "ativo")
          .order("dia", { ascending: true })
          .limit(40);
        if (cleanTenantId) query = query.eq("tenant_id", cleanTenantId);
        const { data } = await query;
        const rows = (data ?? []).map((row) => ({
          id: String(row.id || ""),
          title: `${String(row.modalidade || "Treino")} - ${String(row.dia || "")}`,
          date: String(row.dia || ""),
          hour: String(row.horario || ""),
        })).filter((row) => row.id);
        setTreinos(rows);
        setSelectedTreinoId((previous) => previous || rows[0]?.id || "");
      }
      if (canScanEvento) {
        let query = supabase
          .from("eventos")
          .select("id,titulo,data,hora,tenant_id")
          .order("data", { ascending: true })
          .limit(80);
        if (cleanTenantId) query = query.eq("tenant_id", cleanTenantId);
        const { data } = await query;
        const rows = (data ?? []).map((row) => ({
          id: String(row.id || ""),
          title: String(row.titulo || "Evento"),
          date: String(row.data || ""),
          hour: String(row.hora || ""),
        })).filter((row) => row.id && isEventInScanWindow(row, platformMaster));
        setEventos(rows);
        setSelectedEventId((previous) => previous || rows[0]?.id || "");
      }
    };
    void load();
  }, [canScanEvento, canScanTreino, platformMaster, tenantId]);

  useEffect(() => () => {
    if (!scannerRef.current) return;
    void scannerRef.current.stop().catch(() => {});
    try {
      scannerRef.current.clear();
    } catch {
      // scanner ja desmontado
    }
  }, []);

  const handleScan = async (decoded: string) => {
    const clean = decoded.trim();
    if (!clean || lastPayloadRef.current === clean) return;
    lastPayloadRef.current = clean;
    setTimeout(() => {
      lastPayloadRef.current = "";
    }, 1800);

    if (mode === "treino") {
      const uid = extractUserIdFromQr(clean);
      if (!uid || !selectedTreinoId) {
        setMessage("QR de usuario invalido ou treino nao selecionado.");
        return;
      }
      const path = `/admin/treinos/lista/${encodeURIComponent(selectedTreinoId)}?uid=${encodeURIComponent(uid)}&scanSource=floating`;
      router.push(tenantSlug ? withTenantSlug(tenantSlug, path) : path);
      return;
    }

    if (mode === "evento") {
      const session = await getSupabaseClient().auth.getSession();
      const token = session.data.session?.access_token || "";
      const response = await fetch("/api/admin/event-tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qrPayload: clean, eventId: selectedEventId || undefined }),
      });
      const payload = await response.json().catch(() => null);
      setMessage(response.ok ? `Check-in OK: ${payload?.holderName || "ingresso"}` : payload?.error || "Falha no check-in.");
      return;
    }

    router.push(tenantSlug ? withTenantSlug(tenantSlug, `/album/${user?.turma || "t8"}?scan=1`) : `/album/${user?.turma || "t8"}?scan=1`);
  };

  const start = async () => {
    if (active || starting) return;
    setStarting(true);
    setMessage("");
    try {
      const scanner = new Html5Qrcode("floating-main-scanner");
      scannerRef.current = scanner;
      const cameras = await Html5Qrcode.getCameras().catch(() => []);
      const camera = cameras.find((entry) => /back|rear|traseira|environment/i.test(entry.label)) || cameras[0];
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
    } catch {
      setMessage("Nao foi possivel abrir a camera.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Scanner</p>
          <h1 className="mt-2 text-2xl font-black uppercase">Leitura da barra flutuante</h1>
        </div>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
          <select value={mode} onChange={(event) => setMode(event.target.value as ScanMode)} className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm">
            <option value="album">Album</option>
            {canScanTreino ? <option value="treino">Presenca em treino</option> : null}
            {canScanEvento ? <option value="evento">Check-in de evento</option> : null}
          </select>
          {mode === "treino" ? (
            <select value={selectedTreinoId} onChange={(event) => setSelectedTreinoId(event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm">
              {treinos.map((treino) => <option key={treino.id} value={treino.id}>{treino.title}</option>)}
            </select>
          ) : null}
          {mode === "evento" ? (
            <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm">
              {eventos.map((evento) => <option key={evento.id} value={evento.id}>{evento.title} - {evento.date}</option>)}
            </select>
          ) : null}
          <button onClick={() => void start()} disabled={starting || active} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 p-3 text-sm font-black uppercase text-black disabled:opacity-50">
            {starting ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            Abrir camera
          </button>
        </section>

        <div id="floating-main-scanner" className="qr-reader-surface min-h-[360px] overflow-hidden rounded-3xl border border-dashed border-zinc-700 bg-black" />
        {message ? <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-200"><ScanLine size={16} className="mr-2 inline" />{message}</div> : null}
      </div>
    </main>
  );
}
