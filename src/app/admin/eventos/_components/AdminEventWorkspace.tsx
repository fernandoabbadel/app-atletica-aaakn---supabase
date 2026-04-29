"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Download,
  Edit3,
  Image as ImageIcon,
  Layers3,
  Loader2,
  MapPin,
  MessageCircle,
  MoveVertical,
  Percent,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { LotNameSelector } from "@/components/LotNameSelector";
import { EventManagementAnalytics } from "@/components/EventManagementAnalytics";
import { PaymentRecipientCheckboxList } from "@/components/PaymentRecipientCheckboxList";
import { PaymentReceiversManager } from "@/components/PaymentReceiversManager";
import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { normalizePaymentConfig, type CommercePaymentConfig } from "@/lib/commerceCatalog";
import {
  createAdminEventPoll,
  deleteAdminEventPoll,
  EVENT_POLL_OPTION_MAX_CHARS,
  EVENT_POLL_OPTION_MAX_COUNT,
  EVENT_POLL_QUESTION_MAX_CHARS,
  fetchAdminEventById,
  fetchAdminEventPolls,
  fetchAdminEventSalesPage,
  incrementEventPurchaseUserStats,
  setAdminTicketPayment,
  updateAdminEventPollOptions,
  upsertAdminEvent,
} from "@/lib/eventsNativeService";
import { logActivity } from "@/lib/logger";
import {
  fetchTenantPaymentRecipients,
  filterTenantPaymentRecipientsByIds,
  type TenantPaymentRecipientOption,
} from "@/lib/paymentRecipients";
import { fetchPlanCatalog, type PlanRecord } from "@/lib/plansPublicService";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "@/lib/upload";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  hasValidPhoneLength,
  normalizePhoneToBrE164,
  PHONE_MAX_LENGTH,
} from "@/utils/contactFields";

type EventWorkspaceSection =
  | "extrato"
  | "bi"
  | "lotes"
  | "ingressos"
  | "cupons"
  | "checkins"
  | "edicao"
  | "enquetes"
  | "recebedores";

type EventSaleStatus = "ativo" | "em_breve" | "esgotado";
type EventStatus = "ativo" | "encerrado";
type CouponType = "valor" | "percentual";

type LotePlanPrice = {
  planId: string;
  planName: string;
  price: string;
};

interface EventLot {
  id: number;
  nome: string;
  preco: string;
  status: EventSaleStatus;
  descricao: string;
  quantidade: number;
  ordem: number;
  qrPorIngresso: number;
  invisivel: boolean;
  transferivel: boolean;
  validadeAtiva: boolean;
  inicioVendasData: string;
  inicioVendasHora: string;
  fimVendasData: string;
  fimVendasHora: string;
  planPrices: LotePlanPrice[];
}

interface EventCoupon {
  id: string;
  titulo: string;
  codigo: string;
  tipo: CouponType;
  valor: string;
  valorMinimo: string;
  valorMaximo: string;
  quantidadeDisponivel: number;
  usos: number;
  ativo: boolean;
  createdAt: string;
}

interface EventCheckinOperator {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  createdAt: string;
}

interface AdminEventDataExtra {
  raw: Record<string, unknown>;
  cupons: EventCoupon[];
  checkinOperators: EventCheckinOperator[];
}

interface AdminEvent {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  local: string;
  tipo: string;
  destaque: string;
  mapsUrl: string;
  imagem: string;
  imagePositionY: number;
  descricao: string;
  status: EventStatus;
  saleStatus: EventSaleStatus;
  isLowStock: boolean;
  lotes: EventLot[];
  pixChave: string;
  pixBanco: string;
  pixTitular: string;
  contatoComprovante: string;
  stats: { confirmados: number; talvez: number; likes: number };
  paymentConfig: CommercePaymentConfig | null;
  recipientUserIds: string[];
  dataExtra: AdminEventDataExtra;
}

interface EventSaleRow {
  id: string;
  userId: string;
  userName: string;
  userTurma: string;
  status: string;
  loteId: string;
  loteNome: string;
  quantidade: number;
  valorUnitario: string;
  valorTotal: string;
  dataSolicitacao: string;
  dataAprovacao: unknown;
  aprovadoPor: string;
  paymentConfig: CommercePaymentConfig | null;
}

interface TicketCheckinRow {
  orderId: string;
  ticketLabel: string;
  ticketToken: string;
  holderName: string;
  holderTurma: string;
  loteNome: string;
  scannedAt: string;
  scannedByUserName: string;
  scannedByUserTurma: string;
}

interface PollOption {
  text: string;
  votes: number;
  creatorName?: string;
}

interface EventPoll {
  id: string;
  question: string;
  allowUserOptions: boolean;
  options: PollOption[];
}

const EVENT_TITLE_MAX_LENGTH = 120;
const EVENT_LOCATION_MAX_LENGTH = 140;
const EVENT_TYPE_MAX_LENGTH = 40;
const EVENT_DESCRIPTION_MAX_LENGTH = 1200;
const EVENT_PIX_FIELD_MAX_LENGTH = 140;
const EVENT_LOTE_NAME_MAX_LENGTH = 80;
const EVENT_COUPON_TITLE_MAX_LENGTH = 120;
const EVENT_COUPON_CODE_MAX_LENGTH = 60;
const EVENT_OPERATOR_NAME_MAX_LENGTH = 120;
const EVENT_OPERATOR_EMAIL_MAX_LENGTH = 160;

const SECTION_LABELS: Record<EventWorkspaceSection, string> = {
  extrato: "Extrato",
  bi: "BI",
  lotes: "Lotes",
  ingressos: "Ingressos",
  cupons: "Cupons",
  checkins: "Check-ins",
  edicao: "Edição",
  enquetes: "Enquetes",
  recebedores: "Recebedores",
};

const SECTION_ORDER: EventWorkspaceSection[] = [
  "extrato",
  "bi",
  "lotes",
  "ingressos",
  "cupons",
  "checkins",
  "edicao",
  "enquetes",
  "recebedores",
];

const saleStatusTone: Record<EventSaleStatus, string> = {
  ativo: "border-brand bg-brand-soft text-brand-accent",
  em_breve: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200",
  esgotado: "border-red-500/30 bg-red-500/10 text-red-200",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asBoolean = (value: unknown): boolean => Boolean(value);

const normalizeSearch = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const formatCurrency = (value: number): string =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parseCurrency = (value: string): number => {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (value: string): string => {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
};

const formatDateTime = (value: unknown): string => {
  if (!value) return "-";
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("pt-BR");
    }
  }
  if (value instanceof Date) return value.toLocaleString("pt-BR");
  const row = value as { toDate?: unknown };
  if (typeof row?.toDate === "function") {
    const parsed = row.toDate();
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("pt-BR");
    }
  }
  return "-";
};

const getPaymentRecipientIdsFromConfig = (
  paymentConfig?: CommercePaymentConfig | null
): string[] => {
  const rows =
    paymentConfig?.recipients?.length
      ? paymentConfig.recipients
      : paymentConfig?.recipient
        ? [paymentConfig.recipient]
        : [];

  return Array.from(
    new Set(
      rows
        .map((entry) => asString(entry.userId).trim())
        .filter((entry) => entry.length > 0)
    )
  );
};

const toCommerceRecipientSnapshot = (recipient: TenantPaymentRecipientOption) => ({
  userId: recipient.userId,
  name: recipient.name,
  turma: recipient.turma,
  avatarUrl: recipient.avatarUrl,
  phone: recipient.phone,
});

const buildLotePlanPrices = (
  plans: PlanRecord[],
  current?: LotePlanPrice[]
): LotePlanPrice[] => {
  const currentMap = new Map<string, string>();

  (current ?? []).forEach((entry) => {
    const normalizedPrice = String(entry.price ?? "").trim();
    const planIdKey = String(entry.planId || "").trim().toLowerCase();
    const planNameKey = String(entry.planName || "").trim().toLowerCase();
    if (planIdKey) currentMap.set(planIdKey, normalizedPrice);
    if (planNameKey) currentMap.set(planNameKey, normalizedPrice);
  });

  return plans.map((plan) => ({
    planId: plan.id,
    planName: plan.nome,
    price:
      currentMap.get((plan.id || "").trim().toLowerCase()) ||
      currentMap.get((plan.nome || "").trim().toLowerCase()) ||
      "",
  }));
};

const serializeLotePlanPrices = (
  plans: PlanRecord[],
  current?: LotePlanPrice[]
): LotePlanPrice[] =>
  buildLotePlanPrices(plans, current)
    .map((entry) => ({ ...entry, price: String(entry.price ?? "").trim() }))
    .filter((entry) => entry.price.length > 0);

const normalizeSaleStatus = (value: unknown): EventSaleStatus => {
  const raw = asString(value).trim().toLowerCase();
  if (raw === "em_breve" || raw === "agendado") return "em_breve";
  if (raw === "esgotado" || raw === "encerrado") return "esgotado";
  return "ativo";
};

const normalizeLote = (value: unknown, index: number): EventLot => {
  const row = asRecord(value) ?? {};
  return {
    id: Number.isFinite(Number(row.id)) ? Number(row.id) : Date.now() + index,
    nome: asString(row.nome, "Lote").slice(0, EVENT_LOTE_NAME_MAX_LENGTH),
    preco: asString(row.preco, ""),
    status: normalizeSaleStatus(row.status),
    descricao: asString(row.descricao, ""),
    quantidade: Math.max(0, Math.floor(Number(row.quantidade ?? 100) || 100)),
    ordem: Math.max(0, Math.floor(Number(row.ordem ?? index) || index)),
    qrPorIngresso: Math.max(1, Math.floor(Number(row.qrPorIngresso ?? row.qr_codes_por_ingresso ?? 1) || 1)),
    invisivel: asBoolean(row.invisivel ?? row.invisible),
    transferivel: row.transferivel === undefined ? true : asBoolean(row.transferivel),
    validadeAtiva: asBoolean(row.validadeAtiva ?? row.validityEnabled),
    inicioVendasData: asString(row.inicioVendasData ?? row.startDate),
    inicioVendasHora: asString(row.inicioVendasHora ?? row.startTime),
    fimVendasData: asString(row.fimVendasData ?? row.endDate),
    fimVendasHora: asString(row.fimVendasHora ?? row.endTime),
    planPrices: Array.isArray(row.planPrices)
      ? (row.planPrices as LotePlanPrice[])
      : Array.isArray(row.plan_prices)
        ? (row.plan_prices as LotePlanPrice[])
        : [],
  };
};

const createEmptyLot = (plans: PlanRecord[]): EventLot => ({
  id: Date.now(),
  nome: "",
  preco: "",
  status: "ativo",
  descricao: "",
  quantidade: 100,
  ordem: 0,
  qrPorIngresso: 1,
  invisivel: false,
  transferivel: true,
  validadeAtiva: false,
  inicioVendasData: "",
  inicioVendasHora: "",
  fimVendasData: "",
  fimVendasHora: "",
  planPrices: buildLotePlanPrices(plans),
});

