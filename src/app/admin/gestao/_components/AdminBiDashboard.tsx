"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
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
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  DollarSign,
  Loader2,
  Package,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";

import { useTenantTheme } from "@/context/TenantThemeContext";
import { getSupabaseClient } from "@/lib/supabase";
import { asObject, asString, type Row } from "@/lib/supabaseData";
import { withTenantSlug } from "@/lib/tenantRouting";

type DashboardMode = "eventos" | "treinos" | "produtos";

type MetricRow = {
  name: string;
  quantity: number;
  value: number;
  average?: number;
  secondary?: number;
};

type Kpi = {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone: string;
};

type EventRow = Row & { id?: unknown; titulo?: unknown; data?: unknown; hora?: unknown };
type TicketRow = Row & {
  eventoId?: unknown;
  eventoNome?: unknown;
  userId?: unknown;
  userName?: unknown;
  userTurma?: unknown;
  status?: unknown;
  loteNome?: unknown;
  quantidade?: unknown;
  valorTotal?: unknown;
  dataSolicitacao?: unknown;
  dataAprovacao?: unknown;
  aprovadoPor?: unknown;
  payment_config?: unknown;
};
type TreinoRow = Row & {
  id?: unknown;
  modalidade?: unknown;
  dia?: unknown;
  diaSemana?: unknown;
  horario?: unknown;
  treinador?: unknown;
  status?: unknown;
};
type ChamadaRow = Row & {
  treinoId?: unknown;
  userId?: unknown;
  nome?: unknown;
  turma?: unknown;
  status?: unknown;
  origem?: unknown;
  performanceRating?: unknown;
};
type RsvpRow = Row & {
  treinoId?: unknown;
  userId?: unknown;
  userName?: unknown;
  userTurma?: unknown;
  status?: unknown;
};
type ProductRow = Row & {
  id?: unknown;
  nome?: unknown;
  lote?: unknown;
  categoria?: unknown;
  preco?: unknown;
  likes?: unknown;
  cliques?: unknown;
  vendidos?: unknown;
  seller_type?: unknown;
  seller_id?: unknown;
  seller_name?: unknown;
};
type OrderRow = Row & {
  userId?: unknown;
  userName?: unknown;
  productId?: unknown;
  productName?: unknown;
  quantidade?: unknown;
  total?: unknown;
  price?: unknown;
  status?: unknown;
  createdAt?: unknown;
  seller_type?: unknown;
  seller_id?: unknown;
  seller_name?: unknown;
  data?: unknown;
};
type UserRow = Row & { uid?: unknown; turma?: unknown };

type LoadedData = {
  events: EventRow[];
  tickets: TicketRow[];
  treinos: TreinoRow[];
  chamada: ChamadaRow[];
  rsvps: RsvpRow[];
  products: ProductRow[];
  orders: OrderRow[];
  users: UserRow[];
};

