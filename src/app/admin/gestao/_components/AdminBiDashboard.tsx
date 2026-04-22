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

import { EventManagementAnalytics } from "@/components/EventManagementAnalytics";
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
  local?: unknown;
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
type BiDimensionRow = Row & {
  evento_id?: unknown;
  produto_id?: unknown;
  evento_nome?: unknown;
  produto_nome?: unknown;
  modalidade?: unknown;
  dimension_type?: unknown;
  dimension_value?: unknown;
  pedidos?: unknown;
  quantidade?: unknown;
  valor?: unknown;
  ticket_medio?: unknown;
  presencas?: unknown;
  usuarios_unicos?: unknown;
  treinos_com_presenca?: unknown;
  nota_media?: unknown;
};
type BiCheckinHourRow = Row & {
  evento_id?: unknown;
  hora_label?: unknown;
  checkins?: unknown;
};
type BiTrainingModalityRow = Row & {
  modalidade?: unknown;
  sessoes?: unknown;
  presencas?: unknown;
  confirmacoes?: unknown;
  no_shows?: unknown;
  nota_media?: unknown;
};
type BiProductEngagementRow = Row & {
  produto_id?: unknown;
  produto_nome?: unknown;
  likes?: unknown;
  cliques?: unknown;
  vendidos?: unknown;
};

type LoadedData = {
  events: EventRow[];
  tickets: TicketRow[];
  treinos: TreinoRow[];
  chamada: ChamadaRow[];
  rsvps: RsvpRow[];
  products: ProductRow[];
  orders: OrderRow[];
  users: UserRow[];
  eventSales: BiDimensionRow[];
  eventCheckins: BiCheckinHourRow[];
  trainingPresence: BiDimensionRow[];
  trainingModalities: BiTrainingModalityRow[];
  productSales: BiDimensionRow[];
  productEngagement: BiProductEngagementRow[];
};

const COLORS = ["#2dd4bf", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#fb7185"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const chartTooltipProps = {
  contentStyle: {
    backgroundColor: "#09090b",
    border: "1px solid #27272a",
    borderRadius: 8,
    color: "#e4e4e7",
    boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  },
  labelStyle: { color: "#67e8f9", fontWeight: 800 },
  itemStyle: { color: "#e4e4e7", fontWeight: 700 },
};

