"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Package,
  Repeat2,
  ShoppingBag,
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

type ProductManagementAnalyticsProps = {
  products: Row[];
  orders: Row[];
  users?: Row[];
  title?: string;
  subtitle?: string;
  allLabel?: string;
};

type MetricRow = {
  name: string;
  qtd: number;
  valor: number;
  medio?: number;
  extra?: number;
};

type ProductMetric = {
  id: string;
  name: string;
  category: string;
  lot: string;
  stock: number;
  sold: number;
  clicks: number;
  likes: number;
  revenue: number;
  orders: number;
  discountedRevenue: number;
};

const COLORS = ["#12d18e", "#38bdf8", "#facc15", "#f97316", "#f472b6", "#a78bfa", "#fb7185", "#22c55e"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const tooltipStyle = { background: "#101114", border: "1px solid rgba(255,255,255,.12)", color: "#fff" };
const tooltipLabelStyle = { color: "#fff", fontWeight: 800 };
const tooltipItemStyle = { color: "#fff", fontWeight: 700 };

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function parseNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(
      value
        .replace(/[^\d,.-]/g, "")
        .replace(/\.(?=\d{3}(?:\D|$))/g, "")
        .replace(",", "."),
    );
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeDivide(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function statusIsApproved(status: unknown) {
  const normalized = asString(status).trim().toLowerCase();
  return ["approved", "aprovado", "aprovada", "pago", "paid", "confirmado", "confirmada", "entregue"].includes(normalized);
}

function productName(row: Row) {
  return asString(row.nome ?? row.productName ?? row.name) || "Produto";
}

function productId(row: Row) {
  return asString(row.id ?? row.productId ?? row.produto_id);
}

function orderProductId(row: Row) {
  return asString(row.productId ?? row.produtoId ?? row.product_id ?? row.produto_id);
}

function orderQuantity(row: Row) {
  return Math.max(1, Math.floor(parseNumber(row.quantidade ?? row.itens ?? row.qtd, 1)));
}

function orderTotal(row: Row) {
  const quantity = orderQuantity(row);
  return parseNumber(row.total ?? row.valorTotal, 0) || parseNumber(row.price ?? row.preco, 0) * quantity;
}

function rowDate(value: unknown) {
  const text = asString(value);
  const date = text ? new Date(text) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function weekdayLabel(value: unknown) {
  const date = rowDate(value);
  return date ? WEEKDAYS[date.getDay()] : "Sem data";
}

function addMetric(map: Map<string, MetricRow>, name: string, qtd: number, valor: number, extra = 0) {
  const cleanName = name.trim() || "Sem nome";
  const current = map.get(cleanName) ?? { name: cleanName, qtd: 0, valor: 0, extra: 0 };
  current.qtd += qtd;
  current.valor += valor;
  current.extra = (current.extra ?? 0) + extra;
  current.medio = safeDivide(current.valor, current.qtd);
  map.set(cleanName, current);
}

function metricRows(map: Map<string, MetricRow>, limit = 12) {
  return [...map.values()]
    .sort((left, right) => right.valor - left.valor || right.qtd - left.qtd || (right.extra ?? 0) - (left.extra ?? 0))
    .slice(0, limit);
}

function KpiCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
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

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4">
        <h4 className="text-sm font-black uppercase tracking-[0.16em] text-white">{title}</h4>
        <p className="mt-1 text-xs font-semibold text-white/45">{subtitle}</p>
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

function Bars({ data, dataKey = "qtd", currency = false }: { data: MetricRow[]; dataKey?: keyof MetricRow; currency?: boolean }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
        <XAxis
          type="number"
          stroke="rgba(255,255,255,0.45)"
          tickFormatter={(value) => (currency ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
        />
        <YAxis dataKey="name" type="category" width={118} stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={(value) => (currency ? formatCurrency(Number(value)) : formatNumber(Number(value)))}
        />
        <Bar dataKey={dataKey as string} name={dataKey === "valor" ? "Valor" : dataKey === "medio" ? "Média" : "Qtd"} fill="#12d18e" radius={[0, 8, 8, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarsDual({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 16, left: 0, bottom: 36 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} angle={-18} textAnchor="end" height={58} />
        <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
        <Legend />
        <Bar dataKey="qtd" name="Qtd" fill="#12d18e" radius={[8, 8, 0, 0]} />
        <Bar dataKey="valor" name="Receita" fill="#38bdf8" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineMetric({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 18, left: 0, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
        <Line type="monotone" dataKey="qtd" name="Qtd" stroke="#12d18e" strokeWidth={3} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PieMetric({ data }: { data: MetricRow[] }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="qtd" nameKey="name" innerRadius={62} outerRadius={98} paddingAngle={3}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
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
                            ? percentFormatter.format(value)
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

export function ProductManagementAnalytics({
  products,
  orders,
  users = [],
  title = "Gestão de produtos",
  subtitle = "Vendas, conversão, estoque e recompra no catálogo deste escopo.",
  allLabel = "Todos os produtos",
}: ProductManagementAnalyticsProps) {
  const [productFilter, setProductFilter] = useState("todos");

  const productOptions = useMemo(
    () =>
      products
        .map((product) => ({ id: productId(product), title: productName(product) }))
        .filter((product, index, list) => product.id && list.findIndex((item) => item.id === product.id) === index),
    [products],
  );

  const analytics = useMemo(() => {
    const selectedProducts =
      productFilter === "todos" ? products : products.filter((product) => productId(product) === productFilter);
    const selectedProductIds = new Set(selectedProducts.map(productId).filter(Boolean));
    const selectedOrders = orders.filter((order) => {
      if (selectedProductIds.size > 0 && !selectedProductIds.has(orderProductId(order))) return false;
      return productFilter === "todos" || orderProductId(order) === productFilter;
    });
    const approvedOrders = selectedOrders.filter((order) => statusIsApproved(order.status));
    const productMap = new Map(selectedProducts.map((product) => [productId(product), product]));
    const userTurma = new Map(users.map((user) => [asString(user.uid ?? user.id), asString(user.turma ?? user.userTurma) || "Sem turma"]));

    const productMetrics = new Map<string, ProductMetric>();
    selectedProducts.forEach((product) => {
      const id = productId(product);
      if (!id) return;
      const likes = Array.isArray(product.likes) ? product.likes.length : parseNumber(product.likes, 0);
      productMetrics.set(id, {
        id,
        name: productName(product),
        category: asString(product.categoria) || "Sem categoria",
        lot: asString(product.lote) || "Sem lote",
        stock: parseNumber(product.estoque, 0),
        sold: parseNumber(product.vendidos, 0),
        clicks: parseNumber(product.cliques, 0),
        likes,
        revenue: 0,
        orders: 0,
        discountedRevenue: 0,
      });
    });

    const byProduct = new Map<string, MetricRow>();
    const byLot = new Map<string, MetricRow>();
    const byCategory = new Map<string, MetricRow>();
    const byWeekday = new Map<string, MetricRow>();
    const byClass = new Map<string, MetricRow>();
    const byUser = new Map<string, MetricRow>();
    const buyers = new Map<string, number>();
    let revenue = 0;
    let itemQtd = 0;
    let discountRevenue = 0;

    approvedOrders.forEach((order) => {
      const id = orderProductId(order);
      const product = productMap.get(id);
      const qtd = orderQuantity(order);
      const value = orderTotal(order);
      const metric = productMetrics.get(id);
      const productLabel = asString(order.productName) || productName(product ?? order);
      const lot = asString(product?.lote) || "Sem lote";
      const category = asString(product?.categoria) || "Sem categoria";
      const orderData = asRecord(order.data);
      const turma = asString(orderData.userTurma ?? orderData.turma) || userTurma.get(asString(order.userId)) || "Sem turma";
      const buyer = asString(order.userId ?? order.userName ?? order.email) || asString(order.id);
      const hasDiscount = parseNumber(product?.precoAntigo, 0) > parseNumber(product?.preco, 0);

      revenue += value;
      itemQtd += qtd;
      if (hasDiscount) discountRevenue += value;
      buyers.set(buyer, (buyers.get(buyer) ?? 0) + 1);
      addMetric(byProduct, productLabel, qtd, value);
      addMetric(byLot, lot, qtd, value);
      addMetric(byCategory, category, qtd, value);
      addMetric(byWeekday, weekdayLabel(order.createdAt ?? order.data), qtd, value);
      addMetric(byClass, turma, qtd, value);
      addMetric(byUser, asString(order.userName) || "Comprador", qtd, value);

      if (metric) {
        metric.sold += qtd;
        metric.revenue += value;
        metric.orders += 1;
        if (hasDiscount) metric.discountedRevenue += value;
      }
    });

    const engagementRows = [...productMetrics.values()]
      .map((metric) => ({
        name: metric.name,
        qtd: metric.likes,
        valor: metric.clicks,
        medio: safeDivide(metric.orders, metric.clicks) * 100,
      }))
      .sort((left, right) => right.valor - left.valor || right.qtd - left.qtd)
      .slice(0, 12);

    const stockRows = [...productMetrics.values()]
      .map((metric) => {
        const base = metric.stock + metric.sold;
        return {
          name: metric.name,
          qtd: metric.sold,
          valor: metric.stock,
          medio: safeDivide(metric.sold, base) * 100,
        };
      })
      .sort((left, right) => right.medio - left.medio)
      .slice(0, 12);

    const stalledRows = [...productMetrics.values()]
      .filter((metric) => metric.stock > 0 && (metric.sold === 0 || (metric.clicks >= 5 && metric.orders === 0)))
      .map((metric) => ({
        name: metric.name,
        qtd: metric.stock,
        valor: metric.clicks,
        medio: safeDivide(metric.orders, metric.clicks) * 100,
      }))
      .sort((left, right) => right.qtd - left.qtd || right.valor - left.valor)
      .slice(0, 12);

    const discountRows = [
      { name: "Com desconto", qtd: discountRevenue > 0 ? 1 : 0, valor: discountRevenue },
      { name: "Sem desconto", qtd: Math.max(0, approvedOrders.length - (discountRevenue > 0 ? 1 : 0)), valor: Math.max(0, revenue - discountRevenue) },
    ].filter((row) => row.valor > 0 || row.qtd > 0);

    const recurrenceRows = [
      { name: "Primeira compra", qtd: [...buyers.values()].filter((count) => count === 1).length, valor: 0 },
      { name: "Recompra", qtd: [...buyers.values()].filter((count) => count > 1).length, valor: 0 },
    ];

    const byProductRows = metricRows(byProduct, 14);
    const topFiveRevenue = byProductRows.slice(0, 5).reduce((sum, row) => sum + row.valor, 0);
    let cumulative = 0;
    const abcRows = byProductRows.map((row) => {
      cumulative += row.valor;
      const share = safeDivide(cumulative, revenue) * 100;
      return {
        name: share <= 80 ? "A" : share <= 95 ? "B" : "C",
        qtd: 1,
        valor: row.valor,
      };
    });
    const abcMap = new Map<string, MetricRow>();
    abcRows.forEach((row) => addMetric(abcMap, row.name, row.qtd, row.valor));

    return {
      revenue,
      itemQtd,
      approvedOrders,
      selectedOrders,
      uniqueBuyers: buyers.size,
      averageOrder: safeDivide(revenue, approvedOrders.length),
      clickConversion:
        safeDivide(
          [...productMetrics.values()].reduce((sum, metric) => sum + metric.orders, 0),
          [...productMetrics.values()].reduce((sum, metric) => sum + metric.clicks, 0),
        ) * 100,
      sellThrough:
        safeDivide(
          [...productMetrics.values()].reduce((sum, metric) => sum + metric.sold, 0),
          [...productMetrics.values()].reduce((sum, metric) => sum + metric.sold + metric.stock, 0),
        ) * 100,
      stalledCount: stalledRows.length,
      repeatRate: safeDivide([...buyers.values()].filter((count) => count > 1).length, buyers.size) * 100,
      topFiveDependency: safeDivide(topFiveRevenue, revenue) * 100,
      byProduct: byProductRows,
      byLot: metricRows(byLot),
      byCategory: metricRows(byCategory),
      byWeekday: WEEKDAYS.map((day) => byWeekday.get(day) ?? { name: day, qtd: 0, valor: 0 }),
      byClass: metricRows(byClass),
      byUser: metricRows(byUser, 12),
      engagementRows,
      stockRows,
      stalledRows,
      discountRows,
      recurrenceRows,
      abcRows: metricRows(abcMap, 3),
    };
  }, [orders, productFilter, products, users]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Gestão de produtos</p>
          <h2 className="text-2xl font-black uppercase tracking-tight text-white">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-white/55">{subtitle}</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Produto
          <select
            value={productFilter}
            onChange={(event) => setProductFilter(event.target.value)}
            className="min-w-[240px] rounded-xl border border-white/10 bg-[#090a0d] px-3 py-2 text-sm font-black normal-case tracking-normal text-white outline-none focus:border-emerald-400"
          >
            <option value="todos">{allLabel}</option>
            {productOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita" value={formatCurrency(analytics.revenue)} hint={`${formatNumber(analytics.itemQtd)} itens vendidos`} icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label="Pedidos aprovados" value={formatNumber(analytics.approvedOrders.length)} hint="pagamentos confirmados" icon={<ShoppingBag className="h-4 w-4" />} />
        <KpiCard label="Compradores únicos" value={formatNumber(analytics.uniqueBuyers)} hint="clientes diferentes no filtro" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Valor médio" value={formatCurrency(analytics.averageOrder)} hint="receita / pedidos aprovados" icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Clique para compra" value={formatPercent(analytics.clickConversion)} hint="pedidos aprovados / cliques" icon={<TrendingUp className="h-4 w-4" />} />
        <KpiCard label="Venda do estoque" value={formatPercent(analytics.sellThrough)} hint="vendidos / estoque total estimado" icon={<Package className="h-4 w-4" />} />
        <KpiCard label="Produtos parados" value={formatNumber(analytics.stalledCount)} hint="estoque alto, sem venda ou clique sem compra" icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Recompra" value={formatPercent(analytics.repeatRate)} hint="compradores com mais de um pedido" icon={<Repeat2 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Receita por produto" subtitle="Qtd, receita e valor médio por item">
          <Bars data={analytics.byProduct} dataKey="valor" currency />
        </ChartPanel>
        <ChartPanel title="Lotes por qtd e valor" subtitle="Venda do estoque e receita por lote padronizado">
          <BarsDual data={analytics.byLot} />
        </ChartPanel>
        <ChartPanel title="Turmas por consumo" subtitle="Qtd comprada e receita por turma">
          <BarsDual data={analytics.byClass} />
        </ChartPanel>
        <ChartPanel title="Dias da semana" subtitle="Pedidos e receita por dia">
          <LineMetric data={analytics.byWeekday} />
        </ChartPanel>
        <ChartPanel title="Likes, cliques e conversão" subtitle="Interesse e eficiência por produto">
          <BarsDual data={analytics.engagementRows} />
        </ChartPanel>
        <ChartPanel title="Estoque e giro" subtitle="Vendidos, estoque e taxa de saída">
          <BarsDual data={analytics.stockRows} />
        </ChartPanel>
        <ChartPanel title="Dependência de desconto" subtitle="Receita com e sem desconto">
          <PieMetric data={analytics.discountRows} />
        </ChartPanel>
        <ChartPanel title="Curva ABC de produtos" subtitle="Concentração de receita">
          <PieMetric data={analytics.abcRows} />
        </ChartPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailTable
          title="Produtos parados ou em risco"
          rows={analytics.stalledRows}
          columns={[
            { key: "qtd", label: "Estoque" },
            { key: "valor", label: "Cliques" },
            { key: "medio", label: "Conversão", format: "percent" },
          ]}
        />
        <DetailTable
          title="Resumo de recompra"
          rows={analytics.recurrenceRows}
          columns={[
            { key: "qtd", label: "Compradores" },
          ]}
        />
      </div>
    </section>
  );
}
