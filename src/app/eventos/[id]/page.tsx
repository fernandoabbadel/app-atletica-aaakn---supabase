// src/app/eventos/[id]/page.tsx
"use client";
import Image from "next/image";
import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  ArrowLeft, Calendar, MapPin, Share2, Ticket,
  Users, CheckCircle, HelpCircle, XCircle,
  Loader2, MessageCircle, Copy, Wallet,
  Heart, Send, Trash2, ShieldAlert, Star,
  Ghost, Fish, ChevronLeft, ChevronRight, Flag, X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  addEventPollOption,
  createEventComment,
  cancelEventTicketRequest,
  deleteEventComment,
  EVENT_POLL_OPTION_MAX_CHARS,
  EVENT_POLL_OPTION_MAX_COUNT,
  fetchEventDetailsBundle,
  reportEventComment,
  setEventCommentHidden,
  setEventRsvpDetailed,
  toggleEventCommentLike,
  voteEventPollOption,
  type DateLike,
} from "../../../lib/eventsNativeService";
import { ReceiptContactButton } from "@/components/ReceiptContactButton";
import { getTurmaImage } from "../../../constants/turmaImages";
import { useAuth } from "../../../context/AuthContext";
import { useTenantTheme } from "../../../context/TenantThemeContext";
import { useToast } from "../../../context/ToastContext";
import { resolvePlanIcon, resolvePlanTextClass, resolveUserPlanIcon } from "../../../constants/planVisuals";
import {
  resolvePlanScopedPriceInfo,
  type CommercePaymentConfig,
} from "../../../lib/commerceCatalog";
import { fetchLeagueById } from "../../../lib/leaguesService";
import { isAdminLikeRole, resolveEffectiveAccessRole } from "../../../lib/roles";
import {
  buildEventReceiptWhatsappMessage,
  resolveReceiptContactProfile,
} from "../../../lib/tenantBranding";
import { withTenantSlug } from "../../../lib/tenantRouting";
import { collectUserPlanScope } from "../../../lib/userPlanScope";

// --- INTERFACES ---
interface Lote {
  id: string | number; 
  nome: string;
  preco: string;
  status: 'ativo' | 'esgotado' | 'em_breve';
  planPrices?: Array<{ planId?: string; planName?: string; price?: string | number }>;
}

interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  data: string;
  hora: string;
  local: string;
  imagem?: string;
  imagePositionY?: number;
  tipo: string;
  categoria?: string;
  saleStatus?: 'ativo' | 'esgotado' | 'em_breve';
  sale_status?: 'ativo' | 'esgotado' | 'em_breve';
  isLowStock?: boolean;
  stats?: {
    confirmados: number;
    talvez: number;
    likes?: number;
    leagueId?: string;
    leagueEventVisibility?: string;
    eventVisibility?: string;
  };
  leagueId?: string;
  leagueEventVisibility?: string;
  lotes?: Lote[];
  // ID 12: Dados financeiros locais do evento
  pixChave?: string;
  pixBanco?: string;
  pixTitular?: string;
  contatoComprovante?: string;
}

interface PedidoIngresso {
    id: string;
    loteNome: string;
    quantidade: number;
    valorTotal: string;
    status: string;
    payment_config?: CommercePaymentConfig | null;
    dataSolicitacao?: DateLike | null;
    dataAprovacao?: DateLike | null;
}

interface Rsvp {
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  status: 'going' | 'maybe';
  timestamp?: DateLike | null;
}

interface Comentario {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userTurma: string;
  userPlanoCor?: string;
  userPlanoIcon?: string;
  userPatente?: string;
  userPatenteIcon?: string;
  userPatenteCor?: string;
  role?: string;
  likes: string[];
  reports: string[];
  hidden: boolean;
  createdAt: DateLike | null;
}

interface EnqueteOption {
  text: string;
  votes: number;
  creatorId?: string;
  creatorName?: string;
  creatorAvatar?: string;
  votesByTurma?: Record<string, number>;
}

interface Enquete {
  id: string;
  question: string;
  options: EnqueteOption[];
  allowUserOptions?: boolean;
  voters: string[];
  userVotes?: Record<string, number[]>;
  createdAt: DateLike | null;
}

interface PatenteConfig {
    titulo: string;
    minXp: number;
    cor: string;
    iconName: string;
}

const DEFAULT_PATENTES: PatenteConfig[] = [
    { titulo: "Plâncton", minXp: 0, cor: "text-zinc-400", iconName: "Fish" },
    { titulo: "Peixe Palhaço", minXp: 500, cor: "text-orange-400", iconName: "Fish" },
    { titulo: "Barracuda", minXp: 2000, cor: "text-blue-400", iconName: "Swords" },
    { titulo: "Elite Roxa", minXp: 5000, cor: "text-purple-400", iconName: "Fish" },
    { titulo: "Elite Verde", minXp: 15000, cor: "text-emerald-400", iconName: "Fish" },
    { titulo: "MEGALODON", minXp: 50000, cor: "text-red-600", iconName: "Crown" },
];

const COMMENT_MAX_CHARS = 280;
const EVENT_DETAILS_RSVPS_LIMIT = 200;
const EVENT_DETAILS_COMMENTS_LIMIT = 100;
const EVENT_DETAILS_POLLS_LIMIT = 20;
const EVENT_DETAILS_PEDIDOS_LIMIT = 20;

const getSaleStatusLabel = (status?: Evento["saleStatus"]): string => {
  if (status === "em_breve") return "Em-breve";
  if (status === "esgotado") return "Esgotado";
  return "Ativo";
};

const getSaleStatusClass = (status?: Evento["saleStatus"]): string => {
  if (status === "em_breve") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (status === "esgotado") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

const keepDigits = (value: string): string => value.replace(/\D/g, "");

const parseCurrencyValue = (value: string): number => {
  const sanitized = String(value || "").trim().replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrencyValue = (value: string): string =>
  parseCurrencyValue(value).toFixed(2);

const formatPedidoDateTime = (value?: DateLike | null): string => {
  const date = value?.toDate?.();
  if (!date || Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

const normalizePedidoStatus = (
  value: string
): "pendente" | "aprovado" | "rejeitado" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "aprovado") return "aprovado";
  if (
    normalized === "rejected" ||
    normalized === "rejeitado" ||
    normalized === "cancelado"
  ) {
    return "rejeitado";
  }
  return "pendente";
};

const getPedidoStatusLabel = (value: string): string => {
  const status = normalizePedidoStatus(value);
  if (status === "aprovado") return "Confirmado";
  if (status === "rejeitado") return "Cancelado";
  return "Pendente";
};

const getPedidoStatusClass = (value: string): string => {
  const status = normalizePedidoStatus(value);
  if (status === "aprovado") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "rejeitado") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
};

const parseEventDate = (dateStr: string, timeStr: string = "00:00") => {
    try {
        const [hours, mins] = timeStr.split(':').map(Number);
        
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d, hours || 0, mins || 0);
        }
        return null;
    } catch {
        return null;
    }
};