const emptyLoadedData: LoadedData = {
  events: [],
  tickets: [],
  treinos: [],
  chamada: [],
  rsvps: [],
  products: [],
  orders: [],
  users: [],
  eventSales: [],
  eventCheckins: [],
  trainingPresence: [],
  trainingModalities: [],
  productSales: [],
  productEngagement: [],
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

const formatPercent = (value: number): string =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    Number.isFinite(value) ? value : 0
  )}%`;

const formatShortDate = (value: unknown): string => {
  const raw = asString(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = parseDate(raw);
  return date ? date.toLocaleDateString("pt-BR") : "Sem data";
};

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
  if (!date) return "Sem horário";
  const hour = date.getHours();
  if (hour < 6) return "Madrugada";
  if (hour < 12) return "Manhã";
  if (hour < 18) return "Tarde";
  return "Noite";
};

const hourBucket = (value: unknown): string => {
  const date = parseDate(value);
  if (!date) return "Sem horário";
  return `${String(date.getHours()).padStart(2, "0")}:00`;
};

const readTicketEntries = (paymentConfig: unknown): Row[] => {
  const config = asObject(paymentConfig);
  if (!config) return [];
  const entries = config.ticketEntries || config.tickets || config.ingressos;
  return Array.isArray(entries) ? entries.filter((entry): entry is Row => Boolean(asObject(entry))) : [];
};

const aggregateDimensionRows = (
  rows: BiDimensionRow[],
  dimensionType: string,
  options?: {
    quantityField?: "quantidade" | "presencas" | "pedidos" | "usuarios_unicos" | "treinos_com_presenca";
    valueField?: "valor" | "nota_media";
    secondaryField?: "pedidos" | "usuarios_unicos" | "treinos_com_presenca" | "presencas";
    limit?: number;
  }
): MetricRow[] => {
  const map = new Map<string, MetricRow>();
  const quantityField = options?.quantityField ?? "quantidade";
  const valueField = options?.valueField ?? "valor";

  rows
    .filter((row) => asString(row.dimension_type) === dimensionType)
    .forEach((row) => {
      addMetric(
        map,
        asString(row.dimension_value, "Sem dado"),
        parseNumber(row[quantityField], 0),
        parseNumber(row[valueField], 0),
        options?.secondaryField ? parseNumber(row[options.secondaryField], 0) : 0
      );
    });

  return metricRows(map, options?.limit);
};

const hasBiRows = (...groups: Row[][]): boolean =>
  groups.some((group) => Array.isArray(group) && group.length > 0);

const extractMissingSchemaColumn = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const raw = error as { message?: unknown; details?: unknown };
  const text = [raw.message, raw.details]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.length > 0)
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
  limit = 2500
): Promise<Row[]> {
  const supabase = getSupabaseClient();
  let selectColumns = select
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  let canOrder = true;
  let canFilterTenant = tenantId.trim().length > 0;

  while (selectColumns.length > 0) {
    let query = supabase.from(table).select(selectColumns.join(",")).limit(limit);
    if (canOrder) {
      query = query.order(orderColumn, { ascending: false });
    }
    if (canFilterTenant) {
      query = query.eq("tenant_id", tenantId);
    }
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

async function queryRowsOptional(
  table: string,
  select: string,
  tenantId: string,
  orderColumn: string,
  limit = 2500
): Promise<Row[]> {
  try {
    return await queryRows(table, select, tenantId, orderColumn, limit);
  } catch (error) {
    console.warn(`BI agregado indisponivel em ${table}; usando dados crus quando possivel.`, error);
    return [];
  }
}

async function loadDashboardData(mode: DashboardMode, tenantId: string): Promise<LoadedData> {
  if (mode === "eventos") {
    const [events, eventSales, eventCheckins, tickets] = await Promise.all([
      queryRows("eventos", "id,titulo,data,hora,lotes,stats,tenant_id,createdAt", tenantId, "data", 160),
      queryRowsOptional(
        "bi_eventos_vendas_dimensoes",
        "tenant_id,evento_id,evento_nome,dimension_type,dimension_value,pedidos,quantidade,valor,ticket_medio",
        tenantId,
        "quantidade",
        5000
      ),
      queryRowsOptional(
        "bi_eventos_checkins_hora",
        "tenant_id,evento_id,evento_nome,hora_label,turma,lote,leitor,checkins",
        tenantId,
        "hora_label",
        5000
      ),
      queryRows(
        "solicitacoes_ingressos",
        "id,eventoId,eventoNome,userId,userName,userTurma,status,loteNome,quantidade,valorTotal,dataSolicitacao,dataAprovacao,aprovadoPor,payment_config,tenant_id",
        tenantId,
        "dataSolicitacao",
        3500
      ),
    ]);
    return {
      ...emptyLoadedData,
      events: events as EventRow[],
      tickets: tickets as TicketRow[],
      eventSales: eventSales as BiDimensionRow[],
      eventCheckins: eventCheckins as BiCheckinHourRow[],
    };
  }

  if (mode === "treinos") {
    const [treinos, trainingPresence, trainingModalities, chamada, rsvps] = await Promise.all([
      queryRows(
        "treinos",
        "id,modalidade,dia,diaSemana,horario,local,treinador,status,tenant_id,createdAt",
        tenantId,
        "dia",
        1200
      ),
      queryRowsOptional(
        "bi_treinos_presencas_dimensoes",
        "tenant_id,modalidade,dimension_type,dimension_value,presencas,treinos_com_presenca,usuarios_unicos,nota_media",
        tenantId,
        "presencas",
        5000
      ),
      queryRowsOptional(
        "bi_treinos_modalidades",
        "tenant_id,modalidade,sessoes,presencas,confirmacoes,no_shows,nota_media",
        tenantId,
        "presencas",
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
      trainingPresence: trainingPresence as BiDimensionRow[],
      trainingModalities: trainingModalities as BiTrainingModalityRow[],
    };
  }

  const [products, productSales, productEngagement] = await Promise.all([
    queryRows(
      "produtos",
      "id,nome,lote,categoria,preco,likes,cliques,vendidos,seller_type,seller_id,seller_name,tenant_id,createdAt",
      tenantId,
      "createdAt",
      1600
    ),
    queryRowsOptional(
      "bi_produtos_vendas_dimensoes",
      "tenant_id,produto_id,produto_nome,dimension_type,dimension_value,pedidos,quantidade,valor,ticket_medio",
      tenantId,
      "quantidade",
      5000
    ),
    queryRowsOptional(
      "bi_produtos_engajamento",
      "tenant_id,produto_id,produto_nome,lote,categoria,seller_type,seller_id,seller_name,likes,cliques,vendidos,conversao_clique_compra",
      tenantId,
      "likes",
      2000
    ),
  ]);
  const [orders, users] = hasBiRows(productSales, productEngagement)
    ? [[], []]
    : await Promise.all([
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
    productSales: productSales as BiDimensionRow[],
    productEngagement: productEngagement as BiProductEngagementRow[],
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
        <Tooltip {...chartTooltipProps} formatter={(value) => (dataKey === "value" ? formatCurrency(Number(value)) : formatNumber(Number(value)))} />
        <Bar dataKey={dataKey} radius={[0, 6, 6, 0]} fill="#2dd4bf" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarsDual({
  data,
  quantityName = "Qtd",
  valueName = "Valor",
  valueAsCurrency = true,
}: {
  data: MetricRow[];
  quantityName?: string;
  valueName?: string;
  valueAsCurrency?: boolean;
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 8, right: 18, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" stroke="#2dd4bf" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" tick={{ fontSize: 11 }} />
        <Tooltip
          {...chartTooltipProps}
          formatter={(value, name) =>
            name === valueName && valueAsCurrency
              ? formatCurrency(Number(value))
              : formatNumber(Number(value))
          }
        />
        <Legend />
        <Bar yAxisId="left" dataKey="quantity" name={quantityName} fill="#2dd4bf" radius={[6, 6, 0, 0]} />
        <Bar yAxisId="right" dataKey="value" name={valueName} fill="#fbbf24" radius={[6, 6, 0, 0]} />
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
        <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(Number(value))} />
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
        <Tooltip {...chartTooltipProps} formatter={(value) => (valueKey === "value" ? formatCurrency(Number(value)) : formatNumber(Number(value)))} />
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
        <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(Number(value))} />
        <Line type="monotone" dataKey="quantity" stroke="#2dd4bf" strokeWidth={3} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EventsBi({ data }: { data: LoadedData }) {
  return (
    <DashboardShell title="Gestao de Eventos" subtitle="Vendas, funil, lotes, aprovadores e scan de entrada" mode="eventos">
      <EventManagementAnalytics events={data.events} tickets={data.tickets} allLabel="Todos os eventos" />
    </DashboardShell>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyEventsBi({ data }: { data: LoadedData }) {
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
  const selectedEventSales = useMemo(
    () =>
      eventId === "todos"
        ? data.eventSales
        : data.eventSales.filter((row) => asString(row.evento_id) === eventId),
    [data.eventSales, eventId]
  );
  const selectedEventCheckins = useMemo(
    () =>
      eventId === "todos"
        ? data.eventCheckins
        : data.eventCheckins.filter((row) => asString(row.evento_id) === eventId),
    [data.eventCheckins, eventId]
  );

  const analytics = useMemo(() => {
    if (selectedEventSales.length > 0) {
      const baseRows = selectedEventSales.filter((row) => asString(row.dimension_type) === "turma");
      const revenue = baseRows.reduce((sum, row) => sum + parseNumber(row.valor, 0), 0);
      const quantity = baseRows.reduce((sum, row) => sum + parseNumber(row.quantidade, 0), 0);
      const pedidos = baseRows.reduce((sum, row) => sum + parseNumber(row.pedidos, 0), 0);
      const checkinsByHour = new Map<string, MetricRow>();
      let scanned = 0;

      selectedEventCheckins.forEach((row) => {
        const checkins = parseNumber(row.checkins, 0);
        scanned += checkins;
        addMetric(checkinsByHour, asString(row.hora_label, "Sem horário"), checkins, 0);
      });

      return {
        revenue,
        quantity,
        pedidos,
        scanned,
        byClass: aggregateDimensionRows(selectedEventSales, "turma"),
        byLote: aggregateDimensionRows(selectedEventSales, "lote"),
        byWeekday: WEEKDAYS.map(
          (day) =>
            aggregateDimensionRows(selectedEventSales, "dia_semana").find((row) => row.name === day) ?? {
              name: day,
              quantity: 0,
              value: 0,
            }
        ),
        byPeriod: ["Madrugada", "Manhã", "Tarde", "Noite"].map(
          (period) =>
            aggregateDimensionRows(selectedEventSales, "periodo").find((row) => row.name === period) ?? {
              name: period,
              quantity: 0,
              value: 0,
            }
        ),
        byApprover: aggregateDimensionRows(selectedEventSales, "aprovador", { limit: 10 }),
        byScanHour: metricRows(checkinsByHour).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

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
      pedidos: selectedTickets.length,
      scanned,
      byClass: metricRows(byClass),
      byLote: metricRows(byLote),
      byWeekday: WEEKDAYS.map((day) => byWeekday.get(day) ?? { name: day, quantity: 0, value: 0 }),
      byPeriod: ["Madrugada", "Manhã", "Tarde", "Noite"].map(
        (period) => byPeriod.get(period) ?? { name: period, quantity: 0, value: 0 }
      ),
      byApprover: metricRows(byApprover, 10),
      byScanHour: metricRows(byScanHour).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [selectedEventCheckins, selectedEventSales, selectedTickets]);

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
      value: formatNumber(analytics.pedidos),
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
      label: "Ticket médio",
      value: formatCurrency(analytics.quantity ? analytics.revenue / analytics.quantity : 0),
      hint: "valor por ingresso",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
  ];

  return (
    <DashboardShell title="Gestão de Eventos" subtitle="Vendas, lotes, aprovadores e scan de entrada" mode="eventos">
      <Filters value={eventId} onChange={setEventId} allLabel="Todos os eventos" options={eventOptions} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Turmas por quantidade e valor"><BarsDual data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Lotes mais vendidos"><PieMetric data={analytics.byLote} /></ChartPanel>
        <ChartPanel title="Dias da semana"><Trend data={analytics.byWeekday} valueKey="value" /></ChartPanel>
        <ChartPanel title="Período do dia"><BarsDual data={analytics.byPeriod} /></ChartPanel>
        <ChartPanel title="Comprovantes por aprovador"><Bars data={analytics.byApprover} dataKey="quantity" /></ChartPanel>
        <ChartPanel title="Escaneamento por horário"><LineMetric data={analytics.byScanHour} /></ChartPanel>
      </div>
    </DashboardShell>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TrainingsBi({ data }: { data: LoadedData }) {
  const [modalidade, setModalidade] = useState("todas");
  const treinoMap = useMemo(
    () => new Map(data.treinos.map((treino) => [asString(treino.id), treino])),
    [data.treinos]
  );
  const options = Array.from(
    new Set([
      ...data.treinos.map((treino) => asString(treino.modalidade, "Treino")).filter(Boolean),
      ...data.trainingModalities.map((row) => asString(row.modalidade, "Treino")).filter(Boolean),
    ])
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
    if (data.trainingPresence.length > 0 || data.trainingModalities.length > 0) {
      const presenceRows =
        modalidade === "todas"
          ? data.trainingPresence
          : data.trainingPresence.filter((row) => asString(row.modalidade, "Treino") === modalidade);
      const modalityRows =
        modalidade === "todas"
          ? data.trainingModalities
          : data.trainingModalities.filter((row) => asString(row.modalidade, "Treino") === modalidade);
      const modalidadeMetrics = new Map<string, MetricRow>();
      let ratingSum = 0;
      let ratingWeight = 0;

      modalityRows.forEach((row) => {
        const name = asString(row.modalidade, "Treino");
        const presencas = parseNumber(row.presencas, 0);
        addMetric(modalidadeMetrics, name, presencas, 0, parseNumber(row.sessoes, 0));
        const nota = parseNumber(row.nota_media, 0);
        if (nota > 0 && presencas > 0) {
          ratingSum += nota * presencas;
          ratingWeight += presencas;
        }
      });

      return {
        noShows: modalityRows.reduce((sum, row) => sum + parseNumber(row.no_shows, 0), 0),
        ratingAverage: ratingWeight ? ratingSum / ratingWeight : 0,
        sessions: modalityRows.reduce((sum, row) => sum + parseNumber(row.sessoes, 0), 0),
        rsvps: modalityRows.reduce((sum, row) => sum + parseNumber(row.confirmacoes, 0), 0),
        presences: modalityRows.reduce((sum, row) => sum + parseNumber(row.presencas, 0), 0),
        byClass: aggregateDimensionRows(presenceRows, "turma", { quantityField: "presencas" }),
        byUser: aggregateDimensionRows(presenceRows, "usuario", { quantityField: "presencas", limit: 12 }),
        byModalidade: metricRows(modalidadeMetrics),
        byWeekday: aggregateDimensionRows(presenceRows, "dia_semana", { quantityField: "presencas" }),
        byHour: aggregateDimensionRows(presenceRows, "horario", { quantityField: "presencas" }),
        byCoach: aggregateDimensionRows(presenceRows, "treinador", { quantityField: "presencas", limit: 10 }),
      };
    }

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
      addMetric(byHour, asString(treino?.horario, "Sem horário"), 1, 0);
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
      sessions: selectedTreinoIds.size,
      rsvps: selectedRsvps.length,
      presences: presentes.length,
      byClass: metricRows(byClass),
      byUser: metricRows(byUser, 12),
      byModalidade: metricRows(byModalidade),
      byWeekday: metricRows(byWeekday),
      byHour: metricRows(byHour),
      byCoach: metricRows(byCoach, 10),
    };
  }, [data.trainingModalities, data.trainingPresence, data.treinos, modalidade, presentes, selectedRsvps, selectedTreinoIds.size, treinoMap]);

  const kpis: Kpi[] = [
    {
      label: "Treinos",
      value: formatNumber(analytics.sessions),
      hint: "sessões no filtro",
      icon: <CalendarDays size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Confirmações",
      value: formatNumber(analytics.rsvps),
      hint: "RSVPs no app",
      icon: <Users size={18} />,
      tone: "bg-violet-500/15 text-violet-300",
    },
    {
      label: "Presenças reais",
      value: formatNumber(analytics.presences),
      hint: `${formatNumber(analytics.noShows)} no-shows`,
      icon: <Trophy size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Nota média",
      value: analytics.ratingAverage ? analytics.ratingAverage.toFixed(1) : "-",
      hint: "desempenho por estrelas",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
  ];

  return (
    <DashboardShell title="Gestão de Treinos" subtitle="Participação por turma, usuário, modalidade e horário" mode="treinos">
      <Filters value={modalidade} onChange={setModalidade} allLabel="Todas as modalidades" options={options} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Turmas mais presentes"><Bars data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Usuários que mais participam"><Bars data={analytics.byUser} /></ChartPanel>
        <ChartPanel title="Modalidades: presenças x sessões"><BarsDual data={analytics.byModalidade} /></ChartPanel>
        <ChartPanel title="Dias com mais adesão"><PieMetric data={analytics.byWeekday} /></ChartPanel>
        <ChartPanel title="Horários com mais presença"><Trend data={analytics.byHour} /></ChartPanel>
        <ChartPanel title="Presença por treinador"><Bars data={analytics.byCoach} /></ChartPanel>
      </div>
    </DashboardShell>
  );
}

function TrainingsBiEnhanced({ data }: { data: LoadedData }) {
  const { tenantSlug } = useTenantTheme();
  const [modalidade, setModalidade] = useState("todas");
  const [trainingDate, setTrainingDate] = useState("todas");
  const treinoMap = useMemo(
    () => new Map(data.treinos.map((treino) => [asString(treino.id), treino])),
    [data.treinos]
  );
  const options = useMemo(
    () =>
      Array.from(
        new Set([
          ...data.treinos.map((treino) => asString(treino.modalidade, "Treino")).filter(Boolean),
          ...data.trainingModalities.map((row) => asString(row.modalidade, "Treino")).filter(Boolean),
        ])
      ).map((name) => ({ id: name, title: name })),
    [data.trainingModalities, data.treinos]
  );
  const dateOptions = useMemo(() => {
    const dates = Array.from(
      new Set(data.treinos.map((treino) => asString(treino.dia).trim()).filter(Boolean))
    ).sort((left, right) => right.localeCompare(left));
    return dates.map((date) => ({ id: date, title: formatShortDate(date) }));
  }, [data.treinos]);
  const selectedTreinos = useMemo(
    () =>
      data.treinos.filter((treino) => {
        const treinoModalidade = asString(treino.modalidade, "Treino");
        const treinoDate = asString(treino.dia).trim();
        return (
          (modalidade === "todas" || treinoModalidade === modalidade) &&
          (trainingDate === "todas" || treinoDate === trainingDate)
        );
      }),
    [data.treinos, modalidade, trainingDate]
  );
  const selectedTreinoIds = useMemo(
    () => new Set(selectedTreinos.map((treino) => asString(treino.id)).filter(Boolean)),
    [selectedTreinos]
  );
  const selectedChamada = useMemo(
    () => data.chamada.filter((row) => selectedTreinoIds.has(asString(row.treinoId))),
    [data.chamada, selectedTreinoIds]
  );
  const presentes = useMemo(
    () => selectedChamada.filter((row) => statusKey(row.status) === "presente"),
    [selectedChamada]
  );
  const selectedRsvps = useMemo(
    () =>
      data.rsvps.filter(
        (row) => selectedTreinoIds.has(asString(row.treinoId)) && statusKey(row.status) === "going"
      ),
    [data.rsvps, selectedTreinoIds]
  );

  const analytics = useMemo(() => {
    const byClass = new Map<string, MetricRow>();
    const byUser = new Map<string, MetricRow>();
    const byModalidade = new Map<string, MetricRow>();
    const byWeekday = new Map<string, MetricRow>();
    const byHour = new Map<string, MetricRow>();
    const byCoach = new Map<string, MetricRow>();
    const byLocation = new Map<string, MetricRow>();
    const byDate = new Map<string, MetricRow>();
    const byStatus = new Map<string, MetricRow>();
    const byOrigin = new Map<string, MetricRow>();
    const noShowByUser = new Map<string, MetricRow>();
    const rated = presentes.filter((row) => parseNumber(row.performanceRating, 0) > 0);
    const presentKeys = new Set(presentes.map((row) => `${asString(row.treinoId)}:${asString(row.userId)}`));
    const chamadaKeys = new Set(selectedChamada.map((row) => `${asString(row.treinoId)}:${asString(row.userId)}`));

    selectedTreinos.forEach((treino) => {
      const modalidadeName = asString(treino.modalidade, "Treino");
      const current = byModalidade.get(modalidadeName) ?? { name: modalidadeName, quantity: 0, value: 0 };
      current.value += 1;
      byModalidade.set(modalidadeName, current);

      const dateLabel = formatShortDate(treino.dia);
      const dateCurrent = byDate.get(dateLabel) ?? { name: dateLabel, quantity: 0, value: 0 };
      dateCurrent.value += 1;
      byDate.set(dateLabel, dateCurrent);
    });

    presentes.forEach((row) => {
      const treino = treinoMap.get(asString(row.treinoId));
      addMetric(byClass, asString(row.turma, "Sem turma"), 1, 0);
      addMetric(byUser, asString(row.nome, "Aluno"), 1, 0);
      addMetric(byModalidade, asString(treino?.modalidade, "Treino"), 1, 0);
      addMetric(byWeekday, asString(treino?.diaSemana) || rowDateWeekday(treino?.dia), 1, 0);
      addMetric(byHour, asString(treino?.horario, "Sem horário"), 1, 0);
      addMetric(byCoach, asString(treino?.treinador, "Sem treinador"), 1, 0);
      addMetric(byLocation, asString(treino?.local, "Sem local"), 1, 0);
      addMetric(
        byOrigin,
        statusKey(row.origem) === "app" ? "Presença do app" : "Presença manual",
        1,
        0
      );

      const dateLabel = formatShortDate(treino?.dia);
      const dateCurrent = byDate.get(dateLabel) ?? { name: dateLabel, quantity: 0, value: 0 };
      dateCurrent.quantity += 1;
      byDate.set(dateLabel, dateCurrent);
    });

    selectedChamada.forEach((row) => {
      const status = statusKey(row.status);
      const label =
        status === "falta"
          ? "Falta"
          : status === "justificado"
            ? "Justificativa"
            : "Presença";
      addMetric(byStatus, label, 1, 0);
    });

    const noShowRows = selectedRsvps.filter(
      (row) => !presentKeys.has(`${asString(row.treinoId)}:${asString(row.userId)}`)
    );
    selectedRsvps
      .filter((row) => !chamadaKeys.has(`${asString(row.treinoId)}:${asString(row.userId)}`))
      .forEach(() => addMetric(byStatus, "Confirmado", 1, 0));
    noShowRows.forEach((row) => addMetric(noShowByUser, asString(row.userName, "Aluno"), 1, 0));

    const ratingAverage =
      rated.reduce((sum, row) => sum + parseNumber(row.performanceRating, 0), 0) / Math.max(1, rated.length);
    const userRows = metricRows(byUser);
    const topFivePresences = userRows.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0);
    const uniqueUsers = userRows.length;
    const recurringUsers = userRows.filter((row) => row.quantity >= 2).length;
    const attendanceRate = selectedRsvps.length > 0 ? (presentes.length / selectedRsvps.length) * 100 : 0;
    const retentionRate = uniqueUsers > 0 ? (recurringUsers / uniqueUsers) * 100 : 0;
    const topFiveDependency = presentes.length > 0 ? (topFivePresences / presentes.length) * 100 : 0;
    const riskAthletes = metricRows(noShowByUser, 10);

    return {
      sessions: selectedTreinoIds.size,
      rsvps: selectedRsvps.length,
      presences: presentes.length,
      noShows: noShowRows.length,
      ratingAverage,
      attendanceRate,
      retentionRate,
      topFiveDependency,
      riskCount: riskAthletes.length,
      recurringUsers,
      uniqueUsers,
      byClass: metricRows(byClass),
      byUser: userRows.slice(0, 12),
      byModalidade: metricRows(byModalidade),
      byWeekday: metricRows(byWeekday),
      byHour: metricRows(byHour),
      byCoach: metricRows(byCoach, 10),
      byLocation: metricRows(byLocation, 10),
      byDate: metricRows(byDate).sort((left, right) => left.name.localeCompare(right.name)),
      byStatus: metricRows(byStatus),
      byOrigin: metricRows(byOrigin),
      riskAthletes,
      funnel: [
        { name: "Treinos criados", quantity: selectedTreinoIds.size, value: 0 },
        { name: "Confirmações", quantity: selectedRsvps.length, value: 0 },
        { name: "Presenças", quantity: presentes.length, value: 0 },
        { name: "No-shows", quantity: noShowRows.length, value: 0 },
      ],
    };
  }, [presentes, selectedChamada, selectedRsvps, selectedTreinoIds, selectedTreinos, treinoMap]);

  const kpis: Kpi[] = [
    {
      label: "Treinos",
      value: formatNumber(analytics.sessions),
      hint: "sessões no filtro",
      icon: <CalendarDays size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Confirmações",
      value: formatNumber(analytics.rsvps),
      hint: "RSVPs no app",
      icon: <Users size={18} />,
      tone: "bg-violet-500/15 text-violet-300",
    },
    {
      label: "Presenças reais",
      value: formatNumber(analytics.presences),
      hint: `${formatNumber(analytics.noShows)} no-shows`,
      icon: <Trophy size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Nota média",
      value: analytics.ratingAverage ? analytics.ratingAverage.toFixed(1) : "-",
      hint: "desempenho por estrelas",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
  ];
  const decisionKpis: Kpi[] = [
    {
      label: "Comparecimento",
      value: formatPercent(analytics.attendanceRate),
      hint: "presenças divididas por confirmações",
      icon: <Trophy size={18} />,
      tone: "bg-emerald-500/15 text-emerald-300",
    },
    {
      label: "Retenção",
      value: formatPercent(analytics.retentionRate),
      hint: `${formatNumber(analytics.recurringUsers)} recorrentes entre ${formatNumber(analytics.uniqueUsers)} atletas`,
      icon: <Users size={18} />,
      tone: "bg-cyan-500/15 text-cyan-300",
    },
    {
      label: "Dependência Top 5",
      value: formatPercent(analytics.topFiveDependency),
      hint: "peso dos 5 alunos mais presentes",
      icon: <BarChart3 size={18} />,
      tone: "bg-amber-500/15 text-amber-300",
    },
    {
      label: "Atletas em risco",
      value: formatNumber(analytics.riskCount),
      hint: "confirmaram e não compareceram no filtro",
      icon: <Users size={18} />,
      tone: "bg-red-500/15 text-red-300",
    },
  ];
  const frequencyHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/gestao/treinos/frequencia")
    : "/admin/gestao/treinos/frequencia";

  return (
    <DashboardShell title="Gestão de Treinos" subtitle="Participação por turma, usuário, modalidade, local e horário" mode="treinos">
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-black/40 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
          <BarChart3 size={16} className="text-cyan-300" />
          Filtro analítico
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <select
            value={modalidade}
            onChange={(event) => setModalidade(event.target.value)}
            className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
          >
            <option value="todas">Todas as modalidades</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <select
            value={trainingDate}
            onChange={(event) => setTrainingDate(event.target.value)}
            className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
          >
            <option value="todas">Todas as datas com treino</option>
            {dateOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <Link
            href={frequencyHref}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-400/50 bg-cyan-400/10 px-4 text-xs font-black uppercase tracking-wide text-cyan-200 hover:bg-cyan-400 hover:text-black"
          >
            Frequência por data
          </Link>
        </div>
      </div>
      <KpiGrid items={kpis} />
      <KpiGrid items={decisionKpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Turmas mais presentes"><Bars data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Usuários que mais participam"><Bars data={analytics.byUser} /></ChartPanel>
        <ChartPanel title="Modalidades: presenças x treinos cadastrados">
          <BarsDual data={analytics.byModalidade} quantityName="Presenças" valueName="Treinos cadastrados" valueAsCurrency={false} />
        </ChartPanel>
        <ChartPanel title="Status da frequência">
          <PieMetric data={analytics.byStatus} />
        </ChartPanel>
        <ChartPanel title="Presença do app x manual">
          <PieMetric data={analytics.byOrigin} />
        </ChartPanel>
        <ChartPanel title="Principais locais"><Bars data={analytics.byLocation} /></ChartPanel>
        <ChartPanel title="Funil de adesão"><Bars data={analytics.funnel} /></ChartPanel>
        <ChartPanel title="Dias com mais adesão"><PieMetric data={analytics.byWeekday} /></ChartPanel>
        <ChartPanel title="Horários com mais presença"><Trend data={analytics.byHour} /></ChartPanel>
        <ChartPanel title="Presença por treinador"><Bars data={analytics.byCoach} /></ChartPanel>
        <ChartPanel title="Presenças por data">
          <BarsDual data={analytics.byDate} quantityName="Presenças" valueName="Treinos" valueAsCurrency={false} />
        </ChartPanel>
        <ChartPanel title="Atletas em risco por no-show"><Bars data={analytics.riskAthletes} /></ChartPanel>
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
  const selectedProductSales = useMemo(
    () =>
      productId === "todos"
        ? data.productSales
        : data.productSales.filter((row) => asString(row.produto_id) === productId),
    [data.productSales, productId]
  );
  const selectedProductEngagement = useMemo(
    () =>
      productId === "todos"
        ? data.productEngagement
        : data.productEngagement.filter((row) => asString(row.produto_id) === productId),
    [data.productEngagement, productId]
  );

  const analytics = useMemo(() => {
    if (selectedProductSales.length > 0 || selectedProductEngagement.length > 0) {
      const baseRows = selectedProductSales.filter((row) => asString(row.dimension_type) === "lote");
      const likes = new Map<string, MetricRow>();
      selectedProductEngagement.forEach((product) => {
        addMetric(
          likes,
          asString(product.produto_nome, "Produto"),
          parseNumber(product.likes, 0),
          0,
          parseNumber(product.cliques, 0)
        );
      });

      return {
        revenue: baseRows.reduce((sum, row) => sum + parseNumber(row.valor, 0), 0),
        quantity: baseRows.reduce((sum, row) => sum + parseNumber(row.quantidade, 0), 0),
        pedidos: baseRows.reduce((sum, row) => sum + parseNumber(row.pedidos, 0), 0),
        byLote: aggregateDimensionRows(selectedProductSales, "lote"),
        byWeekday: WEEKDAYS.map(
          (day) =>
            aggregateDimensionRows(selectedProductSales, "dia_semana").find((row) => row.name === day) ?? {
              name: day,
              quantity: 0,
              value: 0,
            }
        ),
        byClass: aggregateDimensionRows(selectedProductSales, "turma"),
        byUser: aggregateDimensionRows(selectedProductSales, "usuario", { limit: 12 }),
        likes: metricRows(likes, 12),
        vendors: aggregateDimensionRows(selectedProductSales, "vendedor", { limit: 12 }),
      };
    }

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
      addMetric(byUser, asString(order.userName, "Usuário"), qtd, value);
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
      pedidos: selectedOrders.length,
      byLote: metricRows(byLote),
      byWeekday: WEEKDAYS.map((day) => byWeekday.get(day) ?? { name: day, quantity: 0, value: 0 }),
      byClass: metricRows(byClass),
      byUser: metricRows(byUser, 12),
      likes: metricRows(likes, 12),
      vendors: metricRows(vendors, 12),
    };
  }, [data.products, productId, productMap, selectedOrders, selectedProductEngagement, selectedProductSales, userTurma]);

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
      value: formatNumber(analytics.pedidos),
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
    <DashboardShell title="Gestão de Produtos" subtitle="Vendas, lotes, turmas, compradores e likes" mode="produtos">
      <Filters value={productId} onChange={setProductId} allLabel="Todos os produtos" options={productOptions} />
      <KpiGrid items={kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Lotes por quantidade e valor"><BarsDual data={analytics.byLote} /></ChartPanel>
        <ChartPanel title="Dias da semana"><Trend data={analytics.byWeekday} valueKey="value" /></ChartPanel>
        <ChartPanel title="Turmas por consumo"><BarsDual data={analytics.byClass} /></ChartPanel>
        <ChartPanel title="Usuários que mais gastaram"><Bars data={analytics.byUser} dataKey="value" /></ChartPanel>
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
        Filtro analítico
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
  mode === "eventos" ? "Gestão de Eventos" : mode === "treinos" ? "Gestão de Treinos" : "Gestão de Produtos";

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
  if (mode === "treinos") return <TrainingsBiEnhanced data={data} />;
  return <ProductsBi data={data} />;
}
