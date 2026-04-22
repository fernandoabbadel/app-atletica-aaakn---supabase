"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Save,
  Ticket,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { getSupabaseClient } from "@/lib/supabase";
import { asString as rawString, type Row } from "@/lib/supabaseData";
import { fetchLeagueById, fetchLeagueUsers, type LeagueRecord, type LeagueUserRecord } from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { withTenantSlug } from "@/lib/tenantRouting";
import { LeagueAdminQuickNav } from "./LeagueAdminQuickNav";

type ManualFrequencyStatus = "presenca" | "falta" | "justificada";

type ManualFrequencyEntry = {
  id: string;
  eventKey: string;
  eventTitle: string;
  userId: string;
  userName: string;
  status: ManualFrequencyStatus;
  justification?: string;
  updatedAt: string;
  updatedBy?: string;
};

type FrequencyEvent = {
  key: string;
  title: string;
  visibility: "public" | "internal";
  ids: Set<string>;
};

type FrequencyMember = {
  id: string;
  nome: string;
  cargo: string;
  foto: string;
  turma: string;
};

type LeagueFrequencyData = {
  league: LeagueRecord | null;
  leagueUsers: LeagueUserRecord[];
  eventTickets: Row[];
  manualEntries: ManualFrequencyEntry[];
};

type DraftState = {
  eventKey: string;
  userId: string;
  status: ManualFrequencyStatus;
  justification: string;
};

const emptyFrequencyData: LeagueFrequencyData = {
  league: null,
  leagueUsers: [],
  eventTickets: [],
  manualEntries: [],
};

const asString = (value: unknown): string => rawString(value).trim();