const normalizeCoupon = (value: unknown, index: number): EventCoupon | null => {
  const row = asRecord(value);
  if (!row) return null;
  const titulo = asString(row.titulo, "").trim().slice(0, EVENT_COUPON_TITLE_MAX_LENGTH);
  const codigo = asString(row.codigo, "").trim().slice(0, EVENT_COUPON_CODE_MAX_LENGTH).toUpperCase();
  if (!titulo && !codigo) return null;
  return {
    id: asString(row.id, `coupon-${index + 1}`),
    titulo: titulo || "Cupom",
    codigo: codigo || `CUPOM${index + 1}`,
    tipo: asString(row.tipo).trim().toLowerCase() === "percentual" ? "percentual" : "valor",
    valor: asString(row.valor, ""),
    valorMinimo: asString(row.valorMinimo, ""),
    valorMaximo: asString(row.valorMaximo, ""),
    quantidadeDisponivel: Math.max(0, Math.floor(Number(row.quantidadeDisponivel ?? 100) || 100)),
    usos: Math.max(0, Math.floor(Number(row.usos ?? 0) || 0)),
    ativo: row.ativo === undefined ? true : asBoolean(row.ativo),
    createdAt: asString(row.createdAt, new Date().toISOString()),
  };
};

const createEmptyCoupon = (): EventCoupon => ({
  id: `coupon-${Date.now()}`,
  titulo: "",
  codigo: "",
  tipo: "valor",
  valor: "",
  valorMinimo: "",
  valorMaximo: "",
  quantidadeDisponivel: 100,
  usos: 0,
  ativo: true,
  createdAt: new Date().toISOString(),
});

const normalizeCheckinOperator = (value: unknown, index: number): EventCheckinOperator | null => {
  const row = asRecord(value);
  if (!row) return null;
  const nome = asString(row.nome, "").trim().slice(0, EVENT_OPERATOR_NAME_MAX_LENGTH);
  const email = asString(row.email, "").trim().slice(0, EVENT_OPERATOR_EMAIL_MAX_LENGTH);
  if (!nome && !email) return null;
  return {
    id: asString(row.id, `checkin-${index + 1}`),
    nome: nome || "Operador",
    email,
    ativo: row.ativo === undefined ? true : asBoolean(row.ativo),
    createdAt: asString(row.createdAt, new Date().toISOString()),
  };
};

const createEmptyCheckinOperator = (): EventCheckinOperator => ({
  id: `checkin-${Date.now()}`,
  nome: "",
  email: "",
  ativo: true,
  createdAt: new Date().toISOString(),
});

const normalizeDataExtra = (value: unknown): AdminEventDataExtra => {
  const raw = asRecord(value) ?? {};
  return {
    raw,
    cupons: Array.isArray(raw.coupons)
      ? raw.coupons
          .map((entry, index) => normalizeCoupon(entry, index))
          .filter((entry): entry is EventCoupon => entry !== null)
      : [],
    checkinOperators: Array.isArray(raw.checkinOperators)
      ? raw.checkinOperators
          .map((entry, index) => normalizeCheckinOperator(entry, index))
          .filter((entry): entry is EventCheckinOperator => entry !== null)
      : [],
  };
};

const serializeDataExtra = (dataExtra: AdminEventDataExtra): Record<string, unknown> => ({
  ...dataExtra.raw,
  coupons: dataExtra.cupons.map((coupon) => ({
    id: coupon.id,
    titulo: coupon.titulo.trim(),
    codigo: coupon.codigo.trim().toUpperCase(),
    tipo: coupon.tipo,
    valor: coupon.valor.trim(),
    valorMinimo: coupon.valorMinimo.trim(),
    valorMaximo: coupon.valorMaximo.trim(),
    quantidadeDisponivel: Math.max(0, Math.floor(coupon.quantidadeDisponivel)),
    usos: Math.max(0, Math.floor(coupon.usos)),
    ativo: coupon.ativo,
    createdAt: coupon.createdAt || new Date().toISOString(),
  })),
  checkinOperators: dataExtra.checkinOperators.map((operator) => ({
    id: operator.id,
    nome: operator.nome.trim(),
    email: operator.email.trim(),
    ativo: operator.ativo,
    createdAt: operator.createdAt || new Date().toISOString(),
  })),
});

const mapAdminEventRow = (raw: Record<string, unknown>): AdminEvent => {
  const statsRow = asRecord(raw.stats) ?? {};
  const paymentConfig = normalizePaymentConfig(raw.payment_config);
  return {
    id: asString(raw.id),
    titulo: asString(raw.titulo, "Evento"),
    data: asString(raw.data),
    hora: asString(raw.hora),
    local: asString(raw.local),
    tipo: asString(raw.tipo, "Evento"),
    destaque: asString(raw.destaque),
    mapsUrl: asString(raw.mapsUrl),
    imagem: asString(raw.imagem),
    imagePositionY: Number.isFinite(Number(raw.imagePositionY)) ? Number(raw.imagePositionY) : 50,
    descricao: asString(raw.descricao),
    status: asString(raw.status, "ativo") === "encerrado" ? "encerrado" : "ativo",
    saleStatus: normalizeSaleStatus(raw.sale_status),
    isLowStock: asBoolean(raw.isLowStock),
    lotes: Array.isArray(raw.lotes)
      ? raw.lotes.map((entry, index) => normalizeLote(entry, index))
      : [],
    pixChave: asString(raw.pixChave),
    pixBanco: asString(raw.pixBanco),
    pixTitular: asString(raw.pixTitular),
    contatoComprovante: asString(raw.contatoComprovante),
    stats: {
      confirmados: Math.max(0, Math.floor(Number(statsRow.confirmados ?? 0) || 0)),
      talvez: Math.max(0, Math.floor(Number(statsRow.talvez ?? 0) || 0)),
      likes: Math.max(0, Math.floor(Number(statsRow.likes ?? 0) || 0)),
    },
    paymentConfig,
    recipientUserIds: getPaymentRecipientIdsFromConfig(paymentConfig),
    dataExtra: normalizeDataExtra(raw.data_extra),
  };
};

const mapSaleRow = (raw: Record<string, unknown>): EventSaleRow => ({
  id: asString(raw.id),
  userId: asString(raw.userId),
  userName: asString(raw.userName, "Aluno"),
  userTurma: asString(raw.userTurma, "-"),
  status: asString(raw.status, "pendente"),
  loteId: asString(raw.loteId),
  loteNome: asString(raw.loteNome, "-"),
  quantidade: Math.max(1, Math.floor(Number(raw.quantidade ?? 1) || 1)),
  valorUnitario: asString(raw.valorUnitario, "0,00"),
  valorTotal: asString(raw.valorTotal, "0,00"),
  dataSolicitacao: asString(raw.dataSolicitacao),
  dataAprovacao: raw.dataAprovacao,
  aprovadoPor: asString(raw.aprovadoPor),
  paymentConfig: normalizePaymentConfig(raw.payment_config),
});

const mapPollRow = (raw: Record<string, unknown>): EventPoll => {
  const options = Array.isArray(raw.options) ? raw.options : [];
  return {
    id: asString(raw.id),
    question: asString(raw.question, "Enquete"),
    allowUserOptions: asBoolean(raw.allowUserOptions),
    options: options.flatMap((entry): PollOption[] => {
      const row = asRecord(entry);
      if (!row) return [];
      const text = asString(row.text).trim();
      if (!text) return [];
      const creatorName = asString(row.creatorName).trim();
      return [
        {
          text,
          votes: Math.max(0, Math.floor(Number(row.votes ?? 0) || 0)),
          ...(creatorName ? { creatorName } : {}),
        },
      ];
    }),
  };
};

const flattenTicketCheckins = (salesRows: EventSaleRow[]): TicketCheckinRow[] =>
  salesRows
    .flatMap((row) => {
      const entries = row.paymentConfig?.ticketEntries ?? [];
      return entries
        .filter((entry) => entry.status === "lido" || Boolean(entry.scannedAt))
        .map((entry) => ({
          orderId: row.id,
          ticketLabel: asString(entry.label, "Ingresso"),
          ticketToken: asString(entry.token),
          holderName: asString(entry.holderName, row.userName),
          holderTurma: asString(entry.holderTurma, row.userTurma),
          loteNome: asString(entry.loteName, row.loteNome),
          scannedAt: asString(entry.scannedAt),
          scannedByUserName: asString(entry.scannedByUserName, "Operador"),
          scannedByUserTurma: asString(entry.scannedByUserTurma),
        }));
    })
    .sort(
      (left, right) =>
        new Date(right.scannedAt || 0).getTime() - new Date(left.scannedAt || 0).getTime()
    );

const serializeLot = (lot: EventLot, plans: PlanRecord[]) => ({
  id: lot.id,
  nome: lot.nome.trim().slice(0, EVENT_LOTE_NAME_MAX_LENGTH),
  preco: lot.preco.trim(),
  status: lot.status,
  descricao: lot.descricao.trim(),
  quantidade: Math.max(0, Math.floor(lot.quantidade)),
  ordem: Math.max(0, Math.floor(lot.ordem)),
  qrPorIngresso: Math.max(1, Math.floor(lot.qrPorIngresso)),
  invisivel: lot.invisivel,
  transferivel: lot.transferivel,
  validadeAtiva: lot.validadeAtiva,
  inicioVendasData: lot.inicioVendasData,
  inicioVendasHora: lot.inicioVendasHora,
  fimVendasData: lot.fimVendasData,
  fimVendasHora: lot.fimVendasHora,
  planPrices: serializeLotePlanPrices(plans, lot.planPrices),
});

const cloneEvent = (event: AdminEvent): AdminEvent => ({
  ...event,
  lotes: event.lotes.map((lot) => ({
    ...lot,
    planPrices: lot.planPrices.map((entry) => ({ ...entry })),
  })),
  stats: { ...event.stats },
  paymentConfig: event.paymentConfig
    ? {
        ...event.paymentConfig,
        ...(event.paymentConfig.recipients
          ? { recipients: event.paymentConfig.recipients.map((entry) => ({ ...entry })) }
          : {}),
        ...(event.paymentConfig.recipient
          ? { recipient: { ...event.paymentConfig.recipient } }
          : {}),
      }
    : null,
  recipientUserIds: [...event.recipientUserIds],
  dataExtra: {
    raw: { ...event.dataExtra.raw },
    cupons: event.dataExtra.cupons.map((coupon) => ({ ...coupon })),
    checkinOperators: event.dataExtra.checkinOperators.map((operator) => ({ ...operator })),
  },
});

function SectionLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${
        active
          ? "border-brand bg-brand-soft text-brand-accent shadow-brand"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      {label}
    </Link>
  );
}

