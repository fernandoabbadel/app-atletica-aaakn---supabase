"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  DollarSign,
  QrCode,
  Target,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { asString, type Row } from "@/lib/supabaseData";

type EventManagementAnalyticsProps = {
  events: Row[];
  tickets: Row[];
  allLabel?: string;
};

type MetricRow = {
  name: string;
  quantity: number;
  value: number;
  average?: number;
  secondary?: number;
  hint?: string;
};

type MutableMetric = {
  quantity: number;
  value: number;
  scanned: number;
  noShow: number;
  orderCount: number;
  leadDaysTotal: number;
  leadDaysCount: number;
  firstPurchase?: number;
  lastPurchase?: number;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const PERIODS = ["Madrugada", "Manha", "Tarde", "Noite"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const COLORS = ["#12d18e", "#38bdf8", "#facc15", "#f97316", "#f472b6", "#a78bfa", "#fb7185", "#22c55e"];

function formatCurrency(value: number) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatDecimal(value: number) {
  return decimalFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function safeDivide(numerator: number, denominator: number) {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function statusValue(row: Row) {
  return asString(row.status || row.situacao || row.state).trim().toLowerCase();
}

function isApprovedStatus(status: unknown) {
  const normalized = asString(status).trim().toLowerCase();
  return ["approved", "aprovado", "aprovada", "pago", "paid", "confirmado", "confirmada", "entregue", "validado"].includes(normalized);
}

function isRejectedStatus(status: unknown) {
  const normalized = asString(status).trim().toLowerCase();
  return ["reprovado", "reprovada", "recusado", "recusada", "rejected", "denied", "cancelado", "cancelada", "invalidado"].includes(normalized);
}

function ticketQuantity(row: Row) {
  const explicit = parseNumber(row.quantidade ?? row.quantity ?? row.qtd, 0);
  if (explicit > 0) {
    return explicit;
  }
  const entries = readTicketEntries(row);
  return Math.max(entries.length, 1);
}

function ticketValue(row: Row) {
  return parseNumber(row.valorTotal ?? row.total ?? row.valor ?? row.amount ?? row.preco, 0);
}

function readPaymentConfig(row: Row) {
  return asRecord(row.payment_config ?? row.paymentConfig ?? row.data);
}

function readTicketEntries(row: Row): Record<string, unknown>[] {
  const config = readPaymentConfig(row);
  const candidates = [
    config.ticketEntries,
    config.tickets,
    config.ingressos,
    row.ticketEntries,
    row.tickets,
    row.ingressos,
  ];

  for (const candidate of candidates) {
    const list = asArray(candidate).map(asRecord).filter((entry) => Object.keys(entry).length > 0);
    if (list.length > 0) {
      return list;
    }
  }

  return [];
}

function entryScannedAt(entry: Record<string, unknown>) {
  return parseDate(entry.scannedAt ?? entry.scanAt ?? entry.checkedAt ?? entry.checkinAt ?? entry.lidoEm ?? entry.dataCheckin);
}

function ticketScannedCount(row: Row) {
  return readTicketEntries(row).filter((entry) => {
    const status = asString(entry.status || entry.scanStatus || entry.situacao).toLowerCase();
    return Boolean(entryScannedAt(entry)) || status.includes("scan") || status.includes("lido") || status.includes("check");
  }).length;
}

function invalidScanCount(row: Row) {
  return readTicketEntries(row).filter((entry) => {
    const status = asString(entry.status || entry.scanStatus || entry.situacao).toLowerCase();
    return status.includes("invalid") || status.includes("inval") || status.includes("duplic");
  }).length;
}

function ticketEventKey(row: Row) {
  return asString(row.eventoId ?? row.eventId ?? row.event_id ?? row.evento_id ?? row.linkEvento ?? row.globalEventId);
}

function ticketEventName(row: Row) {
  return asString(row.eventoNome ?? row.eventName ?? row.evento ?? row.titulo);
}

function eventOptionId(event: Row) {
  return asString(event.id ?? event.globalEventId ?? event.eventoId ?? event.linkEvento);
}

function eventName(event: Row) {
  return asString(event.titulo ?? event.nome ?? event.name ?? event.eventoNome) || "Evento sem nome";
}

function eventIdSet(event: Row) {
  return new Set(
    [
      event.id,
      event.globalEventId,
      event.eventoId,
      event.event_id,
      event.linkEvento,
      event.slug,
      eventName(event),
    ]
      .map((value) => asString(value))
      .filter(Boolean),
  );
}

function eventMatchesTicket(event: Row, ticket: Row) {
  const ids = eventIdSet(event);
  const candidates = [ticketEventKey(ticket), ticketEventName(ticket)].filter(Boolean);
  return candidates.some((candidate) => ids.has(candidate));
}

function getTicketEvent(events: Row[], ticket: Row) {
  const key = ticketEventKey(ticket);
  const name = ticketEventName(ticket);
  return events.find((event) => {
    const ids = eventIdSet(event);
    return (key && ids.has(key)) || (name && ids.has(name));
  });
}

function readEventDate(event?: Row | null) {
  if (!event) {
    return null;
  }
  const date = asString(event.data ?? event.date ?? event.startsAt ?? event.inicio);
  const hour = asString(event.hora ?? event.time ?? event.horario);
  return parseDate(hour && date && !date.includes("T") ? `${date}T${hour}` : date || event.createdAt);
}

function purchaseDate(row: Row) {
  return parseDate(row.dataSolicitacao ?? row.createdAt ?? row.created_at ?? row.insertedAt ?? row.updatedAt);
}

function approvalDate(row: Row) {
  return parseDate(row.dataAprovacao ?? row.approvedAt ?? row.aprovadoEm ?? row.updatedAt);
}

function hoursBetween(start: Date | null, end: Date | null) {
  if (!start || !end) {
    return null;
  }
  const diff = (end.getTime() - start.getTime()) / 36e5;
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

function daysBetween(start: Date | null, end: Date | null) {
  if (!start || !end) {
    return null;
  }
  const diff = (end.getTime() - start.getTime()) / 864e5;
  return Number.isFinite(diff) ? diff : null;
}

function eventStatusLabel(event: Row) {
  const date = readEventDate(event);
  if (!date) {
    return "Sem data";
  }
  const now = Date.now();
  if (date.getTime() > now) {
    return "Futuro";
  }
  if (now - date.getTime() < 8 * 36e5) {
    return "Em andamento";
  }
  return "Encerrado";
}

function periodFromDate(date: Date | null) {
  if (!date) {
    return "Sem horario";
  }
  const hour = date.getHours();
  if (hour < 6) return "Madrugada";
  if (hour < 12) return "Manha";
  if (hour < 18) return "Tarde";
  return "Noite";
}

function scanHour(row: Row) {
  const scanned = readTicketEntries(row)
    .map(entryScannedAt)
    .find(Boolean);
  if (!scanned) {
    return "Sem scan";
  }
  return `${String(scanned.getHours()).padStart(2, "0")}h`;
}

function readStatsNumber(event: Row, keys: string[]) {
  const stats = asRecord(event.stats ?? event.metricas ?? event.analytics ?? event.data);
  for (const key of keys) {
    const value = parseNumber(stats[key], Number.NaN);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function normalizeAudience(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("nao aluno") || normalized.includes("extern") || normalized.includes("publico")) {
    return "Nao aluno";
  }
  if (normalized.includes("aluno") || normalized.includes("atleta") || normalized.includes("socio")) {
    return "Aluno";
  }
  if (normalized.includes("convid")) {
    return "Convidado";
  }
  return "Nao classificado";
}

function lotName(row: Row) {
  return asString(row.loteNome ?? row.lote ?? row.ticketName ?? row.tipoIngresso ?? row.categoria) || "Sem lote";
}

function className(row: Row) {
  return asString(row.userTurma ?? row.turma ?? row.classe ?? row.userClass ?? asRecord(row.data).turma) || "Sem turma";
}

function buyerId(row: Row) {
  return asString(row.userId ?? row.user_id ?? row.compradorId ?? row.email ?? row.userEmail ?? row.userName) || `pedido-${asString(row.id)}`;
}

function approverName(row: Row) {
  return asString(row.aprovadoPor ?? row.approvedBy ?? row.aprovador ?? row.approverName) || "Sem aprovador";
}

function addMutable(map: Map<string, MutableMetric>, key: string, row: Row, events: Row[]) {
  const current =
    map.get(key) ??
    {
      quantity: 0,
      value: 0,
      scanned: 0,
      noShow: 0,
      orderCount: 0,
      leadDaysTotal: 0,
      leadDaysCount: 0,
    };
  const quantity = ticketQuantity(row);
  const scanned = ticketScannedCount(row);
  const date = purchaseDate(row);
  const event = getTicketEvent(events, row);
  const leadDays = daysBetween(date, readEventDate(event));

  current.quantity += quantity;
  current.value += ticketValue(row);
  current.scanned += scanned;
  current.noShow += Math.max(quantity - scanned, 0);
  current.orderCount += 1;

  if (date) {
    const timestamp = date.getTime();
    current.firstPurchase = current.firstPurchase ? Math.min(current.firstPurchase, timestamp) : timestamp;
    current.lastPurchase = current.lastPurchase ? Math.max(current.lastPurchase, timestamp) : timestamp;
  }

  if (leadDays !== null && leadDays >= 0) {
    current.leadDaysTotal += leadDays;
    current.leadDaysCount += 1;
  }

  map.set(key, current);
}

function mutableRows(map: Map<string, MutableMetric>, capacityByName?: Map<string, number>): MetricRow[] {
  return [...map.entries()]
    .map(([name, metric]) => {
      const capacity = capacityByName?.get(name) ?? 0;
      const activeDays =
        metric.firstPurchase && metric.lastPurchase
          ? Math.max(1, Math.ceil((metric.lastPurchase - metric.firstPurchase) / 864e5) + 1)
          : 1;
      return {
        name,
        quantity: metric.quantity,
        value: metric.value,
        average: safeDivide(metric.value, metric.quantity),
        secondary: capacity > 0 ? safeDivide(metric.quantity, capacity) * 100 : safeDivide(metric.quantity, activeDays),
        hint:
          capacity > 0
            ? `${formatPercent(safeDivide(metric.quantity, capacity) * 100)} vendido`
            : `${formatDecimal(safeDivide(metric.quantity, activeDays))} ing./dia`,
      };
    })
    .sort((left, right) => right.value - left.value || right.quantity - left.quantity)
    .slice(0, 10);
}

function extractLotCapacity(events: Row[]) {
  const capacityByName = new Map<string, number>();
  events.forEach((event) => {
    asArray(event.lotes ?? event.batches ?? event.tickets).forEach((entry) => {
      const lot = asRecord(entry);
      const name = asString(lot.nome ?? lot.name ?? lot.titulo ?? lot.label);
      if (!name) {
        return;
      }
      const capacity = parseNumber(
        lot.quantidade ?? lot.capacidade ?? lot.limite ?? lot.total ?? lot.estoque ?? lot.vagas,
        0,
      );
      if (capacity > 0) {
        capacityByName.set(name, (capacityByName.get(name) ?? 0) + capacity);
      }
    });
  });
  return capacityByName;
}

function buildSimpleRows(map: Map<string, number>): MetricRow[] {
  return [...map.entries()]
    .map(([name, quantity]) => ({ name, quantity, value: quantity }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 10);
}

function KpiCard({
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">{label}</p>
          <strong className="mt-2 block text-2xl font-black text-white">{value}</strong>
        </div>
        <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2 text-emerald-200">{icon}</span>
      </div>
      <p className="mt-2 text-xs font-semibold text-white/50">{hint}</p>
    </div>
  );
}

function KpiGrid({ children }: { children: ReactNode }) {
  return <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</section>;
}

function SectionTitle({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">{label}</p>
      <h3 className="text-xl font-black uppercase tracking-tight text-white">{title}</h3>
      <p className="max-w-4xl text-sm font-semibold text-white/55">{description}</p>
    </div>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4">
        <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{title}</h4>
        {subtitle ? <p className="mt-1 text-xs font-semibold text-white/45">{subtitle}</p> : null}
      </div>
      <div className="h-72">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm font-bold text-white/35">
      Sem dados suficientes
    </div>
  );
}

function Bars({ data, dataKey = "quantity", currency = false }: { data: MetricRow[]; dataKey?: keyof MetricRow; currency?: boolean }) {
  if (!data.length) {
    return <EmptyChart />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
        <XAxis
          type="number"
          stroke="rgba(255,255,255,0.45)"
          tickFormatter={(value) => (currency ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
        />
        <YAxis dataKey="name" type="category" width={112} stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: "#101114", border: "1px solid rgba(255,255,255,.12)", color: "#fff" }}
          formatter={(value) => (currency ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
        />
        <Bar dataKey={dataKey as string} fill="#12d18e" radius={[0, 8, 8, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarsDual({ data }: { data: MetricRow[] }) {
  if (!data.length) {
    return <EmptyChart />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 16, left: 0, bottom: 36 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} angle={-18} textAnchor="end" height={58} />
        <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={{ background: "#101114", border: "1px solid rgba(255,255,255,.12)", color: "#fff" }} />
        <Legend />
        <Bar dataKey="quantity" name="Ingressos" fill="#12d18e" radius={[8, 8, 0, 0]} />
        <Bar dataKey="value" name="Receita" fill="#38bdf8" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineMetric({ data, dataKey = "quantity" }: { data: MetricRow[]; dataKey?: keyof MetricRow }) {
  if (!data.length) {
    return <EmptyChart />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 18, left: 0, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} angle={-18} textAnchor="end" height={46} />
        <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={{ background: "#101114", border: "1px solid rgba(255,255,255,.12)", color: "#fff" }} />
        <Line type="monotone" dataKey={dataKey as string} stroke="#12d18e" strokeWidth={3} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieMetric({ data }: { data: MetricRow[] }) {
  if (!data.length) {
    return <EmptyChart />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="quantity" nameKey="name" innerRadius={62} outerRadius={98} paddingAngle={3}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: "#101114", border: "1px solid rgba(255,255,255,.12)", color: "#fff" }} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function DetailTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: MetricRow[];
  columns: Array<{ key: keyof MetricRow; label: string; format?: "currency" | "percent" | "decimal" | "number" }>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
      <div className="border-b border-white/10 px-4 py-3">
        <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{title}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.03] text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
            <tr>
              <th className="px-4 py-3">Nome</th>
              {columns.map((column) => (
                <th key={column.label} className="px-4 py-3">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.name} className="text-white/75">
                  <td className="px-4 py-3 font-black text-white">{row.name}</td>
                  {columns.map((column) => {
                    const value = Number(row[column.key] ?? 0);
                    const formatted =
                      column.format === "currency"
                        ? formatCurrency(value)
                        : column.format === "percent"
                          ? formatPercent(value)
                          : column.format === "decimal"
                            ? formatDecimal(value)
                            : formatNumber(value);
                    return (
                      <td key={`${row.name}-${column.label}`} className="px-4 py-3 font-semibold">
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-center text-sm font-bold text-white/40" colSpan={columns.length + 1}>
                  Sem dados suficientes
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EventManagementAnalytics({ events, tickets, allLabel = "Todos os eventos" }: EventManagementAnalyticsProps) {
  const [eventId, setEventId] = useState("all");

  const eventOptions = useMemo(
    () =>
      events
        .map((event) => ({ id: eventOptionId(event), name: eventName(event) }))
        .filter((event, index, list) => event.id && list.findIndex((item) => item.id === event.id) === index),
    [events],
  );

  const analytics = useMemo(() => {
    const selectedEvents = eventId === "all" ? events : events.filter((event) => eventIdSet(event).has(eventId));
    const selectedTickets =
      eventId === "all"
        ? tickets
        : tickets.filter((ticket) => selectedEvents.some((event) => eventMatchesTicket(event, ticket)) || ticketEventKey(ticket) === eventId);
    const approvedTickets = selectedTickets.filter((ticket) => isApprovedStatus(statusValue(ticket)));
    const rejectedTickets = selectedTickets.filter((ticket) => isRejectedStatus(statusValue(ticket)));
    const pendingTickets = selectedTickets.filter((ticket) => !isApprovedStatus(statusValue(ticket)) && !isRejectedStatus(statusValue(ticket)));

    const approvedQuantity = approvedTickets.reduce((sum, ticket) => sum + ticketQuantity(ticket), 0);
    const revenue = approvedTickets.reduce((sum, ticket) => sum + ticketValue(ticket), 0);
    const scanned = approvedTickets.reduce((sum, ticket) => sum + ticketScannedCount(ticket), 0);
    const emitted = approvedTickets.reduce((sum, ticket) => sum + Math.max(ticketQuantity(ticket), readTicketEntries(ticket).length), 0);
    const noShow = Math.max(approvedQuantity - scanned, 0);
    const views = selectedEvents.reduce((sum, event) => sum + readStatsNumber(event, ["visualizacoes", "views", "pageViews", "viewCount"]), 0);
    const buyClicks = selectedEvents.reduce((sum, event) => sum + readStatsNumber(event, ["cliquesCompra", "buyClicks", "checkoutClicks", "clicks"]), 0);
    const createdOrders = selectedTickets.length;
    const paymentSent = selectedTickets.filter((ticket) => statusValue(ticket) !== "rascunho").length || selectedTickets.length;
    const approvedOrders = approvedTickets.length;
    const approvalRate = safeDivide(approvedOrders, paymentSent) * 100;
    const rejectionRate = safeDivide(rejectedTickets.length, paymentSent) * 100;
    const showRate = safeDivide(scanned, approvedQuantity) * 100;
    const noShowRate = safeDivide(noShow, approvedQuantity) * 100;
    const avgTicket = safeDivide(revenue, approvedQuantity);
    const revenuePerPresent = safeDivide(revenue, scanned);

    const funnelSource = [
      { name: "Publicado", quantity: selectedEvents.length },
      { name: "Visualizacao", quantity: views },
      { name: "Clique compra", quantity: buyClicks },
      { name: "Pedido criado", quantity: createdOrders },
      { name: "Comprovante", quantity: paymentSent },
      { name: "Aprovado", quantity: approvedOrders },
      { name: "Ingresso", quantity: emitted },
      { name: "Check-in", quantity: scanned },
    ];
    const funnelRows = funnelSource.map((step, index) => {
      const previous = funnelSource[index - 1]?.quantity ?? 0;
      return {
        name: step.name,
        quantity: step.quantity,
        value: step.quantity,
        secondary: index === 0 ? 100 : clampPercent(safeDivide(step.quantity, previous) * 100),
      };
    });

    const capacityByName = extractLotCapacity(selectedEvents);
    const byLot = new Map<string, MutableMetric>();
    const byClass = new Map<string, MutableMetric>();
    const byAudience = new Map<string, MutableMetric>();
    const byWeekday = new Map<string, MutableMetric>();
    const byPeriod = new Map<string, MutableMetric>();
    const noShowByClass = new Map<string, number>();
    const noShowByLot = new Map<string, number>();
    const leadBuckets = new Map([
      ["30d+", 0],
      ["15-29d", 0],
      ["7-14d", 0],
      ["3-6d", 0],
      ["24-72h", 0],
      ["<24h", 0],
    ]);
    const scanHours = new Map<string, number>();
    const approvers = new Map<string, { quantity: number; value: number; slaTotal: number; slaCount: number }>();
    const eventRows = new Map<string, MutableMetric>();
    const userEvents = new Map<string, Set<string>>();
    const userPurchases = new Map<string, Array<{ date: number; value: number; quantity: number }>>();

    let slaTotal = 0;
    let slaCount = 0;
    let slowApprovals = 0;
    let invalidScans = 0;
    const scanTokens = new Map<string, number>();

    approvedTickets.forEach((ticket) => {
      const quantity = ticketQuantity(ticket);
      const scannedCount = ticketScannedCount(ticket);
      const event = getTicketEvent(selectedEvents.length ? selectedEvents : events, ticket);
      const purchase = purchaseDate(ticket);
      const eventDate = readEventDate(event);
      const leadDays = daysBetween(purchase, eventDate);
      const eventLabel = event ? eventName(event) : ticketEventName(ticket) || "Evento sem nome";
      const user = buyerId(ticket);

      addMutable(byLot, lotName(ticket), ticket, selectedEvents);
      addMutable(byClass, className(ticket), ticket, selectedEvents);
      addMutable(byAudience, normalizeAudience(lotName(ticket)), ticket, selectedEvents);
      addMutable(byWeekday, purchase ? WEEKDAYS[purchase.getDay()] : "Sem data", ticket, selectedEvents);
      addMutable(byPeriod, periodFromDate(purchase), ticket, selectedEvents);
      addMutable(eventRows, eventLabel, ticket, selectedEvents);

      noShowByClass.set(className(ticket), (noShowByClass.get(className(ticket)) ?? 0) + Math.max(quantity - scannedCount, 0));
      noShowByLot.set(lotName(ticket), (noShowByLot.get(lotName(ticket)) ?? 0) + Math.max(quantity - scannedCount, 0));

      if (leadDays !== null && leadDays >= 0) {
        const bucket = leadDays >= 30 ? "30d+" : leadDays >= 15 ? "15-29d" : leadDays >= 7 ? "7-14d" : leadDays >= 3 ? "3-6d" : leadDays >= 1 ? "24-72h" : "<24h";
        leadBuckets.set(bucket, (leadBuckets.get(bucket) ?? 0) + quantity);
      }

      const scanKey = scanHour(ticket);
      if (scanKey !== "Sem scan") {
        scanHours.set(scanKey, (scanHours.get(scanKey) ?? 0) + scannedCount);
      }

      readTicketEntries(ticket).forEach((entry) => {
        const token = asString(entry.token ?? entry.id ?? entry.codigo ?? entry.qrCode);
        if (token && entryScannedAt(entry)) {
          scanTokens.set(token, (scanTokens.get(token) ?? 0) + 1);
        }
      });
      invalidScans += invalidScanCount(ticket);

      const approvalHours = hoursBetween(purchase, approvalDate(ticket));
      if (approvalHours !== null) {
        slaTotal += approvalHours;
        slaCount += 1;
        if (approvalHours > 24) {
          slowApprovals += 1;
        }
      }

      const approver = approverName(ticket);
      const approverMetric = approvers.get(approver) ?? { quantity: 0, value: 0, slaTotal: 0, slaCount: 0 };
      approverMetric.quantity += 1;
      approverMetric.value += ticketValue(ticket);
      if (approvalHours !== null) {
        approverMetric.slaTotal += approvalHours;
        approverMetric.slaCount += 1;
      }
      approvers.set(approver, approverMetric);

      const set = userEvents.get(user) ?? new Set<string>();
      set.add(eventLabel);
      userEvents.set(user, set);
      const purchases = userPurchases.get(user) ?? [];
      purchases.push({ date: purchase?.getTime() ?? 0, value: ticketValue(ticket), quantity });
      userPurchases.set(user, purchases);
    });

    const duplicateScans = [...scanTokens.values()].filter((count) => count > 1).length;
    const approverRows = [...approvers.entries()]
      .map(([name, metric]) => ({
        name,
        quantity: metric.quantity,
        value: metric.value,
        average: safeDivide(metric.slaTotal, metric.slaCount),
      }))
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, 10);
    const topApproverCount = approverRows[0]?.quantity ?? 0;
    const top3ApproverCount = approverRows.slice(0, 3).reduce((sum, row) => sum + row.quantity, 0);

    const recurrenceRows = new Map<string, MutableMetric>();
    let recurringBuyers = 0;
    userEvents.forEach((set) => {
      if (set.size > 1) {
        recurringBuyers += 1;
      }
    });
    let newBuyerQuantity = 0;
    let recurringQuantity = 0;
    userPurchases.forEach((purchases) => {
      purchases
        .sort((left, right) => left.date - right.date)
        .forEach((purchase, index) => {
          if (index === 0) {
            newBuyerQuantity += purchase.quantity;
          } else {
            recurringQuantity += purchase.quantity;
          }
        });
    });
    recurrenceRows.set("Novos", {
      quantity: newBuyerQuantity,
      value: 0,
      scanned: 0,
      noShow: 0,
      orderCount: 0,
      leadDaysTotal: 0,
      leadDaysCount: 0,
    });
    recurrenceRows.set("Recorrentes", {
      quantity: recurringQuantity,
      value: 0,
      scanned: 0,
      noShow: 0,
      orderCount: 0,
      leadDaysTotal: 0,
      leadDaysCount: 0,
    });

    const selectedSingleEvent = eventId !== "all" ? selectedEvents[0] : null;
    const firstPurchase = approvedTickets
      .map(purchaseDate)
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const targetDate = readEventDate(selectedSingleEvent);
    const daysRemaining = targetDate ? Math.max(0, (targetDate.getTime() - Date.now()) / 864e5) : 0;
    const daysElapsed = firstPurchase ? Math.max(1, (Date.now() - firstPurchase.getTime()) / 864e5) : 0;
    const projectedTickets = selectedSingleEvent && daysRemaining > 0 && daysElapsed > 0 ? approvedQuantity + safeDivide(approvedQuantity, daysElapsed) * daysRemaining : 0;

    const lotRows = mutableRows(byLot, capacityByName);
    const classRows = mutableRows(byClass);
    const audienceRows = mutableRows(byAudience);
    const weekdayRows = PERIODS.length
      ? WEEKDAYS.map((name) => {
          const metric = byWeekday.get(name);
          return {
            name,
            quantity: metric?.quantity ?? 0,
            value: metric?.value ?? 0,
            average: safeDivide(metric?.value ?? 0, metric?.quantity ?? 0),
          };
        })
      : [];
    const periodRows = PERIODS.map((name) => {
      const metric = byPeriod.get(name);
      return {
        name,
        quantity: metric?.quantity ?? 0,
        value: metric?.value ?? 0,
        average: safeDivide(metric?.value ?? 0, metric?.quantity ?? 0),
      };
    });
    const eventSummaryRows = mutableRows(eventRows).map((row) => {
      const event = selectedEvents.find((item) => eventName(item) === row.name);
      return {
        ...row,
        secondary: event ? showRate : row.secondary,
        hint: event ? eventStatusLabel(event) : row.hint,
      };
    });

    return {
      selectedEvents,
      selectedTickets,
      approvedTickets,
      rejectedTickets,
      pendingTickets,
      revenue,
      approvedQuantity,
      avgTicket,
      revenuePerPresent,
      scanned,
      noShow,
      showRate,
      noShowRate,
      approvalRate,
      rejectionRate,
      views,
      buyClicks,
      createdOrders,
      paymentSent,
      approvedOrders,
      emitted,
      funnelRows,
      lotRows,
      classRows,
      audienceRows,
      weekdayRows,
      periodRows,
      approverRows,
      scanHourRows: buildSimpleRows(scanHours).sort((left, right) => left.name.localeCompare(right.name)),
      noShowClassRows: buildSimpleRows(noShowByClass),
      noShowLotRows: buildSimpleRows(noShowByLot),
      leadRows: buildSimpleRows(leadBuckets),
      recurrenceRows: mutableRows(recurrenceRows),
      eventSummaryRows,
      avgSlaHours: safeDivide(slaTotal, slaCount),
      slowApprovals,
      duplicateScans,
      invalidScans,
      topApproverDependency: safeDivide(topApproverCount, approvedOrders) * 100,
      top3ApproverDependency: safeDivide(top3ApproverCount, approvedOrders) * 100,
      uniqueBuyers: userEvents.size,
      recurringBuyers,
      recurringRate: safeDivide(recurringBuyers, userEvents.size) * 100,
      projectedTickets,
      approvedWithoutScan: noShow,
      eventStatus: selectedSingleEvent ? eventStatusLabel(selectedSingleEvent) : "Consolidado",
    };
  }, [eventId, events, tickets]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Gestao de eventos</p>
          <h2 className="text-2xl font-black uppercase tracking-tight text-white">Painel de decisao</h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-white/55">
            Comercial, aprovacao, portaria e estrategia no mesmo recorte para mostrar onde vende, onde trava e o que vale repetir.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Evento
          <select
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            className="min-w-[240px] rounded-xl border border-white/10 bg-[#090a0d] px-3 py-2 text-sm font-black normal-case tracking-normal text-white outline-none focus:border-emerald-400"
          >
            <option value="all">{allLabel}</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SectionTitle
        label="Bloco comercial"
        title="Venda, funil, lotes e preco"
        description="Mostra da publicacao ate o check-in, com receita, ticket medio exato, sell-through ou velocidade por lote e leitura por turma, dia e periodo."
      />
      <KpiGrid>
        <KpiCard label="Receita bruta" value={formatCurrency(analytics.revenue)} hint={`${formatNumber(analytics.approvedQuantity)} ingressos aprovados`} icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label="Ticket medio exato" value={formatCurrency(analytics.avgTicket)} hint="receita / ingressos aprovados" icon={<Ticket className="h-4 w-4" />} />
        <KpiCard label="Taxa de aprovacao" value={formatPercent(analytics.approvalRate)} hint={`${formatNumber(analytics.approvedOrders)} aprovados de ${formatNumber(analytics.paymentSent)} enviados`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <KpiCard label="Conversao compra" value={formatPercent(safeDivide(analytics.buyClicks, analytics.views) * 100)} hint="cliques em comprar / visualizacoes" icon={<Target className="h-4 w-4" />} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Funil completo do evento" subtitle="Publicado -> visualizacao -> compra -> comprovante -> aprovacao -> ingresso -> check-in">
          <Bars data={analytics.funnelRows} />
        </ChartPanel>
        <ChartPanel title="Lotes por retorno" subtitle="Quantidade e receita por lote">
          <BarsDual data={analytics.lotRows} />
        </ChartPanel>
        <ChartPanel title="Turmas por venda" subtitle="Quem compra, receita e ticket medio">
          <BarsDual data={analytics.classRows} />
        </ChartPanel>
        <ChartPanel title="Aluno x nao aluno" subtitle="Mix de publico inferido pelo nome do lote">
          <PieMetric data={analytics.audienceRows} />
        </ChartPanel>
        <ChartPanel title="Compras por dia da semana" subtitle="Quantidade, receita e ticket medio">
          <BarsDual data={analytics.weekdayRows} />
        </ChartPanel>
        <ChartPanel title="Compras por periodo" subtitle="Manha, tarde, noite e madrugada">
          <BarsDual data={analytics.periodRows} />
        </ChartPanel>
      </div>

      <DetailTable
        title="Detalhe de lotes"
        rows={analytics.lotRows}
        columns={[
          { key: "quantity", label: "Ingressos" },
          { key: "value", label: "Receita", format: "currency" },
          { key: "average", label: "Ticket", format: "currency" },
          { key: "secondary", label: "Sell/vel.", format: "decimal" },
        ]}
      />

      <SectionTitle
        label="Bloco operacional"
        title="Aprovacao de comprovantes"
        description="Controla SLA, reprovacao, fila pendente e dependencia do aprovador principal para achar gargalos antes do evento."
      />
      <KpiGrid>
        <KpiCard label="SLA medio" value={`${formatDecimal(analytics.avgSlaHours)}h`} hint="tempo entre pedido e aprovacao" icon={<Clock3 className="h-4 w-4" />} />
        <KpiCard label="Taxa de reprovacao" value={formatPercent(analytics.rejectionRate)} hint={`${formatNumber(analytics.rejectedTickets.length)} comprovantes recusados`} icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Dependencia top 1" value={formatPercent(analytics.topApproverDependency)} hint={`top 3 concentram ${formatPercent(analytics.top3ApproverDependency)}`} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Fila/atraso" value={formatNumber(analytics.pendingTickets.length + analytics.slowApprovals)} hint={`${formatNumber(analytics.pendingTickets.length)} pendentes, ${formatNumber(analytics.slowApprovals)} acima de 24h`} icon={<TrendingUp className="h-4 w-4" />} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Aprovacoes por aprovador" subtitle="Volume e receita processada">
          <BarsDual data={analytics.approverRows} />
        </ChartPanel>
        <ChartPanel title="SLA por aprovador" subtitle="Tempo medio de aprovacao em horas">
          <Bars data={analytics.approverRows} dataKey="average" />
        </ChartPanel>
      </div>

      <SectionTitle
        label="Bloco portaria"
        title="Entrada, check-in e no-show"
        description="Compara ingressos aprovados com leitura real de QR para apontar falta, duplicidade, scan invalido e horario de pico."
      />
      <KpiGrid>
        <KpiCard label="Show rate" value={formatPercent(analytics.showRate)} hint={`${formatNumber(analytics.scanned)} check-ins de ${formatNumber(analytics.approvedQuantity)} aprovados`} icon={<QrCode className="h-4 w-4" />} />
        <KpiCard label="No-show rate" value={formatPercent(analytics.noShowRate)} hint={`${formatNumber(analytics.noShow)} aprovados sem entrada`} icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Receita por presente" value={formatCurrency(analytics.revenuePerPresent)} hint="receita / check-ins" icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label="Scan duplicado/invalido" value={formatNumber(analytics.duplicateScans + analytics.invalidScans)} hint={`${formatNumber(analytics.duplicateScans)} duplicados, ${formatNumber(analytics.invalidScans)} invalidos`} icon={<QrCode className="h-4 w-4" />} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartPanel title="Check-ins por horario" subtitle="Pico de entrada">
          <LineMetric data={analytics.scanHourRows} />
        </ChartPanel>
        <ChartPanel title="No-show por turma" subtitle="Aprovados sem check-in">
          <Bars data={analytics.noShowClassRows} />
        </ChartPanel>
        <ChartPanel title="No-show por lote" subtitle="Atrito por tipo de ingresso">
          <Bars data={analytics.noShowLotRows} />
        </ChartPanel>
      </div>

      <SectionTitle
        label="Bloco estrategico"
        title="Recorrencia, antecedencia e repeticao"
        description="Ajuda presidencia e financeiro a entender quem volta, quando compra e quais eventos merecem repeticao ou ajuste de formato."
      />
      <KpiGrid>
        <KpiCard label="Compradores unicos" value={formatNumber(analytics.uniqueBuyers)} hint={`${formatPercent(analytics.recurringRate)} recorrentes`} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Previsao final" value={analytics.projectedTickets ? formatNumber(analytics.projectedTickets) : "Sem ritmo"} hint="estimativa simples pelo ritmo atual" icon={<TrendingUp className="h-4 w-4" />} />
        <KpiCard label="Resultado estimado" value={formatCurrency(analytics.revenue)} hint="custos ainda nao cadastrados" icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label="Status do recorte" value={analytics.eventStatus} hint={`${formatNumber(analytics.createdOrders)} pedidos criados`} icon={<BarChart3 className="h-4 w-4" />} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Antecedencia da compra" subtitle="Dias antes do evento">
          <Bars data={analytics.leadRows} />
        </ChartPanel>
        <ChartPanel title="Novos x recorrentes" subtitle="Primeira compra comparada com compras repetidas">
          <PieMetric data={analytics.recurrenceRows} />
        </ChartPanel>
      </div>
      <DetailTable
        title="Eventos para repetir ou ajustar"
        rows={analytics.eventSummaryRows}
        columns={[
          { key: "quantity", label: "Ingressos" },
          { key: "value", label: "Receita", format: "currency" },
          { key: "average", label: "Ticket", format: "currency" },
        ]}
      />
    </section>
  );
}
