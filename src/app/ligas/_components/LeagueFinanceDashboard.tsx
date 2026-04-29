"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, BarChart3, CheckCircle2, Loader2, Package, QrCode, Ticket, Users, Wallet, XCircle } from "lucide-react";

import { EventManagementAnalytics } from "@/components/EventManagementAnalytics";
import { ProductManagementAnalytics } from "@/components/ProductManagementAnalytics";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { getSupabaseClient } from "@/lib/supabase";
import { asString as rawString, type Row } from "@/lib/supabaseData";
import { fetchLeagueById, fetchLeagueUsers, type LeagueRecord, type LeagueUserRecord } from "@/lib/leaguesService";
import { resolveLeagueLogoSrc } from "@/lib/leagueMedia";
import { withTenantSlug } from "@/lib/tenantRouting";
import { LeagueAdminQuickNav } from "./LeagueAdminQuickNav";

type MetricRow = {
  name: string;
  quantity: number;
  value: number;
};

type LeagueFinanceData = {
  league: LeagueRecord | null;
  leagueUsers: LeagueUserRecord[];
  products: Row[];
  productOrders: Row[];
  eventTickets: Row[];
};

const COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#22d3ee"];
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

const emptyFinanceData: LeagueFinanceData = {
  league: null,
  leagueUsers: [],
  products: [],
  productOrders: [],
  eventTickets: [],
};

const asString = (value: unknown): string => rawString(value).trim();

const asRecord = (value: unknown): Row | null =>
  typeof value === "object" && value !== null ? (value as Row) : null;

const parseNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asString(value);
  if (!text) return 0;
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseQuantity = (value: unknown, fallback = 1): number => {
  const parsed = Math.floor(parseNumber(value));
  return parsed > 0 ? parsed : fallback;
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

const statusIsApproved = (status: unknown): boolean => {
  const normalized = asString(status).toLowerCase();
  return ["approved", "aprovado", "aprovada", "delivered", "entregue", "validado"].includes(normalized);
};

const isLeagueSellerRow = (row: Row, leagueId: string): boolean =>
  asString(row.seller_id) === leagueId &&
  ["league", "tenant", ""].includes(asString(row.seller_type).toLowerCase());

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

const normalizeLeagueRoleKey = (value: unknown): string =>
  asString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const canScanInternalLeagueEvents = (role: unknown): boolean => {
  const key = normalizeLeagueRoleKey(role);
  return key === "presidente" || key === "vice-presidente" || key === "vice presidente" || key === "secretaria" || key === "secretario";
};

const addMetric = (map: Map<string, MetricRow>, name: string, quantity: number, value: number) => {
  const cleanName = name.trim() || "Sem nome";
  const current = map.get(cleanName) ?? { name: cleanName, quantity: 0, value: 0 };
  current.quantity += quantity;
  current.value += value;
  map.set(cleanName, current);
};

const sortMetrics = (map: Map<string, MetricRow>, limit = 8): MetricRow[] =>
  Array.from(map.values())
    .sort((a, b) => b.value - a.value || b.quantity - a.quantity)
    .slice(0, limit);

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

async function loadLeagueFinanceData(
  leagueId: string,
  tenantId: string
): Promise<LeagueFinanceData> {
  if (!leagueId) return emptyFinanceData;

  const [league, leagueUsers, productsRaw, ordersRaw, ticketsRaw] = await Promise.all([
    fetchLeagueById(leagueId, {
      forceRefresh: true,
      tenantId: tenantId || undefined,
    }),
    fetchLeagueUsers({
      maxResults: 2000,
      tenantId: tenantId || undefined,
    }),
    queryRows(
      "produtos",
      "id,nome,lote,preco,estoque,status,active,aprovado,vendidos,seller_type,seller_id,seller_name,tenant_id,createdAt",
      tenantId,
      "createdAt",
      1200
    ),
    queryRows(
      "orders",
      "id,userId,userName,productId,productName,quantidade,itens,total,price,status,createdAt,data,seller_type,seller_id,seller_name,tenant_id",
      tenantId,
      "createdAt",
      2400
    ),
    queryRows(
      "solicitacoes_ingressos",
      "id,eventoId,eventoNome,userId,userName,userTurma,status,loteNome,quantidade,valorTotal,dataSolicitacao,dataAprovacao,aprovadoPor,payment_config,tenant_id",
      tenantId,
      "dataSolicitacao",
      2400
    ),
  ]);

  const products = productsRaw.filter((row) => isLeagueSellerRow(row, leagueId));
  const productIds = new Set(products.map((row) => asString(row.id)).filter(Boolean));
  const eventIds = leagueEventIds(league);
  const eventNames = leagueEventNames(league);

  const productOrders = ordersRaw.filter((row) => {
    const belongsToProduct = productIds.has(asString(row.productId));
    const belongsToSeller = isLeagueSellerRow(row, leagueId);
    return belongsToProduct || belongsToSeller;
  });

  const eventTickets = ticketsRaw.filter((row) => {
    const eventId = asString(row.eventoId);
    const eventName = asString(row.eventoNome);
    return eventIds.has(eventId) || eventNames.has(eventName);
  });

  return {
    league,
    leagueUsers,
    products,
    productOrders,
    eventTickets,
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

function ChartPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase text-white">{title}</h2>
        <p className="mt-1 text-[11px] text-zinc-500">{subtitle}</p>
      </div>
      <div className="h-72">{children}</div>
    </section>
  );
}

export function LeagueFinanceDashboard({
  view = "hub",
  basePath,
  leagueIdOverride,
  showBoard = true,
  entityLabel = "liga",
  entityArticle = "da",
}: {
  view?: "hub" | "eventos" | "produtos";
  basePath?: string;
  leagueIdOverride?: string;
  showBoard?: boolean;
  entityLabel?: string;
  entityArticle?: "da" | "do";
}) {
  const params = useParams<{ leagueId?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { tenantId, tenantSlug } = useTenantTheme();
  const routeLeagueId = typeof params?.leagueId === "string" ? params.leagueId : "";
  const leagueId = leagueIdOverride?.trim() || routeLeagueId;
  const [data, setData] = useState<LeagueFinanceData>(emptyFinanceData);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const tenantPath = useCallback(
    (path: string) => (tenantSlug ? withTenantSlug(tenantSlug, path) : path),
    [tenantSlug]
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErrorMessage("");

    loadLeagueFinanceData(leagueId, tenantId)
      .then((result) => {
        if (!mounted) return;
        setData(result);
      })
      .catch((error) => {
        console.error("Falha ao carregar gestão financeira da liga:", error);
        if (!mounted) return;
        setErrorMessage("Não foi possível carregar a gestão financeira agora.");
        setData(emptyFinanceData);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [leagueId, tenantId]);

  const analytics = useMemo(() => {
    const productMap = new Map(data.products.map((product) => [asString(product.id), product]));
    const productSalesByName = new Map<string, MetricRow>();
    const productSalesByLot = new Map<string, MetricRow>();
    const eventSalesByName = new Map<string, MetricRow>();
    const eventSalesByLot = new Map<string, MetricRow>();
    const eventSalesByClass = new Map<string, MetricRow>();
    const eventSalesByWeekday = new Map<string, MetricRow>();
    const eventSalesByPeriod = new Map<string, MetricRow>();
    const eventApprovers = new Map<string, MetricRow>();
    const eventScanByHour = new Map<string, MetricRow>();

    let productRevenue = 0;
    let productQuantity = 0;
    let eventRevenue = 0;
    let eventQuantity = 0;
    let eventScanned = 0;

    const approvedProductOrders = data.productOrders.filter((order) => statusIsApproved(order.status));

    approvedProductOrders.forEach((order) => {
      const quantity = parseQuantity(order.quantidade ?? order.itens, 1);
      const total = parseNumber(order.total) || parseNumber(order.price) * quantity;
      const product = productMap.get(asString(order.productId));
      const productName = asString(order.productName) || asString(product?.nome) || "Produto";
      const lotName = asString(product?.lote) || "Sem lote";
      productRevenue += total;
      productQuantity += quantity;
      addMetric(productSalesByName, productName, quantity, total);
      addMetric(productSalesByLot, lotName, quantity, total);
    });

    const approvedEventTickets = data.eventTickets.filter((ticket) => statusIsApproved(ticket.status));

    approvedEventTickets.forEach((ticket) => {
      const quantity = parseQuantity(ticket.quantidade, 1);
      const total = parseNumber(ticket.valorTotal);
      eventRevenue += total;
      eventQuantity += quantity;
      addMetric(eventSalesByName, asString(ticket.eventoNome) || "Evento", quantity, total);
      addMetric(eventSalesByLot, asString(ticket.loteNome) || "Sem lote", quantity, total);
      addMetric(eventSalesByClass, asString(ticket.userTurma) || "Sem turma", quantity, total);
      addMetric(eventSalesByWeekday, rowDateWeekday(ticket.dataSolicitacao), quantity, total);
      addMetric(eventSalesByPeriod, rowDatePeriod(ticket.dataSolicitacao), quantity, total);
      addMetric(eventApprovers, asString(ticket.aprovadoPor) || "Sem aprovador", quantity, total);

      const entries = ticketEntries(ticket.payment_config);
      const scannedEntries = entries.filter((entry) => {
        const status = asString(entry.status).toLowerCase();
        return status === "lido" || Boolean(asString(entry.scannedAt));
      });
      const scannedCount = scannedEntries.length || ticketScannedCount(ticket);
      eventScanned += scannedCount;
      if (scannedEntries.length > 0) {
        scannedEntries.forEach((entry) => {
          addMetric(eventScanByHour, hourBucket(entry.scannedAt), 1, 0);
        });
      } else if (scannedCount > 0) {
        addMetric(eventScanByHour, "Sem horario", scannedCount, 0);
      }
    });

    const totalRevenue = productRevenue + eventRevenue;
    const totalQuantity = productQuantity + eventQuantity;
    const eventShowRate = eventQuantity > 0 ? (eventScanned / eventQuantity) * 100 : 0;

    return {
      productRevenue,
      productQuantity,
      eventRevenue,
      eventQuantity,
      eventApprovedOrders: approvedEventTickets.length,
      eventScanned,
      eventTicketAverage: eventQuantity > 0 ? eventRevenue / eventQuantity : 0,
      eventShowRate,
      eventNoShowRate: eventQuantity > 0 ? Math.max(0, 100 - eventShowRate) : 0,
      totalRevenue,
      totalQuantity,
      revenueBySource: [
        { name: "Produtos", quantity: productQuantity, value: productRevenue },
        { name: "Eventos", quantity: eventQuantity, value: eventRevenue },
      ],
      productSalesByName: sortMetrics(productSalesByName),
      productSalesByLot: sortMetrics(productSalesByLot),
      eventSalesByName: sortMetrics(eventSalesByName),
      eventSalesByLot: sortMetrics(eventSalesByLot),
      eventSalesByClass: sortMetrics(eventSalesByClass),
      eventSalesByWeekday: WEEKDAYS.map(
        (day) => eventSalesByWeekday.get(day) ?? { name: day, quantity: 0, value: 0 }
      ),
      eventSalesByPeriod: ["Madrugada", "Manha", "Tarde", "Noite"].map(
        (period) => eventSalesByPeriod.get(period) ?? { name: period, quantity: 0, value: 0 }
      ),
      eventApprovers: sortMetrics(eventApprovers, 10),
      eventScanByHour: sortMetrics(eventScanByHour).sort((left, right) => left.name.localeCompare(right.name)),
    };
  }, [data]);

  const league = data.league;
  const leagueName = league?.sigla?.trim() || league?.nome?.trim() || "Liga";
  const leagueLogo = (league ? resolveLeagueLogoSrc(league) : "") || "/logo.png";
  const leagueBaseHref = tenantPath(
    basePath || `/ligas/${encodeURIComponent(leagueId)}`
  );
  const leagueHomeHref = leagueBaseHref;
  const leagueInformationHref = `${leagueBaseHref}/informacoes`;
  const leagueMembersHref = `${leagueBaseHref}/membros`;
  const leagueEventsHref = `${leagueBaseHref}/eventos`;
  const leagueStoreHref = `${leagueBaseHref}/loja`;
  const leagueFinanceHref = `${leagueBaseHref}/gestao`;
  const leagueFrequencyHref = `${leagueBaseHref}/gestao/frequencia`;
  const leagueEventsManagementHref = `${leagueBaseHref}/gestao/eventos`;
  const leagueProductsManagementHref = `${leagueBaseHref}/gestao/produtos`;
  const leagueBoardHref = `${leagueBaseHref}/board-round`;
  const scannerHref = tenantPath("/scanner");
  const memberPresence = useMemo(() => {
    const userById = new Map(data.leagueUsers.map((entry) => [entry.id.trim(), entry]));
    const events = (data.league?.eventos || []).map((event) => {
      const globalId = getLeagueEventGlobalId(event);
      const ids = new Set([asString(event.id), asString(event.globalEventId), globalId].filter(Boolean));
      return {
        key: globalId || asString(event.id) || asString(event.titulo),
        title: asString(event.titulo) || "Evento",
        visibility: getLeagueEventVisibility(event),
        ids,
      };
    });
    const members = (data.league?.membros || [])
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
      .sort((left, right) =>
        left.turma.localeCompare(right.turma, "pt-BR") ||
        left.nome.localeCompare(right.nome, "pt-BR")
      );

    const eventByTicketKey = new Map<string, (typeof events)[number]>();
    events.forEach((event) => {
      event.ids.forEach((id) => eventByTicketKey.set(id, event));
      eventByTicketKey.set(event.title, event);
    });

    const presence = new Map<string, { approved: number; scanned: number; total: number }>();
    data.eventTickets.forEach((ticket) => {
      if (!statusIsApproved(ticket.status)) return;
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

    return { events, members, presence };
  }, [data]);
  const currentLeagueMember = league?.membros.find(
    (member) => member.id.trim() === (user?.uid || "").trim()
  );
  const canCurrentUserScanInternal = canScanInternalLeagueEvents(currentLeagueMember?.cargo);

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
                onClick={() => router.push(leagueHomeHref)}
                className="rounded-full border border-zinc-800 bg-zinc-900 p-2 hover:bg-zinc-800"
                aria-label="Voltar para o painel da liga"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-zinc-700 bg-black">
                <Image src={leagueLogo} alt={leagueName} fill sizes="44px" className="object-cover" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Gestão financeira
                </p>
                <h1 className="text-xl font-black uppercase">{leagueName}</h1>
              </div>
            </div>
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
            showBoard={showBoard}
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
            label="Receita total"
            value={formatCurrency(analytics.totalRevenue)}
            hint={`${formatNumber(analytics.totalQuantity)} itens vendidos`}
            icon={<Wallet size={18} />}
          />
          <MetricCard
            label="Produtos"
            value={formatCurrency(analytics.productRevenue)}
            hint={`${formatNumber(analytics.productQuantity)} produtos aprovados`}
            icon={<Package size={18} />}
          />
          <MetricCard
            label="Eventos"
            value={formatCurrency(analytics.eventRevenue)}
            hint={`${formatNumber(analytics.eventQuantity)} ingressos aprovados`}
            icon={<Ticket size={18} />}
          />
          <MetricCard
            label="Catálogo"
            value={formatNumber(data.products.length)}
            hint={`produtos cadastrados ${entityArticle} ${entityLabel}`}
            icon={<BarChart3 size={18} />}
          />
        </section>

        {view === "hub" ? (
          <section className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Frequência",
                description: "Matriz de presença por membro e evento, com exportação CSV.",
                href: leagueFrequencyHref,
                icon: <CheckCircle2 size={18} />,
              },
              {
                title: "Eventos",
                description: "Funil, aprovação, portaria, recorrência e lotes da liga.",
                href: leagueEventsManagementHref,
                icon: <Ticket size={18} />,
              },
              {
                title: "Produtos",
                description: "Receita, estoque, recompra, conversão e curva ABC dos produtos da liga.",
                href: leagueProductsManagementHref,
                icon: <Package size={18} />,
              },
            ].map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => router.push(item.href)}
                className="flex min-h-36 flex-col items-start justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left transition hover:border-emerald-500/40 hover:bg-zinc-900/80"
              >
                <span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300">
                  {item.icon}
                </span>
                <span>
                  <strong className="block text-lg font-black uppercase text-white">{item.title}</strong>
                  <span className="mt-1 block text-sm font-semibold text-zinc-500">{item.description}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => router.push(scannerHref)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500 px-5 py-4 text-sm font-black uppercase text-black hover:bg-emerald-400 md:col-span-3"
            >
              <QrCode size={18} />
              Abrir scanner de QR
            </button>
          </section>
        ) : null}

        {view === "eventos" ? (
          <EventManagementAnalytics
            events={(data.league?.eventos || []) as unknown as Row[]}
            tickets={data.eventTickets}
            allLabel={`Todos os eventos ${entityArticle} ${entityLabel}`}
          />
        ) : null}

        {view === "produtos" ? (
          <ProductManagementAnalytics
            products={data.products}
            orders={data.productOrders}
            users={data.leagueUsers as unknown as Row[]}
            title={`Produtos ${entityArticle} ${entityLabel}`}
            subtitle="Receita, compradores únicos, valor médio, conversão por produto, estoque, recompra e curva ABC apenas desta liga."
            allLabel={`Todos os produtos ${entityArticle} ${entityLabel}`}
          />
        ) : null}

        {false ? <>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                Presença dos membros
              </p>
              <h2 className="mt-2 text-lg font-black uppercase text-white">
                Membros por evento
              </h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                Aprovado mostra ingresso liberado; presente mostra QR lido.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push(leagueFrequencyHref)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs font-black uppercase text-cyan-100 hover:bg-cyan-500/20"
              >
                <CheckCircle2 size={16} />
                Ver frequência
              </button>
              <button
                type="button"
                onClick={() => router.push(scannerHref)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500 px-4 py-3 text-xs font-black uppercase text-black hover:bg-emerald-400"
              >
                <QrCode size={16} />
                Abrir scanner
              </button>
            </div>
          </div>
          {canCurrentUserScanInternal ? (
            <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-100">
              Seu cargo na liga permite leitura de QR em eventos internos.
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-black/30">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-black/40 text-zinc-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[220px] bg-black/80 p-3 uppercase">Membro</th>
                  {memberPresence.events.map((event) => (
                    <th key={event.key} className="min-w-[150px] p-3 align-top uppercase">
                      <button
                        type="button"
                        onClick={() => router.push(`${leagueBaseHref}/eventos/lista/${encodeURIComponent(event.key)}`)}
                        className="text-left hover:text-emerald-300"
                      >
                        <span className="line-clamp-2 text-[11px] font-black text-zinc-200">{event.title}</span>
                        <span className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[9px] font-black ${
                          event.visibility === "internal"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                        }`}>
                          {event.visibility === "internal" ? "Interno" : "Publico"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {memberPresence.members.map((member) => (
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
                          <p className="text-[10px] font-bold uppercase text-zinc-500">{member.turma} - {member.cargo}</p>
                        </div>
                      </div>
                    </td>
                    {memberPresence.events.map((event) => {
                      const cell = memberPresence.presence.get(`${event.key}:${member.id}`);
                      const present = Boolean(cell && cell.scanned > 0);
                      const approved = Boolean(cell && cell.approved > 0);
                      return (
                        <td key={`${member.id}-${event.key}`} className="p-3">
                          {present ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">
                              <CheckCircle2 size={12} /> Presente
                            </span>
                          ) : approved ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-300">
                              <Ticket size={12} /> Aprovado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] font-black uppercase text-zinc-600">
                              <XCircle size={12} /> -
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {memberPresence.members.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, memberPresence.events.length + 1)} className="p-8 text-center text-sm text-zinc-500">
                      Nenhum membro encontrado nesta liga.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <EventManagementAnalytics
          events={(data.league?.eventos || []) as unknown as Row[]}
          tickets={data.eventTickets}
          allLabel="Todos os eventos da liga"
        />

        <section className="grid gap-5 lg:grid-cols-2">
          <ChartPanel title="Receita por origem" subtitle="Comparação entre loja e eventos vendidos.">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} {...chartTooltipProps} />
                <Pie
                  data={analytics.revenueBySource}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={96}
                  paddingAngle={4}
                >
                  {analytics.revenueBySource.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Produtos mais vendidos" subtitle="Ranking por receita aprovada.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.productSalesByName} layout="vertical" margin={{ left: 12, right: 18 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} {...chartTooltipProps} />
                <Bar dataKey="value" fill="#34d399" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Eventos vendidos" subtitle="Ingressos aprovados por evento.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.eventSalesByName} layout="vertical" margin={{ left: 12, right: 18 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} {...chartTooltipProps} />
                <Bar dataKey="value" fill="#60a5fa" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>

          <ChartPanel title="Lotes" subtitle="Receita por lote em produtos e eventos.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...analytics.productSalesByLot, ...analytics.eventSalesByLot].slice(0, 8)}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={(value) => formatCurrency(Number(value))} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} {...chartTooltipProps} />
                <Bar dataKey="value" fill="#fbbf24" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-sm font-black uppercase text-white">Resumo da loja</h2>
            <div className="mt-4 space-y-3">
              {analytics.productSalesByName.length === 0 ? (
                <p className="text-sm text-zinc-500">Nenhuma venda aprovada de produto encontrada.</p>
              ) : (
                analytics.productSalesByName.map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                    <div>
                      <p className="text-sm font-bold text-white">{row.name}</p>
                      <p className="text-[11px] text-zinc-500">{formatNumber(row.quantity)} unidades</p>
                    </div>
                    <p className="text-sm font-black text-emerald-300">{formatCurrency(row.value)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-sm font-black uppercase text-white">Resumo de eventos</h2>
            <div className="mt-4 space-y-3">
              {analytics.eventSalesByName.length === 0 ? (
                <p className="text-sm text-zinc-500">Nenhuma venda aprovada de evento encontrada.</p>
              ) : (
                analytics.eventSalesByName.map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                    <div>
                      <p className="text-sm font-bold text-white">{row.name}</p>
                      <p className="text-[11px] text-zinc-500">{formatNumber(row.quantity)} ingressos</p>
                    </div>
                    <p className="text-sm font-black text-blue-300">{formatCurrency(row.value)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        </> : null}
      </main>
    </div>
  );
}