const COLORS = ["#2dd4bf", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#fb7185"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

const emptyLoadedData: LoadedData = {
  events: [],
  tickets: [],
  treinos: [],
  chamada: [],
  rsvps: [],
  products: [],
  orders: [],
  users: [],
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0
  );

const parseNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const parsed = toDate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const statusKey = (value: unknown): string => asString(value).trim().toLowerCase();

const isApprovedStatus = (value: unknown): boolean =>
  ["aprovado", "approved", "pago", "paid", "entregue", "presente"].includes(statusKey(value));

const addMetric = (
  map: Map<string, MetricRow>,
  name: string,
  quantity: number,
  value: number,
  secondary = 0
) => {
  const key = name.trim() || "Sem dado";
  const current = map.get(key) ?? { name: key, quantity: 0, value: 0, secondary: 0 };
  current.quantity += quantity;
  current.value += value;
  current.secondary = (current.secondary ?? 0) + secondary;
  current.average = current.quantity > 0 ? current.value / current.quantity : 0;
  map.set(key, current);
};

const metricRows = (map: Map<string, MetricRow>, limit?: number): MetricRow[] => {
  const rows = Array.from(map.values()).sort(
    (left, right) =>
      right.value - left.value ||
      right.quantity - left.quantity ||
      left.name.localeCompare(right.name)
  );
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
};

const rowDateWeekday = (value: unknown): string => {
  const date = parseDate(value);
  return date ? WEEKDAYS[date.getDay()] ?? "Sem data" : "Sem data";
};

const rowDatePeriod = (value: unknown): string => {
  const date = parseDate(value);
  if (!date) return "Sem horario";
  const hour = date.getHours();
  if (hour < 6) return "Madrugada";
  if (hour < 12) return "Manha";
  if (hour < 18) return "Tarde";
  return "Noite";
};

const hourBucket = (value: unknown): string => {
  const date = parseDate(value);
  if (!date) return "Sem horario";
  return `${String(date.getHours()).padStart(2, "0")}:00`;
};

const readTicketEntries = (paymentConfig: unknown): Row[] => {
  const config = asObject(paymentConfig);
  if (!config) return [];
  const entries = config.ticketEntries || config.tickets || config.ingressos;
  return Array.isArray(entries) ? entries.filter((entry): entry is Row => Boolean(asObject(entry))) : [];
};

async function queryRows(
  table: string,
  select: string,
  tenantId: string,
  orderColumn: string,
  limit = 2500
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select(select).order(orderColumn, { ascending: false }).limit(limit);
  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as Row[]) : [];
}

async function loadDashboardData(mode: DashboardMode, tenantId: string): Promise<LoadedData> {
  if (mode === "eventos") {
    const [events, tickets] = await Promise.all([
      queryRows("eventos", "id,titulo,data,hora,lotes,stats,tenant_id,createdAt", tenantId, "data", 160),
      queryRows(
        "solicitacoes_ingressos",
        "id,eventoId,eventoNome,userId,userName,userTurma,status,loteNome,quantidade,valorTotal,dataSolicitacao,dataAprovacao,aprovadoPor,payment_config,tenant_id",
        tenantId,
        "dataSolicitacao",
        3500
      ),
    ]);
    return { ...emptyLoadedData, events: events as EventRow[], tickets: tickets as TicketRow[] };
  }

  if (mode === "treinos") {
    const [treinos, chamada, rsvps] = await Promise.all([
      queryRows(
        "treinos",
        "id,modalidade,dia,diaSemana,horario,local,treinador,status,tenant_id,createdAt",
        tenantId,
        "dia",
        1200
      ),
      queryRows(
        "treinos_chamada",
        "id,treinoId,userId,nome,turma,status,origem,performanceRating,timestamp,tenant_id",
        tenantId,
        "timestamp",
        5000
      ),
      queryRows(
        "treinos_rsvps",
        "id,treinoId,userId,userName,userTurma,status,timestamp,tenant_id",
        tenantId,
        "timestamp",
        5000
      ),
    ]);
    return {
      ...emptyLoadedData,
      treinos: treinos as TreinoRow[],
      chamada: chamada as ChamadaRow[],
      rsvps: rsvps as RsvpRow[],
    };
  }

  const [products, orders, users] = await Promise.all([
    queryRows(
      "produtos",
      "id,nome,lote,categoria,preco,likes,cliques,vendidos,seller_type,seller_id,seller_name,tenant_id,createdAt",
      tenantId,
      "createdAt",
      1600
    ),
    queryRows(
      "orders",
      "id,userId,userName,productId,productName,quantidade,total,price,status,createdAt,seller_type,seller_id,seller_name,data,tenant_id",
      tenantId,
      "createdAt",
      5000
    ),
    queryRows("users", "uid,turma,tenant_id,createdAt", tenantId, "createdAt", 5000),
  ]);
  return {
    ...emptyLoadedData,
    products: products as ProductRow[],
    orders: orders as OrderRow[],
    users: users as UserRow[],
  };
}

