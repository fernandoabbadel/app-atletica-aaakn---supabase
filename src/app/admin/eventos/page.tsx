"use client";

import React, { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Plus, Edit, Trash2, Calendar, 
  Image as ImageIcon, X, Tag, Users, 
  CheckCircle, Download, BarChart3, Lock, MoveVertical,
  Star, MessageCircle, Check, RotateCcw, Loader2, Wallet, UserPlus
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; 
import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { LotNameSelector } from "@/components/LotNameSelector";
import { PaymentRecipientCheckboxList } from "@/components/PaymentRecipientCheckboxList";
import { PaymentReceiversManager } from "@/components/PaymentReceiversManager";
import { useToast } from "../../../context/ToastContext";
import { useAuth } from "../../../context/AuthContext";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "../../../lib/upload";
import { logActivity } from "../../../lib/logger";
import { isEventExpiredByGrace } from "../../../lib/eventDateUtils";
import {
  createAdminEventPoll,
  deleteAdminEventById,
  deleteAdminEventPoll,
  EVENT_POLL_OPTION_MAX_CHARS,
  EVENT_POLL_OPTION_MAX_COUNT,
  EVENT_POLL_QUESTION_MAX_CHARS,
  fetchAdminEventParticipants,
  fetchAdminEventPolls,
  fetchEventsFeed,
  setAdminEventSaleStatus,
  incrementEventPurchaseUserStats,
  setAdminEventLowStock,
  setAdminEventStatus,
  setAdminTicketPayment,
  updateAdminEventPollOptions,
  upsertAdminEvent,
  type DateLike,
} from "../../../lib/eventsNativeService";
import { normalizePaymentConfig, type CommercePaymentConfig } from "@/lib/commerceCatalog";
import {
  fetchTenantPaymentRecipients,
  filterTenantPaymentRecipientsByIds,
  type TenantPaymentRecipientOption,
} from "@/lib/paymentRecipients";
import { fetchPlanCatalog, type PlanRecord } from "../../../lib/plansPublicService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  hasValidPhoneLength,
  normalizePhoneToBrE164,
  PHONE_MAX_LENGTH,
} from "@/utils/contactFields";

const EVENT_DASHBOARD_GRACE_MS = 24 * 60 * 60 * 1000;
const EVENT_TITLE_MAX_LENGTH = 120;
const EVENT_LOCATION_MAX_LENGTH = 140;
const EVENT_TYPE_MAX_LENGTH = 40;
const EVENT_DESCRIPTION_MAX_LENGTH = 1200;
const EVENT_PIX_FIELD_MAX_LENGTH = 140;
const EVENT_LOTE_NAME_MAX_LENGTH = 80;

// --- TIPAGEM ---
type EventSaleStatus = "ativo" | "em_breve" | "esgotado";
type StatusLote = EventSaleStatus;
type LotePlanPrice = {
  planId: string;
  planName: string;
  price: string;
};

interface Lote {
  id: number;
  nome: string;
  preco: string;
  status: StatusLote;
  dataVirada?: string;
  planPrices?: LotePlanPrice[];
}

interface PollOption {
  text: string;
  votes: number;
  creator?: string; 
  creatorName?: string;
  creatorAvatar?: string;
}

interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  allowUserOptions: boolean;
}

interface Participante {
  id: string; 
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: "going" | "maybe" | "comprador"; 
  pagamento?: "pago" | "pendente" | "analise"; 
  lote?: string;
  quantidade?: number;
  valorTotal?: string;
  dataAprovacao?: DateLike | Date | null; 
  aprovadoPor?: string | null; 
  comprovantePara?: string | null;
  tipo: 'rsvp' | 'venda';
  origemVenda?: boolean; // 🦈 Adicionado para evitar @ts-ignore
}

interface Evento {
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
  lotes: Lote[];
  descricao: string;
  status: "ativo" | "encerrado";
  saleStatus?: EventSaleStatus;
  isLowStock?: boolean; 
  stats?: { confirmados: number; talvez: number; likes: number; };
  vendasTotais?: { vendidos: number; total: number; receita?: number; };
  
  // 🦈 ID 12: Campos Financeiros Específicos do Evento
  pixChave?: string;
  pixBanco?: string;
  pixTitular?: string;
  contatoComprovante?: string;
  recipientUserId?: string;
  recipientUserName?: string;
  recipientUserTurma?: string;
  recipientUserAvatar?: string;
  recipientUserIds?: string[];
  paymentConfig?: CommercePaymentConfig | null;
}