const asRecord = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [raw.message, raw.details]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter(Boolean)
    .join(" | ");
  if (!text) return null;

  const patterns = [
    /column\s+[a-z0-9_]+\.(\w+)\s+does not exist/i,
    /column\s+(\w+)\s+does not exist/i,
    /could not find the ['"]?(\w+)['"]? column/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

async function queryRows(
  table: string,
  select: string,
  tenantId: string,
  orderColumn: string,
  limit = 1200
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let selectColumns = select
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  let canOrder = true;
  let canFilterTenant = tenantId.trim().length > 0;

  while (selectColumns.length > 0) {
    let query = supabase.from(table).select(selectColumns.join(",")).limit(limit);
    if (canOrder) query = query.order(orderColumn, { ascending: false });
    if (canFilterTenant) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (!error) return Array.isArray(data) ? (data as unknown as Row[]) : [];

    const missingColumn = extractMissingSchemaColumn(error)?.trim().toLowerCase() || "";
    if (missingColumn) {
      if (canFilterTenant && missingColumn === "tenant_id") {
        canFilterTenant = false;
        continue;
      }
      if (canOrder && missingColumn === orderColumn.trim().toLowerCase()) {
        canOrder = false;
        continue;
      }
      const nextColumns = selectColumns.filter(
        (column) => column.trim().toLowerCase() !== missingColumn
      );
      if (nextColumns.length > 0 && nextColumns.length < selectColumns.length) {
        selectColumns = nextColumns;
        continue;
      }
    }
    if (canOrder) {
      canOrder = false;
      continue;
    }
    throw error;
  }
  return [];
}

const statusIsApproved = (status: unknown): boolean => {
  const normalized = asString(status).toLowerCase();
  return ["approved", "aprovado", "aprovada", "delivered", "entregue", "validado"].includes(normalized);
};

const parseQuantity = (value: unknown, fallback = 1): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  const parsed = Number(asString(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const ticketEntries = (paymentConfig: unknown): Row[] => {
  const config = asRecord(paymentConfig);
  const entries = config?.ticketEntries || config?.tickets || config?.ingressos;
  return Array.isArray(entries)
    ? entries.map((entry) => asRecord(entry)).filter((entry): entry is Row => entry !== null)
    : [];
};

const ticketScannedCount = (row: Row): number =>
  ticketEntries(row.payment_config).filter((entry) => {
    const status = asString(entry.status).toLowerCase();
    return status === "lido" || Boolean(asString(entry.scannedAt));
  }).length;

const getLeagueEventVisibility = (
  event: LeagueRecord["eventos"][number]
): "public" | "internal" =>
  asString(event.visibility).toLowerCase() === "internal" ? "internal" : "public";

const getLeagueEventGlobalId = (event: LeagueRecord["eventos"][number]): string => {
  const direct = asString(event.globalEventId) || asString(event.id);
  if (direct) return direct;
  const linkMatch = asString(event.linkEvento).match(/\/eventos\/([^/?#]+)/i);
  return linkMatch?.[1] ? decodeURIComponent(linkMatch[1]) : "";
};

const leagueEventIds = (league: LeagueRecord | null): Set<string> => {
  const ids = new Set<string>();
  (league?.eventos || []).forEach((event) => {
    [event.id, event.globalEventId].forEach((value) => {
      const clean = asString(value);
      if (clean) ids.add(clean);
    });
    const linkMatch = asString(event.linkEvento).match(/\/eventos\/([^/?#]+)/i);
    if (linkMatch?.[1]) ids.add(decodeURIComponent(linkMatch[1]));
  });
  return ids;
};

const leagueEventNames = (league: LeagueRecord | null): Set<string> =>
  new Set((league?.eventos || []).map((event) => asString(event.titulo)).filter(Boolean));

const statusLabel = (status: ManualFrequencyStatus): string => {
  if (status === "presenca") return "Presença";
  if (status === "falta") return "Falta";
  return "Justificativa";
};

const formatDateTime = (value: unknown): string => {
  const text = asString(value);
  const date = text ? new Date(text) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR");
};

const getAdminAccessToken = async (): Promise<string> => {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
};

const fetchManualFrequencyEntries = async (
  leagueId: string,
  tenantId: string
): Promise<ManualFrequencyEntry[]> => {
  const token = await getAdminAccessToken();
  if (!token) return [];

  const params = new URLSearchParams({ leagueId });
  if (tenantId) params.set("tenantId", tenantId);

  const response = await fetch(`/api/admin/ligas/frequency?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => null)) as {
    entries?: ManualFrequencyEntry[];
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error || "Não foi possível carregar os ajustes manuais.");
  }
  return Array.isArray(payload?.entries) ? payload.entries : [];
};

const saveManualFrequencyEntry = async (payload: {
  leagueId: string;
  tenantId: string;
  entry: Omit<ManualFrequencyEntry, "id" | "updatedAt" | "updatedBy">;
}): Promise<ManualFrequencyEntry[]> => {
  const token = await getAdminAccessToken();
  if (!token) throw new Error("Sessão inválida. Entre novamente para salvar.");

  const response = await fetch("/api/admin/ligas/frequency", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leagueId: payload.leagueId,
      tenantId: payload.tenantId,
      ...payload.entry,
    }),
  });
  const result = (await response.json().catch(() => null)) as {
    entries?: ManualFrequencyEntry[];
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(result?.error || "Não foi possível salvar a frequência.");
  }
  return Array.isArray(result?.entries) ? result.entries : [];
};

const deleteManualFrequencyEntry = async (payload: {
  leagueId: string;
  tenantId: string;
  eventKey: string;
  userId: string;
}): Promise<ManualFrequencyEntry[]> => {
  const token = await getAdminAccessToken();
  if (!token) throw new Error("Sessão inválida. Entre novamente para remover.");

  const response = await fetch("/api/admin/ligas/frequency", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as {
    entries?: ManualFrequencyEntry[];
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(result?.error || "Não foi possível remover o ajuste.");
  }
  return Array.isArray(result?.entries) ? result.entries : [];
};

async function loadLeagueFrequencyData(
  leagueId: string,
  tenantId: string
): Promise<LeagueFrequencyData> {
  if (!leagueId) return emptyFrequencyData;

  const [league, leagueUsers, ticketsRaw, manualEntries] = await Promise.all([
    fetchLeagueById(leagueId, {
      forceRefresh: true,
      tenantId: tenantId || undefined,
    }),
    fetchLeagueUsers({
      maxResults: 2000,
      tenantId: tenantId || undefined,
    }),
    queryRows(
      "solicitacoes_ingressos",
      "id,eventoId,eventoNome,userId,userName,userTurma,status,loteNome,quantidade,valorTotal,dataSolicitacao,dataAprovacao,aprovadoPor,payment_config,tenant_id",
      tenantId,
      "dataSolicitacao",
      2400
    ),
    fetchManualFrequencyEntries(leagueId, tenantId),
  ]);

  const eventIds = leagueEventIds(league);
  const eventNames = leagueEventNames(league);
  const eventTickets = ticketsRaw.filter((row) => {
    const eventId = asString(row.eventoId);
    const eventName = asString(row.eventoNome);
    return statusIsApproved(row.status) && (eventIds.has(eventId) || eventNames.has(eventName));
  });

  return {
    league,
    leagueUsers,
    eventTickets,
    manualEntries,
  };
}

function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
        <span className="text-emerald-300">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}

export function LeagueFrequencyPage() {
  const params = useParams<{ leagueId?: string }>();
  const router = useRouter();
  const { tenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const leagueId = typeof params?.leagueId === "string" ? params.leagueId : "";
  const [data, setData] = useState<LeagueFrequencyData>(emptyFrequencyData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>({
    eventKey: "",
    userId: "",
    status: "presenca",
    justification: "",
  });

  const tenantPath = useCallback(
    (path: string) => (tenantSlug ? withTenantSlug(tenantSlug, path) : path),
    [tenantSlug]
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErrorMessage("");

    loadLeagueFrequencyData(leagueId, tenantId)
      .then((result) => {
        if (!mounted) return;
        setData(result);
      })
      .catch((error) => {
        console.error("Falha ao carregar frequência da liga:", error);
        if (!mounted) return;
        setErrorMessage("Não foi possível carregar a frequência agora.");
        setData(emptyFrequencyData);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [leagueId, tenantId]);

  const presenceData = useMemo(() => {
    const userById = new Map(data.leagueUsers.map((entry) => [entry.id.trim(), entry]));
    const events: FrequencyEvent[] = (data.league?.eventos || []).map((event) => {
      const globalId = getLeagueEventGlobalId(event);
      const ids = new Set([asString(event.id), asString(event.globalEventId), globalId].filter(Boolean));
      return {
        key: globalId || asString(event.id) || asString(event.titulo),
        title: asString(event.titulo) || "Evento",
        visibility: getLeagueEventVisibility(event),
        ids,
      };
    });
    const members: FrequencyMember[] = (data.league?.membros || [])
      .map((member) => {
        const userRecord = userById.get(member.id.trim());
        return {
          id: member.id.trim(),
          nome: member.nome,
          cargo: member.cargo,
          foto: member.foto || userRecord?.foto || "",
          turma: userRecord?.turma || "Sem turma",
        };
      })
      .filter((member) => member.id)
      .sort(
        (left, right) =>
          left.turma.localeCompare(right.turma, "pt-BR") ||
          left.nome.localeCompare(right.nome, "pt-BR")
      );

    const eventByTicketKey = new Map<string, FrequencyEvent>();
    events.forEach((event) => {
      event.ids.forEach((id) => eventByTicketKey.set(id, event));
      eventByTicketKey.set(event.title, event);
    });

    const presence = new Map<string, { approved: number; scanned: number; total: number }>();
    data.eventTickets.forEach((ticket) => {
      const userId = asString(ticket.userId);
      if (!userId) return;
      const event =
        eventByTicketKey.get(asString(ticket.eventoId)) ||
        eventByTicketKey.get(asString(ticket.eventoNome));
      if (!event?.key) return;
      const quantity = parseQuantity(ticket.quantidade, 1);
      const entries = ticketEntries(ticket.payment_config);
      const scanned = ticketScannedCount(ticket);
      const key = `${event.key}:${userId}`;
      const current = presence.get(key) ?? { approved: 0, scanned: 0, total: 0 };
      current.approved += quantity;
      current.scanned += scanned;
      current.total += Math.max(quantity, entries.length);
      presence.set(key, current);
    });

    const manualByCell = new Map<string, ManualFrequencyEntry>();
    data.manualEntries.forEach((entry) => {
      manualByCell.set(`${entry.eventKey}:${entry.userId}`, entry);
    });

    return { events, members, presence, manualByCell };
  }, [data]);

  const firstEventKey = presenceData.events[0]?.key || "";
  const firstMemberId = presenceData.members[0]?.id || "";

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      eventKey: current.eventKey || firstEventKey,
      userId: current.userId || firstMemberId,
    }));
  }, [firstEventKey, firstMemberId]);

  const selectedEvent = useMemo(
    () => presenceData.events.find((event) => event.key === draft.eventKey) || null,
    [draft.eventKey, presenceData.events]
  );
  const selectedMember = useMemo(
    () => presenceData.members.find((member) => member.id === draft.userId) || null,
    [draft.userId, presenceData.members]
  );
  const selectedManualEntry = selectedEvent && selectedMember
    ? presenceData.manualByCell.get(`${selectedEvent.key}:${selectedMember.id}`) || null
    : null;

  const resolveCell = useCallback((event: FrequencyEvent, member: FrequencyMember) => {
    const manual = presenceData.manualByCell.get(`${event.key}:${member.id}`);
    if (manual) {
      return {
        kind: manual.status,
        label: statusLabel(manual.status),
        manual,
      };
    }
    const cell = presenceData.presence.get(`${event.key}:${member.id}`);
    if (cell && cell.scanned > 0) return { kind: "presenca" as const, label: "Presença", manual: null };
    if (cell && cell.approved > 0) return { kind: "aprovado" as const, label: "Aprovado", manual: null };
    return { kind: "vazio" as const, label: "-", manual: null };
  }, [presenceData]);

  const analytics = useMemo(() => {
    let presentes = 0;
    let faltas = 0;
    let justificadas = 0;
    let aprovados = 0;

    presenceData.members.forEach((member) => {
      presenceData.events.forEach((event) => {
        const cell = resolveCell(event, member);
        if (cell.kind === "presenca") presentes += 1;
        if (cell.kind === "falta") faltas += 1;
        if (cell.kind === "justificada") justificadas += 1;
        if (cell.kind === "aprovado") aprovados += 1;
      });
    });

    return { presentes, faltas, justificadas, aprovados };
  }, [presenceData, resolveCell]);

  const openManualForm = (event?: FrequencyEvent, member?: FrequencyMember) => {
    setDraft({
      eventKey: event?.key || firstEventKey,
      userId: member?.id || firstMemberId,
      status: "presenca",
      justification: "",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!selectedEvent || !selectedMember || saving) return;
    setSaving(true);
    try {
      const entries = await saveManualFrequencyEntry({
        leagueId,
        tenantId,
        entry: {
          eventKey: selectedEvent.key,
          eventTitle: selectedEvent.title,
          userId: selectedMember.id,
          userName: selectedMember.nome,
          status: draft.status,
          justification: draft.justification.trim(),
        },
      });
      setData((current) => ({ ...current, manualEntries: entries }));
      addToast("Frequência atualizada.", "success");
      setFormOpen(false);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error && error.message ? error.message : "Não foi possível salvar.";
      addToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent || !selectedMember || saving) return;
    setSaving(true);
    try {
      const entries = await deleteManualFrequencyEntry({
        leagueId,
        tenantId,
        eventKey: selectedEvent.key,
        userId: selectedMember.id,
      });
      setData((current) => ({ ...current, manualEntries: entries }));
      addToast("Ajuste manual removido.", "success");
      setFormOpen(false);
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error && error.message ? error.message : "Não foi possível remover.";
      addToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const league = data.league;
  const leagueName = league?.sigla?.trim() || league?.nome?.trim() || "Liga";
  const leagueLogo = (league ? resolveLeagueLogoSrc(league) : "") || "/logo.png";
  const leagueBaseHref = tenantPath(`/ligas/${encodeURIComponent(leagueId)}`);
  const leagueHomeHref = leagueBaseHref;
  const leagueInformationHref = `${leagueBaseHref}/informacoes`;
  const leagueMembersHref = `${leagueBaseHref}/membros`;
  const leagueEventsHref = `${leagueBaseHref}/eventos`;
  const leagueStoreHref = `${leagueBaseHref}/loja`;
  const leagueFinanceHref = `${leagueBaseHref}/gestao`;
  const leagueBoardHref = `${leagueBaseHref}/board-round`;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-6 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(leagueFinanceHref)}
                className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
                aria-label="Voltar para a gestão"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                <Image src={leagueLogo} alt={leagueName} fill sizes="44px" className="object-cover" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Frequência dos membros
                </p>
                <h1 className="text-xl font-black uppercase">{leagueName}</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openManualForm()}
              disabled={presenceData.events.length === 0 || presenceData.members.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500 px-4 py-3 text-xs font-black uppercase text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ClipboardList size={16} />
              Adicionar ajuste manual
            </button>
          </div>
          <LeagueAdminQuickNav
            active="finance"
            homeHref={leagueHomeHref}
            informationHref={leagueInformationHref}
            membersHref={leagueMembersHref}
            eventsHref={leagueEventsHref}
            storeHref={leagueStoreHref}
            financeHref={leagueFinanceHref}
            boardHref={leagueBoardHref}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        {errorMessage ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard
            label="Presenças"
            value={String(analytics.presentes)}
            hint="QR lido ou ajuste manual"
            icon={<CheckCircle2 size={18} />}
          />
          <MetricCard
            label="Aprovados"
            value={String(analytics.aprovados)}
            hint="Ingresso liberado sem leitura"
            icon={<Ticket size={18} />}
          />
          <MetricCard
            label="Faltas"
            value={String(analytics.faltas)}
            hint="Lançadas manualmente"
            icon={<XCircle size={18} />}
          />
          <MetricCard
            label="Justificativas"
            value={String(analytics.justificadas)}
            hint="Ausências justificadas"
            icon={<ClipboardList size={18} />}
          />
        </section>

        {formOpen ? (
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <label className="flex-1 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                  Evento
                </span>
                <select
                  value={draft.eventKey}
                  onChange={(event) => setDraft((current) => ({ ...current, eventKey: event.target.value }))}
                  className="w-full rounded-xl border border-emerald-500/20 bg-black/70 px-3 py-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                >
                  {presenceData.events.map((event) => (
                    <option key={event.key} value={event.key} className="bg-zinc-950 text-white">
                      {event.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex-1 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                  Membro
                </span>
                <select
                  value={draft.userId}
                  onChange={(event) => setDraft((current) => ({ ...current, userId: event.target.value }))}
                  className="w-full rounded-xl border border-emerald-500/20 bg-black/70 px-3 py-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                >
                  {presenceData.members.map((member) => (
                    <option key={member.id} value={member.id} className="bg-zinc-950 text-white">
                      {member.nome} - {member.turma}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 lg:w-52">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                  Status
                </span>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as ManualFrequencyStatus,
                    }))
                  }
                  className="w-full rounded-xl border border-emerald-500/20 bg-black/70 px-3 py-3 text-sm font-bold text-white outline-none focus:border-emerald-400"
                >
                  <option value="presenca" className="bg-zinc-950 text-white">Presença</option>
                  <option value="falta" className="bg-zinc-950 text-white">Falta</option>
                  <option value="justificada" className="bg-zinc-950 text-white">Justificativa</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                Justificativa ou observação
              </span>
              <textarea
                rows={3}
                maxLength={1000}
                value={draft.justification}
                onChange={(event) => setDraft((current) => ({ ...current, justification: event.target.value }))}
                className="w-full resize-none rounded-xl border border-emerald-500/20 bg-black/70 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400"
                placeholder="Opcional para presença e falta; recomendado para justificativa."
              />
            </label>

            {selectedManualEntry ? (
              <p className="mt-3 text-[11px] font-bold text-emerald-100/80">
                Último ajuste salvo: {statusLabel(selectedManualEntry.status)}
                {formatDateTime(selectedManualEntry.updatedAt) ? ` em ${formatDateTime(selectedManualEntry.updatedAt)}` : ""}.
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-900"
              >
                Cancelar
              </button>
              {selectedManualEntry ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-black uppercase text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Remover ajuste
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !selectedEvent || !selectedMember}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400 px-4 py-3 text-xs font-black uppercase text-black hover:bg-emerald-300 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar frequência
              </button>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                Eventos da liga
              </p>
              <h2 className="mt-2 text-lg font-black uppercase text-white">
                Frequência dos membros
              </h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                Presença mostra QR lido ou ajuste manual; aprovado mostra ingresso liberado sem leitura.
              </p>
            </div>
            <span className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-[10px] font-black uppercase text-zinc-400">
              {presenceData.members.length} membros / {presenceData.events.length} eventos
            </span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-black/30">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs">
              <thead className="bg-black/40 text-zinc-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[240px] bg-black/80 p-3 uppercase">Membro</th>
                  {presenceData.events.map((event) => (
                    <th key={event.key} className="min-w-[170px] p-3 align-top uppercase">
                      <span className="line-clamp-2 text-[11px] font-black text-zinc-200">{event.title}</span>
                      <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[9px] font-black ${
                        event.visibility === "internal"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                      }`}>
                        {event.visibility === "internal" ? "Interno" : "Público"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {presenceData.members.map((member) => (
                  <tr key={member.id} className="hover:bg-zinc-950/70">
                    <td className="sticky left-0 z-10 bg-zinc-950 p-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                          {member.foto ? (
                            <Image src={member.foto} alt={member.nome} fill sizes="36px" className="object-cover" />
                          ) : (
                            <Users size={16} className="m-2 text-zinc-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black text-white">{member.nome}</p>
                          <p className="text-[10px] font-bold uppercase text-zinc-500">
                            {member.turma} - {member.cargo}
                          </p>
                        </div>
                      </div>
                    </td>
                    {presenceData.events.map((event) => {
                      const cell = resolveCell(event, member);
                      const badgeClass =
                        cell.kind === "presenca"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : cell.kind === "aprovado"
                            ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                            : cell.kind === "justificada"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                              : cell.kind === "falta"
                                ? "border-red-500/30 bg-red-500/10 text-red-300"
                                : "border-zinc-800 bg-zinc-950 text-zinc-600";
                      const Icon =
                        cell.kind === "presenca"
                          ? CheckCircle2
                          : cell.kind === "aprovado"
                            ? Ticket
                            : cell.kind === "vazio"
                              ? XCircle
                              : ClipboardList;

                      return (
                        <td key={`${member.id}-${event.key}`} className="p-3">
                          <div className="flex flex-col items-start gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${badgeClass}`}>
                              <Icon size={12} /> {cell.label}
                            </span>
                            {cell.manual?.justification ? (
                              <span className="line-clamp-2 max-w-[150px] text-[10px] leading-4 text-zinc-400">
                                {cell.manual.justification}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                setDraft({
                                  eventKey: event.key,
                                  userId: member.id,
                                  status: cell.manual?.status || "presenca",
                                  justification: cell.manual?.justification || "",
                                });
                                setFormOpen(true);
                              }}
                              className="rounded-lg border border-zinc-700 bg-black/40 px-2 py-1 text-[9px] font-black uppercase text-zinc-400 hover:border-emerald-500/30 hover:text-emerald-200"
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {presenceData.members.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, presenceData.events.length + 1)} className="p-8 text-center text-sm text-zinc-500">
                      Nenhum membro encontrado nesta liga.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