export default function AdminEventWorkspace({
  eventId,
  section,
}: {
  eventId: string;
  section: EventWorkspaceSection;
}) {
  const { addToast } = useToast();
  const { user } = useAuth();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [evento, setEvento] = useState<AdminEvent | null>(null);
  const [editDraft, setEditDraft] = useState<AdminEvent | null>(null);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [savingEvento, setSavingEvento] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [planCatalog, setPlanCatalog] = useState<PlanRecord[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const [paymentRecipients, setPaymentRecipients] = useState<TenantPaymentRecipientOption[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [showReceiversManager, setShowReceiversManager] = useState(false);

  const [salesRows, setSalesRows] = useState<EventSaleRow[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [salesSearch, setSalesSearch] = useState("");
  const [salesStatusFilter, setSalesStatusFilter] = useState("todos");

  const [polls, setPolls] = useState<EventPoll[]>([]);
  const [loadingPolls, setLoadingPolls] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollAllowUserOptions, setPollAllowUserOptions] = useState(true);
  const [pollDraftOptions, setPollDraftOptions] = useState<string[]>(["", ""]);

  const [editingLotId, setEditingLotId] = useState<number | "new" | null>(null);
  const [lotDraft, setLotDraft] = useState<EventLot>(createEmptyLot([]));

  const [editingCouponId, setEditingCouponId] = useState<string | "new" | null>(null);
  const [couponDraft, setCouponDraft] = useState<EventCoupon>(createEmptyCoupon());

  const [editingOperatorId, setEditingOperatorId] = useState<string | "new" | null>(null);
  const [operatorDraft, setOperatorDraft] = useState<EventCheckinOperator>(createEmptyCheckinOperator());

  const scopedPath = useCallback(
    (path: string) => (tenantSlug ? withTenantSlug(tenantSlug, path) : path),
    [tenantSlug]
  );

  const eventSectionHref = useCallback(
    (targetSection: EventWorkspaceSection) =>
      scopedPath(`/admin/eventos/${encodeURIComponent(eventId)}/${targetSection}`),
    [eventId, scopedPath]
  );

  const adminEventosHref = scopedPath("/admin/eventos");
  const scanEventoHref = scopedPath(`/admin/eventos/scan/${encodeURIComponent(eventId)}`);
  const scanHubHref = scopedPath("/admin/scan-eventos");
  const legacyListaHref = scopedPath(`/admin/eventos/lista/${encodeURIComponent(eventId)}`);

  const loadEvent = useCallback(
    async () => {
      const cleanEventId = eventId.trim();
      if (!cleanEventId) return;

      setLoadingEvento(true);
      try {
        const row = await fetchAdminEventById({
          eventId: cleanEventId,
          tenantId: activeTenantId || undefined,
        });
        if (!row) {
          setEvento(null);
          setEditDraft(null);
          return;
        }
        const mapped = mapAdminEventRow(row);
        setEvento(mapped);
        setEditDraft(cloneEvent(mapped));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar evento.", "error");
      } finally {
        setLoadingEvento(false);
      }
    },
    [activeTenantId, addToast, eventId]
  );

  const loadPlanCatalog = useCallback(
    async (forceRefresh = false) => {
      if (loadingPlans) return;
      setLoadingPlans(true);
      try {
        const rows = await fetchPlanCatalog({
          tenantId: activeTenantId || undefined,
          forceRefresh,
          maxResults: 50,
        });
        setPlanCatalog(rows);
      } catch (error: unknown) {
        console.error(error);
      } finally {
        setLoadingPlans(false);
      }
    },
    [activeTenantId, loadingPlans]
  );

  const loadPaymentRecipients = useCallback(async () => {
    const cleanTenantId = (activeTenantId || "").trim();
    if (!cleanTenantId || loadingRecipients) return;
    setLoadingRecipients(true);
    try {
      const rows = await fetchTenantPaymentRecipients(cleanTenantId, "events");
      setPaymentRecipients(rows);
    } catch (error: unknown) {
      console.error(error);
      setPaymentRecipients([]);
      addToast("Erro ao carregar recebedores.", "error");
    } finally {
      setLoadingRecipients(false);
    }
  }, [activeTenantId, addToast, loadingRecipients]);

  const loadSales = useCallback(
    async (forceRefresh = false) => {
      if (loadingSales) return;
      setLoadingSales(true);
      try {
        const page = await fetchAdminEventSalesPage({
          eventId,
          pageSize: 2000,
          forceRefresh,
        });
        setSalesRows(page.rows.map((row) => mapSaleRow(row)));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar ingressos.", "error");
      } finally {
        setLoadingSales(false);
      }
    },
    [addToast, eventId, loadingSales]
  );

  const loadPolls = useCallback(
    async (forceRefresh = false) => {
      if (loadingPolls) return;
      setLoadingPolls(true);
      try {
        const rows = await fetchAdminEventPolls({
          eventId,
          forceRefresh,
          maxResults: 60,
          tenantId: activeTenantId || undefined,
        });
        setPolls(rows.map((row) => mapPollRow(row)));
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar enquetes.", "error");
      } finally {
        setLoadingPolls(false);
      }
    },
    [activeTenantId, addToast, eventId, loadingPolls]
  );

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    if (section === "lotes" || section === "edicao") {
      void loadPlanCatalog();
    }
    if (section === "recebedores" || section === "edicao") {
      void loadPaymentRecipients();
    }
    if (section === "extrato" || section === "bi" || section === "ingressos" || section === "checkins") {
      void loadSales();
    }
    if (section === "enquetes") {
      void loadPolls();
    }
  }, [loadPaymentRecipients, loadPlanCatalog, loadPolls, loadSales, section]);

  useEffect(() => {
    if (!planCatalog.length) return;
    setLotDraft((previous) => ({
      ...previous,
      planPrices: buildLotePlanPrices(planCatalog, previous.planPrices),
    }));
    setEditDraft((previous) =>
      previous
        ? {
            ...previous,
            lotes: previous.lotes.map((lot) => ({
              ...lot,
              planPrices: buildLotePlanPrices(planCatalog, lot.planPrices),
            })),
          }
        : previous
    );
  }, [planCatalog]);

  const persistEvent = useCallback(
    async (nextEvent: AdminEvent, successMessage: string) => {
      if (savingEvento) return;
      const selectedPaymentRecipientsFromDirectory = filterTenantPaymentRecipientsByIds(
        paymentRecipients,
        nextEvent.recipientUserIds
      );
      const fallbackPaymentRecipients = (
        nextEvent.paymentConfig?.recipients?.length
          ? nextEvent.paymentConfig.recipients
          : nextEvent.paymentConfig?.recipient
            ? [nextEvent.paymentConfig.recipient]
            : []
      )
        .map((entry) => ({
          userId: asString(entry.userId),
          name: asString(entry.name),
          turma: asString(entry.turma),
          avatarUrl: asString(entry.avatarUrl),
          phone: asString(entry.phone),
        }))
        .filter((entry) => nextEvent.recipientUserIds.includes(entry.userId));
      const selectedPaymentRecipients =
        selectedPaymentRecipientsFromDirectory.length > 0 || nextEvent.recipientUserIds.length === 0
          ? selectedPaymentRecipientsFromDirectory
          : fallbackPaymentRecipients;
      const primaryPaymentRecipient = selectedPaymentRecipients[0] || null;
      const normalizedWhatsapp = normalizePhoneToBrE164(nextEvent.contatoComprovante || "");
      const hasPaymentConfig =
        Boolean(nextEvent.pixChave.trim()) ||
        Boolean(nextEvent.pixBanco.trim()) ||
        Boolean(nextEvent.pixTitular.trim()) ||
        Boolean(normalizedWhatsapp.trim()) ||
        selectedPaymentRecipients.length > 0;

      const payload: Record<string, unknown> = {
        titulo: nextEvent.titulo.trim().slice(0, EVENT_TITLE_MAX_LENGTH),
        data: nextEvent.data,
        hora: nextEvent.hora,
        local: nextEvent.local.trim().slice(0, EVENT_LOCATION_MAX_LENGTH),
        tipo: nextEvent.tipo.trim().slice(0, EVENT_TYPE_MAX_LENGTH),
        destaque: nextEvent.destaque.trim().slice(0, 180),
        mapsUrl: nextEvent.mapsUrl.trim().slice(0, 400),
        imagem: nextEvent.imagem,
        imagePositionY: nextEvent.imagePositionY,
        descricao: nextEvent.descricao.trim().slice(0, EVENT_DESCRIPTION_MAX_LENGTH),
        lotes: nextEvent.lotes.map((lot) => serializeLot(lot, planCatalog)),
        status: nextEvent.status,
        sale_status: nextEvent.saleStatus,
        pixChave: nextEvent.pixChave.trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        pixBanco: nextEvent.pixBanco.trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        pixTitular: nextEvent.pixTitular.trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        contatoComprovante: normalizedWhatsapp.slice(0, PHONE_MAX_LENGTH),
        stats: nextEvent.stats,
        isLowStock: nextEvent.isLowStock,
        data_extra: serializeDataExtra(nextEvent.dataExtra),
        payment_config: hasPaymentConfig
          ? {
              chave: nextEvent.pixChave.trim(),
              banco: nextEvent.pixBanco.trim(),
              titular: nextEvent.pixTitular.trim(),
              ...(normalizedWhatsapp ? { whatsapp: normalizedWhatsapp } : {}),
              ...(primaryPaymentRecipient
                ? { recipient: toCommerceRecipientSnapshot(primaryPaymentRecipient) }
                : {}),
              ...(selectedPaymentRecipients.length > 0
                ? { recipients: selectedPaymentRecipients.map(toCommerceRecipientSnapshot) }
                : {}),
            }
          : null,
      };

      setSavingEvento(true);
      try {
        await upsertAdminEvent({
          eventId: nextEvent.id,
          data: payload,
          actorUserId: user?.uid,
          tenantId: activeTenantId || undefined,
        });
        await loadEvent();
        addToast(successMessage, "success");
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao salvar evento.", "error");
      } finally {
        setSavingEvento(false);
      }
    },
    [activeTenantId, addToast, loadEvent, paymentRecipients, planCatalog, savingEvento, user?.uid]
  );

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    if (!editDraft.titulo.trim()) {
      addToast("Título obrigatório.", "error");
      return;
    }
    if (!editDraft.data || !editDraft.hora) {
      addToast("Data e hora obrigatórias.", "error");
      return;
    }
    if (
      editDraft.contatoComprovante.trim() &&
      !hasValidPhoneLength(editDraft.contatoComprovante.trim())
    ) {
      addToast("Informe um WhatsApp válido para o comprovante.", "error");
      return;
    }
    await persistEvent(editDraft, "Evento atualizado.");
  };

  const handleImageUpload = async (file: File) => {
    if (!editDraft || uploadingImage) return;
    setUploadingImage(true);
    try {
      const tenantScope = sanitizeStoragePathSegment(activeTenantId || "global");
      const objectDir = `eventos/${tenantScope}/${sanitizeStoragePathSegment(editDraft.id || "draft")}`;
      const { url, error } = await uploadImage(file, objectDir, {
        scopeKey: `admin:eventos:capa:${tenantScope}:${editDraft.id || "draft"}`,
        fileName: editDraft.id ? "capa" : buildDraftAssetFileName("capa"),
        upsert: Boolean(editDraft.id),
        versionStrategy: editDraft.id ? "file-metadata" : "none",
        cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
        maxBytes: 3 * 1024 * 1024,
        maxWidth: 2400,
        maxHeight: 1800,
        maxPixels: 3_600_000,
        compressionMaxWidth: 1800,
        compressionMaxHeight: 1200,
        compressionMaxBytes: 200 * 1024,
        quality: 0.82,
        rateLimitMax: 4,
      });
      if (error || !url) {
        addToast(error || "Falha no upload da capa.", "error");
        return;
      }
      setEditDraft((previous) => (previous ? { ...previous, imagem: url } : previous));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSalesPaymentToggle = async (row: EventSaleRow) => {
    const isApproving = row.status.toLowerCase() !== "aprovado";
    const amount = parseCurrency(row.valorTotal || "0");
    try {
      await setAdminTicketPayment({
        ticketRequestId: row.id,
        isApproving,
        approvedBy: user?.nome || "Admin",
      });

      if (row.userId && Number.isFinite(amount)) {
        await incrementEventPurchaseUserStats({
          userId: row.userId,
          isApproving,
          valorGasto: amount,
          lotName: row.loteNome,
          eventTitle: evento?.titulo || "Evento",
        });
      }

      if (user?.uid) {
        await logActivity(
          user.uid,
          user.nome || "Admin",
          "UPDATE",
          "Eventos/Pagamentos",
          `${isApproving ? "Aprovou" : "Reabriu"} comprovante de ${row.userName} (${evento?.titulo || "Evento"})`
        ).catch(() => {});
      }

      addToast(isApproving ? "Pagamento aprovado." : "Pagamento reaberto.", "success");
      await loadSales(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar pagamento.", "error");
    }
  };

  const handleCreatePoll = async () => {
    const normalizedOptions = pollDraftOptions
      .map((option) => option.trim().slice(0, EVENT_POLL_OPTION_MAX_CHARS))
      .filter((option, index, array) => option.length > 0 && array.indexOf(option) === index)
      .slice(0, EVENT_POLL_OPTION_MAX_COUNT);
    if (!pollQuestion.trim()) {
      addToast("Digite a pergunta da enquete.", "error");
      return;
    }
    try {
      await createAdminEventPoll({
        eventId,
        question: pollQuestion.trim().slice(0, EVENT_POLL_QUESTION_MAX_CHARS),
        allowUserOptions: pollAllowUserOptions,
        options: normalizedOptions.map((text) => ({ text, votes: 0 })),
        tenantId: activeTenantId || undefined,
      });
      setPollQuestion("");
      setPollAllowUserOptions(true);
      setPollDraftOptions(["", ""]);
      addToast("Enquete criada.", "success");
      await loadPolls(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao criar enquete.", "error");
    }
  };

  const handleDeletePoll = async (pollId: string) => {
    if (!window.confirm("Excluir enquete?")) return;
    try {
      await deleteAdminEventPoll({
        eventId,
        pollId,
        tenantId: activeTenantId || undefined,
      });
      addToast("Enquete removida.", "success");
      await loadPolls(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao excluir enquete.", "error");
    }
  };

  const handleDeletePollOption = async (poll: EventPoll, optionIndex: number) => {
    if (!window.confirm("Remover esta opção da enquete?")) return;
    const nextOptions = poll.options.filter((_, index) => index !== optionIndex);
    try {
      await updateAdminEventPollOptions({
        eventId,
        pollId: poll.id,
        options: nextOptions,
        tenantId: activeTenantId || undefined,
      });
      addToast("Opção removida.", "success");
      await loadPolls(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar enquete.", "error");
    }
  };

  const sortedLots = useMemo(
    () =>
      [...(evento?.lotes || [])].sort((left, right) => {
        const orderDelta = left.ordem - right.ordem;
        if (orderDelta !== 0) return orderDelta;
        return left.nome.localeCompare(right.nome, "pt-BR");
      }),
    [evento?.lotes]
  );

  const filteredSales = useMemo(() => {
    const search = normalizeSearch(salesSearch);
    return salesRows.filter((row) => {
      const matchesSearch =
        !search ||
        normalizeSearch(
          `${row.userName} ${row.userTurma} ${row.loteNome} ${row.id} ${row.status}`
        ).includes(search);
      const matchesStatus =
        salesStatusFilter === "todos" ||
        (salesStatusFilter === "aprovado" && row.status.toLowerCase() === "aprovado") ||
        (salesStatusFilter === "pendente" && row.status.toLowerCase() === "pendente") ||
        (salesStatusFilter === "analise" && row.status.toLowerCase() === "analise");
      return matchesSearch && matchesStatus;
    });
  }, [salesRows, salesSearch, salesStatusFilter]);

  const checkinRows = useMemo(() => flattenTicketCheckins(salesRows), [salesRows]);

  const salesMetrics = useMemo(() => {
    const bruto = salesRows.reduce((sum, row) => sum + parseCurrency(row.valorTotal), 0);
    const aprovado = salesRows
      .filter((row) => row.status.toLowerCase() === "aprovado")
      .reduce((sum, row) => sum + parseCurrency(row.valorTotal), 0);
    const pendente = salesRows
      .filter((row) => row.status.toLowerCase() !== "aprovado")
      .reduce((sum, row) => sum + parseCurrency(row.valorTotal), 0);
    const descontos = (evento?.dataExtra.cupons || []).reduce((sum, coupon) => {
      if (coupon.tipo === "valor") {
        return sum + parseCurrency(coupon.valor) * coupon.usos;
      }
      return sum;
    }, 0);

    return {
      bruto,
      aprovado,
      pendente,
      descontos,
      tickets: salesRows.reduce((sum, row) => sum + row.quantidade, 0),
    };
  }, [evento?.dataExtra.cupons, salesRows]);

  const analyticsEventRows = useMemo<Record<string, unknown>[]>(
    () => (evento ? [{ ...evento }] as Record<string, unknown>[] : []),
    [evento]
  );

  const analyticsTicketRows = useMemo<Record<string, unknown>[]>(
    () =>
      evento
        ? salesRows.map((row) => ({
            ...row,
            eventoId: evento.id,
            eventId: evento.id,
            event_id: evento.id,
            eventoNome: evento.titulo,
            eventName: evento.titulo,
          }))
        : [],
    [evento, salesRows]
  );

  const operatorPerformance = useMemo(() => {
    const byOperator = new Map<string, number>();
    checkinRows.forEach((row) => {
      const key = row.scannedByUserName || "Operador";
      byOperator.set(key, (byOperator.get(key) || 0) + 1);
    });
    return Array.from(byOperator.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((left, right) => right.total - left.total);
  }, [checkinRows]);

  const handleOpenNewLot = () => {
    setEditingLotId("new");
    setLotDraft(createEmptyLot(planCatalog));
  };

  const handleOpenEditLot = (lot: EventLot) => {
    setEditingLotId(lot.id);
    setLotDraft({
      ...lot,
      planPrices: buildLotePlanPrices(planCatalog, lot.planPrices),
    });
  };

  const handleSaveLot = async () => {
    if (!evento) return;
    if (!lotDraft.nome.trim() || !lotDraft.preco.trim()) {
      addToast("Título e preço do lote são obrigatórios.", "error");
      return;
    }
    const nextLot: EventLot = {
      ...lotDraft,
      nome: lotDraft.nome.trim().slice(0, EVENT_LOTE_NAME_MAX_LENGTH),
      preco: lotDraft.preco.trim(),
      descricao: lotDraft.descricao.trim(),
      quantidade: Math.max(0, Math.floor(lotDraft.quantidade)),
      ordem: Math.max(0, Math.floor(lotDraft.ordem)),
      qrPorIngresso: Math.max(1, Math.floor(lotDraft.qrPorIngresso)),
      planPrices: buildLotePlanPrices(planCatalog, lotDraft.planPrices),
    };
    const nextEvent = cloneEvent(evento);
    if (editingLotId === "new") {
      nextEvent.lotes = [...nextEvent.lotes, { ...nextLot, id: Date.now() }];
    } else {
      nextEvent.lotes = nextEvent.lotes.map((lot) => (lot.id === editingLotId ? nextLot : lot));
    }
    await persistEvent(nextEvent, editingLotId === "new" ? "Lote criado." : "Lote atualizado.");
    setEditingLotId(null);
    setLotDraft(createEmptyLot(planCatalog));
  };

  const handleDeleteLot = async (lotId: number) => {
    if (!evento || !window.confirm("Remover este lote?")) return;
    const nextEvent = cloneEvent(evento);
    nextEvent.lotes = nextEvent.lotes.filter((lot) => lot.id !== lotId);
    await persistEvent(nextEvent, "Lote removido.");
    if (editingLotId === lotId) {
      setEditingLotId(null);
      setLotDraft(createEmptyLot(planCatalog));
    }
  };

  const handleOpenNewCoupon = () => {
    setEditingCouponId("new");
    setCouponDraft(createEmptyCoupon());
  };

  const handleOpenEditCoupon = (coupon: EventCoupon) => {
    setEditingCouponId(coupon.id);
    setCouponDraft({ ...coupon });
  };

  const handleSaveCoupon = async () => {
    if (!evento) return;
    if (!couponDraft.titulo.trim() || !couponDraft.codigo.trim()) {
      addToast("Título e código do cupom são obrigatórios.", "error");
      return;
    }
    const nextCoupon: EventCoupon = {
      ...couponDraft,
      titulo: couponDraft.titulo.trim().slice(0, EVENT_COUPON_TITLE_MAX_LENGTH),
      codigo: couponDraft.codigo.trim().slice(0, EVENT_COUPON_CODE_MAX_LENGTH).toUpperCase(),
      valor: couponDraft.valor.trim(),
      valorMinimo: couponDraft.valorMinimo.trim(),
      valorMaximo: couponDraft.valorMaximo.trim(),
      quantidadeDisponivel: Math.max(0, Math.floor(couponDraft.quantidadeDisponivel)),
    };
    const nextEvent = cloneEvent(evento);
    if (editingCouponId === "new") {
      nextEvent.dataExtra.cupons = [...nextEvent.dataExtra.cupons, nextCoupon];
    } else {
      nextEvent.dataExtra.cupons = nextEvent.dataExtra.cupons.map((coupon) =>
        coupon.id === editingCouponId ? nextCoupon : coupon
      );
    }
    await persistEvent(nextEvent, editingCouponId === "new" ? "Cupom criado." : "Cupom atualizado.");
    setEditingCouponId(null);
    setCouponDraft(createEmptyCoupon());
  };

  const handleDeleteCoupon = async (couponId: string) => {
    if (!evento || !window.confirm("Excluir este cupom?")) return;
    const nextEvent = cloneEvent(evento);
    nextEvent.dataExtra.cupons = nextEvent.dataExtra.cupons.filter((coupon) => coupon.id !== couponId);
    await persistEvent(nextEvent, "Cupom removido.");
    if (editingCouponId === couponId) {
      setEditingCouponId(null);
      setCouponDraft(createEmptyCoupon());
    }
  };

  const handleOpenNewOperator = () => {
    setEditingOperatorId("new");
    setOperatorDraft(createEmptyCheckinOperator());
  };

  const handleOpenEditOperator = (operator: EventCheckinOperator) => {
    setEditingOperatorId(operator.id);
    setOperatorDraft({ ...operator });
  };

  const handleSaveOperator = async () => {
    if (!evento) return;
    if (!operatorDraft.nome.trim()) {
      addToast("Informe o nome do operador.", "error");
      return;
    }
    const nextOperator: EventCheckinOperator = {
      ...operatorDraft,
      nome: operatorDraft.nome.trim().slice(0, EVENT_OPERATOR_NAME_MAX_LENGTH),
      email: operatorDraft.email.trim().slice(0, EVENT_OPERATOR_EMAIL_MAX_LENGTH),
    };
    const nextEvent = cloneEvent(evento);
    if (editingOperatorId === "new") {
      nextEvent.dataExtra.checkinOperators = [...nextEvent.dataExtra.checkinOperators, nextOperator];
    } else {
      nextEvent.dataExtra.checkinOperators = nextEvent.dataExtra.checkinOperators.map((operator) =>
        operator.id === editingOperatorId ? nextOperator : operator
      );
    }
    await persistEvent(
      nextEvent,
      editingOperatorId === "new" ? "Operador de apoio adicionado." : "Operador atualizado."
    );
    setEditingOperatorId(null);
    setOperatorDraft(createEmptyCheckinOperator());
  };

  const handleDeleteOperator = async (operatorId: string) => {
    if (!evento || !window.confirm("Remover este operador da lista visual?")) return;
    const nextEvent = cloneEvent(evento);
    nextEvent.dataExtra.checkinOperators = nextEvent.dataExtra.checkinOperators.filter(
      (operator) => operator.id !== operatorId
    );
    await persistEvent(nextEvent, "Operador removido.");
    if (editingOperatorId === operatorId) {
      setEditingOperatorId(null);
      setOperatorDraft(createEmptyCheckinOperator());
    }
  };

  const handleSaveRecebedores = async (recipientUserIds: string[]) => {
    if (!evento) return;
    const nextEvent = cloneEvent(evento);
    nextEvent.recipientUserIds = recipientUserIds;
    setEvento(nextEvent);
    setEditDraft(nextEvent);
    await persistEvent(nextEvent, "Recebedores atualizados.");
  };

  const exportExtratoCsv = () => {
    if (!filteredSales.length) return;
    const headers = [
      "ID",
      "Cliente",
      "Turma",
      "Data",
      "Itens",
      "Valor",
      "Status",
      "Aprovado Por",
    ];
    const rows = filteredSales.map((row) => [
      row.id,
      row.userName,
      row.userTurma,
      formatDateTime(row.dataSolicitacao),
      `${row.quantidade}x ${row.loteNome}`,
      row.valorTotal,
      row.status,
      row.aprovadoPor || "-",
    ]);
    const csvContent = [headers.join(","), ...rows.map((line) => line.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `extrato_evento_${eventId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loadingEvento) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-6 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950 px-6 py-16">
          <Loader2 size={24} className="animate-spin text-brand" />
        </div>
      </main>
    );
  }

  if (!evento || !editDraft) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-6 text-white">
        <div className="mx-auto max-w-5xl space-y-4">
          <Link
            href={adminEventosHref}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-300"
          >
            <ArrowLeft size={14} />
            Voltar para eventos
          </Link>
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-400">
            Evento não encontrado.
          </div>
        </div>
      </main>
    );
  }

  const selectedRecipients = filterTenantPaymentRecipientsByIds(
    paymentRecipients,
    editDraft.recipientUserIds
  );

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-4 text-white sm:px-6 sm:py-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Link
                  href={adminEventosHref}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 bg-black/40 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                >
                  <ArrowLeft size={18} />
                </Link>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
                    Gestão do Evento
                  </p>
                  <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                    {evento.titulo}
                  </h1>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={scanEventoHref}
                  className="inline-flex items-center gap-2 rounded-full border border-brand bg-brand-soft px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-brand-accent shadow-brand"
                >
                  <QrCode size={14} />
                  Scanner
                </Link>
                <Link
                  href={legacyListaHref}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-black/30 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-200"
                >
                  <Users size={14} />
                  Lista antiga
                </Link>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[240px_1fr]">
              <div className="relative h-44 overflow-hidden rounded-[1.6rem] border border-zinc-800 bg-black sm:h-52">
                {evento.imagem ? (
                  <Image
                    src={evento.imagem}
                    alt={evento.titulo}
                    fill
                    sizes="(max-width: 768px) 100vw, 240px"
                    className="object-cover"
                    style={{ objectPosition: `50% ${evento.imagePositionY}%` }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-600">
                    <ImageIcon size={28} />
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Data</p>
                  <p className="mt-2 flex items-center gap-2 text-sm font-bold text-white">
                    <Calendar size={14} className="text-brand" />
                    {formatDate(evento.data)} às {evento.hora || "--:--"}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Local</p>
                  <p className="mt-2 flex items-center gap-2 text-sm font-bold text-white">
                    <MapPin size={14} className="text-brand-accent" />
                    {evento.local || "Sem local"}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Status de venda</p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-black uppercase ${saleStatusTone[evento.saleStatus]}`}
                  >
                    {evento.saleStatus === "em_breve"
                      ? "Em breve"
                      : evento.saleStatus === "esgotado"
                        ? "Esgotado"
                        : "Ativo"}
                  </span>
                </div>
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Confirmações</p>
                  <p className="mt-2 text-2xl font-black text-white">{evento.stats.confirmados}</p>
                  <p className="text-[11px] text-zinc-500">{evento.stats.talvez} interessados</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-800 px-4 py-3 sm:px-6">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {SECTION_ORDER.map((item) => (
                <SectionLink
                  key={item}
                  href={eventSectionHref(item)}
                  label={SECTION_LABELS[item]}
                  active={section === item}
                />
              ))}
            </div>
          </div>
        </header>

        {section === "extrato" ? (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Faturamento total", value: formatCurrency(salesMetrics.bruto), tone: "text-emerald-300" },
                { label: "Descontos (cupons)", value: formatCurrency(salesMetrics.descontos), tone: "text-red-300" },
                { label: "Saldo liberado", value: formatCurrency(salesMetrics.aprovado), tone: "text-violet-300" },
                { label: "Saldo a liberar", value: formatCurrency(salesMetrics.pendente), tone: "text-sky-300" },
              ].map((card) => (
                <div key={card.label} className="rounded-[1.6rem] border border-zinc-800 bg-zinc-950 p-5">
                  <p className="text-[11px] text-zinc-500">{card.label}</p>
                  <p className={`mt-3 text-3xl font-black ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-black text-white">Extrato do evento</h2>
                  <p className="text-sm text-zinc-500">Filtre as vendas e exporte o movimento deste evento.</p>
                </div>
                <button
                  type="button"
                  onClick={exportExtratoCsv}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                >
                  <Download size={14} />
                  Exportar CSV
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]">
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black/20 px-3 py-3">
                  <Search size={16} className="text-zinc-500" />
                  <input
                    value={salesSearch}
                    onChange={(event) => setSalesSearch(event.target.value)}
                    placeholder="Buscar por cliente, lote ou pedido..."
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                  />
                </div>
                <select
                  value={salesStatusFilter}
                  onChange={(event) => setSalesStatusFilter(event.target.value)}
                  className="rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none"
                >
                  <option value="todos">Todos os status</option>
                  <option value="aprovado">Aprovados</option>
                  <option value="pendente">Pendentes</option>
                  <option value="analise">Em análise</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadSales(true)}
                  className="brand-button-soft"
                >
                  Atualizar
                </button>
              </div>

              <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-zinc-800">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-black/40 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Itens</th>
                        <th className="px-4 py-3">Valor</th>
                        <th className="px-4 py-3">Desconto</th>
                        <th className="px-4 py-3">Pagamento</th>
                        <th className="px-4 py-3">Fonte</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 bg-zinc-950/70">
                      {loadingSales ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center">
                            <Loader2 size={20} className="mx-auto animate-spin text-brand" />
                          </td>
                        </tr>
                      ) : filteredSales.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                            Nenhuma transação encontrada.
                          </td>
                        </tr>
                      ) : (
                        filteredSales.map((row) => (
                          <tr key={row.id} className="hover:bg-white/[0.03]">
                            <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.id.slice(0, 8)}</td>
                            <td className="px-4 py-3">
                              <p className="font-bold text-white">{row.userName}</p>
                              <p className="text-xs text-zinc-500">{row.userTurma || "-"}</p>
                            </td>
                            <td className="px-4 py-3 text-zinc-400">{formatDateTime(row.dataSolicitacao)}</td>
                            <td className="px-4 py-3 text-zinc-300">{row.quantidade}x {row.loteNome}</td>
                            <td className="px-4 py-3 font-semibold text-emerald-300">
                              {formatCurrency(parseCurrency(row.valorTotal))}
                            </td>
                            <td className="px-4 py-3 text-zinc-500">R$ 0,00</td>
                            <td className="px-4 py-3 text-zinc-400">Comprovante</td>
                            <td className="px-4 py-3 text-zinc-400">App USC</td>
                            <td className="px-4 py-3">
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-300">
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {section === "bi" ? (
          <section className="space-y-4">
            <EventManagementAnalytics
              events={analyticsEventRows}
              tickets={analyticsTicketRows}
              hideEventSelector
              initialEventId={evento.id}
              headerLabel="BI do evento"
              headerTitle={evento.titulo}
              headerDescription="Análise consolidada deste evento específico, sem duplicar a página geral de BI."
            />
          </section>
        ) : null}

        {section === "lotes" ? (
          <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-white">Lotes do evento</h2>
                  <p className="text-sm text-zinc-500">Organize visibilidade, preços, validade e regras por lote.</p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenNewLot}
                  className="brand-button-soft"
                >
                  <Layers3 size={14} />
                  Criar novo lote
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {sortedLots.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
                    Nenhum lote cadastrado para este evento.
                  </div>
                ) : (
                  sortedLots.map((lot) => (
                    <div key={lot.id} className="rounded-[1.4rem] border border-zinc-800 bg-black/25 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-black text-white">{lot.nome}</h3>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${saleStatusTone[lot.status]}`}>
                              {lot.status === "em_breve" ? "Em breve" : lot.status === "esgotado" ? "Esgotado" : "Ativo"}
                            </span>
                            {lot.invisivel ? (
                              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-amber-200">
                                Invisível
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm text-zinc-400">{lot.descricao || "Sem descrição adicional."}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditLot(lot)}
                            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-200"
                          >
                            <Edit3 size={13} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteLot(lot.id)}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase text-red-200"
                          >
                            <Trash2 size={13} />
                            Excluir
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Preço</p>
                          <p className="mt-2 text-lg font-black text-emerald-300">R$ {lot.preco || "0,00"}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Quantidade</p>
                          <p className="mt-2 text-lg font-black text-white">{lot.quantidade}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Ordem / QR</p>
                          <p className="mt-2 text-lg font-black text-white">{lot.ordem} / {lot.qrPorIngresso}</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Período</p>
                          <p className="mt-2 text-sm font-bold text-white">
                            {lot.validadeAtiva
                              ? `${lot.inicioVendasData || "--"} ${lot.inicioVendasHora || "--:--"}`
                              : "Sem limite definido"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                  {editingLotId === "new" ? "Novo lote" : editingLotId ? "Editar lote" : "Criação de lotes"}
                </p>
                <h2 className="mt-2 text-xl font-black text-white">Crie ou atualize um lote</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Configure os mesmos campos operacionais usados hoje e já deixe o lote pronto para vendas futuras.
                </p>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Informações básicas</p>
                  <div className="mt-4 grid gap-3">
                    <LotNameSelector
                      value={lotDraft.nome}
                      maxLength={EVENT_LOTE_NAME_MAX_LENGTH}
                      onChange={(value) => setLotDraft((previous) => ({ ...previous, nome: value }))}
                    />
                    <textarea
                      value={lotDraft.descricao}
                      onChange={(event) =>
                        setLotDraft((previous) => ({ ...previous, descricao: event.target.value }))
                      }
                      placeholder="Descreva os benefícios ou detalhes deste lote..."
                      className="min-h-24 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Preço e quantidade</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input
                      value={lotDraft.preco}
                      onChange={(event) => setLotDraft((previous) => ({ ...previous, preco: event.target.value }))}
                      placeholder="Preço (R$)"
                      inputMode="decimal"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={lotDraft.quantidade}
                      onChange={(event) =>
                        setLotDraft((previous) => ({
                          ...previous,
                          quantidade: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      placeholder="Quantidade"
                      inputMode="numeric"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={lotDraft.ordem}
                      onChange={(event) =>
                        setLotDraft((previous) => ({
                          ...previous,
                          ordem: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      placeholder="Ordem de exibição"
                      inputMode="numeric"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={lotDraft.qrPorIngresso}
                      onChange={(event) =>
                        setLotDraft((previous) => ({
                          ...previous,
                          qrPorIngresso: Math.max(1, Number(event.target.value) || 1),
                        }))
                      }
                      placeholder="QR por ingresso"
                      inputMode="numeric"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Opções do lote</p>
                  <div className="mt-4 grid gap-3">
                    <label className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                      <input
                        type="checkbox"
                        checked={lotDraft.invisivel}
                        onChange={(event) =>
                          setLotDraft((previous) => ({ ...previous, invisivel: event.target.checked }))
                        }
                        className="mt-1 h-4 w-4 accent-emerald-500"
                      />
                      <div>
                        <p className="font-bold text-white">Lote invisível</p>
                        <p className="text-sm text-zinc-500">
                          Fica oculto da venda pública e pode ser reservado para operação interna.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                      <input
                        type="checkbox"
                        checked={lotDraft.transferivel}
                        onChange={(event) =>
                          setLotDraft((previous) => ({ ...previous, transferivel: event.target.checked }))
                        }
                        className="mt-1 h-4 w-4 accent-emerald-500"
                      />
                      <div>
                        <p className="font-bold text-white">Lote transferível</p>
                        <p className="text-sm text-zinc-500">
                          Permite a circulação do ingresso entre usuários.
                        </p>
                      </div>
                    </label>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={lotDraft.validadeAtiva}
                          onChange={(event) =>
                          setLotDraft((previous) => ({ ...previous, validadeAtiva: event.target.checked }))
                        }
                          className="mt-1 h-4 w-4 accent-emerald-500"
                        />
                        <div>
                          <p className="font-bold text-white">Período de validade</p>
                          <p className="text-sm text-zinc-500">Defina início e fim das vendas deste lote.</p>
                        </div>
                      </label>
                      {lotDraft.validadeAtiva ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Início das vendas</p>
                            <input
                              type="date"
                              value={lotDraft.inicioVendasData}
                              onChange={(event) =>
                                setLotDraft((previous) => ({ ...previous, inicioVendasData: event.target.value }))
                              }
                              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none"
                            />
                            <input
                              type="time"
                              value={lotDraft.inicioVendasHora}
                              onChange={(event) =>
                                setLotDraft((previous) => ({ ...previous, inicioVendasHora: event.target.value }))
                              }
                              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none"
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Fim das vendas</p>
                            <input
                              type="date"
                              value={lotDraft.fimVendasData}
                              onChange={(event) =>
                                setLotDraft((previous) => ({ ...previous, fimVendasData: event.target.value }))
                              }
                              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none"
                            />
                            <input
                              type="time"
                              value={lotDraft.fimVendasHora}
                              onChange={(event) =>
                                setLotDraft((previous) => ({ ...previous, fimVendasHora: event.target.value }))
                              }
                              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Preço por plano</p>
                  <div className="mt-4 space-y-3">
                    {lotDraft.planPrices.map((entry) => (
                      <div
                        key={entry.planId}
                        className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-[1fr_160px]"
                      >
                        <div>
                          <p className="font-bold text-white">{entry.planName}</p>
                          <p className="text-xs text-zinc-500">Em branco usa o valor geral do lote.</p>
                        </div>
                        <input
                          value={entry.price}
                          onChange={(event) =>
                            setLotDraft((previous) => ({
                              ...previous,
                              planPrices: previous.planPrices.map((planEntry) =>
                                planEntry.planId === entry.planId
                                  ? { ...planEntry, price: event.target.value }
                                  : planEntry
                              ),
                            }))
                          }
                          placeholder="Preço especial"
                          className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Status do lote</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(["ativo", "em_breve", "esgotado"] as EventSaleStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setLotDraft((previous) => ({ ...previous, status }))}
                        className={`rounded-xl border px-3 py-3 text-[11px] font-black uppercase ${
                          lotDraft.status === status
                            ? saleStatusTone[status]
                            : "border-zinc-700 bg-zinc-950 text-zinc-400"
                        }`}
                      >
                        {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em breve" : "Esgotado"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
                {editingLotId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLotId(null);
                      setLotDraft(createEmptyLot(planCatalog));
                    }}
                    className="rounded-2xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-300"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSaveLot()}
                  className="brand-button-soft"
                >
                  {editingLotId === "new" ? "Criar lote" : editingLotId ? "Salvar lote" : "Salvar rascunho"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {section === "ingressos" ? (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Pedidos", value: String(salesRows.length) },
                { label: "Ingressos emitidos", value: String(salesMetrics.tickets) },
                { label: "Aprovados", value: String(salesRows.filter((row) => row.status.toLowerCase() === "aprovado").length) },
                { label: "Check-ins lidos", value: String(checkinRows.length) },
              ].map((card) => (
                <div key={card.label} className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950 p-5">
                  <p className="text-[11px] text-zinc-500">{card.label}</p>
                  <p className="mt-3 text-3xl font-black text-white">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-black text-white">Ingressos e pedidos</h2>
                  <p className="text-sm text-zinc-500">Acompanhe pedidos, liberações e consumo dos ingressos do evento.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={scanEventoHref}
                    className="brand-button-soft"
                  >
                    <QrCode size={14} />
                    Scanner do evento
                  </Link>
                  <Link
                    href={legacyListaHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                  >
                    <Users size={14} />
                    Lista antiga
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1.3fr_0.8fr_auto]">
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-black/20 px-3 py-3">
                  <Search size={16} className="text-zinc-500" />
                  <input
                    value={salesSearch}
                    onChange={(event) => setSalesSearch(event.target.value)}
                    placeholder="Buscar por aluno, lote ou pedido..."
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                  />
                </div>
                <select
                  value={salesStatusFilter}
                  onChange={(event) => setSalesStatusFilter(event.target.value)}
                  className="rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none"
                >
                  <option value="todos">Todos</option>
                  <option value="aprovado">Aprovado</option>
                  <option value="pendente">Pendente</option>
                  <option value="analise">Em análise</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadSales(true)}
                  className="rounded-2xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                >
                  Atualizar
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {loadingSales ? (
                  <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-8 text-center">
                    <Loader2 size={20} className="mx-auto animate-spin text-brand" />
                  </div>
                ) : filteredSales.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-8 text-center text-sm text-zinc-500">
                    Nenhum ingresso encontrado para o filtro atual.
                  </div>
                ) : (
                  filteredSales.map((row) => {
                    const checkins = row.paymentConfig?.ticketEntries?.filter(
                      (entry) => entry.status === "lido" || Boolean(entry.scannedAt)
                    ).length ?? 0;
                    const approved = row.status.toLowerCase() === "aprovado";
                    return (
                      <div key={row.id} className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-black text-white">{row.userName}</h3>
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-300">
                                {row.userTurma || "Sem turma"}
                              </span>
                              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                                approved
                                  ? "border-brand bg-brand-soft text-brand-accent"
                                  : "border-zinc-700 bg-zinc-900/60 text-zinc-300"
                              }`}>
                                {row.status}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-zinc-400">
                              Pedido #{row.id.slice(0, 8)} • {row.quantidade}x {row.loteNome}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSalesPaymentToggle(row)}
                            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase ${
                              approved
                                ? "border border-zinc-700 bg-black/20 text-zinc-200"
                                : "border border-brand bg-brand-soft text-brand-accent"
                            }`}
                          >
                            {approved ? <RotateCcw size={14} /> : <Check size={14} />}
                            {approved ? "Reabrir pagamento" : "Aprovar pagamento"}
                          </button>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Valor</p>
                            <p className="mt-2 text-lg font-black text-emerald-300">{formatCurrency(parseCurrency(row.valorTotal))}</p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Unitário</p>
                            <p className="mt-2 text-lg font-black text-white">R$ {row.valorUnitario || "0,00"}</p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">QRs lidos</p>
                            <p className="mt-2 text-lg font-black text-white">{checkins}/{row.quantidade}</p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Solicitado em</p>
                            <p className="mt-2 text-sm font-bold text-white">{formatDateTime(row.dataSolicitacao)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        ) : null}

        {section === "cupons" ? (
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-white">Cupons do evento</h2>
                  <p className="text-sm text-zinc-500">Gerencie cupons internos e deixe o evento pronto para campanhas.</p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenNewCoupon}
                  className="brand-button-soft"
                >
                  <Percent size={14} />
                  Criar novo cupom
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {evento.dataExtra.cupons.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
                    Nenhum cupom cadastrado para este evento.
                  </div>
                ) : (
                  evento.dataExtra.cupons.map((coupon) => (
                    <div key={coupon.id} className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-black text-white">{coupon.titulo}</h3>
                            <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-300">
                              {coupon.codigo}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
                              coupon.ativo
                                ? "border-brand bg-brand-soft text-brand-accent"
                                : "border-zinc-700 bg-zinc-900/60 text-zinc-400"
                            }`}>
                              {coupon.ativo ? "Ativo" : "Inativo"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-400">
                            {coupon.tipo === "percentual" ? `${coupon.valor}%` : `R$ ${coupon.valor || "0,00"}`} • mínimo R$ {coupon.valorMinimo || "0,00"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditCoupon(coupon)}
                            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-xs font-black uppercase text-zinc-200"
                          >
                            <Edit3 size={13} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCoupon(coupon.id)}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase text-red-200"
                          >
                            <Trash2 size={13} />
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                {editingCouponId === "new" ? "Novo cupom" : editingCouponId ? "Editar cupom" : "Criação de cupons"}
              </p>
              <h2 className="mt-2 text-xl font-black text-white">Crie um novo cupom</h2>
              <p className="mt-1 text-sm text-zinc-500">Configure o catálogo promocional específico deste evento.</p>

              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Informações do cupom</p>
                  <div className="mt-4 grid gap-3">
                    <input
                      value={couponDraft.titulo}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({
                          ...previous,
                          titulo: event.target.value.slice(0, EVENT_COUPON_TITLE_MAX_LENGTH),
                        }))
                      }
                      placeholder="Título do cupom"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={couponDraft.codigo}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({
                          ...previous,
                          codigo: event.target.value.slice(0, EVENT_COUPON_CODE_MAX_LENGTH).toUpperCase(),
                        }))
                      }
                      placeholder="Código do cupom"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm uppercase outline-none placeholder:text-zinc-600"
                    />
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Tipo e valor</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <select
                      value={couponDraft.tipo}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({
                          ...previous,
                          tipo: event.target.value === "percentual" ? "percentual" : "valor",
                        }))
                      }
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none"
                    >
                      <option value="valor">Valor fixo</option>
                      <option value="percentual">Percentual</option>
                    </select>
                    <input
                      value={couponDraft.valor}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({ ...previous, valor: event.target.value }))
                      }
                      placeholder={couponDraft.tipo === "percentual" ? "Valor (%)" : "Valor (R$)"}
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={couponDraft.valorMinimo}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({ ...previous, valorMinimo: event.target.value }))
                      }
                      placeholder="Valor mínimo (R$)"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={couponDraft.valorMaximo}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({ ...previous, valorMaximo: event.target.value }))
                      }
                      placeholder="Valor máximo (R$)"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={couponDraft.quantidadeDisponivel}
                      onChange={(event) =>
                        setCouponDraft((previous) => ({
                          ...previous,
                          quantidadeDisponivel: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      placeholder="Quantidade disponível"
                      inputMode="numeric"
                      className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 sm:col-span-2"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <input
                    type="checkbox"
                    checked={couponDraft.ativo}
                    onChange={(event) =>
                      setCouponDraft((previous) => ({ ...previous, ativo: event.target.checked }))
                    }
                    className="mt-1 h-4 w-4 accent-emerald-500"
                  />
                  <div>
                    <p className="font-bold text-white">Cupom ativo</p>
                    <p className="text-sm text-zinc-500">Mantém o cupom disponível na operação deste evento.</p>
                  </div>
                </label>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
                {editingCouponId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCouponId(null);
                      setCouponDraft(createEmptyCoupon());
                    }}
                    className="rounded-2xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-300"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSaveCoupon()}
                  className="brand-button-soft"
                >
                  {editingCouponId === "new" ? "Criar cupom" : editingCouponId ? "Salvar cupom" : "Salvar rascunho"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {section === "checkins" ? (
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Ingressos emitidos", value: String(salesMetrics.tickets) },
                  { label: "Check-ins lidos", value: String(checkinRows.length) },
                  {
                    label: "Taxa de leitura",
                    value:
                      salesMetrics.tickets > 0
                        ? `${Math.round((checkinRows.length / salesMetrics.tickets) * 100)}%`
                        : "0%",
                  },
                  { label: "Leitores únicos", value: String(operatorPerformance.length) },
                ].map((card) => (
                  <div key={card.label} className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950 p-5">
                    <p className="text-[11px] text-zinc-500">{card.label}</p>
                    <p className="mt-3 text-3xl font-black text-white">{card.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-white">Histórico de leituras</h2>
                    <p className="text-sm text-zinc-500">Veja quem validou cada ingresso e acione o scanner do evento.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={scanEventoHref}
                      className="brand-button-soft"
                    >
                      <QrCode size={14} />
                      Scanner do evento
                    </Link>
                    <Link
                      href={scanHubHref}
                      className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                    >
                      <ScanLine size={14} />
                      Hub de scanner
                    </Link>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {loadingSales ? (
                    <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-8 text-center">
                      <Loader2 size={20} className="mx-auto animate-spin text-brand" />
                    </div>
                  ) : checkinRows.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-8 text-center text-sm text-zinc-500">
                      Nenhum check-in realizado até agora.
                    </div>
                  ) : (
                    checkinRows.map((row) => (
                      <div key={`${row.orderId}:${row.ticketToken}`} className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-black text-white">{row.holderName}</h3>
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase text-zinc-300">
                                {row.ticketLabel}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-zinc-400">
                              {row.holderTurma || "Sem turma"} • {row.loteNome || "Sem lote"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-right">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Lido em</p>
                            <p className="mt-2 text-sm font-bold text-white">{formatDateTime(row.scannedAt)}</p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Pedido</p>
                            <p className="mt-2 font-mono text-xs text-zinc-300">{row.orderId}</p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Operador</p>
                            <p className="mt-2 font-bold text-white">
                              {row.scannedByUserName || "Operador"}
                              {row.scannedByUserTurma ? ` • ${row.scannedByUserTurma}` : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                  {editingOperatorId === "new" ? "Novo operador" : editingOperatorId ? "Editar operador" : "Equipe de apoio"}
                </p>
                <h2 className="mt-2 text-xl font-black text-white">Equipe visual de check-in</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Cadastre os nomes de apoio do evento. As permissões reais de scanner continuam sendo controladas pelo perfil do app.
                </p>

                <div className="mt-5 space-y-4">
                  <input
                    value={operatorDraft.nome}
                    onChange={(event) =>
                      setOperatorDraft((previous) => ({
                        ...previous,
                        nome: event.target.value.slice(0, EVENT_OPERATOR_NAME_MAX_LENGTH),
                      }))
                    }
                    placeholder="Nome do operador"
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                  <input
                    value={operatorDraft.email}
                    onChange={(event) =>
                      setOperatorDraft((previous) => ({
                        ...previous,
                        email: event.target.value.slice(0, EVENT_OPERATOR_EMAIL_MAX_LENGTH),
                      }))
                    }
                    placeholder="E-mail do operador"
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                  <label className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                    <input
                      type="checkbox"
                      checked={operatorDraft.ativo}
                      onChange={(event) =>
                        setOperatorDraft((previous) => ({ ...previous, ativo: event.target.checked }))
                      }
                      className="mt-1 h-4 w-4 accent-emerald-500"
                    />
                    <div>
                      <p className="font-bold text-white">Operador ativo</p>
                      <p className="text-sm text-zinc-500">Mantém este nome visível para a operação do evento.</p>
                    </div>
                  </label>
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:justify-end">
                  {editingOperatorId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingOperatorId(null);
                        setOperatorDraft(createEmptyCheckinOperator());
                      }}
                      className="rounded-2xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-300"
                    >
                      Cancelar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleSaveOperator()}
                    className="brand-button-soft"
                  >
                    <UserPlus size={14} />
                    {editingOperatorId === "new" ? "Adicionar operador" : editingOperatorId ? "Salvar operador" : "Salvar rascunho"}
                  </button>
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-white">Leituras por operador</h3>
                    <p className="text-sm text-zinc-500">Resumo real do scanner com base nos ingressos lidos.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenNewOperator}
                    className="rounded-xl border border-zinc-700 bg-black/20 px-3 py-2 text-xs font-black uppercase text-zinc-200"
                  >
                    Novo
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {operatorPerformance.length === 0 && evento.dataExtra.checkinOperators.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
                      Nenhum operador visível ou leitura registrada.
                    </div>
                  ) : null}

                  {operatorPerformance.map((operator) => (
                    <div key={operator.name} className="rounded-[1.2rem] border border-zinc-800 bg-black/20 p-4">
                      <p className="font-black text-white">{operator.name}</p>
                      <p className="mt-2 text-sm text-zinc-500">{operator.total} validações realizadas</p>
                    </div>
                  ))}

                  {evento.dataExtra.checkinOperators.map((operator) => (
                    <div key={operator.id} className="rounded-[1.2rem] border border-zinc-800 bg-black/20 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-black text-white">{operator.nome}</p>
                          <p className="mt-1 text-sm text-zinc-500">{operator.email || "Sem e-mail"} • {operator.ativo ? "Ativo" : "Inativo"}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditOperator(operator)}
                            className="rounded-xl border border-zinc-700 bg-black/20 px-3 py-2 text-xs font-black uppercase text-zinc-200"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteOperator(operator.id)}
                            className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase text-red-200"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {section === "edicao" ? (
          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Capa do evento</p>
                    <h2 className="mt-2 text-xl font-black text-white">Imagem e posicionamento</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                  >
                    Trocar imagem
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleImageUpload(file);
                    }
                    event.target.value = "";
                  }}
                />

                <div className="mt-4 overflow-hidden rounded-[1.6rem] border border-zinc-800 bg-black">
                  <div className="relative h-56">
                    {uploadingImage ? (
                      <div className="flex h-full items-center justify-center text-brand">
                        <Loader2 size={22} className="animate-spin" />
                      </div>
                    ) : editDraft.imagem ? (
                      <Image
                        src={editDraft.imagem}
                        alt={editDraft.titulo}
                        fill
                        sizes="(max-width: 1280px) 100vw, 640px"
                        className="object-cover"
                        style={{ objectPosition: `50% ${editDraft.imagePositionY}%` }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-zinc-600">
                        <ImageIcon size={30} />
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 border-t border-zinc-800 p-4">
                    <ImageResizeHelpLink label="Diminuir a imagem do evento no Squoosh.app" />
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                      <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <MoveVertical size={12} />
                          Ajuste fino
                        </span>
                        <span>{editDraft.imagePositionY}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editDraft.imagePositionY}
                        onChange={(event) =>
                          setEditDraft((previous) =>
                            previous ? { ...previous, imagePositionY: Number(event.target.value) } : previous
                          )
                        }
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Dados principais</p>
                <h2 className="mt-2 text-xl font-black text-white">Informações do evento</h2>

                <div className="mt-5 grid gap-3">
                  <input
                    value={editDraft.titulo}
                    onChange={(event) =>
                      setEditDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              titulo: event.target.value.slice(0, EVENT_TITLE_MAX_LENGTH),
                            }
                          : previous
                      )
                    }
                    placeholder="Nome do evento"
                    className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={editDraft.data}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous ? { ...previous, data: event.target.value } : previous
                        )
                      }
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none"
                    />
                    <input
                      type="time"
                      value={editDraft.hora}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous ? { ...previous, hora: event.target.value } : previous
                        )
                      }
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select
                      value={editDraft.tipo}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                tipo: event.target.value.slice(0, EVENT_TYPE_MAX_LENGTH),
                              }
                            : previous
                        )
                      }
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none"
                    >
                      <option value="Festa">Festa</option>
                      <option value="Esporte">Esporte</option>
                      <option value="Outro">Outro</option>
                    </select>
                    <input
                      value={editDraft.local}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                local: event.target.value.slice(0, EVENT_LOCATION_MAX_LENGTH),
                              }
                            : previous
                        )
                      }
                      placeholder="Local"
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                  </div>
                  <textarea
                    value={editDraft.descricao}
                    onChange={(event) =>
                      setEditDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              descricao: event.target.value.slice(0, EVENT_DESCRIPTION_MAX_LENGTH),
                            }
                          : previous
                      )
                    }
                    placeholder="Descrição completa"
                    className="min-h-40 rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-brand" />
                  <div>
                    <h2 className="text-lg font-black text-white">Financeiro & recebimento</h2>
                    <p className="text-sm text-zinc-500">Substitua a conta global apenas neste evento.</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <input
                    value={editDraft.pixChave}
                    onChange={(event) =>
                      setEditDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              pixChave: event.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
                            }
                          : previous
                      )
                    }
                    placeholder="Chave PIX"
                    className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={editDraft.pixBanco}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                pixBanco: event.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
                              }
                            : previous
                        )
                      }
                      placeholder="Banco"
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={editDraft.pixTitular}
                      onChange={(event) =>
                        setEditDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                pixTitular: event.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
                              }
                            : previous
                        )
                      }
                      placeholder="Nome do titular"
                      className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                    />
                  </div>
                  <input
                    value={editDraft.contatoComprovante}
                    onChange={(event) =>
                      setEditDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              contatoComprovante: normalizePhoneToBrE164(event.target.value),
                            }
                          : previous
                      )
                    }
                    placeholder="WhatsApp para comprovante"
                    className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <h2 className="text-lg font-black text-white">Status de venda</h2>
                <p className="text-sm text-zinc-500">Controle se o evento está ativo, em breve ou esgotado.</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(["ativo", "em_breve", "esgotado"] as EventSaleStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() =>
                        setEditDraft((previous) => (previous ? { ...previous, saleStatus: status } : previous))
                      }
                      className={`rounded-xl border px-3 py-3 text-[11px] font-black uppercase ${
                        editDraft.saleStatus === status
                          ? saleStatusTone[status]
                          : "border-zinc-700 bg-black/20 text-zinc-400"
                      }`}
                    >
                      {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em breve" : "Esgotado"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <h2 className="text-lg font-black text-white">Recebedores do evento</h2>
                <p className="text-sm text-zinc-500">Mantidos aqui e também na página dedicada de recebedores.</p>
                <div className="mt-4">
                  <PaymentRecipientCheckboxList
                    id="admin-event-edit-recipients"
                    label="Liberar comprovantes do evento"
                    helperText="Marque quem pode receber os comprovantes específicos deste evento."
                    emptyText="Nenhum recebedor de evento cadastrado."
                    options={paymentRecipients}
                    selectedUserIds={editDraft.recipientUserIds}
                    loading={loadingRecipients}
                    onChange={(recipientUserIds) =>
                      setEditDraft((previous) =>
                        previous ? { ...previous, recipientUserIds } : previous
                      )
                    }
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedRecipients.map((recipient) => (
                    <span
                      key={recipient.userId}
                      className="rounded-full border border-brand bg-brand-soft px-3 py-1 text-[11px] font-bold text-brand-accent"
                    >
                      {recipient.name}
                    </span>
                  ))}
                  {selectedRecipients.length === 0 ? (
                    <span className="text-sm text-zinc-500">Nenhum recebedor selecionado.</span>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <h2 className="text-lg font-black text-white">Atalhos do evento</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Link
                    href={eventSectionHref("lotes")}
                    className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4 transition hover:border-brand"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Lotes</p>
                    <p className="mt-2 font-black text-white">{evento.lotes.length} configurados</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm text-brand-accent">
                      Abrir página
                      <ChevronRight size={14} />
                    </span>
                  </Link>
                  <Link
                    href={eventSectionHref("recebedores")}
                    className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4 transition hover:border-brand"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Recebedores</p>
                    <p className="mt-2 font-black text-white">{editDraft.recipientUserIds.length} selecionados</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm text-brand-accent">
                      Abrir página
                      <ChevronRight size={14} />
                    </span>
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setEditDraft(cloneEvent(evento))}
                  className="rounded-2xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-300"
                >
                  Recarregar rascunho
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={savingEvento}
                  className="brand-button-soft"
                >
                  {savingEvento ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Atualizar evento
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {section === "enquetes" ? (
          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Nova enquete</p>
              <h2 className="mt-2 text-xl font-black text-white">Crie uma enquete do evento</h2>
              <div className="mt-5 space-y-4">
                <input
                  value={pollQuestion}
                  onChange={(event) =>
                    setPollQuestion(event.target.value.slice(0, EVENT_POLL_QUESTION_MAX_CHARS))
                  }
                  placeholder="Pergunta da enquete"
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                />

                <label className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <input
                    type="checkbox"
                    checked={pollAllowUserOptions}
                    onChange={(event) => setPollAllowUserOptions(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-emerald-500"
                  />
                  <div>
                    <p className="font-bold text-white">Permitir novas respostas dos usuários</p>
                    <p className="text-sm text-zinc-500">Mantém a enquete aberta para sugestões da comunidade.</p>
                  </div>
                </label>

                <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Opções iniciais</p>
                    <button
                      type="button"
                      onClick={() =>
                        setPollDraftOptions((previous) =>
                          previous.length >= EVENT_POLL_OPTION_MAX_COUNT ? previous : [...previous, ""]
                        )
                      }
                      disabled={pollDraftOptions.length >= EVENT_POLL_OPTION_MAX_COUNT}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-black uppercase text-zinc-200 disabled:opacity-50"
                    >
                      Adicionar resposta
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {pollDraftOptions.map((option, index) => (
                      <div key={`draft-option-${index}`} className="flex gap-2">
                        <input
                          value={option}
                          onChange={(event) =>
                            setPollDraftOptions((previous) =>
                              previous.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? event.target.value.slice(0, EVENT_POLL_OPTION_MAX_CHARS)
                                  : entry
                              )
                            )
                          }
                          placeholder={`Resposta ${index + 1}`}
                          className="min-w-0 flex-1 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600"
                        />
                        {pollDraftOptions.length > 2 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPollDraftOptions((previous) =>
                                previous.filter((_, entryIndex) => entryIndex !== index)
                              )
                            }
                            className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 text-red-200"
                          >
                            <X size={14} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleCreatePoll()}
                  className="brand-button-soft"
                >
                  <MessageCircle size={14} />
                  Criar enquete
                </button>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <h2 className="text-xl font-black text-white">Enquetes já publicadas</h2>
              <p className="mt-1 text-sm text-zinc-500">Gerencie respostas e remova opções quando precisar.</p>

              <div className="mt-5 space-y-4">
                {loadingPolls ? (
                  <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-8 text-center">
                    <Loader2 size={20} className="mx-auto animate-spin text-brand" />
                  </div>
                ) : polls.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-8 text-center text-sm text-zinc-500">
                    Nenhuma enquete publicada para este evento.
                  </div>
                ) : (
                  polls.map((poll) => (
                    <div key={poll.id} className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-black text-white">{poll.question}</h3>
                          <p className="mt-1 text-sm text-zinc-500">
                            {poll.allowUserOptions ? "Aberta para respostas da comunidade." : "Somente respostas pré-definidas."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeletePoll(poll.id)}
                          className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-200"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {poll.options.map((option, index) => (
                          <div
                            key={`${poll.id}:${option.text}:${index}`}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3"
                          >
                            <div>
                              <p className="font-bold text-white">{option.text}</p>
                              <p className="text-xs text-zinc-500">
                                {option.votes} voto(s)
                                {option.creatorName ? ` • ${option.creatorName}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeletePollOption(poll, index)}
                              className="rounded-xl border border-zinc-700 bg-black/20 p-2 text-zinc-300"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}

        {section === "recebedores" ? (
          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-white">Recebedores do evento</h2>
                  <p className="mt-1 text-sm text-zinc-500">Escolha quem pode receber comprovantes deste evento.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReceiversManager(true)}
                  className="rounded-xl border border-zinc-700 bg-black/20 px-4 py-3 text-xs font-black uppercase text-zinc-200"
                >
                  Gerenciar diretório
                </button>
              </div>

              <div className="mt-5">
                <PaymentRecipientCheckboxList
                  id="admin-event-workspace-recipients"
                  label="Liberar comprovantes do evento"
                  helperText="Marque quem pode receber o comprovante específico deste evento."
                  emptyText="Nenhum recebedor de evento cadastrado."
                  options={paymentRecipients}
                  selectedUserIds={editDraft.recipientUserIds}
                  loading={loadingRecipients}
                  onChange={(recipientUserIds) =>
                    setEditDraft((previous) =>
                      previous ? { ...previous, recipientUserIds } : previous
                    )
                  }
                />
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSaveRecebedores(editDraft.recipientUserIds)}
                  disabled={savingEvento}
                  className="brand-button-soft"
                >
                  {savingEvento ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Salvar recebedores
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <h2 className="text-xl font-black text-white">Resumo do financeiro</h2>
                <div className="mt-5 grid gap-3">
                  <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Chave PIX</p>
                    <p className="mt-2 font-bold text-white">{editDraft.pixChave || "Não definida"}</p>
                  </div>
                  <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Banco / titular</p>
                    <p className="mt-2 font-bold text-white">
                      {[editDraft.pixBanco, editDraft.pixTitular].filter(Boolean).join(" • ") || "Não definido"}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">WhatsApp de comprovante</p>
                    <p className="mt-2 font-bold text-white">{editDraft.contatoComprovante || "Não definido"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
                <h3 className="text-lg font-black text-white">Recebedores selecionados</h3>
                <div className="mt-4 space-y-3">
                  {selectedRecipients.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
                      Nenhum recebedor está marcado neste evento.
                    </div>
                  ) : (
                    selectedRecipients.map((recipient) => (
                      <div key={recipient.userId} className="rounded-[1.4rem] border border-zinc-800 bg-black/20 p-4">
                        <p className="font-black text-white">{recipient.name}</p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {recipient.turma || "Sem turma"}
                          {recipient.phone ? ` • ${recipient.phone}` : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <PaymentReceiversManager
          tenantId={activeTenantId || ""}
          scope="events"
          open={showReceiversManager}
          recipients={paymentRecipients}
          title="Recebedores de eventos"
          description="Lista usada somente pelos comprovantes de eventos."
          savedMessage="Recebedores de eventos atualizados."
          onClose={() => setShowReceiversManager(false)}
          onSaved={setPaymentRecipients}
        />
      </div>
    </main>
  );
}