function EventCountdown({ dateStr, timeStr }: { dateStr: string, timeStr: string }) {
  const [timeLeft, setTimeLeft] = useState<{d: number, h: number, m: number, s: number} | null>(null);
  const [status, setStatus] = useState("CALCULANDO...");

  useEffect(() => {
    const tick = () => {
        const target = parseEventDate(dateStr, timeStr);
        if (!target) {
            setStatus("DATA INDEFINIDA");
            return;
        }
        const now = new Date();
        const diff = target.getTime() - now.getTime();

        if (diff <= 0) {
            setStatus("ESTA ROLANDO!");
            setTimeLeft(null);
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        setTimeLeft({ d: days, h: hours, m: minutes, s: seconds });
        setStatus("");
    };
    
    tick();
    const interval = setInterval(tick, 1000); 
    return () => clearInterval(interval);
  }, [dateStr, timeStr]);

  if (status) return <div className="bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-emerald-500/50 shadow-[0_0_25px_rgba(16,185,129,0.4)] animate-pulse"><span className="text-sm font-black text-emerald-400 tracking-[0.2em]">{status}</span></div>;

  return (
    <div className="flex gap-3 bg-black/40 backdrop-blur-sm p-2 rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.d || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Dias</span></div>
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.h || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Hrs</span></div>
        <div className="flex flex-col items-center justify-center bg-zinc-900/80 w-12 h-14 rounded-xl border border-zinc-800"><span className="text-xl font-black text-white leading-none">{String(timeLeft?.m || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Min</span></div>
        <div className="flex flex-col items-center justify-center bg-emerald-900/20 w-12 h-14 rounded-xl border border-emerald-500/30"><span className="text-xl font-black text-emerald-400 leading-none">{String(timeLeft?.s || 0).padStart(2, '0')}</span><span className="text-[7px] font-bold text-emerald-600 uppercase tracking-wider mt-1">Seg</span></div>
    </div>
  );
}

// --- BADGES DO USUARIO ---
const UserBadges = ({ data, patentesConfig }: { data: Comentario, patentesConfig: PatenteConfig[] }) => {
    const isAdminUser = isAdminLikeRole(data.role);
    const normalizeLabel = (value: string | undefined): string =>
      String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const isDisplayLabel = (value: string | undefined): value is string => {
      const normalized = normalizeLabel(value);
      return normalized.length > 0 && normalized !== "visitante" && normalized !== "visitor";
    };
    const hasPlanIcon = typeof data.userPlanoIcon === "string" && data.userPlanoIcon.trim().length > 0;
    const PlanIcon = hasPlanIcon ? resolveUserPlanIcon(data.userPlanoIcon, undefined, Ghost) : null;
    const planColor = resolvePlanTextClass(data.userPlanoCor, "text-zinc-400");
    const normalizedPatenteLabel = normalizeLabel(data.userPatente);
    const patenteFromList = normalizedPatenteLabel
      ? patentesConfig.find((p) => normalizeLabel(p.titulo) === normalizedPatenteLabel)
      : undefined;
    const patenteIconName =
      (typeof data.userPatenteIcon === "string" ? data.userPatenteIcon.trim() : "") ||
      (patenteFromList?.iconName || "");
    const patenteColorRaw =
      (typeof data.userPatenteCor === "string" ? data.userPatenteCor.trim() : "") ||
      (patenteFromList?.cor || "");
    const PatenteIcon = patenteIconName ? resolvePlanIcon(patenteIconName, Fish) : null;
    const patenteColor = resolvePlanTextClass(patenteColorRaw, "text-zinc-400");
    const patenteTitle = isDisplayLabel(data.userPatente)
      ? data.userPatente
      : isDisplayLabel(patenteFromList?.titulo)
      ? patenteFromList?.titulo
      : "";

    return (
        <div className="flex items-center gap-1.5 ml-1">
            {isAdminUser && <span title="Admin"><ShieldAlert size={12} className="text-red-500 fill-red-500/20" /></span>}
            {PlanIcon && <PlanIcon size={12} className={planColor} />}
            {PatenteIcon && (
              <div title={patenteTitle ? `Patente: ${patenteTitle}` : undefined} className="flex items-center justify-center">
                <PatenteIcon size={12} className={patenteColor} />
              </div>
            )}
        </div>
    );
};

const getLeagueEventVisibility = (event: Evento | null): "public" | "internal" => {
  const raw = String(
    event?.leagueEventVisibility ||
      event?.stats?.leagueEventVisibility ||
      event?.stats?.eventVisibility ||
      ""
  )
    .trim()
    .toLowerCase();
  return raw === "internal" || raw === "interno" ? "internal" : "public";
};

const getLeagueIdFromEvent = (event: Evento | null): string =>
  String(event?.leagueId || event?.stats?.leagueId || "").trim();

export default function DetalhesEventoPage() {
  const params = useParams();
  const { user, isAdmin } = useAuth(); 
  const { tenantId: activeTenantId, tenantSigla, tenantName, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const tenantPath = (path: string): string =>
    tenantSlug.trim() ? withTenantSlug(tenantSlug, path) : path;
  
  const [evento, setEvento] = useState<Evento | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [enquetes, setEnquetes] = useState<Enquete[]>([]);
  const [patentesConfig, setPatentesConfig] = useState<PatenteConfig[]>(DEFAULT_PATENTES);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [userRsvp, setUserRsvp] = useState<string | null>(null);
  
  const [modalUsersType, setModalUsersType] = useState<"going" | "maybe" | null>(null);
  const [newComment, setNewComment] = useState("");
  const [newPollOption, setNewPollOption] = useState("");
  
  const [currentPollIndex, setCurrentPollIndex] = useState(0);

  // Novos estados para pedidos
  const [meusPedidos, setMeusPedidos] = useState<PedidoIngresso[]>([]);
  // Usando Record<string, unknown> para evitar 'any'
  const [globalFinanceiro, setGlobalFinanceiro] = useState<Record<string, unknown> | null>(null);
  const contatoFinanceiro = (() => {
      const telefones = globalFinanceiro?.telefones;
      if (typeof telefones === "string") return telefones;
      const whatsapp = globalFinanceiro?.whatsapp;
      if (typeof whatsapp === "string") return whatsapp;
      return undefined;
  })();
  const { userPlanNames, userPlanIds } = useMemo(() => collectUserPlanScope(user), [user]);

  const eventId = typeof params.id === "string" ? params.id : "";
  const resolveLotePriceInfo = useCallback(
      (lote: Lote) => {
          const basePrice = Number.parseFloat(String(lote.preco || "0").replace(",", ".")) || 0;
          const priceInfo = resolvePlanScopedPriceInfo({
              basePrice,
              entries: Array.isArray(lote.planPrices)
                  ? lote.planPrices.map((entry) => ({
                        planId: String(entry.planId || ""),
                        planName: String(entry.planName || ""),
                        price:
                            typeof entry.price === "number"
                                ? entry.price
                                : Number.parseFloat(String(entry.price || "0").replace(",", ".")) || 0,
                    }))
                  : [],
              userPlanIds,
              userPlanNames,
          });
          return {
            ...priceInfo,
            displayPrice: priceInfo.finalPrice.toFixed(2).replace(".", ","),
          };
      },
      [userPlanIds, userPlanNames]
  );

  const refreshEventData = useCallback(
      async (withLoading = false) => {
          if (!eventId) {
              setLoading(false);
              return;
          }

          if (withLoading) setLoading(true);
          try {
              const bundle = await fetchEventDetailsBundle({
                  eventId,
                  userId: user?.uid || null,
                  rsvpsLimit: EVENT_DETAILS_RSVPS_LIMIT,
                  commentsLimit: EVENT_DETAILS_COMMENTS_LIMIT,
                  pollsLimit: EVENT_DETAILS_POLLS_LIMIT,
                  pedidosLimit: EVENT_DETAILS_PEDIDOS_LIMIT,
                  forceRefresh: false,
                  tenantId: activeTenantId || undefined,
              });

              const loadedEvent = bundle.evento as Evento | null;
              if (getLeagueEventVisibility(loadedEvent) === "internal") {
                  const leagueId = getLeagueIdFromEvent(loadedEvent);
                  const league = leagueId
                      ? await fetchLeagueById(leagueId, {
                            tenantId: activeTenantId || undefined,
                          })
                      : null;
                  const canViewInternalEvent = Boolean(
                      user?.uid &&
                      league?.membros?.some((member) => member.id.trim() === user.uid.trim())
                  );
                  if (!canViewInternalEvent) {
                      setAccessDenied(true);
                      setEvento(null);
                      setRsvps([]);
                      setComentarios([]);
                      setEnquetes([]);
                      setMeusPedidos([]);
                      setUserRsvp(null);
                      return;
                  }
              }

              setAccessDenied(false);
              setEvento(loadedEvent);
              setRsvps(bundle.rsvps as unknown as Rsvp[]);
              setComentarios(bundle.comentarios as unknown as Comentario[]);
              setEnquetes(bundle.enquetes as unknown as Enquete[]);
              setPatentesConfig(
                  bundle.patentes.length > 0
                      ? (bundle.patentes as unknown as PatenteConfig[])
                      : DEFAULT_PATENTES
              );
              setGlobalFinanceiro(bundle.financeiro);
              setMeusPedidos(bundle.meusPedidos as unknown as PedidoIngresso[]);

              if (user) {
                  const me = (bundle.rsvps as unknown as Rsvp[]).find((p) => p.userId === user.uid);
                  setUserRsvp(me ? me.status : null);
              } else {
                  setUserRsvp(null);
              }
          } catch (error: unknown) {
              console.error(error);
              addToast("Erro ao carregar evento.", "error");
          } finally {
              setLoading(false);
          }
      },
      [activeTenantId, eventId, user, addToast]
  );

  useEffect(() => {
      void refreshEventData(true);
  }, [refreshEventData]);

  const pendingPedidos = useMemo(
      () => meusPedidos.filter((pedido) => normalizePedidoStatus(pedido.status) === "pendente"),
      [meusPedidos]
  );
  const historyPedidos = useMemo(
      () => meusPedidos.filter((pedido) => normalizePedidoStatus(pedido.status) !== "pendente"),
      [meusPedidos]
  );

  const resolvePedidoPaymentConfig = useCallback(
      (pedido: PedidoIngresso) => {
          const paymentConfig =
              pedido.payment_config && typeof pedido.payment_config === "object"
                  ? pedido.payment_config
                  : null;
          const isLeagueEvent =
              String(evento?.categoria || "").trim().toLowerCase() === "liga" ||
              String(evento?.tipo || "").trim().toLowerCase() === "liga";
          return {
              chave:
                  String(paymentConfig?.chave || evento?.pixChave || globalFinanceiro?.chave || "").trim(),
              banco:
                  String(paymentConfig?.banco || evento?.pixBanco || globalFinanceiro?.banco || "").trim(),
              titular:
                  String(paymentConfig?.titular || evento?.pixTitular || globalFinanceiro?.titular || "").trim(),
              whatsapp:
                  String(
                      paymentConfig?.whatsapp ||
                      evento?.contatoComprovante ||
                      contatoFinanceiro ||
                      ""
                  ).trim(),
              ...(!isLeagueEvent && paymentConfig?.recipient
                  ? { recipient: paymentConfig.recipient }
                  : {}),
              ...(Array.isArray(paymentConfig?.ticketEntries)
                  ? { ticketEntries: paymentConfig.ticketEntries }
                  : {}),
          };
      },
      [contatoFinanceiro, evento, globalFinanceiro]
  );

  const handleCopyPedidoPix = useCallback(
      async (pedido: PedidoIngresso) => {
          try {
              const payment = resolvePedidoPaymentConfig(pedido);
              if (!payment.chave) {
                  addToast("Chave PIX não configurada para este evento.", "error");
                  return;
              }
              await navigator.clipboard.writeText(payment.chave || "");
              addToast("Chave PIX copiada!", "success");
          } catch (error: unknown) {
              console.error(error);
              addToast("Não foi possível copiar a chave PIX.", "error");
          }
      },
      [addToast, resolvePedidoPaymentConfig]
  );

  const handleSendPedidoReceiptWhatsapp = useCallback(
      (pedido: PedidoIngresso) => {
          if (!evento) return;
          const payment = resolvePedidoPaymentConfig(pedido);
          const adminPhone = keepDigits(payment.whatsapp || "");
          if (!adminPhone) {
              addToast("WhatsApp financeiro não configurado para este evento.", "error");
              return;
          }

          const buyerName = user?.nome || "Aluno";
          const buyerPhone = user?.telefone || "Não informado";
          const buyerTurma = user?.turma || "Sem turma";
          const total = formatCurrencyValue(pedido.valorTotal);
          const recipient = resolveReceiptContactProfile({
              paymentConfig: payment,
              tenantSigla,
              tenantName,
              fallbackAvatarUrl: evento.imagem || "/logo.png",
              fallbackPhone: payment.whatsapp || contatoFinanceiro,
          });
          const message = buildEventReceiptWhatsappMessage({
              tenantSigla,
              tenantName,
              eventTitle: evento.titulo,
              eventType: evento.tipo,
              eventCategory: evento.categoria,
              buyerName,
              buyerTurma,
              buyerPhone,
              ticketLabel: `${pedido.quantidade}x ${pedido.loteNome}`,
              totalValue: total,
              orderCode: pedido.id.slice(0, 8).toUpperCase(),
              recipientName: recipient.name,
              recipientTurma: recipient.turma,
          });
          const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;
          window.open(whatsappUrl, "_blank");
      },
      [
          addToast,
          contatoFinanceiro,
          evento,
          resolvePedidoPaymentConfig,
          tenantName,
          tenantSigla,
          user?.nome,
          user?.telefone,
          user?.turma,
      ]
  );

  // --- ACTIONS ---

  const handleCancelOrder = async (pedidoId: string) => {
      if (!confirm("Tem certeza que deseja cancelar este pedido?")) return;
      try {
          await cancelEventTicketRequest(pedidoId, {
              tenantId: activeTenantId || undefined,
          });
          addToast("Pedido cancelado.", "info");
          await refreshEventData();
      } catch {
          addToast("Erro ao cancelar.", "error");
      }
  };

  const handleRSVP = async (status: "going" | "maybe") => {
      if (!user || !evento) return addToast("Faça login para confirmar!", "error");
      try {
          await setEventRsvpDetailed({
              eventId: evento.id,
              userId: user.uid,
              status,
              userName: user.nome || "Anônimo",
              userAvatar: user.foto || "",
              userTurma: user.turma || "Geral",
              tenantId: activeTenantId || undefined,
          });
          addToast("Lista atualizada!", "success");
          await refreshEventData();
      } catch { addToast("Erro ao atualizar.", "error"); }
  };

  const handleSendComment = async () => {
      const commentText = newComment.trim().slice(0, COMMENT_MAX_CHARS);
      if (!commentText || !user || !evento) return;
      const newCommentData = {
          text: commentText, userId: user.uid, userName: user.nome || "Anônimo",
          userAvatar: user.foto || "", userTurma: user.turma || "Geral",
          userPlanoCor: typeof user.plano_cor === "string" ? user.plano_cor : undefined,
          userPlanoIcon: typeof user.plano_icon === "string" ? user.plano_icon : undefined,
          userPatente: typeof user.patente === "string" ? user.patente : undefined,
          role: resolveEffectiveAccessRole(user),
          likes: [], reports: [], hidden: false
      };
      try {
          await createEventComment({ eventId: evento.id, data: newCommentData });
          setNewComment("");
          addToast("Comentário enviado!", "success");
          await refreshEventData();
      } catch { addToast("Erro ao comentar.", "error"); }
  };

  const handleLikeComment = async (comId: string, currentLikes: string[], authorId: string) => {
      if (!user || !evento) return;
      const safeLikes = Array.isArray(currentLikes) ? currentLikes : [];
      try {
          void safeLikes;
          void authorId;
          await toggleEventCommentLike({
              eventId: evento.id,
              commentId: comId,
              userId: user.uid,
          });
          await refreshEventData();
      } catch (error) { console.error(error); }
  };

  const handleDeleteComment = async (comId: string) => {
      if (!evento || !confirm("Apagar este comentário?")) return;
      try {
          await deleteEventComment({ eventId: evento.id, commentId: comId });
          addToast("Comentário apagado.", "info");
          await refreshEventData();
      } catch {
          addToast("Erro ao apagar.", "error");
      }
  };

  const handleReportComment = async (comId: string) => {
      if (!user || !evento) return;
      await reportEventComment({ eventId: evento.id, commentId: comId, userId: user.uid });
      addToast("Comentário denunciado.", "info");
      await refreshEventData();
  };

  const handleToggleHideComment = async (comId: string, currentStatus: boolean) => {
      if(!evento) return;
      await setEventCommentHidden({ eventId: evento.id, commentId: comId, hidden: !currentStatus });
      addToast(currentStatus ? "Comentário restaurado." : "Comentário ocultado.", "info");
      await refreshEventData();
  };

  const handleVotePoll = async (pollId: string, optionIndex: number) => {
      if (!user || !evento) return addToast("Login necessario.", "error");
      try {
        await voteEventPollOption({
            eventId: evento.id,
            pollId,
            userId: user.uid,
            userTurma: user.turma || "Geral",
            optionIndex,
            tenantId: activeTenantId || undefined,
        });
        await refreshEventData();
      } catch (e: unknown) { 
        const errorMsg = e instanceof Error ? e.message : typeof e === 'string' ? e : "Erro ao votar.";
        addToast(errorMsg, "error"); 
      }
  };

  const handleCreatePollOption = async (pollId: string) => {
      const cleanOptionText = newPollOption.trim().slice(0, EVENT_POLL_OPTION_MAX_CHARS);
      if(!cleanOptionText || !user || !evento) return;

      const current = enquetes.find((poll) => poll.id === pollId);
      if (current && Array.isArray(current.options) && current.options.length >= EVENT_POLL_OPTION_MAX_COUNT) {
          addToast(`Cada enquete aceita no máximo ${EVENT_POLL_OPTION_MAX_COUNT} respostas.`, "error");
          return;
      }

      const optionAlreadyExists = Boolean(
          current?.options?.some(
              (option) => option.text.trim().toLowerCase() === cleanOptionText.toLowerCase()
          )
      );
      if (optionAlreadyExists) {
          addToast("Essa resposta ja existe na enquete.", "info");
          return;
      }
      const userAlreadyCreatedOption = Boolean(
          current?.options?.some((option) => option.creatorId === user.uid)
      );
      if (userAlreadyCreatedOption) {
          addToast("Cada usuário pode sugerir no máximo uma nova resposta por enquete.", "info");
          return;
      }

      const previousPolls = enquetes;
      const userTurma = user.turma || "Geral";

      setEnquetes((prev) =>
          prev.map((poll) => {
              if (poll.id !== pollId) return poll;

              const nextOptionIndex = poll.options.length;
              const currentUserVotes = Array.isArray(poll.userVotes?.[user.uid])
                  ? poll.userVotes?.[user.uid] || []
                  : [];

              return {
                  ...poll,
                  options: [
                      ...poll.options,
                      {
                          text: cleanOptionText,
                          votes: 1,
                          creatorId: user.uid,
                          creatorName: user.nome?.split(" ")[0] || "Anonimo",
                          creatorAvatar: user.foto || "",
                          votesByTurma: { [userTurma]: 1 },
                      },
                  ],
                  voters: poll.voters.includes(user.uid) ? poll.voters : [...poll.voters, user.uid],
                  userVotes: {
                      ...(poll.userVotes || {}),
                      [user.uid]: Array.from(new Set([...currentUserVotes, nextOptionIndex])),
                  },
              };
          })
      );
      setNewPollOption("");

      try {
          await addEventPollOption({
              eventId: evento.id,
              pollId,
              option: { 
                  text: cleanOptionText,
                  votes: 0,
                  creatorId: user.uid,
                  creatorName: user.nome?.split(" ")[0] || "Anonimo",
                  creatorAvatar: user.foto || "",
                  votesByTurma: {},
              },
              autoVoteUserId: user.uid,
              autoVoteUserTurma: userTurma,
              tenantId: activeTenantId || undefined,
          });
          addToast("Opcao adicionada e voto registrado!", "success");
          void refreshEventData();
      } catch (error: unknown) {
          setEnquetes(previousPolls);
          setNewPollOption(cleanOptionText);
          addToast(error instanceof Error ? error.message : "Erro ao adicionar opcao.", "error");
      }
  };

  const handleReportPoll = async (_pollId: string) => { if(!user) return; void _pollId; addToast("Enquete reportada a moderacao.", "info"); };
  const handleReportOption = async (_pollId: string, optionText: string) => { if(!user) return; void _pollId; addToast(`Opcao "${optionText}" denunciada.`, "info"); };

  const nextPoll = () => setCurrentPollIndex(prev => (prev + 1) % enquetes.length);
  const prevPoll = () => setCurrentPollIndex(prev => (prev - 1 + enquetes.length) % enquetes.length);
  const currentPoll = enquetes[currentPollIndex];

  const topTurmasPoll = useMemo(() => {
      if (!currentPoll) return [];
      const counts: Record<string, number> = {};
      currentPoll.options?.forEach((opt) => {
          if (opt.votesByTurma) {
              Object.entries(opt.votesByTurma).forEach(([turma, count]) => { counts[turma] = (counts[turma] || 0) + (count as number); });
          }
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  }, [currentPoll]);

  const sortedPollOptions = useMemo(() => {
      if (!currentPoll?.options) return [];
      return currentPoll.options
          .map((opt, originalIndex) => ({ opt, originalIndex }))
          .sort((left, right) => (right.opt.votes || 0) - (left.opt.votes || 0));
  }, [currentPoll]);

  const orderedComments = useMemo(() => {
      return [...comentarios].sort((left, right) => {
          const leftMs = left.createdAt?.toDate ? left.createdAt.toDate().getTime() : 0;
          const rightMs = right.createdAt?.toDate ? right.createdAt.toDate().getTime() : 0;
          return rightMs - leftMs;
      });
  }, [comentarios]);

  const handleShare = async () => {
      const shareUrl = typeof window !== "undefined" ? window.location.href : "";
      if (!shareUrl) return;

      try {
          if (evento && typeof navigator !== "undefined" && navigator.share) {
              await navigator.share({ title: evento.titulo, url: shareUrl });
              return;
          }

          await navigator.clipboard.writeText(shareUrl);
          addToast("Link copiado!", "success");
      } catch (error: unknown) {
          const shareError = error as { name?: string };
          if (shareError?.name === "AbortError") return;

          try {
              await navigator.clipboard.writeText(shareUrl);
              addToast("Link copiado!", "success");
          } catch {
              addToast("Não foi possível compartilhar agora.", "error");
          }
      }
  };

  const modalUsers = useMemo(() => {
      if (!modalUsersType) return [];
      return rsvps.filter(r => r.status === modalUsersType);
  }, [rsvps, modalUsersType]);

  const rankingTurmas = useMemo(() => {
      const counts: Record<string, number> = {};
      rsvps.forEach(r => r.status === 'going' && (counts[(r.userTurma || "Geral").toUpperCase()] = (counts[(r.userTurma || "Geral").toUpperCase()] || 0) + 1));
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => ({
          turma: t,
          count: c,
          imagem: getTurmaImage(t, "https://github.com/shadcn.png"),
        }));
  }, [rsvps]);

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500 w-10 h-10"/></div>;
  if (accessDenied) return <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4 px-6 text-center"><ShieldAlert size={40} className="text-amber-400"/> <p className="max-w-sm text-sm text-zinc-300">Este evento interno aparece apenas para membros da liga.</p> <Link href={tenantPath("/eventos")} className="text-emerald-500 underline">Voltar</Link></div>;
  if (!evento) return <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4"><XCircle size={40} className="text-red-500"/> <p>Evento não encontrado.</p> <Link href={tenantPath("/eventos")} className="text-emerald-500 underline">Voltar</Link></div>;
  const eventoSaleStatus = evento.saleStatus || evento.sale_status || "ativo";
  const firstActiveLote = evento.lotes?.find((lote) => lote.status === "ativo");

  return (
    <div className="min-h-screen bg-[#050505] pb-44 font-sans text-white">
      
      {/* HERO IMAGE NEXT.JS */}
        <div className="relative h-[58vh] min-h-[420px] max-h-[640px] w-full sm:min-h-[360px]">
            <Image 
                src={evento.imagem || "https://placehold.co/600x400/111/333"} 
                alt={`Capa do evento ${evento.titulo}`}
                fill
                sizes="100vw"
                priority
                className="object-cover" 
                style={{ objectPosition: `50% ${evento.imagePositionY || 50}%` }}
                unoptimized // Adicione isso para evitar erros de dominio externo
            />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/20 to-transparent"></div>
        
        <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between sm:left-6 sm:right-6 sm:top-6">
            <Link href={tenantPath("/eventos")} className="bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 text-white hover:bg-white hover:text-black transition">
                <ArrowLeft size={20} />
            </Link>
            <button onClick={handleShare} className="bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 text-white hover:bg-emerald-500 hover:text-black transition">
                <Share2 size={20} />
            </button>
        </div>

        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
            <EventCountdown dateStr={evento.data} timeStr={evento.hora} />
        </div>

      <div className="absolute bottom-32 right-4 z-20 flex flex-col items-end gap-2 sm:bottom-24 sm:right-6">
            {rankingTurmas.map((t) => (
                <div key={t.turma} className="flex items-center gap-2 bg-black/60 backdrop-blur-md pl-1 pr-3 py-1 rounded-full border border-white/10">
                    <Image 
                        src={t.imagem} 
                        alt={`Turma ${t.turma}`} 
                        width={24} 
                        height={24} 
                        className="rounded-full object-cover border border-zinc-500"
                    />
                    <span className="text-[10px] font-bold text-emerald-400">+{t.count}</span>
                </div>
            ))}
        </div>

        <div className="absolute bottom-0 left-0 z-20 w-full p-4 sm:p-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="px-3 py-1 bg-emerald-500 text-black text-[10px] font-black uppercase rounded inline-block">{evento.tipo}</span>
                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase backdrop-blur-md ${getSaleStatusClass(eventoSaleStatus)}`}>
                    {getSaleStatusLabel(eventoSaleStatus)}
                </span>
            </div>
            <h1 className="mb-2 break-words text-3xl font-black uppercase italic leading-none text-white drop-shadow-xl sm:text-4xl">{evento.titulo}</h1>
            <div className="flex flex-wrap gap-2 text-xs font-bold uppercase text-zinc-300">
                <span className="flex items-center gap-1"><Calendar size={12} className="text-emerald-500"/> {evento.data}</span>
                <span className="flex min-w-0 items-center gap-1"><MapPin size={12} className="shrink-0 text-emerald-500"/> <span className="line-clamp-1">{evento.local}</span></span>
            </div>
        </div>
      </div>

      {/* CONTEUDO */}
      <div className="relative z-30 -mt-6 space-y-8 rounded-t-[30px] border-t border-white/10 bg-[#050505] p-4 sm:p-6">
        
        {evento.descricao && (
            <div className="space-y-2">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Sobre o Evento</h3>
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{evento.descricao}</p>
            </div>
        )}

        {evento.isLowStock && (
            <div className="bg-gradient-to-r from-yellow-600 to-yellow-400 p-0.5 rounded-2xl animate-pulse shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                <div className="bg-black rounded-[14px] p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Star className="text-yellow-400 fill-yellow-400" size={24}/>
                        <div>
                            <p className="text-yellow-400 font-black uppercase text-sm tracking-widest">Ultimas Vagas</p>
                            <p className="text-zinc-400 text-[10px]">O lote vai virar em breve!</p>
                        </div>
                    </div>
                    {/* Link para nova compra */}
                    {firstActiveLote && eventoSaleStatus !== 'em_breve' && eventoSaleStatus !== 'esgotado' && (
                          <Link href={tenantPath(`/eventos/compra?evento=${evento.id}&lote=${firstActiveLote.id}`)} className="bg-yellow-400 text-black font-black text-xs px-4 py-2 rounded-lg uppercase hover:bg-yellow-300">Garantir</Link>
                    )}
                </div>
            </div>
        )}

        <div className="grid grid-cols-2 gap-3">
            <button onClick={() => handleRSVP('going')} className={`py-4 rounded-xl flex flex-col items-center gap-1 transition border ${userRsvp === 'going' ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg' : 'bg-zinc-900 border-zinc-800'}`}>
                <CheckCircle size={20}/> <span className="text-xs font-black uppercase">Eu Vou</span>
            </button>
            <button onClick={() => handleRSVP('maybe')} className={`py-4 rounded-xl flex flex-col items-center gap-1 transition border ${userRsvp === 'maybe' ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg' : 'bg-zinc-900 border-zinc-800'}`}>
                <HelpCircle size={20}/> <span className="text-xs font-black uppercase">Talvez</span>
            </button>
        </div>

        <div className="flex flex-wrap justify-center gap-4 text-[10px] font-bold uppercase text-zinc-500 sm:gap-6">
            <button onClick={() => setModalUsersType('going')} className="hover:text-emerald-500 transition underline decoration-dashed underline-offset-4 flex items-center gap-1">
                <Users size={12}/> {evento.stats?.confirmados || 0} Confirmados
            </button>
            <button onClick={() => setModalUsersType('maybe')} className="hover:text-yellow-500 transition underline decoration-dashed underline-offset-4 flex items-center gap-1">
                <HelpCircle size={12}/> {evento.stats?.talvez || 0} Interessados
            </button>
        </div>

        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Ticket size={14} className="text-emerald-500"/> Ingressos</h3>
                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getSaleStatusClass(eventoSaleStatus)}`}>
                    {getSaleStatusLabel(eventoSaleStatus)}
                </span>
            </div>
            {evento.lotes?.map((l, i) => (
                <div key={i} className={`flex justify-between items-center gap-3 p-4 rounded-xl border ${l.status === 'ativo' && eventoSaleStatus === 'ativo' ? 'bg-zinc-900 border-emerald-500/50' : 'bg-black border-zinc-800 opacity-70'}`}>
                    <div>
                        <p className="text-xs font-black text-white uppercase">{l.nome}</p>
                        {(() => {
                          const priceInfo = resolveLotePriceInfo(l);
                          const hasDiscount = priceInfo.finalPrice < priceInfo.basePrice;
                          return (
                            <div>
                              {hasDiscount ? (
                                <p className="text-[10px] font-bold uppercase text-zinc-500 line-through">
                                  R$ {priceInfo.basePrice.toFixed(2).replace(".", ",")}
                                </p>
                              ) : null}
                              <p className="text-emerald-400 font-bold">R$ {priceInfo.displayPrice}</p>
                              {hasDiscount ? (
                                <p className="text-[10px] font-black uppercase text-emerald-300">
                                  Beneficio {userPlanNames[0]?.trim() || "do seu plano"}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                    </div>
                    {l.status === 'ativo' && eventoSaleStatus === 'ativo' ? 
                        // ID 4: Link atualizado para a nova pagina de compra com query params
                        <Link 
                            href={tenantPath(`/eventos/compra?evento=${evento.id}&lote=${l.id}`)} 
                            className="bg-white text-black px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-400 transition shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                        >
                            Comprar
                        </Link> 
                        : <span className={`text-[10px] font-bold uppercase border px-3 py-1 rounded-lg ${getSaleStatusClass(l.status === 'ativo' ? eventoSaleStatus : l.status)}`}>{getSaleStatusLabel(l.status === 'ativo' ? eventoSaleStatus : l.status)}</span>}
                </div>
            ))}
        </div>

        {/* ENQUETES CARROSSEL */}
        <div className="space-y-4 pt-4 border-t border-zinc-800">
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <MessageCircle size={14} className="text-purple-500"/> Enquete da Galera
                </h3>
                {enquetes.length > 1 && (
                    <div className="flex gap-2">
                        <button onClick={prevPoll} className="p-1 bg-zinc-900 rounded hover:bg-zinc-800 text-zinc-400"><ChevronLeft size={16}/></button>
                        <button onClick={nextPoll} className="p-1 bg-zinc-900 rounded hover:bg-zinc-800 text-zinc-400"><ChevronRight size={16}/></button>
                    </div>
                )}
            </div>

            {currentPoll ? (
                <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 space-y-3 relative overflow-hidden transition-all duration-300">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold text-sm text-white max-w-[80%]">{currentPoll.question || "Qual a boa?"}</h4>
                        <button onClick={() => handleReportPoll(currentPoll.id)} className="text-zinc-600 hover:text-yellow-500"><ShieldAlert size={14}/></button>
                    </div>
                    
             {topTurmasPoll.length > 0 && (
            <div className="flex gap-2 mb-2 items-center bg-black/20 p-2 rounded-lg border border-white/5">
                {topTurmasPoll.map(turma => (
                    <div key={turma} className="flex items-center gap-1">
                        <div className="relative w-5 h-5 rounded-full border border-zinc-700 overflow-hidden">
                            <Image 
                                src={getTurmaImage(turma, "https://github.com/shadcn.png")} 
                                alt={`Turma ${turma}`} 
                                fill
                                sizes="20px"
                                className="object-cover"
                            />
                        </div>
                        <span className="text-[9px] font-bold text-zinc-400">{turma}</span>
                    </div>
                ))}
            </div>
        )}

                    <div className="space-y-2">
                        {sortedPollOptions.map(({ opt, originalIndex }) => {
                            const totalVotes = currentPoll.options.reduce((acc, o) => acc + (o.votes || 0), 0);
                            const percent = totalVotes > 0 ? Math.round(((opt.votes || 0) / totalVotes) * 100) : 0;
                            const userVotedHere = currentPoll.userVotes?.[user?.uid || ""]?.includes(originalIndex);

                            return (
                                <div key={`${opt.text}-${originalIndex}`} className="relative group">
                                    <button 
                                        onClick={() => handleVotePoll(currentPoll.id, originalIndex)} 
                                        className={`w-full relative bg-black rounded overflow-hidden flex justify-between items-center h-10 text-xs hover:bg-zinc-800 transition ${userVotedHere ? 'border border-purple-500/50' : ''}`}
                                        title={`${opt.votes} votos`}
                                    >
                                        <div className={`absolute left-0 top-0 h-full transition-all duration-500 ${userVotedHere ? 'bg-purple-500/40' : 'bg-purple-500/20'}`} style={{ width: `${percent}%` }}></div>
                                        
                                     <div className="relative z-10 pl-3 flex items-center gap-2 max-w-[70%]">
            {opt.creatorAvatar && (
                <Image 
                    src={opt.creatorAvatar} 
                    alt="Criador" 
                    width={20}
                    height={20}
                    className="rounded-full border border-zinc-700 object-cover" 
                    title={`Criado por ${opt.creatorName}`}
                    unoptimized
                />
            )}
            <span className="truncate text-left flex items-center gap-1">
                {opt.text}
                {userVotedHere && <CheckCircle size={10} className="text-purple-400"/>}
            </span>
        </div>
                                        
                                        <span className="relative z-10 pr-3 text-zinc-500 font-bold group-hover:text-purple-400 flex items-center gap-1">
                                            {opt.votes} <span className="text-[8px] font-normal uppercase">Votos</span>
                                        </span>
                                    </button>
                                    
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleReportOption(currentPoll.id, opt.text); }}
                                        className="absolute right-[-20px] top-1/2 -translate-y-1/2 text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                        title="Reportar Opcao"
                                    >
                                        <Flag size={10}/>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    
                    {currentPoll.allowUserOptions ? (
                        <>
                            <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-800/50">
                                <input 
                                    value={newPollOption}
                                    onChange={e => setNewPollOption(e.target.value)}
                                    placeholder="Adicionar resposta..."
                                    className="bg-transparent text-xs text-white border-b border-zinc-700 outline-none flex-1 py-1"
                                    maxLength={EVENT_POLL_OPTION_MAX_CHARS}
                                />
                                <button onClick={() => handleCreatePollOption(currentPoll.id)} className="text-[10px] bg-purple-500/10 text-purple-400 px-2 rounded uppercase font-bold hover:bg-purple-500 hover:text-white transition">Add</button>
                            </div>
                            <p className="text-[8px] text-zinc-600 mt-1 italic text-center">
                                * Cada usuário pode sugerir 1 resposta nova e a enquete aceita até {EVENT_POLL_OPTION_MAX_COUNT} respostas. ({newPollOption.length}/{EVENT_POLL_OPTION_MAX_CHARS})
                            </p>
                        </>
                    ) : (
                        <p className="text-[10px] text-zinc-600 italic text-center pt-2 border-t border-zinc-800/50">
                            Essa enquete esta fechada para novas respostas.
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-[10px] text-zinc-600 italic">Nenhuma enquete ativa no momento.</p>
            )}
        </div>

        {/* COMENTARIOS */}
        <div className="space-y-6 pt-4 border-t border-zinc-800">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Mural do Role</h3>
            
            <div className="flex gap-2">
                <input 
                    value={newComment} 
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Solta o verbo..." 
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 text-sm text-white outline-none focus:border-emerald-500 transition-colors"
                    maxLength={COMMENT_MAX_CHARS}
                />
                <button onClick={handleSendComment} className="bg-emerald-500 p-3 rounded-xl text-black hover:bg-emerald-400 shadow-lg shadow-emerald-900/20">
                    <Send size={18}/>
                </button>
            </div>
            <p className="text-[10px] text-zinc-500 -mt-3">Comentário: {newComment.length}/{COMMENT_MAX_CHARS}</p>

            <div className="space-y-4">
                {orderedComments.map((c) => {
                    const nameColorClass = resolvePlanTextClass(c.userPlanoCor, "text-zinc-300");
                    const likesArray = Array.isArray(c.likes) ? c.likes : [];

                return (!c.hidden || isAdmin) && (
            <div key={c.id} className={`flex gap-3 ${c.hidden ? 'opacity-50 grayscale' : ''}`}>
                <Link href={tenantPath(`/perfil/${c.userId}`)}>
                    <div className="relative group/avatar cursor-pointer">
                        <Image 
                            src={c.userAvatar || "https://github.com/shadcn.png"} 
                            alt={c.userName} 
                            width={40}
                            height={40}
                            className="rounded-full bg-zinc-800 object-cover border border-zinc-800 group-hover/avatar:border-emerald-500 transition-colors"
                        />
                        <div className="absolute -bottom-1 -right-1 h-5 w-5 overflow-hidden rounded-full border border-black bg-zinc-950 shadow-brand">
                            <Image
                                src={getTurmaImage(c.userTurma, "/logo.png")}
                                alt={`Turma ${(c.userTurma || "").trim() || "sem turma"}`}
                                fill
                                sizes="20px"
                                unoptimized
                                className="object-cover"
                            />
                        </div>
                    </div>
                </Link>
                            
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5">
                                            <p className={`text-xs font-black ${nameColorClass} flex items-center gap-1`}>
                                                {c.userName}
                                            </p>
                                            {/* ID 651: Nova logica de badge baseada na config global */}
                                            <UserBadges data={c} patentesConfig={patentesConfig} />
                                        </div>
                                        {/* ID 653: Foto da Turma + Nome */}
                                       <div className="mt-0.5 flex items-center gap-1 opacity-60">
            <span className="text-[9px] font-mono text-zinc-300">{c.userTurma || "Sem turma"}</span>
        </div>
                                    </div>

                                    <div className="flex gap-2 text-zinc-500">
                                        <button onClick={() => handleLikeComment(c.id, c.likes || [], c.userId)} className={`flex items-center gap-1 hover:text-red-500 ${likesArray.includes(user?.uid || "") ? 'text-red-500' : ''}`}>
                                            <Heart size={12} className={likesArray.includes(user?.uid || "") ? "fill-current" : ""}/> 
                                            <span className="text-[9px]">{likesArray.length || 0}</span>
                                        </button>
                                        
                                        <button onClick={() => handleReportComment(c.id)} className="hover:text-yellow-500"><ShieldAlert size={12}/></button>
                                        
                                        {(user?.uid === c.userId || isAdmin) && (
                                            <button onClick={() => handleDeleteComment(c.id)} className="hover:text-red-500 transition-colors" title="Apagar">
                                                <Trash2 size={12}/>
                                            </button>
                                        )}

                                        {isAdmin && (
                                            <button onClick={() => handleToggleHideComment(c.id, c.hidden)} className="hover:text-red-500 opacity-50 hover:opacity-100">
                                                {c.hidden ? <CheckCircle size={12}/> : <div className="w-3 h-3 bg-zinc-700 rounded-full"></div>}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{c.text}</p>
                                {c.hidden && <span className="text-[9px] text-red-500 font-bold uppercase block mt-1 border border-red-900/30 bg-red-900/10 px-2 py-0.5 rounded w-fit">Oculto pelo Admin</span>}
                            </div>
                        </div>
                    );
                })}
                {orderedComments.length === 0 && <p className="text-center text-xs text-zinc-600 py-4">Seja o primeiro a comentar!</p>}
            </div>
        </div>

        <section className="space-y-4 pt-4 border-t border-zinc-800">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <Ticket size={14} className="text-purple-500"/>
                Seus Pedidos
            </h3>

            {pendingPedidos.length > 0 && (
                <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase text-yellow-400">Pendentes</p>
                    {pendingPedidos.map((pedido) => {
                        const payment = resolvePedidoPaymentConfig(pedido);
                        const pedidoWhatsapp = keepDigits(payment.whatsapp || "");
                        const pedidoTotal = formatCurrencyValue(pedido.valorTotal);

                        return (
                            <article
                                key={pedido.id}
                                className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-bold text-white">
                                            Pedido #{pedido.id.slice(0, 8).toUpperCase()}
                                        </p>
                                        <p className="text-xs text-zinc-400">
                                            {formatPedidoDateTime(pedido.dataSolicitacao)}
                                        </p>
                                    </div>
                                    <span
                                        className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${getPedidoStatusClass(pedido.status)}`}
                                    >
                                        {getPedidoStatusLabel(pedido.status)}
                                    </span>
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <p className="text-xs text-zinc-300">
                                        {pedido.quantidade}x {pedido.loteNome} • R$ {pedidoTotal}
                                    </p>
                                    <button
                                        onClick={() => void handleCancelOrder(pedido.id)}
                                        className="inline-flex items-center gap-1 text-xs font-black uppercase text-red-400 hover:text-red-300"
                                    >
                                        <X size={12}/>
                                        Cancelar pedido
                                    </button>
                                </div>

                                <div className="mt-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                                    <div className="flex items-center gap-2">
                                        <Wallet size={14} className="text-emerald-400" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                            Informações do PIX
                                        </p>
                                    </div>

                                    <div className="mt-3 space-y-2 text-xs">
                                        <div>
                                            <p className="text-[10px] font-black uppercase text-zinc-500">
                                                Chave PIX
                                            </p>
                                            <p className="mt-1 break-all rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-zinc-100">
                                                {payment.chave || "Consulte o financeiro"}
                                            </p>
                                        </div>

                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                    Banco
                                                </p>
                                                <p className="mt-1 font-bold text-zinc-200">
                                                    {payment.banco || "--"}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                    Titular
                                                </p>
                                                <p className="mt-1 font-bold text-zinc-200">
                                                    {payment.titular || "--"}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                Envie o comprovante para
                                            </p>
                                            <p className="mt-1 font-bold text-zinc-200">
                                                {payment.whatsapp || "(Consulte a diretoria)"}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => void handleCopyPedidoPix(pedido)}
                                                disabled={!payment.chave}
                                                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                                            >
                                                <Copy size={12} />
                                                Copiar PIX
                                            </button>
                                        </div>
                                        {pedidoWhatsapp ? (
                                            <ReceiptContactButton
                                                recipient={resolveReceiptContactProfile({
                                                    paymentConfig: payment,
                                                    tenantSigla,
                                                    tenantName,
                                                    fallbackAvatarUrl: evento?.imagem || "/logo.png",
                                                    fallbackPhone: payment.whatsapp || contatoFinanceiro,
                                                })}
                                                onClick={() => handleSendPedidoReceiptWhatsapp(pedido)}
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {historyPedidos.length > 0 && (
                <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase text-zinc-400">Finalizados</p>
                    {historyPedidos.map((pedido) => (
                        <article
                            key={pedido.id}
                            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-bold text-white">
                                        Pedido #{pedido.id.slice(0, 8).toUpperCase()}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                        {formatPedidoDateTime(
                                            pedido.dataAprovacao || pedido.dataSolicitacao
                                        )}
                                    </p>
                                </div>
                                <span
                                    className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${getPedidoStatusClass(pedido.status)}`}
                                >
                                    {getPedidoStatusLabel(pedido.status)}
                                </span>
                            </div>

                            <div className="mt-3 text-xs text-zinc-300">
                                {pedido.quantidade}x {pedido.loteNome} • R$ {formatCurrencyValue(pedido.valorTotal)}
                            </div>
                            <Link
                                href={
                                    tenantSlug
                                        ? withTenantSlug(
                                              tenantSlug,
                                              `/configuracoes/pedidos/eventos?pedido=${encodeURIComponent(pedido.id)}`
                                          )
                                        : `/configuracoes/pedidos/eventos?pedido=${encodeURIComponent(pedido.id)}`
                                }
                                className="mt-3 inline-flex items-center gap-2 text-[11px] font-black uppercase text-emerald-400 hover:text-emerald-300"
                            >
                                Ver pedido / ingresso
                            </Link>
                        </article>
                    ))}
                </div>
            )}

            {pendingPedidos.length === 0 && historyPedidos.length === 0 && (
                <div className="rounded-xl border border-zinc-800 p-4 text-xs text-zinc-500">
                    Você ainda não fez pedidos deste evento.
                </div>
            )}
        </section>

      </div>

      {modalUsersType && (
          <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-zinc-950 w-full max-w-sm rounded-3xl border border-zinc-800 max-h-[70vh] flex flex-col shadow-2xl">
                  <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 rounded-t-3xl">
                      <h3 className="font-bold text-white uppercase tracking-wider text-sm flex items-center gap-2">
                          {modalUsersType === 'going' ? <CheckCircle size={16} className="text-emerald-500"/> : <HelpCircle size={16} className="text-yellow-500"/>}
                          {modalUsersType === 'going' ? 'Confirmados' : 'Interessados'}
                      </h3>
                      <button onClick={() => setModalUsersType(null)} className="p-2 hover:bg-zinc-800 rounded-full transition"><XCircle size={20} className="text-zinc-500"/></button>
                  </div>
        <div className="p-2 overflow-y-auto space-y-1 custom-scrollbar flex-1">
                      {modalUsers.map((u, i) => (
                          <Link key={i} href={tenantPath(`/perfil/${u.userId}`)} className="flex items-center gap-3 p-3 hover:bg-zinc-900 rounded-2xl transition group">
                           <div className="relative">
            <Image 
                src={u.userAvatar || "https://github.com/shadcn.png"} 
                alt={u.userName} 
                width={40}
                height={40}
                className="rounded-full object-cover border-2 border-zinc-800 group-hover:border-brand transition-colors"
            />
            <div className="absolute -bottom-1 -right-1 h-5 w-5 overflow-hidden rounded-full border border-black bg-zinc-950 shadow-brand">
                <Image
                    src={getTurmaImage(u.userTurma, "/logo.png")}
                    alt={`Turma ${(u.userTurma || "").trim() || "sem turma"}`}
                    fill
                    sizes="20px"
                    unoptimized
                    className="object-cover"
                />
            </div>
        </div>
                              <div className="flex-1">
                                  <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{u.userName}</p>
                                  <p className="text-[10px] text-zinc-500 uppercase font-bold">{(u.userTurma || "").trim() || "Sem turma"} • Ver Perfil</p>
                              </div>
                              <ArrowLeft size={16} className="rotate-180 text-zinc-700 group-hover:text-white transition-colors"/>
                          </Link>
                      ))}
                      {modalUsers.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-12 text-zinc-600 gap-2">
                              <Users size={32} className="opacity-20"/>
                              <p className="text-xs">Ninguém nesta lista ainda.</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