function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{item.label}</p>
              <p className="mt-3 text-3xl font-black text-white">{item.value}</p>
            </div>
            <div className={`rounded-lg p-2 ${item.tone}`}>{item.icon}</div>
          </div>
          <p className="mt-3 text-xs font-bold text-zinc-500">{item.hint}</p>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
      <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-zinc-400">{title}</h2>
      <div className="h-[310px] min-w-0">{children}</div>
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm font-bold text-zinc-600">
      Sem dados para o filtro atual.
    </div>
  );
}

function Bars({ data, dataKey = "quantity" }: { data: MetricRow[]; dataKey?: "quantity" | "value" | "secondary" }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 18, right: 18, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#27272a" horizontal={false} />
        <XAxis type="number" stroke="#71717a" tick={{ fontSize: 11 }} />
        <YAxis dataKey="name" type="category" width={92} stroke="#a1a1aa" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => (dataKey === "value" ? formatCurrency(Number(value)) : formatNumber(Number(value)))} />
        <Bar dataKey={dataKey} radius={[0, 6, 6, 0]} fill="#2dd4bf" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarsDual({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 8, right: 18, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" stroke="#2dd4bf" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value, name) => (name === "value" ? formatCurrency(Number(value)) : formatNumber(Number(value)))} />
        <Legend />
        <Bar yAxisId="left" dataKey="quantity" name="Qtd" fill="#2dd4bf" radius={[6, 6, 0, 0]} />
        <Bar yAxisId="right" dataKey="value" name="Valor" fill="#fbbf24" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieMetric({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data.slice(0, 8)} dataKey="quantity" nameKey="name" innerRadius={62} outerRadius={112} paddingAngle={2}>
          {data.slice(0, 8).map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatNumber(Number(value))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Trend({ data, valueKey = "quantity" }: { data: MetricRow[]; valueKey?: "quantity" | "value" }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ left: 8, right: 18, top: 10, bottom: 8 }}>
        <defs>
          <linearGradient id={`bi-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.62} />
            <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
        <YAxis stroke="#71717a" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => (valueKey === "value" ? formatCurrency(Number(value)) : formatNumber(Number(value)))} />
        <Area type="monotone" dataKey={valueKey} stroke="#2dd4bf" fill={`url(#bi-${valueKey})`} strokeWidth={3} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function LineMetric({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 8, right: 18, top: 10, bottom: 8 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
        <YAxis stroke="#71717a" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => formatNumber(Number(value))} />
        <Line type="monotone" dataKey="quantity" stroke="#2dd4bf" strokeWidth={3} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EventsBi({ data }: { data: LoadedData }) {
  const [eventId, setEventId] = useState("todos");
  const eventOptions = data.events
    .map((event) => ({ id: asString(event.id), title: asString(event.titulo, "Evento") }))
    .filter((event) => event.id);

  const selectedTickets = useMemo(() => {
    const rows =
      eventId === "todos"
        ? data.tickets
        : data.tickets.filter((row) => asString(row.eventoId) === eventId);
    return rows.filter((row) => isApprovedStatus(row.status));
  }, [data.tickets, eventId]);

  const analytics = useMemo(() => {
    const byClass = new Map<string, MetricRow>();
    const byLote = new Map<string, MetricRow>();
    const byWeekday = new Map<string, MetricRow>();
    const byPeriod = new Map<string, MetricRow>();
    const byApprover = new Map<string, MetricRow>();
    const byScanHour = new Map<string, MetricRow>();
    let revenue = 0;
    let quantity = 0;
    let scanned = 0;

    selectedTickets.forEach((ticket) => {
      const qtd = Math.max(1, Math.floor(parseNumber(ticket.quantidade, 1)));
      const value = parseNumber(ticket.valorTotal, 0);
      revenue += value;
      quantity += qtd;
      addMetric(byClass, asString(ticket.userTurma, "Sem turma"), qtd, value);
      addMetric(byLote, asString(ticket.loteNome, "Lote"), qtd, value);
      addMetric(byWeekday, rowDateWeekday(ticket.dataSolicitacao), qtd, value);
      addMetric(byPeriod, rowDatePeriod(ticket.dataSolicitacao), qtd, value);
      addMetric(byApprover, asString(ticket.aprovadoPor, "Sem aprovador"), qtd, value);

      readTicketEntries(ticket.payment_config).forEach((entry) => {
        const scannedAt = asString(entry.scannedAt);
        if (!scannedAt) return;
        scanned += 1;
        addMetric(byScanHour, hourBucket(scannedAt), 1, value / Math.max(1, qtd));
      });
    });

    return {
      revenue,
      quantity,
      scanned,
      byClass: metricRows(byClass),
      byLote: metricRows(byLote),
      byWeekday: WEEKDAYS.map((day) => byWeekday.get(day) ?? { name: day, quantity: 0, value: 0 }),
      byPeriod: ["Madrugada", "Manha", "Tarde", "Noite"].map(
        (period) => byPeriod.get(period) ?? { name: period, quantity: 0, value: 0 }
      ),
      byApprover: metricRows(byApprover, 10),
      byScanHour: metricRows(byScanHour).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [selectedTickets]);

  const kpis: Kpi[] = [
    {
      label: "Receita",
      value: formatCurrency(analytics.revenue),
      hint: `${formatNumber(analytics.quantity)} ingressos vendidos`,
      icon: <DollarSign size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Pedidos aprovados",
      value: formatNumber(selectedTickets.length),
      hint: "comprovantes aprovados",
      icon: <Ticket size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Check-ins",
      value: formatNumber(analytics.scanned),
      hint: "leituras registradas na entrada",
      icon: <Users size={18} />,
      tone: "bg-violet-500/15 text-violet-300",
    },
    {
      label: "Ticket medio",
      value: formatCurrency(analytics.quantity ? analytics.revenue / analytics.quantity : 0),
      hint: "valor por ingresso",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
  ];

  return (
    <DashboardShell title="Gestao de Eventos" subtitle="Vendas, lotes, aprovadores e scan de entrada" mode="eventos">
      <Filters value={eventId} onChange={setEventId} allLabel="Todos os eventos" options={eventOptions} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Turmas por quantidade e valor"><BarsDual data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Lotes mais vendidos"><PieMetric data={analytics.byLote} /></ChartPanel>
        <ChartPanel title="Dias da semana"><Trend data={analytics.byWeekday} valueKey="value" /></ChartPanel>
        <ChartPanel title="Periodo do dia"><BarsDual data={analytics.byPeriod} /></ChartPanel>
        <ChartPanel title="Comprovantes por aprovador"><Bars data={analytics.byApprover} dataKey="quantity" /></ChartPanel>
        <ChartPanel title="Scaneamento por horario"><LineMetric data={analytics.byScanHour} /></ChartPanel>
      </div>
    </DashboardShell>
  );
}

function TrainingsBi({ data }: { data: LoadedData }) {
  const [modalidade, setModalidade] = useState("todas");
  const treinoMap = useMemo(
    () => new Map(data.treinos.map((treino) => [asString(treino.id), treino])),
    [data.treinos]
  );
  const options = Array.from(
    new Set(data.treinos.map((treino) => asString(treino.modalidade, "Treino")).filter(Boolean))
  ).map((name) => ({ id: name, title: name }));
  const selectedTreinoIds = new Set(
    data.treinos
      .filter((treino) => modalidade === "todas" || asString(treino.modalidade, "Treino") === modalidade)
      .map((treino) => asString(treino.id))
  );
  const selectedChamada = data.chamada.filter((row) => selectedTreinoIds.has(asString(row.treinoId)));
  const presentes = selectedChamada.filter((row) => statusKey(row.status) === "presente");
  const selectedRsvps = data.rsvps.filter(
    (row) => selectedTreinoIds.has(asString(row.treinoId)) && statusKey(row.status) === "going"
  );

  const analytics = useMemo(() => {
    const byClass = new Map<string, MetricRow>();
    const byUser = new Map<string, MetricRow>();
    const byModalidade = new Map<string, MetricRow>();
    const byWeekday = new Map<string, MetricRow>();
    const byHour = new Map<string, MetricRow>();
    const byCoach = new Map<string, MetricRow>();
    const rated = presentes.filter((row) => parseNumber(row.performanceRating, 0) > 0);

    presentes.forEach((row) => {
      const treino = treinoMap.get(asString(row.treinoId));
      addMetric(byClass, asString(row.turma, "Sem turma"), 1, 0);
      addMetric(byUser, asString(row.nome, "Aluno"), 1, 0);
      addMetric(byModalidade, asString(treino?.modalidade, "Treino"), 1, 0);
      addMetric(byWeekday, asString(treino?.diaSemana) || rowDateWeekday(treino?.dia), 1, 0);
      addMetric(byHour, asString(treino?.horario, "Sem horario"), 1, 0);
      addMetric(byCoach, asString(treino?.treinador, "Sem treinador"), 1, 0);
    });

    data.treinos.forEach((treino) => {
      if (modalidade !== "todas" && asString(treino.modalidade, "Treino") !== modalidade) return;
      const current = byModalidade.get(asString(treino.modalidade, "Treino")) ?? {
        name: asString(treino.modalidade, "Treino"),
        quantity: 0,
        value: 0,
        secondary: 0,
      };
      current.secondary = (current.secondary ?? 0) + 1;
      byModalidade.set(current.name, current);
    });

    const presentKeys = new Set(presentes.map((row) => `${asString(row.treinoId)}:${asString(row.userId)}`));
    const noShows = selectedRsvps.filter(
      (row) => !presentKeys.has(`${asString(row.treinoId)}:${asString(row.userId)}`)
    ).length;
    const ratingAverage =
      rated.reduce((sum, row) => sum + parseNumber(row.performanceRating, 0), 0) / Math.max(1, rated.length);

    return {
      noShows,
      ratingAverage,
      byClass: metricRows(byClass),
      byUser: metricRows(byUser, 12),
      byModalidade: metricRows(byModalidade),
      byWeekday: metricRows(byWeekday),
      byHour: metricRows(byHour),
      byCoach: metricRows(byCoach, 10),
    };
  }, [data.treinos, modalidade, presentes, selectedRsvps, treinoMap]);

  const kpis: Kpi[] = [
    {
      label: "Treinos",
      value: formatNumber(selectedTreinoIds.size),
      hint: "sessoes no filtro",
      icon: <CalendarDays size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Confirmacoes",
      value: formatNumber(selectedRsvps.length),
      hint: "RSVPs no app",
      icon: <Users size={18} />,
      tone: "bg-violet-500/15 text-violet-300",
    },
    {
      label: "Presencas reais",
      value: formatNumber(presentes.length),
      hint: `${formatNumber(analytics.noShows)} no-shows`,
      icon: <Trophy size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Nota media",
      value: analytics.ratingAverage ? analytics.ratingAverage.toFixed(1) : "-",
      hint: "desempenho por estrelas",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
  ];

  return (
    <DashboardShell title="Gestao de Treinos" subtitle="Participacao por turma, usuario, modalidade e horario" mode="treinos">
      <Filters value={modalidade} onChange={setModalidade} allLabel="Todas as modalidades" options={options} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Turmas mais presentes"><Bars data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Usuarios que mais participam"><Bars data={analytics.byUser} /></ChartPanel>
        <ChartPanel title="Modalidades: presencas x sessoes"><BarsDual data={analytics.byModalidade} /></ChartPanel>
        <ChartPanel title="Dias com mais adesao"><PieMetric data={analytics.byWeekday} /></ChartPanel>
        <ChartPanel title="Horarios com mais presenca"><Trend data={analytics.byHour} /></ChartPanel>
        <ChartPanel title="Presenca por treinador"><Bars data={analytics.byCoach} /></ChartPanel>
      </div>
    </DashboardShell>
  );
}

function ProductsBi({ data }: { data: LoadedData }) {
  const [productId, setProductId] = useState("todos");
  const productMap = useMemo(
    () => new Map(data.products.map((product) => [asString(product.id), product])),
    [data.products]
  );
  const userTurma = useMemo(
    () => new Map(data.users.map((user) => [asString(user.uid), asString(user.turma, "Sem turma")])),
    [data.users]
  );
  const productOptions = data.products
    .map((product) => ({ id: asString(product.id), title: asString(product.nome, "Produto") }))
    .filter((product) => product.id);

  const selectedOrders = data.orders.filter((order) => {
    if (!isApprovedStatus(order.status)) return false;
    if (productId === "todos") return true;
    return asString(order.productId) === productId;
  });

  const analytics = useMemo(() => {
    const byLote = new Map<string, MetricRow>();
    const byWeekday = new Map<string, MetricRow>();
    const byClass = new Map<string, MetricRow>();
    const byUser = new Map<string, MetricRow>();
    const likes = new Map<string, MetricRow>();
    const vendors = new Map<string, MetricRow>();
    let revenue = 0;
    let quantity = 0;

    selectedOrders.forEach((order) => {
      const product = productMap.get(asString(order.productId));
      const qtd = Math.max(1, Math.floor(parseNumber(order.quantidade, 1)));
      const value = parseNumber(order.total, parseNumber(order.price, 0) * qtd);
      const orderData = asObject(order.data);
      const turmaFromData = asString(orderData?.userTurma || orderData?.turma);
      const turma = turmaFromData || userTurma.get(asString(order.userId)) || "Sem turma";
      const sellerType = asString(order.seller_type || product?.seller_type, "tenant");
      const sellerName = asString(order.seller_name || product?.seller_name);
      const sellerLabel = sellerType === "mini_vendor" ? sellerName || "Mini vendor" : "Tenant";

      revenue += value;
      quantity += qtd;
      addMetric(byLote, asString(product?.lote, "Sem lote"), qtd, value);
      addMetric(byWeekday, rowDateWeekday(order.createdAt), qtd, value);
      addMetric(byClass, turma, qtd, value);
      addMetric(byUser, asString(order.userName, "Usuario"), qtd, value);
      addMetric(vendors, sellerLabel, qtd, value);
    });

    const productsForLikes =
      productId === "todos"
        ? data.products
        : data.products.filter((product) => asString(product.id) === productId);
    productsForLikes.forEach((product) => {
      const likeCount = Array.isArray(product.likes) ? product.likes.length : parseNumber(product.likes, 0);
      const clicks = parseNumber(product.cliques, 0);
      addMetric(likes, asString(product.nome, "Produto"), likeCount, 0, clicks);
    });

    return {
      revenue,
      quantity,
      byLote: metricRows(byLote),
      byWeekday: WEEKDAYS.map((day) => byWeekday.get(day) ?? { name: day, quantity: 0, value: 0 }),
      byClass: metricRows(byClass),
      byUser: metricRows(byUser, 12),
      likes: metricRows(likes, 12),
      vendors: metricRows(vendors, 12),
    };
  }, [data.products, productId, productMap, selectedOrders, userTurma]);

  const likeTotal = analytics.likes.reduce((sum, row) => sum + row.quantity, 0);
  const kpis: Kpi[] = [
    {
      label: "Receita",
      value: formatCurrency(analytics.revenue),
      hint: `${formatNumber(analytics.quantity)} itens vendidos`,
      icon: <DollarSign size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Pedidos",
      value: formatNumber(selectedOrders.length),
      hint: "aprovados no filtro",
      icon: <Package size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Ticket medio",
      value: formatCurrency(selectedOrders.length ? analytics.revenue / selectedOrders.length : 0),
      hint: "por pedido",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
    {
      label: "Likes",
      value: formatNumber(likeTotal),
      hint: "interesse dos produtos",
      icon: <Trophy size={18} />,
      tone: "bg-violet-500/15 text-violet-300",
    },
  ];

  return (
    <DashboardShell title="Gestao de Produtos" subtitle="Vendas, lotes, turmas, compradores e likes" mode="produtos">
      <Filters value={productId} onChange={setProductId} allLabel="Todos os produtos" options={productOptions} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Lotes por quantidade e valor"><BarsDual data={analytics.byLote} /></ChartPanel>
        <ChartPanel title="Dias da semana"><Trend data={analytics.byWeekday} valueKey="value" /></ChartPanel>
        <ChartPanel title="Turmas por consumo"><BarsDual data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Usuarios que mais gastaram"><Bars data={analytics.byUser} dataKey="value" /></ChartPanel>
        <ChartPanel title="Likes e cliques por produto"><BarsDual data={analytics.likes} /></ChartPanel>
        <ChartPanel title="Tenant x mini vendors"><PieMetric data={analytics.vendors} /></ChartPanel>
      </div>
    </DashboardShell>
  );
}

function Filters({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: Array<{ id: string; title: string }>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-black/40 p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
        <BarChart3 size={16} className="text-cyan-300" />
        Filtro analitico
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
      >
        <option value="todos">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function DashboardShell({
  title,
  subtitle,
  mode,
  children,
}: {
  title: string;
  subtitle: string;
  mode: DashboardMode;
  children: React.ReactNode;
}) {
  const { tenantSlug } = useTenantTheme();
  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const links = [
    { id: "eventos", label: "Eventos", href: tenantSlug ? withTenantSlug(tenantSlug, "/admin/gestao/eventos") : "/admin/gestao/eventos" },
    { id: "treinos", label: "Treinos", href: tenantSlug ? withTenantSlug(tenantSlug, "/admin/gestao/treinos") : "/admin/gestao/treinos" },
    { id: "produtos", label: "Produtos", href: tenantSlug ? withTenantSlug(tenantSlug, "/admin/gestao/produtos") : "/admin/gestao/produtos" },
  ];

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-5 text-white md:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href={backHref} className="rounded-lg border border-zinc-800 bg-black p-2 text-zinc-300 hover:text-white">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">BI Admin</p>
              <h1 className="mt-1 text-2xl font-black uppercase text-white">{title}</h1>
              <p className="mt-1 text-sm font-bold text-zinc-500">{subtitle}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            {links.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                  mode === link.id
                    ? "border-cyan-400 bg-cyan-400 text-black"
                    : "border-zinc-800 bg-black text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}

const modeTitle = (mode: DashboardMode): string =>
  mode === "eventos" ? "Gestao de Eventos" : mode === "treinos" ? "Gestao de Treinos" : "Gestao de Produtos";

export default function AdminBiDashboard({ mode }: { mode: DashboardMode }) {
  const { tenantId } = useTenantTheme();
  const [data, setData] = useState<LoadedData>(emptyLoadedData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void loadDashboardData(mode, tenantId.trim())
      .then((nextData) => {
        if (mounted) setData(nextData);
      })
      .catch((loadError: unknown) => {
        console.error(loadError);
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Erro ao carregar BI.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [mode, tenantId]);

  if (loading) {
    return (
      <DashboardShell title={modeTitle(mode)} subtitle="Carregando indicadores" mode={mode}>
        <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
          <Loader2 className="animate-spin text-cyan-300" />
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title={modeTitle(mode)} subtitle="Falha ao carregar indicadores" mode={mode}>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-sm font-bold text-red-200">
          {error}
        </div>
      </DashboardShell>
    );
  }

  if (mode === "eventos") return <EventsBi data={data} />;
  if (mode === "treinos") return <TrainingsBi data={data} />;
  return <ProductsBi data={data} />;
}