// LÓGICA DO CONTADOR COOL
const calculateTimeLeft = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return "DATA INDEFINIDA";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "FORMATO ANTIGO";
    const eventDate = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(eventDate.getTime())) return "DATA INVÁLIDA";
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();
    if (diff < 0 && diff > -1000 * 60 * 60 * 4) return "AO VIVO 🔴"; 
    if (diff < 0) return "ENCERRADO";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${String(days).padStart(2, '0')}D ${String(hours).padStart(2, '0')}H ${String(minutes).padStart(2, '0')}M`;
};

const formatTimestamp = (timestamp: DateLike | Date | null | undefined, type: 'date' | 'time') => {
    if (!timestamp) return "-";
    const date =
      typeof (timestamp as { toDate?: unknown }).toDate === "function"
        ? ((timestamp as DateLike).toDate())
        : new Date(timestamp as Date);
    if (type === 'date') return date.toLocaleDateString('pt-BR');
    if (type === 'time') return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return "-";
};

const resolvePaymentRecipientLabel = (value: unknown): string => {
    const paymentConfig = normalizePaymentConfig(value);
    const recipient = paymentConfig?.recipient;
    if (!recipient) return "";
    return [recipient.name, recipient.turma, recipient.phone]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .join(" - ");
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
          .map((entry) => String(entry.userId || "").trim())
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
    .map((entry) => ({
      ...entry,
      price: String(entry.price ?? "").trim(),
    }))
    .filter((entry) => entry.price.length > 0);

export default function AdminEventosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const { user: currentUser } = useAuth(); 
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [planCatalog, setPlanCatalog] = useState<PlanRecord[]>([]);
  const [eventPaymentRecipients, setEventPaymentRecipients] = useState<TenantPaymentRecipientOption[]>([]);
  const [loadingEventPaymentRecipients, setLoadingEventPaymentRecipients] = useState(false);
  const [showEventReceiversManager, setShowEventReceiversManager] = useState(false);
  
  // Modais e Estados
  const [showModal, setShowModal] = useState(false);
  const [showLotePlanModal, setShowLotePlanModal] = useState<number | null>(null);
  const [showGestaoModal, setShowGestaoModal] = useState<Evento | null>(null);
  const [showPollModal, setShowPollModal] = useState<Evento | null>(null); 
  const [participantesReais, setParticipantesReais] = useState<Participante[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]); 
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingAllParticipants, setLoadingAllParticipants] = useState(false);

  const [novoEvento, setNovoEvento] = useState<Partial<Evento>>({
    titulo: "", data: "", hora: "", local: "", tipo: "Festa", destaque: "", mapsUrl: "", imagem: "", descricao: "", lotes: [],
    imagePositionY: 50,
    // 🦈 Inicialização dos novos campos
    pixChave: "", pixBanco: "", pixTitular: "", contatoComprovante: "", saleStatus: "ativo", recipientUserId: "", recipientUserName: "", recipientUserTurma: "", recipientUserAvatar: "", recipientUserIds: [], paymentConfig: null
  });
  const [novoLote, setNovoLote] = useState<{ nome: string; preco: string; status: StatusLote }>({ nome: "", preco: "", status: "ativo" });
  
  const [novaEnquete, setNovaEnquete] = useState({ question: "", allowUserOptions: true });
  const [pollDraftOptions, setPollDraftOptions] = useState<string[]>(["", ""]);

  const mapEventRow = (raw: Record<string, unknown>): Evento => ({
      id: String(raw.id || ""),
      titulo: String(raw.titulo || "Evento"),
      data: String(raw.data || ""),
      hora: String(raw.hora || ""),
      local: String(raw.local || ""),
      tipo: String(raw.tipo || "Evento"),
      destaque: String(raw.destaque || ""),
      mapsUrl: String(raw.mapsUrl || ""),
      imagem: String(raw.imagem || ""),
      descricao: String(raw.descricao || ""),
      status: (String(raw.status || "ativo") as "ativo" | "encerrado"),
      saleStatus: (String(raw.sale_status || "ativo") as EventSaleStatus),
      lotes: (Array.isArray(raw.lotes) ? raw.lotes : []).map((entry) => {
        const lote = (entry || {}) as Record<string, unknown>;
        return {
          id: Number(lote.id || Date.now()),
          nome: String(lote.nome || "Lote"),
          preco: String(lote.preco || "0"),
          status: (String(lote.status || "ativo") as StatusLote),
          planPrices: Array.isArray(lote.planPrices)
            ? (lote.planPrices as LotePlanPrice[])
            : Array.isArray(lote.plan_prices)
            ? (lote.plan_prices as LotePlanPrice[])
            : [],
        };
      }),
      imagePositionY: typeof raw.imagePositionY === "number" ? raw.imagePositionY : 50,
      stats: (raw.stats as Evento["stats"]) || { confirmados: 0, talvez: 0, likes: 0 },
      vendasTotais: (raw.vendasTotais as Evento["vendasTotais"]) || { vendidos: 0, total: 500, receita: 0 },
      isLowStock: Boolean(raw.isLowStock),
      pixChave: String(raw.pixChave || ""),
      pixBanco: String(raw.pixBanco || ""),
      pixTitular: String(raw.pixTitular || ""),
      contatoComprovante: String(raw.contatoComprovante || ""),
      recipientUserId:
        typeof (raw.payment_config as CommercePaymentConfig | null | undefined)?.recipient?.userId === "string"
          ? (raw.payment_config as CommercePaymentConfig).recipient?.userId || ""
          : "",
      recipientUserName:
        typeof (raw.payment_config as CommercePaymentConfig | null | undefined)?.recipient?.name === "string"
          ? (raw.payment_config as CommercePaymentConfig).recipient?.name || ""
          : "",
      recipientUserTurma:
        typeof (raw.payment_config as CommercePaymentConfig | null | undefined)?.recipient?.turma === "string"
          ? (raw.payment_config as CommercePaymentConfig).recipient?.turma || ""
          : "",
      recipientUserAvatar:
        typeof (raw.payment_config as CommercePaymentConfig | null | undefined)?.recipient?.avatarUrl === "string"
          ? (raw.payment_config as CommercePaymentConfig).recipient?.avatarUrl || ""
          : "",
      recipientUserIds: getPaymentRecipientIdsFromConfig(
        normalizePaymentConfig(raw.payment_config)
      ),
      paymentConfig: normalizePaymentConfig(raw.payment_config),
  });

  const loadEventos = useCallback(async (forceRefresh = true) => {
      try {
          const rows = await fetchEventsFeed({
              maxResults: 50,
              forceRefresh,
              includeInactive: true,
              includePast: true,
              includeFullData: true,
              tenantId: activeTenantId || undefined,
          });
          setEventos(rows.map((row) => mapEventRow(row)));
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao carregar eventos.", "error");
      }
  }, [activeTenantId, addToast]);

  const loadPlanCatalog = useCallback(async (forceRefresh = true) => {
      try {
          const rows = await fetchPlanCatalog({
              tenantId: activeTenantId || undefined,
              forceRefresh,
              maxResults: 40,
          });
          setPlanCatalog(rows);
      } catch (error: unknown) {
          console.error(error);
      }
  }, [activeTenantId]);

  const mapParticipantsFromRows = (
      rsvpsRows: Record<string, unknown>[],
      vendasRows: Record<string, unknown>[]
  ): Participante[] => {
      const map = new Map<string, Participante>();

      rsvpsRows.forEach((raw) => {
          const userId = String(raw.userId || "");
          if (!userId) return;
          map.set(userId, {
              id: String(raw.id || userId),
              userId,
              userName: String(raw.userName || "Aluno"),
              userAvatar: String(raw.userAvatar || ""),
              userTurma: String(raw.userTurma || ""),
              status: (String(raw.status || "maybe") as "going" | "maybe"),
              pagamento: "pendente",
              lote: "-",
              valorTotal: "-",
              tipo: "rsvp",
          });
      });

      vendasRows.forEach((raw) => {
          const userId = String(raw.userId || "");
          if (!userId) return;
          const existing = map.get(userId);
          map.set(userId, {
              id: String(raw.id || userId),
              userId,
              userName: String(raw.userName || existing?.userName || "Aluno"),
              userAvatar: existing?.userAvatar || "https://github.com/shadcn.png",
              userTurma: String(raw.userTurma || existing?.userTurma || ""),
              status: "going",
              pagamento: (String(raw.status) === "aprovado" ? "pago" : "analise"),
              lote: String(raw.loteNome || "-"),
              quantidade: Number(raw.quantidade || 1),
              valorTotal: String(raw.valorTotal || "-"),
              dataAprovacao: raw.dataAprovacao as DateLike | Date | null | undefined,
              aprovadoPor: String(raw.aprovadoPor || ""),
              comprovantePara: resolvePaymentRecipientLabel(raw.payment_config),
              tipo: "venda",
              origemVenda: true,
          });
      });

      return Array.from(map.values());
  };

  const loadParticipantes = useCallback(async (loadAll = false) => {
      if (!showGestaoModal) return;
      if (loadAll) {
          setLoadingAllParticipants(true);
      } else {
          setLoadingList(true);
      }

      try {
          const rows = await fetchAdminEventParticipants({
              eventId: showGestaoModal.id,
              rsvpsLimit: loadAll ? 1500 : 350,
              vendasLimit: loadAll ? 1500 : 350,
              forceRefresh: false,
          });
          setParticipantesReais(mapParticipantsFromRows(rows.rsvps, rows.vendas));
      } catch (error: unknown) {
          console.error("Erro lista:", error);
          addToast("Erro ao carregar lista.", "error");
      } finally {
          setLoadingList(false);
          setLoadingAllParticipants(false);
      }
  }, [showGestaoModal, addToast]);

  const loadPolls = useCallback(async () => {
      if (!showPollModal) return;
      try {
          const rows = await fetchAdminEventPolls({
              eventId: showPollModal.id,
              maxResults: 80,
              forceRefresh: false,
          });
          setPolls(
            rows.map((row) => ({
              id: String(row.id || crypto.randomUUID()),
              question: String(row.question || ""),
              options: (Array.isArray(row.options) ? row.options : []) as PollOption[],
              allowUserOptions: Boolean(row.allowUserOptions),
            }))
          );
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao carregar enquetes.", "error");
      }
  }, [showPollModal, addToast]);

  useEffect(() => {
      void Promise.all([loadEventos(true), loadPlanCatalog(true)]);
  }, [loadEventos, loadPlanCatalog]);

  useEffect(() => {
      const cleanTenantId = activeTenantId.trim();
      if (!cleanTenantId) {
          setEventPaymentRecipients([]);
          setLoadingEventPaymentRecipients(false);
          return;
      }

      let mounted = true;
      setLoadingEventPaymentRecipients(true);

      const run = async () => {
          try {
              const recipients = await fetchTenantPaymentRecipients(cleanTenantId, "events");
              if (mounted) setEventPaymentRecipients(recipients);
          } catch (error: unknown) {
              console.error(error);
              if (mounted) setEventPaymentRecipients([]);
          } finally {
              if (mounted) setLoadingEventPaymentRecipients(false);
          }
      };

      void run();
      return () => {
          mounted = false;
      };
  }, [activeTenantId]);

  useEffect(() => {
      if (planCatalog.length === 0) return;

      setNovoEvento((prev) => {
          if (!Array.isArray(prev.lotes) || prev.lotes.length === 0) return prev;

          return {
              ...prev,
              lotes: prev.lotes.map((lote) => ({
                  ...lote,
                  planPrices: buildLotePlanPrices(planCatalog, lote.planPrices),
              })),
          };
      });
  }, [planCatalog]);

  useEffect(() => {
      if (!showGestaoModal) return;
      void loadParticipantes(false);
  }, [showGestaoModal, loadParticipantes]);

  useEffect(() => {
      if (!showPollModal) return;
      void loadPolls();
  }, [showPollModal, loadPolls]);

  useEffect(() => {
      if (showPollModal) return;
      setNovaEnquete({ question: "", allowUserOptions: true });
      setPollDraftOptions(["", ""]);
  }, [showPollModal]);

  const dashboardStats = useMemo(() => {
      const totalEventos = eventos.length;
      const totalIngressos = eventos.reduce((acc, curr) => acc + (curr.vendasTotais?.vendidos || 0), 0);
      const receitaEstimada = totalIngressos * 60; 
      return { totalEventos, totalIngressos, receitaEstimada };
  }, [eventos]);

  const eventosAtivosPainel = useMemo(
      () =>
          eventos.filter(
              (evento) => !isEventExpiredByGrace(evento.data, evento.hora, EVENT_DASHBOARD_GRACE_MS)
          ),
      [eventos]
  );

  const eventosArquivados = useMemo(
      () =>
          eventos.filter((evento) =>
              isEventExpiredByGrace(evento.data, evento.hora, EVENT_DASHBOARD_GRACE_MS)
          ),
      [eventos]
  );
  const adminHomeHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin";
  const adminEventosHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/eventos") : "/admin/eventos";
  const adminEventosEncerradosHref = tenantSlug
    ? withTenantSlug(tenantSlug, "/admin/eventos/encerrados")
    : "/admin/eventos/encerrados";
  const clearEventModalQuery = useCallback(() => {
      const currentQuery = searchParams.toString();
      if (!currentQuery) return;

      const nextParams = new URLSearchParams(currentQuery);
      let changed = false;
      ["edit", "novo"].forEach((key) => {
          if (!nextParams.has(key)) return;
          nextParams.delete(key);
          changed = true;
      });
      if (!changed) return;

      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${adminEventosHref}?${nextQuery}` : adminEventosHref, {
          scroll: false,
      });
  }, [adminEventosHref, router, searchParams]);

  // --- ACTIONS ---

  const handleOpenCreate = () => {
      setNovoEvento({ 
          titulo: "", data: "", hora: "", local: "", tipo: "Festa", destaque: "", mapsUrl: "", imagem: "", descricao: "", lotes: [], imagePositionY: 50,
          pixChave: "", pixBanco: "", pixTitular: "", contatoComprovante: "", saleStatus: "ativo", recipientUserId: "", recipientUserName: "", recipientUserTurma: "", recipientUserAvatar: "", recipientUserIds: [], paymentConfig: null
      });
      setEditingId(null);
      setIsEditing(false);
      setShowModal(true);
      clearEventModalQuery();
  };

  const handleOpenEdit = useCallback((evento: Evento) => {
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(evento.data);
      const isValidTime = /^\d{2}:\d{2}$/.test(evento.hora);
      setNovoEvento({ 
          ...evento, 
          imagePositionY: evento.imagePositionY ?? 50,
          data: isValidDate ? evento.data : "",
          hora: isValidTime ? evento.hora : "",
          pixChave: evento.pixChave || "",
          pixBanco: evento.pixBanco || "",
          pixTitular: evento.pixTitular || "",
          contatoComprovante: evento.contatoComprovante || "",
          saleStatus: evento.saleStatus || "ativo",
          recipientUserId: evento.recipientUserId || "",
          recipientUserName: evento.recipientUserName || "",
          recipientUserTurma: evento.recipientUserTurma || "",
          recipientUserAvatar: evento.recipientUserAvatar || "",
          recipientUserIds: evento.recipientUserIds || getPaymentRecipientIdsFromConfig(evento.paymentConfig),
          paymentConfig: evento.paymentConfig || null,
      });
      if (!isValidDate || !isValidTime) addToast("Formato de data antigo. Por favor, atualize.", "info");
      setEditingId(evento.id);
      setIsEditing(true);
      setShowModal(true);
  }, [addToast]);

  useEffect(() => {
      const requestedEditId = searchParams.get("edit")?.trim() || "";
      if (!requestedEditId || showModal) return;
      const targetEvent = eventos.find((evento) => evento.id === requestedEditId);
      if (!targetEvent) return;
      handleOpenEdit(targetEvent);
  }, [eventos, handleOpenEdit, searchParams, showModal]);

  const handleSave = async () => {
    if (!novoEvento.titulo?.trim()) return addToast("Titulo obrigatorio!", "error");
    if (!novoEvento.data || !novoEvento.hora) return addToast("Data e hora obrigatorios!", "error");
    if (
      String(novoEvento.contatoComprovante || "").trim() &&
      !hasValidPhoneLength(String(novoEvento.contatoComprovante || ""))
    ) {
      return addToast("Informe um WhatsApp valido para o comprovante.", "error");
    }

    const selectedPaymentRecipients = filterTenantPaymentRecipientsByIds(
      eventPaymentRecipients,
      novoEvento.recipientUserIds || []
    );
    const primaryPaymentRecipient = selectedPaymentRecipients[0] || null;
    const hasPaymentConfig =
      Boolean(novoEvento.pixChave) ||
      Boolean(novoEvento.pixBanco) ||
      Boolean(novoEvento.pixTitular) ||
      Boolean(novoEvento.contatoComprovante) ||
      selectedPaymentRecipients.length > 0;

    const eventoPayload: Record<string, unknown> = {
        ...novoEvento,
        titulo: String(novoEvento.titulo || "").trim().slice(0, EVENT_TITLE_MAX_LENGTH),
        local: String(novoEvento.local || "").trim().slice(0, EVENT_LOCATION_MAX_LENGTH),
        tipo: String(novoEvento.tipo || "Festa").trim().slice(0, EVENT_TYPE_MAX_LENGTH),
        destaque: String(novoEvento.destaque || "").trim().slice(0, 180),
        mapsUrl: String(novoEvento.mapsUrl || "").trim().slice(0, 400),
        descricao: String(novoEvento.descricao || "").trim().slice(0, EVENT_DESCRIPTION_MAX_LENGTH),
        pixChave: String(novoEvento.pixChave || "").trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        pixBanco: String(novoEvento.pixBanco || "").trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        pixTitular: String(novoEvento.pixTitular || "").trim().slice(0, EVENT_PIX_FIELD_MAX_LENGTH),
        contatoComprovante: normalizePhoneToBrE164(
          String(novoEvento.contatoComprovante || "").trim()
        ).slice(0, PHONE_MAX_LENGTH),
        lotes: (novoEvento.lotes || []).map((lote) => ({
          ...lote,
          nome: String(lote.nome || "").trim().slice(0, EVENT_LOTE_NAME_MAX_LENGTH),
          preco: String(lote.preco || "").trim().slice(0, 40),
          status: lote.status || "ativo",
          planPrices: serializeLotePlanPrices(planCatalog, lote.planPrices),
        })),
        status: novoEvento.status || "ativo",
        sale_status: novoEvento.saleStatus || "ativo",
        payment_config: hasPaymentConfig
            ? {
                chave: String(novoEvento.pixChave || "").trim(),
                banco: String(novoEvento.pixBanco || "").trim(),
                titular: String(novoEvento.pixTitular || "").trim(),
                whatsapp: normalizePhoneToBrE164(String(novoEvento.contatoComprovante || "").trim()),
                ...(primaryPaymentRecipient
                  ? { recipient: toCommerceRecipientSnapshot(primaryPaymentRecipient) }
                  : {}),
                ...(selectedPaymentRecipients.length > 0
                  ? { recipients: selectedPaymentRecipients.map(toCommerceRecipientSnapshot) }
                  : {}),
            }
          : null,
        updatedAt: new Date().toISOString(),
    };

    try {
        if (isEditing && editingId) {
            await upsertAdminEvent({
                eventId: editingId,
                data: eventoPayload,
                actorUserId: currentUser?.uid,
                tenantId: activeTenantId || undefined,
            });
            addToast("Evento atualizado!", "success");
        } else {
            await upsertAdminEvent({
                data: {
                    ...eventoPayload,
                    stats: { confirmados: 0, talvez: 0, likes: 0 },
                    vendasTotais: { vendidos: 0, total: 500, receita: 0 },
                },
                actorUserId: currentUser?.uid,
                tenantId: activeTenantId || undefined,
            });
            if (currentUser?.uid) {
                await logActivity(
                    currentUser.uid,
                    currentUser.nome || "Admin",
                    "CREATE",
                    "Eventos/Admin",
                    `Criou evento: ${String(novoEvento.titulo || "Evento")}`
                ).catch(() => {});
            }
            addToast("Evento criado!", "success");
        }

        setShowModal(false);
        clearEventModalQuery();
        await loadEventos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao salvar.", "error");
      }
    };

  const handleDelete = async (id: string) => {
    if (confirm("Excluir evento permanentemente?")) {
      try {
          const targetEvento = eventos.find((row) => row.id === id);
          await deleteAdminEventById(id);
          if (currentUser?.uid) {
              await logActivity(
                  currentUser.uid,
                  currentUser.nome || "Admin",
                  "DELETE",
                  "Eventos/Admin",
                  `Excluiu evento: ${targetEvento?.titulo || id}`
              ).catch(() => {});
          }
          addToast("Evento cancelado.", "info");
          await loadEventos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao excluir.", "error");
      }
    }
  };

  const handleAddLote = () => {
      if(!novoLote.nome || !novoLote.preco) return;
      const lotes = novoEvento.lotes || [];
      const loteId = Date.now();
      setNovoEvento({
        ...novoEvento,
        lotes: [
          ...lotes,
          {
            id: loteId,
            ...novoLote,
            nome: novoLote.nome.trim().slice(0, EVENT_LOTE_NAME_MAX_LENGTH),
            preco: novoLote.preco.trim().slice(0, 40),
            planPrices: buildLotePlanPrices(planCatalog),
          },
        ],
      });
      setNovoLote({ nome: "", preco: "", status: "ativo" });
      setShowLotePlanModal(loteId);
  };

  const toggleLoteStatus = (loteId: number, status: StatusLote) => {
      const updated = novoEvento.lotes?.map(l => l.id === loteId ? { ...l, status } : l);
      setNovoEvento({ ...novoEvento, lotes: updated });
  };

  const removeLote = (loteId: number) => {
      const updated = novoEvento.lotes?.filter(l => l.id !== loteId);
      setNovoEvento({ ...novoEvento, lotes: updated });
  }

  const updateLotePlanPrice = (loteId: number, planId: string, value: string) => {
      setNovoEvento((prev) => ({
          ...prev,
          lotes: prev.lotes?.map((lote) =>
              lote.id !== loteId
                  ? lote
                  : {
                        ...lote,
                        planPrices: (lote.planPrices || buildLotePlanPrices(planCatalog)).map((entry) =>
                            entry.planId === planId ? { ...entry, price: value } : entry
                        ),
                    }
          ),
      }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || uploading) {
        input.value = "";
        return;
    }

    setUploading(true);
    try {
        const tenantScope = sanitizeStoragePathSegment(activeTenantId || "global");
        const eventId = editingId?.trim() || "";
        const isStableTarget = eventId.length > 0;
        const objectDir = isStableTarget
            ? `eventos/${tenantScope}/${sanitizeStoragePathSegment(eventId)}`
            : `eventos/${tenantScope}/drafts`;
        const { url, error } = await uploadImage(file, objectDir, {
            scopeKey: `admin:eventos:capa:${tenantScope}:${eventId || "draft"}`,
            fileName: isStableTarget ? "capa" : buildDraftAssetFileName("capa"),
            upsert: isStableTarget,
            versionStrategy: isStableTarget ? "file-metadata" : "none",
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
        setNovoEvento((prev) => ({ ...prev, imagem: url }));
    } finally {
        setUploading(false);
        input.value = "";
    }
  };

  const exportarCSV = () => {
      if(!showGestaoModal) return;
      const headers = ["Nome", "Turma", "Status Presença", "Pagamento", "Lote", "Qtd", "Valor", "Data Aprov.", "Hora Aprov.", "Aprovado Por"];
      const rows = participantesReais.map(p => [
          p.userName, p.userTurma, p.status, p.pagamento || "pendente", p.lote || "-", p.quantidade || "1", p.valorTotal || "-",
          formatTimestamp(p.dataAprovacao, 'date'), formatTimestamp(p.dataAprovacao, 'time'), p.aprovadoPor || "-"
      ]);
      const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `lista_${showGestaoModal.titulo}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const toggleEventoStatus = async (evento: Evento) => {
      const newStatus = evento.status === "ativo" ? "encerrado" : "ativo";
      try {
          await setAdminEventStatus({ eventId: evento.id, status: newStatus, tenantId: activeTenantId || undefined });
          addToast(`Evento marcado como ${newStatus}.`, "info");
          await loadEventos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar status.", "error");
      }
  };

  const handleSetEventoSaleStatus = async (evento: Evento, saleStatus: EventSaleStatus) => {
      try {
          await setAdminEventSaleStatus({
              eventId: evento.id,
              saleStatus,
              tenantId: activeTenantId || undefined,
          });
          addToast("Status de venda atualizado.", "success");
          await loadEventos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar status de venda.", "error");
      }
  };

  const toggleLowStock = async (evento: Evento) => {
      try {
          await setAdminEventLowStock({
              eventId: evento.id,
              isLowStock: !evento.isLowStock,
          });
          addToast(`Status de vagas ${!evento.isLowStock ? 'ATIVADO' : 'DESATIVADO'}`, "success");
          await loadEventos(true);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar.", "error");
      }
  };

  const handleTogglePayment = async (p: Participante) => {
      if (p.tipo !== 'venda') return addToast("Apenas vendas podem ser gerenciadas financeiramente.", "error");
      
      const isApproving = p.pagamento !== 'pago';
      const valorGasto = Number.parseFloat(
        String(p.valorTotal || "0").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")
      );

      if (isApproving) {
          if (!confirm(`Confirmar pagamento de ${p.userName} no valor de R$ ${p.valorTotal}?`)) return;
      } else {
          if (!confirm(`ATENCAO: Desaprovar pagamento de ${p.userName}? Isso ira remover o XP ganho.`)) return;
      }

      try {
          await setAdminTicketPayment({
              ticketRequestId: p.id,
              isApproving,
              approvedBy: currentUser?.nome || "Admin",
          });

          if (!isNaN(valorGasto) && p.userId) {
              await incrementEventPurchaseUserStats({
                  userId: p.userId,
                  isApproving,
                  valorGasto,
                  lotName: p.lote || "",
                  eventType: showGestaoModal?.tipo || "",
                  eventTitle: showGestaoModal?.titulo || "",
              });
          }

          setParticipantesReais(prev => prev.map(item => item.id === p.id ? { 
              ...item, 
              pagamento: isApproving ? 'pago' : 'pendente', 
              dataAprovacao: isApproving ? new Date() : null, 
              aprovadoPor: isApproving ? (currentUser?.nome || "Admin") : null 
          } : item));

          if (currentUser?.uid) {
              await logActivity(
                  currentUser.uid,
                  currentUser.nome || "Admin",
                  "UPDATE",
                  "Eventos/Pagamentos",
                  `${isApproving ? "Aprovou" : "Rejeitou"} comprovante de ${p.userName} (${showGestaoModal?.titulo || "Evento"})`
              ).catch(() => {});
          }

          addToast(isApproving ? "Pagamento aprovado!" : "Pagamento estornado.", isApproving ? "success" : "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar pagamento.", "error");
      }
  };

  // --- GESTÃO DE ENQUETES ---
  const handleCreatePoll = async () => {
      if (!showPollModal || !novaEnquete.question) return;
      const normalizedOptions = pollDraftOptions
          .map((option) => option.trim().slice(0, EVENT_POLL_OPTION_MAX_CHARS))
          .filter((option, index, array) => option.length > 0 && array.indexOf(option) === index)
          .slice(0, EVENT_POLL_OPTION_MAX_COUNT);
      try {
          await createAdminEventPoll({
              eventId: showPollModal.id,
              question: novaEnquete.question.trim().slice(0, EVENT_POLL_QUESTION_MAX_CHARS),
              allowUserOptions: novaEnquete.allowUserOptions,
              options: normalizedOptions.map((text) => ({ text, votes: 0 })),
              tenantId: activeTenantId || undefined,
          });
          setNovaEnquete({ question: "", allowUserOptions: true });
          setPollDraftOptions(["", ""]);
          addToast("Enquete criada!", "success");
          await loadPolls();
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao criar enquete.", "error");
      }
  };

  const handleDeletePoll = async (pollId: string) => {
      if (!showPollModal) return;
      if (!confirm("Excluir enquete?")) return;
      try {
          await deleteAdminEventPoll({
            eventId: showPollModal.id,
            pollId,
            tenantId: activeTenantId || undefined,
          });
          addToast("Enquete excluida.", "info");
          await loadPolls();
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao excluir.", "error");
      }
  };

  const handleDeleteOption = async (poll: Poll, optionIndex: number) => {
      if (!showPollModal) return;
      if (!confirm("Remover esta opcao da enquete?")) return;
      const newOptions = poll.options.filter((option, i) => {
          void option;
          return i !== optionIndex;
      });
      try {
          await updateAdminEventPollOptions({
              eventId: showPollModal.id,
              pollId: poll.id,
              options: newOptions,
              tenantId: activeTenantId || undefined,
          });
          addToast("Opcao removida.", "info");
          await loadPolls();
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao remover opcao.", "error");
      }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-32">
      <header className="p-6 sticky top-0 z-30 bg-[#050505]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <Link href={adminHomeHref} className="bg-zinc-900 p-2 rounded-full hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400" /></Link>
            <h1 className="text-lg font-black text-white uppercase tracking-tighter">Gestão de Eventos</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={adminEventosEncerradosHref}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-zinc-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Encerrados ({eventosArquivados.length})
          </Link>
          <button
            type="button"
            onClick={() => setShowEventReceiversManager(true)}
            className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-purple-300 transition hover:bg-purple-500/20"
          >
            <span className="inline-flex items-center gap-2">
              <UserPlus size={14} />
              Recebedores eventos
            </span>
          </button>
          <button onClick={handleOpenCreate} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20">
            <Plus size={16} /> Novo Evento
          </button>
        </div>
      </header>

      <main className="p-6 space-y-8">
        {/* DASHBOARD VISUAL */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><Calendar size={48}/></div>
                <p className="text-xs text-zinc-500 font-bold uppercase flex items-center gap-2"><Tag size={14}/> Total de Eventos</p>
                <p className="text-3xl font-black text-white mt-2">{dashboardStats.totalEventos}</p>
            </div>
        </div>

        {/* LISTA DE EVENTOS */}
        <div>
            <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2"><BarChart3 size={16}/> Eventos Ativos (janela +1 dia)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {eventosAtivosPainel.map((evento) => (
                <div key={evento.id} className={`rounded-2xl border overflow-hidden group hover:border-emerald-500/30 transition flex flex-col h-full ${evento.status === 'encerrado' ? 'bg-zinc-950 border-zinc-900 grayscale opacity-70' : 'bg-zinc-900 border-zinc-800'}`}>
                    <div className="h-32 bg-black/50 relative overflow-hidden">
                        <Image src={evento.imagem} alt={evento.titulo} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover opacity-80 group-hover:opacity-100 transition" style={{ objectPosition: `50% ${evento.imagePositionY || 50}%` }}/>
                        <div className="absolute top-2 left-2 flex gap-1 z-10">
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm border border-white/10">{evento.tipo}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border backdrop-blur-sm ${
                            evento.saleStatus === "em_breve"
                              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                              : evento.saleStatus === "esgotado"
                              ? "border-red-500/30 bg-red-500/10 text-red-300"
                              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          }`}>
                            {evento.saleStatus === "em_breve" ? "Em-breve" : evento.saleStatus === "esgotado" ? "Esgotado" : "Ativo"}
                          </span>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono font-bold text-emerald-400 border border-emerald-500/30 z-10">{calculateTimeLeft(evento.data, evento.hora)}</div>
                        <button onClick={(e) => { e.stopPropagation(); toggleLowStock(evento); }} className={`absolute top-2 right-2 p-1.5 rounded-lg border transition shadow-lg z-10 ${evento.isLowStock ? 'bg-yellow-500 text-black border-yellow-400' : 'bg-black/50 text-zinc-400 border-zinc-700 hover:text-white'}`} title="Alternar 'Últimas Vagas'"><Star size={14} className={evento.isLowStock ? 'fill-black' : ''}/></button>
                    </div>
                    <div className="p-4 flex-1 flex flex-col">
                        <h3 className="font-bold text-white text-lg leading-tight mb-1">{evento.titulo}</h3>
                        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-4"><Calendar size={12} className="text-emerald-500"/> {evento.data} <Users size={12} className="text-blue-500"/> {evento.stats?.confirmados || 0} confirmados</div>
                        <div className="mb-4 grid grid-cols-3 gap-2">
                            {(["ativo", "em_breve", "esgotado"] as EventSaleStatus[]).map((status) => (
                                <button
                                    key={`${evento.id}-${status}`}
                                    type="button"
                                    onClick={() => void handleSetEventoSaleStatus(evento, status)}
                                    className={`rounded-lg border px-2 py-2 text-[10px] font-black uppercase transition ${
                                        (evento.saleStatus || "ativo") === status
                                            ? status === "ativo"
                                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                                : status === "em_breve"
                                                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                                                : "border-red-500/30 bg-red-500/10 text-red-300"
                                            : "border-zinc-700 bg-black/20 text-zinc-500 hover:text-zinc-300"
                                    }`}
                                >
                                    {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em-breve" : "Esgotado"}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-3 border-t border-white/5 mt-auto">
                              <Link href={`${adminEventosHref}/lista/${evento.id}`} className="flex-1 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg hover:bg-emerald-500 hover:text-black transition flex justify-center items-center gap-2 text-xs font-bold uppercase"><Users size={14}/> Lista</Link>
                            <button onClick={() => setShowPollModal(evento)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-purple-400 transition" title="Enquetes"><MessageCircle size={16}/></button>
                            <button onClick={() => handleOpenEdit(evento)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition"><Edit size={16}/></button>
                            <button onClick={() => toggleEventoStatus(evento)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-yellow-500 transition" title={evento.status === 'ativo' ? 'Encerrar' : 'Reativar'}>{evento.status === 'ativo' ? <Lock size={16}/> : <CheckCircle size={16}/>}</button>
                            <button onClick={() => handleDelete(evento.id)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-500 transition"><Trash2 size={16}/></button>
                        </div>
                    </div>
                </div>
                ))}
            </div>
            {eventosAtivosPainel.length === 0 && (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-400">
                Nenhum evento ativo para exibicao no painel principal.
              </div>
            )}
        </div>
      </main>

      {/* MODAL GESTÃO LISTA (MANTIDO IGUAL AO ANTERIOR) */}
      {showGestaoModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4" onClick={(e) => e.stopPropagation()}>
              <div className="bg-zinc-900 w-full max-w-7xl h-[90vh] rounded-2xl border border-zinc-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-black/40">
                      <div><h2 className="font-black text-white text-xl uppercase tracking-tighter flex items-center gap-2"><Tag size={20} className="text-emerald-500"/> Gestão: {showGestaoModal.titulo}</h2></div>
                      <button onClick={() => setShowGestaoModal(null)} className="p-2 hover:bg-zinc-800 rounded-full transition"><X size={20}/></button>
                  </div>
                  <div className="flex-1 p-6 overflow-hidden flex flex-col">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-bold text-zinc-400 uppercase">Lista de Presença ({participantesReais.length})</h3>
                          <div className="flex items-center gap-4">
                              {(loadingList || loadingAllParticipants) && (
                                <span className="text-xs text-zinc-500 flex items-center gap-2">
                                  <Loader2 className="animate-spin" size={14}/>
                                  Atualizando...
                                </span>
                              )}
                              <button
                                onClick={() => void loadParticipantes(true)}
                                disabled={loadingAllParticipants}
                                className="text-xs text-yellow-400 font-bold hover:underline disabled:opacity-50"
                              >
                                {loadingAllParticipants ? "Carregando tudo..." : "Carregar tudo"}
                              </button>
                              <button onClick={exportarCSV} className="text-xs text-emerald-500 font-bold hover:underline flex items-center gap-1"><Download size={14}/> CSV</button>
                          </div>
                      </div>
                      <div className="flex-1 overflow-auto border border-zinc-800 rounded-xl custom-scrollbar">
                          <table className="w-full text-left text-xs whitespace-nowrap">
                              <thead className="text-zinc-500 border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
                                  <tr>
                                      <th className="p-3">Usuário</th><th className="p-3">Turma</th><th className="p-3">RSVP</th><th className="p-3">Pagamento</th><th className="p-3 text-center">Ação</th>
                                      <th className="p-3 text-center">Data Aprov.</th><th className="p-3 text-center">Hora Aprov.</th><th className="p-3">Aprovado Por</th><th className="p-3">Comprovante Para</th><th className="p-3">Valor</th><th className="p-3">Lote</th><th className="p-3 text-center">Qtd</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-800">
                                  {participantesReais.map(p => (
                                      <tr key={p.id} className="hover:bg-zinc-800/50 transition">
                                          <td className="p-3 font-bold"><Link href={`/admin/usuarios/${p.userId}`} className="flex items-center gap-2 hover:text-emerald-400 transition" target="_blank"><div className="relative w-6 h-6 rounded-full overflow-hidden bg-zinc-800"><Image src={p.userAvatar || "https://github.com/shadcn.png"} alt="Avatar" fill sizes="24px" className="object-cover"/></div>{p.userName}</Link></td>
                                          <td className="p-3 text-zinc-400">{p.userTurma || "-"}</td>
                                          <td className="p-3"><span className={`px-2 py-0.5 rounded font-bold uppercase ${p.status === 'going' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-yellow-500/10 text-yellow-500'}`}>{p.status === 'going' ? 'Vou' : 'Talvez'}</span></td>
                                          <td className="p-3"><span className={`px-2 py-0.5 rounded font-bold uppercase ${p.pagamento === 'pago' ? 'bg-blue-500/10 text-blue-500' : p.pagamento === 'analise' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-zinc-800 text-zinc-500'}`}>{p.pagamento === 'pago' ? 'Pago' : p.pagamento === 'analise' ? 'Em Análise' : 'Pendente'}</span></td>
                                          <td className="p-3 text-center">{p.tipo === 'venda' ? (<div className="flex justify-center gap-2">{p.pagamento !== 'pago' ? (<button onClick={() => handleTogglePayment(p)} className="bg-emerald-600 hover:bg-emerald-500 text-white p-1.5 rounded-lg transition" title="Aprovar Pagamento"><Check size={14}/></button>) : (<button onClick={() => handleTogglePayment(p)} className="bg-zinc-800 hover:bg-red-500/20 hover:text-red-500 text-zinc-500 p-1.5 rounded-lg transition" title="Desfazer Aprovação"><RotateCcw size={14}/></button>)}</div>) : (<span className="text-zinc-600">-</span>)}</td>
                                          <td className="p-3 text-center text-zinc-400">{formatTimestamp(p.dataAprovacao, 'date')}</td>
                                          <td className="p-3 text-center text-zinc-400">{formatTimestamp(p.dataAprovacao, 'time')}</td>
                                          <td className="p-3 text-zinc-400 italic text-[10px] truncate max-w-[100px]">{p.aprovadoPor || "-"}</td>
                                          <td className="p-3 text-zinc-400 text-[10px] truncate max-w-[160px]">{p.comprovantePara || "-"}</td>
                                          <td className="p-3 font-mono text-emerald-400">{p.valorTotal ? `R$ ${p.valorTotal}` : "-"}</td>
                                          <td className="p-3 text-zinc-400">{p.lote || "-"}</td>
                                          <td className="p-3 text-center">{p.quantidade && p.quantidade > 1 ? <span className="bg-purple-500 text-white px-1.5 rounded font-bold">{p.quantidade}</span> : "1"}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL ENQUETES (MANTIDO) */}
      {showPollModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4" onClick={(e) => e.stopPropagation()}>
              {/* Conteúdo do Modal de Enquetes */}
              <div className="bg-zinc-900 w-full max-w-lg rounded-2xl border border-zinc-800 flex flex-col h-[80vh]">
                  <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-black/40">
                      <div><h2 className="font-black text-white text-lg uppercase flex items-center gap-2"><MessageCircle size={20} className="text-purple-500"/> Enquetes</h2></div>
                      <button onClick={() => setShowPollModal(null)} className="p-2 hover:bg-zinc-800 rounded-full transition"><X size={20}/></button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                      {/* Criar */}
                      <div className="bg-black/30 p-4 rounded-xl border border-zinc-800">
                          <input type="text" maxLength={EVENT_POLL_QUESTION_MAX_CHARS} placeholder="Pergunta..." className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white mb-3" value={novaEnquete.question} onChange={e => setNovaEnquete({...novaEnquete, question: e.target.value.slice(0, EVENT_POLL_QUESTION_MAX_CHARS)})} />
                          <div className="mb-3 flex items-center gap-2">
                              <input type="checkbox" id="adminAllowPollOptions" checked={novaEnquete.allowUserOptions} onChange={e => setNovaEnquete({...novaEnquete, allowUserOptions: e.target.checked})} className="accent-purple-500"/>
                              <label htmlFor="adminAllowPollOptions" className="text-xs text-zinc-400">Permitir que usuários adicionem respostas</label>
                          </div>
                          <div className="space-y-2 mb-3">
                              {pollDraftOptions.map((option, index) => (
                                  <div key={`poll-draft-option-${index}`} className="flex gap-2">
                                      <input
                                          type="text"
                                          maxLength={EVENT_POLL_OPTION_MAX_CHARS}
                                          placeholder={`Resposta ${index + 1}`}
                                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white"
                                          value={option}
                                          onChange={(e) => setPollDraftOptions((prev) => prev.map((entry, entryIndex) => entryIndex === index ? e.target.value.slice(0, EVENT_POLL_OPTION_MAX_CHARS) : entry))}
                                      />
                                      {pollDraftOptions.length > 2 ? (
                                          <button
                                              type="button"
                                              onClick={() => setPollDraftOptions((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-zinc-400 hover:bg-zinc-800"
                                          >
                                              <X size={14} />
                                          </button>
                                      ) : null}
                                  </div>
                              ))}
                          </div>
                          <div className="mb-3 flex items-center justify-between gap-3 text-[10px] font-bold uppercase text-zinc-500">
                              <span>Opcoes iniciais opcionais</span>
                              <button
                                  type="button"
                                  onClick={() => setPollDraftOptions((prev) => prev.length >= EVENT_POLL_OPTION_MAX_COUNT ? prev : [...prev, ""])}
                                  disabled={pollDraftOptions.length >= EVENT_POLL_OPTION_MAX_COUNT}
                                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                              >
                                  Adicionar resposta
                              </button>
                          </div>
                          <button onClick={handleCreatePoll} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs uppercase">Criar Enquete</button>
                      </div>
                      {/* Lista */}
                      <div className="space-y-4">
                          {polls.map(poll => (
                              <div key={poll.id} className="bg-zinc-800/20 p-4 rounded-xl border border-zinc-800 space-y-3">
                                  <div className="flex justify-between items-start">
                                      <p className="font-bold text-sm text-white">{poll.question}</p>
                                      <button onClick={() => handleDeletePoll(poll.id)} className="text-zinc-600 hover:text-red-500 transition"><Trash2 size={16}/></button>
                                  </div>
                                  <div className="space-y-1 bg-black/20 p-2 rounded-lg max-h-40 overflow-y-auto custom-scrollbar">
                                      {poll.options.map((opt, idx) => (
                                          <div key={idx} className="flex justify-between items-center text-xs text-zinc-300 p-2 hover:bg-zinc-700/30 rounded group">
                                              <span>{opt.text} ({opt.votes})</span>
                                              <button onClick={() => handleDeleteOption(poll, idx)} className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={12}/></button>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL CRIAR/EDITAR - ATUALIZADO COM FINANCEIRO */}
      {showModal && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center py-4">
            <div className="bg-zinc-950 w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-zinc-800 p-6 space-y-4 animate-in zoom-in-95 custom-scrollbar">
            <h2 className="font-bold text-white text-lg flex items-center gap-2"><Calendar size={20} className="text-emerald-500"/> {isEditing ? "Editar" : "Criar"} Evento</h2>
            <div className="space-y-3">
                {/* UPLOAD IMAGEM */}
                <div className="space-y-2">
                    <div onClick={() => fileInputRef.current?.click()} className="h-40 border-2 border-dashed border-zinc-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-emerald-500 transition bg-black/20 relative group overflow-hidden">
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={handleImageUpload}/>
                        {uploading ? <span className="text-xs text-emerald-500 animate-pulse">Enviando...</span> : novoEvento.imagem ? (
                            <Image src={novoEvento.imagem} alt="Capa" fill sizes="(max-width: 768px) 100vw, 560px" className="object-cover" style={{ objectPosition: `50% ${novoEvento.imagePositionY || 50}%` }}/>
                        ) : <div className="text-center text-zinc-500"><ImageIcon className="mx-auto mb-1"/><span className="text-xs font-bold uppercase">Capa</span></div>}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition"><span className="text-xs font-bold text-white uppercase bg-black px-3 py-1 rounded-full">Trocar Imagem</span></div>
                    </div>
                    <ImageResizeHelpLink label="Diminuir a imagem do evento no favicon.io/favicon-converter" />
                    {novoEvento.imagem && (
                        <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                            <div className="flex justify-between text-[10px] text-zinc-400 uppercase font-bold mb-1"><span className="flex items-center gap-1"><MoveVertical size={12}/> Ajuste Fino</span><span>{novoEvento.imagePositionY}%</span></div>
                            <input type="range" min="0" max="100" value={novoEvento.imagePositionY || 50} onChange={(e) => setNovoEvento({ ...novoEvento, imagePositionY: Number(e.target.value) })} className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"/>
                        </div>
                    )}
                </div>

                <input type="text" maxLength={EVENT_TITLE_MAX_LENGTH} placeholder="Nome do Evento" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none" value={novoEvento.titulo} onChange={(e) => setNovoEvento({ ...novoEvento, titulo: e.target.value.slice(0, EVENT_TITLE_MAX_LENGTH) })} />
                
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Data</label>
                        <input type="date" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white uppercase" value={novoEvento.data} onChange={(e) => setNovoEvento({ ...novoEvento, data: e.target.value })} />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Hora</label>
                        <input type="time" className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white" value={novoEvento.hora} onChange={(e) => setNovoEvento({ ...novoEvento, hora: e.target.value })} />
                    </div>
                </div>

                <div className="flex gap-2">
                    <select className="flex-1 bg-black border border-zinc-700 rounded-xl p-3 text-sm text-zinc-400" value={novoEvento.tipo} onChange={(e) => setNovoEvento({ ...novoEvento, tipo: e.target.value.slice(0, EVENT_TYPE_MAX_LENGTH) })}>
                        <option value="Festa">Festa</option><option value="Esporte">Esporte</option><option value="Outro">Outro...</option>
                    </select>
                    <input type="text" maxLength={EVENT_LOCATION_MAX_LENGTH} placeholder="Local" className="flex-1 bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white" value={novoEvento.local} onChange={(e) => setNovoEvento({ ...novoEvento, local: e.target.value.slice(0, EVENT_LOCATION_MAX_LENGTH) })} />
                </div>

                {/* 🦈 NOVO: SEÇÃO FINANCEIRA (PIX) */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Wallet size={16} className="text-emerald-500"/>
                        <span className="text-xs font-bold text-zinc-300 uppercase">Financeiro & Recebimento</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 -mt-2 mb-2">Preencha para substituir a conta global neste evento.</p>
                    
                    <div className="grid grid-cols-1 gap-2">
                        <input id="admin-event-pix-key" name="admin_event_pix_key" type="text" maxLength={EVENT_PIX_FIELD_MAX_LENGTH} placeholder="Chave PIX (ex: CNPJ, Email)" className="bg-black border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoEvento.pixChave} onChange={e => setNovoEvento({...novoEvento, pixChave: e.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH)})} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <input id="admin-event-pix-bank" name="admin_event_pix_bank" type="text" maxLength={EVENT_PIX_FIELD_MAX_LENGTH} placeholder="Banco" className="bg-black border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoEvento.pixBanco} onChange={e => setNovoEvento({...novoEvento, pixBanco: e.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH)})} />
                        <input id="admin-event-pix-holder" name="admin_event_pix_holder" type="text" maxLength={EVENT_PIX_FIELD_MAX_LENGTH} placeholder="Nome Titular" className="bg-black border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoEvento.pixTitular} onChange={e => setNovoEvento({...novoEvento, pixTitular: e.target.value.slice(0, EVENT_PIX_FIELD_MAX_LENGTH)})} />
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 text-[11px] text-zinc-500">
                        <p className="font-black uppercase tracking-[0.18em] text-zinc-400">Comprovante</p>
                        <p className="mt-1">Informe o WhatsApp responsavel por este evento.</p>
                    </div>
                    <input id="admin-event-payment-whatsapp" name="admin_event_payment_whatsapp" type="text" maxLength={PHONE_MAX_LENGTH} inputMode="tel" placeholder="Telefone/WhatsApp para Comprovante" className="w-full bg-black border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoEvento.contatoComprovante} onChange={e => setNovoEvento({...novoEvento, contatoComprovante: normalizePhoneToBrE164(e.target.value)})} />
                    <PaymentRecipientCheckboxList
                        id="admin-event-payment-recipients"
                        label="Liberar comprovantes do evento"
                        helperText="Marque quem pode receber o comprovante deste evento."
                        emptyText="Nenhum recebedor de evento cadastrado."
                        options={eventPaymentRecipients}
                        selectedUserIds={novoEvento.recipientUserIds || []}
                        loading={loadingEventPaymentRecipients}
                        onChange={(recipientUserIds) =>
                            setNovoEvento((prev) => ({ ...prev, recipientUserIds }))
                        }
                    />
                </div>
                
                {/* Gestão de Lotes */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                    <div>
                        <span className="text-xs font-bold text-zinc-300 uppercase">Status de Venda</span>
                        <p className="text-[10px] text-zinc-500">Controla se o evento esta ativo, em breve ou esgotado.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {(["ativo", "em_breve", "esgotado"] as EventSaleStatus[]).map((status) => (
                            <button
                                key={status}
                                type="button"
                                onClick={() => setNovoEvento({ ...novoEvento, saleStatus: status })}
                                className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase ${
                                    (novoEvento.saleStatus || "ativo") === status
                                        ? status === "ativo"
                                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                            : status === "em_breve"
                                            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                                            : "border-red-500/30 bg-red-500/10 text-red-300"
                                        : "border-zinc-700 bg-black text-zinc-400"
                                }`}
                            >
                                {status === "ativo" ? "Ativar" : status === "em_breve" ? "Em-breve" : "Esgotado"}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-black/40 border border-zinc-800 rounded-xl p-4">
                    <label className="text-xs text-zinc-500 font-bold uppercase mb-3 block border-b border-zinc-800 pb-2">Configurar Lotes</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <LotNameSelector value={novoLote.nome} maxLength={EVENT_LOTE_NAME_MAX_LENGTH} onChange={(value) => setNovoLote({ ...novoLote, nome: value })} containerClassName="grid grid-cols-2 gap-2 col-span-2" selectClassName="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-white" inputClassName="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-white" />
                        <input type="text" placeholder="Preço (R$)" className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs text-white" value={novoLote.preco} onChange={e => setNovoLote({...novoLote, preco: e.target.value})} />
                    </div>
                    <button onClick={handleAddLote} className="w-full bg-emerald-600 text-white py-2 rounded-lg font-bold text-xs uppercase hover:bg-emerald-500">Adicionar Lote</button>
                    <div className="space-y-1 mt-2 max-h-24 overflow-y-auto custom-scrollbar">
                        {novoEvento.lotes?.map(l => (
                            <div key={l.id} className="flex justify-between items-center text-xs bg-zinc-900 px-3 py-2 rounded border border-zinc-800">
                                <span className="text-white font-bold">{l.nome} - {l.preco}</span>
                                <div className="flex gap-1">
                                    <button onClick={() => toggleLoteStatus(l.id, "ativo")} className={`px-2 rounded ${l.status === 'ativo' ? 'bg-emerald-500 ring-2 ring-emerald-500/50' : 'bg-zinc-700'}`} title="Ativar"></button>
                                    <button onClick={() => toggleLoteStatus(l.id, "em_breve")} className={`px-2 rounded ${l.status === 'em_breve' ? 'bg-yellow-600 ring-2 ring-yellow-500/50' : 'bg-zinc-700'}`} title="Em Breve"></button>
                                    <button onClick={() => toggleLoteStatus(l.id, "esgotado")} className={`px-2 rounded ${l.status === 'esgotado' ? 'bg-red-500 ring-2 ring-red-500/50' : 'bg-zinc-700'}`} title="Esgotado"></button>
                                    <button onClick={() => setShowLotePlanModal(l.id)} className="rounded border border-zinc-700 bg-black/30 px-2 py-1 text-[10px] font-black uppercase text-zinc-300 hover:border-emerald-500/30 hover:text-emerald-300">Planos</button>
                                    <button onClick={() => removeLote(l.id)} className="text-zinc-500 hover:text-red-500 ml-1"><X size={12}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div><label className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">Descrição Completa</label><textarea maxLength={EVENT_DESCRIPTION_MAX_LENGTH} className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-sm text-white h-24 resize-none focus:border-emerald-500 outline-none" value={novoEvento.descricao} onChange={(e) => setNovoEvento({ ...novoEvento, descricao: e.target.value.slice(0, EVENT_DESCRIPTION_MAX_LENGTH) })}></textarea></div>

            <div className="flex gap-3 pt-2 border-t border-zinc-800">
              <button onClick={() => { setShowModal(false); clearEventModalQuery(); }} className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-bold text-xs uppercase hover:bg-zinc-800 transition">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition">{isEditing ? "Atualizar Evento" : "Criar Evento"}</button>
            </div>
            </div>
          </div>
        </div>
      )}

      {showLotePlanModal !== null && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black uppercase text-white">Preco do Lote por Plano</h3>
                <p className="text-[11px] text-zinc-500">
                  So ajuste quem tiver desconto especifico. Se deixar em branco, o plano usa o valor geral do lote.
                </p>
              </div>
              <button onClick={() => setShowLotePlanModal(null)} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 hover:bg-zinc-800">
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {(novoEvento.lotes?.find((l) => l.id === showLotePlanModal)?.planPrices || buildLotePlanPrices(planCatalog)).map((entry) => (
                <div key={entry.planId} className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                  <div>
                    <p className="text-sm font-bold text-white">{entry.planName}</p>
                    <p className="text-[10px] text-zinc-500">
                      Em branco: usa o preco do lote
                      {novoEvento.lotes?.find((l) => l.id === showLotePlanModal)?.preco
                        ? ` (R$ ${novoEvento.lotes?.find((l) => l.id === showLotePlanModal)?.preco})`
                        : "."}
                    </p>
                  </div>
                  <input
                    value={entry.price}
                    onChange={(e) => updateLotePlanPrice(showLotePlanModal, entry.planId, e.target.value)}
                    placeholder={`Preco especial para ${entry.planName}`}
                    inputMode="decimal"
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PaymentReceiversManager
        tenantId={activeTenantId}
        scope="events"
        open={showEventReceiversManager}
        recipients={eventPaymentRecipients}
        title="Recebedores de eventos"
        description="Lista usada somente pelos comprovantes de eventos."
        savedMessage="Recebedores de eventos atualizados."
        onClose={() => setShowEventReceiversManager(false)}
        onSaved={setEventPaymentRecipients}
      />
    </div>
  );
}


