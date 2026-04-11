// src/app/loja/[id]/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  cancelStoreOrderRequest,
  createStoreOrder,
  fetchStoreProductDetail,
  toggleStoreProductLike,
} from "../../../lib/storePublicService";
import {
  ArrowLeft,
  Copy,
  Heart,
  Loader2,
  MessageCircle,
  Minimize2,
  ShoppingBag,
  Wallet,
  X,
  ZoomIn,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { fetchFinanceiroConfig } from "../../../lib/eventsService";
import { buildLoginPath } from "@/lib/authRedirect";
import {
  fetchMiniVendorProfileById,
  resolveMiniVendorPaymentConfig,
} from "@/lib/miniVendorService";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import { collectUserPlanScope } from "@/lib/userPlanScope";
import { isAdminLikeRole, resolveEffectiveAccessRole } from "@/lib/roles";
import {
  buildTenantFinanceFallback,
  resolveTenantBrandLabel,
} from "../../../lib/tenantBranding";

interface ProdutoVariante {
  id?: string;
  cor?: string;
  tamanho?: string;
  estoque?: number;
  vendidos?: number;
}

interface Produto {
  id: string;
  nome: string;
  preco: number;
  preco_base?: number;
  precoAntigo?: number;
  img: string;
  descricao: string;
  likes: string[];
  categoria: string;
  estoque?: number;
  cores?: string | string[];
  variantes?: ProdutoVariante[];
  caracteristicas?: string[];
  status?: "ativo" | "em_breve" | "esgotado";
  payment_config?: PixData | null;
  seller?: {
    type: "tenant" | "mini_vendor";
    id: string;
    name: string;
    logoUrl: string;
  } | null;
}

interface Order {
  id: string;
  userId: string;
  userName: string;
  userTurma?: string;
  productId: string;
  productName: string;
  price: number;
  total?: number;
  quantidade?: number;
  itens?: number;
  data?: Record<string, unknown>;
  payment_config?: PixData | null;
  status: "pendente" | "approved" | "rejected" | "delivered" | "cancelado";
  createdAt: DateLike | null;
  updatedAt?: DateLike | null;
}

interface DateLike {
  toDate: () => Date;
}

interface PixData {
  chave: string;
  banco: string;
  titular: string;
  whatsapp?: string;
}

const getAvailabilityLabel = (status?: Produto["status"]): string => {
  if (status === "em_breve") return "Em-breve";
  if (status === "esgotado") return "Esgotado";
  return "Ativo";
};

const getAvailabilityClass = (status?: Produto["status"]): string => {
  if (status === "em_breve") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (status === "esgotado") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

const parseColorLines = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry): entry is string => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter((entry): entry is string => entry.length > 0);
  }
  return [];
};

const orderStatusLabel = (status: Order["status"]): string => {
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Rejeitado";
  if (status === "delivered") return "Entregue";
  if (status === "cancelado") return "Cancelado";
  return "Pendente";
};

const orderStatusClass = (status: Order["status"]): string => {
  if (status === "approved" || status === "delivered") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  }
  if (status === "rejected" || status === "cancelado") {
    return "bg-red-500/10 text-red-400 border-red-500/30";
  }
  return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
};

const orderMillis = (value?: DateLike | null): number => {
  if (!value) return 0;
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  return 0;
};

const formatOrderDateTime = (value?: DateLike | null): string => {
  if (!value || typeof value.toDate !== "function") return "--";
  const date = value.toDate();
  return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export default function DetalheProdutoPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSigla, tenantName, tenantSlug, tenantLogoUrl } = useTenantTheme();
  const { userPlanNames, userPlanIds } = useMemo(() => collectUserPlanScope(user), [user]);
  const isPrivilegedViewer = useMemo(
    () => isAdminLikeRole(resolveEffectiveAccessRole(user)),
    [user]
  );
  const effectiveUserPlanNames = useMemo(
    () => (isPrivilegedViewer ? [] : userPlanNames),
    [isPrivilegedViewer, userPlanNames]
  );
  const effectiveUserPlanIds = useMemo(
    () => (isPrivilegedViewer ? [] : userPlanIds),
    [isPrivilegedViewer, userPlanIds]
  );

  const [produto, setProduto] = useState<Produto | null>(null);
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<1 | 2 | 3>(1);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null);
  const [checkoutQuantity, setCheckoutQuantity] = useState(1);
  const [checkoutColor, setCheckoutColor] = useState("");
  const [pixData, setPixData] = useState<PixData>({
    chave: "Carregando...",
    banco: "...",
    titular: "...",
    whatsapp: "",
  });
  const [loadingPixData, setLoadingPixData] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isImageViewerZoomed, setIsImageViewerZoomed] = useState(false);

  const checkoutTotal = useMemo(
    () => Number((Number(produto?.preco || 0) * checkoutQuantity).toFixed(2)),
    [produto?.preco, checkoutQuantity]
  );

  const resolveOrderColor = useCallback((order?: Order | null): string => {
    const rawData = order?.data;
    if (!rawData || typeof rawData !== "object") return "";
    const selectedColor = rawData["corSelecionada"];
    return typeof selectedColor === "string" ? selectedColor.trim() : "";
  }, []);

  const availableColors = useMemo(() => {
    if (!produto) return [] as string[];
    const variantColors = Array.isArray(produto.variantes)
      ? produto.variantes
          .map((variant) => (typeof variant?.cor === "string" ? variant.cor.trim() : ""))
          .filter((entry): entry is string => entry.length > 0)
      : [];
    const manualColors = parseColorLines(produto.cores);
    return Array.from(new Set([...variantColors, ...manualColors]));
  }, [produto]);

  const availableSizes = useMemo(() => {
    if (!produto || !Array.isArray(produto.variantes)) return [] as string[];
    return Array.from(
      new Set(
        produto.variantes
          .map((variant) => (typeof variant?.tamanho === "string" ? variant.tamanho.trim() : ""))
          .filter((entry): entry is string => entry.length > 0)
      )
    );
  }, [produto]);

  const totalStock = useMemo(() => {
    if (!produto) return 0;
    if (Array.isArray(produto.variantes) && produto.variantes.length > 0) {
      return produto.variantes.reduce((acc, variant) => {
        const stock = typeof variant.estoque === "number" && Number.isFinite(variant.estoque) ? variant.estoque : 0;
        return acc + stock;
      }, 0);
    }
    return typeof produto.estoque === "number" && Number.isFinite(produto.estoque) ? produto.estoque : 0;
  }, [produto]);

  const selectedColorStock = useMemo(() => {
    if (!produto) return 0;
    if (!checkoutColor.trim()) return -1;
    if (!Array.isArray(produto.variantes) || produto.variantes.length === 0) return -1;
    const normalizedSelected = checkoutColor.trim().toLowerCase();
    const matching = produto.variantes.filter(
      (variant) => typeof variant.cor === "string" && variant.cor.trim().toLowerCase() === normalizedSelected
    );
    if (matching.length === 0) return -1;
    return matching.reduce((acc, variant) => {
      const stock = typeof variant.estoque === "number" && Number.isFinite(variant.estoque) ? variant.estoque : 0;
      return acc + stock;
    }, 0);
  }, [checkoutColor, produto]);

  const effectiveCheckoutStock = selectedColorStock >= 0 ? selectedColorStock : totalStock;
  const isSelectedColorUnavailable = checkoutColor.trim().length > 0 && selectedColorStock === 0;
  const checkoutMaxQuantity = useMemo(() => Math.max(1, Math.min(10, effectiveCheckoutStock || 1)), [effectiveCheckoutStock]);
  const saleStatus = produto?.status || "ativo";
  const isOutOfStock = totalStock <= 0 || saleStatus === "esgotado";
  const isComingSoon = saleStatus === "em_breve";

  const productId = typeof params.id === "string" ? params.id : "";
  const financeFallback = useMemo(
    () =>
      buildTenantFinanceFallback({
        tenantSigla,
        tenantName,
      }),
    [tenantName, tenantSigla]
  );
  const brandLabel = useMemo(
    () => resolveTenantBrandLabel(tenantSigla, tenantName),
    [tenantName, tenantSigla]
  );
  const resolveOrderPaymentConfig = useCallback(
    (order?: Order | null): PixData => {
      const rawConfig =
        order?.payment_config && typeof order.payment_config === "object"
          ? order.payment_config
          : null;

      return {
        chave:
          typeof rawConfig?.chave === "string" && rawConfig.chave.trim()
            ? rawConfig.chave.trim()
            : pixData.chave,
        banco:
          typeof rawConfig?.banco === "string" && rawConfig.banco.trim()
            ? rawConfig.banco.trim()
            : pixData.banco,
        titular:
          typeof rawConfig?.titular === "string" && rawConfig.titular.trim()
            ? rawConfig.titular.trim()
            : pixData.titular,
        whatsapp:
          typeof rawConfig?.whatsapp === "string" && rawConfig.whatsapp.trim()
            ? rawConfig.whatsapp.trim()
            : pixData.whatsapp || financeFallback.whatsapp,
      };
    },
    [financeFallback.whatsapp, pixData]
  );
  const sellerLogo = produto?.seller?.logoUrl || tenantLogoUrl || "/logo.png";
  const sellerName = produto?.seller?.name || brandLabel;
  const sellerProfileHref =
    produto?.seller?.type === "mini_vendor" && produto.seller.id
      ? tenantSlug
        ? withTenantSlug(tenantSlug, `/perfil/mini-vendor/${produto.seller.id}`)
        : `/perfil/mini-vendor/${produto.seller.id}`
      : "";

  useEffect(() => {
    setCheckoutQuantity((prev) => Math.min(prev, checkoutMaxQuantity));
  }, [checkoutMaxQuantity]);

  const refreshProductData = useCallback(
    async (forceRefresh = true) => {
      if (!productId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const bundle = await fetchStoreProductDetail({
          productId,
          userId: user?.uid || null,
          reviewsLimit: 0,
          ordersLimit: 50,
          forceRefresh,
          tenantId: tenantId || undefined,
          userPlanNames: effectiveUserPlanNames,
          userPlanIds: effectiveUserPlanIds,
        });

        setProduto(bundle.produto as unknown as Produto | null);

        const ordersList = (bundle.userOrders as unknown as Order[]).sort(
          (left, right) => orderMillis(right.createdAt) - orderMillis(left.createdAt)
        );
        setUserOrders(ordersList);
      } catch (error: unknown) {
        console.error(error);
        addToast("Erro ao carregar produto.", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast, effectiveUserPlanIds, effectiveUserPlanNames, productId, tenantId, user?.uid]
  );

  useEffect(() => {
    void refreshProductData(true);
  }, [refreshProductData]);

  const pendingOrders = useMemo(
    () => userOrders.filter((order) => order.status === "pendente"),
    [userOrders]
  );

  const historyOrders = useMemo(
    () => userOrders.filter((order) => order.status !== "pendente"),
    [userOrders]
  );

  const handleLike = async () => {
    if (!user || !produto) return;
    const isLiked = produto.likes?.includes(user.uid);

    try {
      await toggleStoreProductLike({
        productId: produto.id,
        userId: user.uid,
        currentlyLiked: Boolean(isLiked),
        tenantId: tenantId || undefined,
      });

      setProduto((prev) => {
        if (!prev) return prev;
        const likes = Array.isArray(prev.likes) ? [...prev.likes] : [];
        if (isLiked) {
          return { ...prev, likes: likes.filter((entry) => entry !== user.uid) };
        }
        return { ...prev, likes: [...likes, user.uid] };
      });
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao curtir produto.", "error");
    }
  };

  const loadStorePixData = useCallback(async () => {
    if (loadingPixData) return;
    if (produto?.payment_config) {
      setPixData(produto.payment_config);
      return;
    }
    setLoadingPixData(true);
    try {
      if (
        tenantId &&
        produto?.seller?.type === "mini_vendor" &&
        produto.seller.id
      ) {
        const sellerProfile = await fetchMiniVendorProfileById({
          tenantId,
          miniVendorId: produto.seller.id,
          forceRefresh: false,
        });
        const sellerPayment = resolveMiniVendorPaymentConfig(sellerProfile);
        if (sellerPayment) {
          setPixData({
            chave: typeof sellerPayment.chave === "string" ? sellerPayment.chave : "",
            banco: typeof sellerPayment.banco === "string" ? sellerPayment.banco : "",
            titular: typeof sellerPayment.titular === "string" ? sellerPayment.titular : "",
            whatsapp: typeof sellerPayment.whatsapp === "string" ? sellerPayment.whatsapp : "",
          });
          return;
        }
      }

      const financeiro = await fetchFinanceiroConfig({
        forceRefresh: false,
        tenantId: tenantId || undefined,
      });
      const chave =
        typeof financeiro?.chave === "string" && financeiro.chave.trim()
          ? financeiro.chave.trim()
          : financeFallback.chave;
      const banco =
        typeof financeiro?.banco === "string" && financeiro.banco.trim()
          ? financeiro.banco.trim()
          : financeFallback.banco;
      const titular =
        typeof financeiro?.titular === "string" && financeiro.titular.trim()
          ? financeiro.titular.trim()
          : financeFallback.titular;
      const whatsapp =
        typeof financeiro?.whatsapp === "string" && financeiro.whatsapp.trim()
          ? financeiro.whatsapp.trim()
          : financeFallback.whatsapp;

      setPixData({ chave, banco, titular, whatsapp });
    } catch (error: unknown) {
      console.error(error);
      setPixData(financeFallback);
    } finally {
      setLoadingPixData(false);
    }
  }, [
    financeFallback,
    loadingPixData,
    produto?.payment_config,
    produto?.seller?.id,
    produto?.seller?.type,
    tenantId,
  ]);

  const handleBuy = async () => {
    if (!user || !produto) {
      router.push(
        buildLoginPath(
          tenantSlug
            ? withTenantSlug(tenantSlug, `/loja/${String(params?.id || "")}`)
            : `/loja/${String(params?.id || "")}`
        )
      );
      return;
    }
    if (isComingSoon) {
      addToast("Este produto ainda esta em breve para o seu acesso.", "info");
      return;
    }
    if (isOutOfStock || isSelectedColorUnavailable) {
      addToast("Produto esgotado no momento.", "info");
      return;
    }
    setCheckoutStep(1);
    setCheckoutOrderId(null);
    setCheckoutQuantity(1);
    setCheckoutColor("");
    setCheckoutOpen(true);
    void loadStorePixData();
  };

  const handleCheckoutConfirmOrder = async () => {
    if (!user || !produto || creatingOrder) return;
    if (isOutOfStock || isSelectedColorUnavailable) {
      addToast("Produto esgotado no momento.", "error");
      return;
    }
    if (checkoutQuantity < 1 || checkoutQuantity > checkoutMaxQuantity) {
      addToast("Quantidade invalida para o estoque atual.", "error");
      return;
    }

    setCreatingOrder(true);
    try {
      const order = await createStoreOrder({
        userId: user.uid,
        userName: user.nome || "Aluno",
        productId: produto.id,
        productName: produto.nome,
        price: produto.preco,
        quantity: checkoutQuantity,
        color: checkoutColor,
        tenantId: tenantId || undefined,
        userPlanNames,
        userPlanIds,
        paymentConfig: produto.payment_config ? { ...produto.payment_config } : null,
      });

      setCheckoutOrderId(order.id);
      setCheckoutStep(2);
      addToast("Pedido gerado! Agora envie o comprovante.", "success");
      await refreshProductData(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao realizar pedido.", "error");
    } finally {
      setCreatingOrder(false);
    }
  };

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(pixData.chave);
      addToast("Chave PIX copiada!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Nao foi possivel copiar a chave PIX.", "error");
    }
  };

  const handleSendReceiptWhatsapp = () => {
    if (!produto || !checkoutOrderId) return;
    const adminPhone = (pixData.whatsapp || financeFallback.whatsapp).replace(/\D/g, "");
    const buyerName = user?.nome?.trim() || "Cliente";
    const buyerTurma = user?.turma?.trim() || "Sem turma";
    const buyerPhone = user?.telefone?.trim() || "Nao informado";
    const message = `Fala, equipe ${sellerName}! Quero finalizar a compra do produto *${produto.nome}*.\n\n[CLIENTE] ${buyerName}\n[TURMA] ${buyerTurma}\n[CONTATO] ${buyerPhone}\n[PRODUTO] ${produto.nome}\n[QTD] ${checkoutQuantity}\n${checkoutColor.trim() ? `[COR] ${checkoutColor.trim()}\n` : ""}[VALOR] R$ ${checkoutTotal.toFixed(2)}\n[PEDIDO] ${checkoutOrderId.slice(0, 8).toUpperCase()}\n\nSegue o comprovante do PIX!`;
    const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
    setCheckoutStep(3);
  };

  const handleOpenImageViewer = () => {
    setIsImageViewerZoomed(false);
    setIsImageViewerOpen(true);
  };

  const handleCopyOrderPix = async (order: Order) => {
    try {
      await navigator.clipboard.writeText(resolveOrderPaymentConfig(order).chave);
      addToast("Chave PIX copiada!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Nao foi possivel copiar a chave PIX.", "error");
    }
  };

  const handleSendOrderReceiptWhatsapp = (order: Order) => {
    if (!produto) return;
    const payment = resolveOrderPaymentConfig(order);
    const adminPhone = (payment.whatsapp || financeFallback.whatsapp).replace(/\D/g, "");
    if (!adminPhone) {
      addToast("WhatsApp financeiro nao configurado para este pedido.", "error");
      return;
    }

    const quantity = Number(order.quantidade || order.itens || 1);
    const total = Number((order.total ?? order.price) || 0).toFixed(2);
    const selectedColor = resolveOrderColor(order);
    const buyerName = user?.nome?.trim() || order.userName || "Cliente";
    const buyerTurma = user?.turma?.trim() || order.userTurma || "Sem turma";
    const buyerPhone = user?.telefone?.trim() || "Nao informado";
    const message = `Fala, equipe ${sellerName}! Quero finalizar a compra do produto *${produto.nome}*.\n\n[CLIENTE] ${buyerName}\n[TURMA] ${buyerTurma}\n[CONTATO] ${buyerPhone}\n[PRODUTO] ${produto.nome}\n[QTD] ${quantity}\n${selectedColor ? `[COR] ${selectedColor}\n` : ""}[VALOR] R$ ${total}\n[PEDIDO] ${order.id.slice(0, 8).toUpperCase()}\n\nSegue o comprovante do PIX!`;
    const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!orderId || cancellingOrderId) return;

    const confirmed = window.confirm("Cancelar este pedido pendente?");
    if (!confirmed) return;

    setCancellingOrderId(orderId);
    try {
      await cancelStoreOrderRequest(orderId);
      addToast("Pedido cancelado.", "info");
      await refreshProductData(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Nao foi possivel cancelar agora.", "error");
    } finally {
      setCancellingOrderId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!produto) {
    return (
      <div className="h-screen bg-[#050505] flex items-center justify-center text-white">
        Produto nao encontrado.
      </div>
    );
  }

  const isLiked = produto.likes?.includes(user?.uid || "");
  const basePrice = Number(produto.preco_base ?? produto.preco);
  const finalPrice = Number(produto.preco);
  const hasPlanBenefit = finalPrice < basePrice;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-10 font-sans selection:bg-emerald-500/30">
      <div className="relative w-full h-[45vh] bg-black">
        <Image
          src={produto.img}
          alt={produto.nome}
          fill
          priority
          className="object-cover"
          sizes="100vw"
          onClick={handleOpenImageViewer}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent z-10" />
        <button
          onClick={() => router.back()}
          className="absolute top-6 left-6 z-20 bg-black/40 backdrop-blur-md p-3 rounded-full text-white hover:bg-zinc-800 transition border border-white/10"
        >
          <ArrowLeft size={24} />
        </button>
        <button
          onClick={handleOpenImageViewer}
          className="absolute top-6 right-24 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-black uppercase text-white backdrop-blur-md transition hover:bg-zinc-800"
        >
          <ZoomIn size={16} />
          Ver melhor
        </button>
        <button
          onClick={handleLike}
          className="absolute top-6 right-6 z-20 bg-black/40 backdrop-blur-md p-3 rounded-full text-white hover:scale-110 transition border border-white/10"
        >
          <Heart size={24} className={isLiked ? "fill-red-500 text-red-500" : "text-white"} />
        </button>
      </div>

      <div className="relative z-30 -mt-10 bg-[#050505] rounded-t-[2.5rem] border-t border-white/10 p-6 shadow-2xl min-h-[60vh]">
        <div className="flex justify-between items-start mb-6">
          <div>
            <span className="text-[10px] font-black uppercase text-emerald-500 tracking-widest bg-emerald-900/20 px-2 py-1 rounded border border-emerald-500/20">
              {produto.categoria}
            </span>
            <div className="mt-3 flex items-center gap-3">
              {sellerProfileHref ? (
                <Link
                  href={sellerProfileHref}
                  className="inline-flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 transition hover:border-blue-500/30 hover:bg-blue-500/10"
                >
                  <div className="relative h-10 w-10 overflow-hidden rounded-full border border-zinc-700 bg-black">
                    <Image src={sellerLogo} alt={sellerName} fill sizes="40px" className="object-cover" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Mini vendor
                    </p>
                    <p className="text-sm font-bold text-zinc-200">{sellerName}</p>
                  </div>
                </Link>
              ) : (
                <>
                  <div className="relative h-10 w-10 overflow-hidden rounded-full border border-zinc-700 bg-black">
                    <Image src={sellerLogo} alt={sellerName} fill sizes="40px" className="object-cover" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Loja da atletica
                    </p>
                    <p className="text-sm font-bold text-zinc-200">{sellerName}</p>
                  </div>
                </>
              )}
            </div>
            <h1 className="text-3xl font-black text-white italic uppercase mt-2 leading-none">{produto.nome}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Heart size={14} className="text-red-500 fill-red-500" />
              <span className="text-xs text-zinc-400 font-bold">{produto.likes?.length || 0} curtidas</span>
            </div>
          </div>
          <div className="text-right">
            {hasPlanBenefit ? (
              <p className="text-xs font-bold uppercase text-zinc-500 line-through">
                R$ {basePrice.toFixed(2)}
              </p>
            ) : null}
            <p className="text-3xl font-black text-emerald-400">R$ {finalPrice.toFixed(2)}</p>
            {hasPlanBenefit ? (
              <p className="mt-1 text-[10px] font-black uppercase text-emerald-300">
                Beneficio {userPlanNames[0]?.trim() || "do seu plano"}
              </p>
            ) : null}
            <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${getAvailabilityClass(saleStatus)}`}>
              {getAvailabilityLabel(saleStatus)}
            </span>
          </div>
        </div>

        <div className="mb-6 border-b border-zinc-800 pb-3">
          <span className="text-sm font-bold uppercase tracking-wide text-white">Detalhes</span>
        </div>

        <div className="space-y-6 animate-in fade-in">
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{produto.descricao}</p>

            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase">
                <span className="px-2 py-1 rounded-md border border-zinc-700 bg-black text-zinc-300">
                  Estoque disponivel
                </span>
                {isComingSoon && (
                  <span className="px-2 py-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">
                    Liberacao em breve
                  </span>
                )}
                {isOutOfStock && (
                  <span className="px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-300">
                    Esgotado
                  </span>
                )}
              </div>

              {availableColors.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500 mb-2">Cores disponiveis</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableColors.map((color) => (
                      <span
                        key={`color-${color}`}
                        className="px-2.5 py-1 rounded-md border border-zinc-700 bg-black text-[10px] font-bold uppercase text-zinc-300"
                      >
                        {color}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {availableSizes.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500 mb-2">Tamanhos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSizes.map((size) => (
                      <span
                        key={`size-${size}`}
                        className="px-2.5 py-1 rounded-md border border-zinc-700 bg-black text-[10px] font-bold uppercase text-zinc-300"
                      >
                        {size}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(produto.caracteristicas) && produto.caracteristicas.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500 mb-2">Caracteristicas</p>
                  <ul className="space-y-1">
                    {produto.caracteristicas
                      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                      .slice(0, 6)
                      .map((item) => (
                        <li key={item} className="text-xs text-zinc-300">
                          • {item}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>

            <button
              onClick={handleBuy}
              disabled={isOutOfStock || isComingSoon}
              className="w-full py-4 bg-emerald-600 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-3 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20 active:scale-95 text-white disabled:opacity-50 disabled:hover:bg-emerald-600"
            >
              <ShoppingBag size={20} /> {isComingSoon ? "Produto em breve" : isOutOfStock ? "Produto Esgotado" : "Comprar Agora"}
            </button>

            <Link
              href={tenantSlug ? withTenantSlug(tenantSlug, `/loja/${produto.id}/review`) : `/loja/${produto.id}/review`}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase hover:border-emerald-500/40 hover:text-emerald-300 transition"
            >
              Avaliacoes
            </Link>

            <section className="space-y-4 pt-2 border-t border-zinc-800">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Seus pedidos</h3>

              {pendingOrders.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] uppercase font-black text-yellow-400">Pendentes</p>
                  {pendingOrders.map((order) => (
                    <article key={order.id} className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white">Pedido #{order.id.slice(0, 8).toUpperCase()}</p>
                          <p className="text-xs text-zinc-400">{formatOrderDateTime(order.createdAt)}</p>
                        </div>
                        <span className="text-[10px] font-black uppercase px-2 py-1 rounded border bg-yellow-500/10 text-yellow-300 border-yellow-500/30">
                          Pendente
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-zinc-300">
                          Qtd: {Number(order.quantidade || order.itens || 1)} • R$ {Number((order.total ?? order.price) || 0).toFixed(2)}
                        </p>
                        <button
                          onClick={() => void handleCancelOrder(order.id)}
                          disabled={cancellingOrderId === order.id}
                          className="text-xs font-black uppercase text-red-400 hover:text-red-300 disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {cancellingOrderId === order.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                          Cancelar pedido
                        </button>
                      </div>
                      {(() => {
                        const payment = resolveOrderPaymentConfig(order);
                        const orderColor = resolveOrderColor(order);
                        const orderWhatsapp = (payment.whatsapp || financeFallback.whatsapp).replace(/\D/g, "");
                        return (
                          <div className="mt-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                            <div className="flex items-center gap-2">
                              <Wallet size={14} className="text-emerald-400" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                Informacoes do PIX
                              </p>
                            </div>
                            <div className="mt-3 space-y-2 text-xs">
                              <div>
                                <p className="text-zinc-500 font-bold uppercase text-[10px]">Chave PIX</p>
                                <p className="mt-1 break-all rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-zinc-100">
                                  {payment.chave || "Consulte o financeiro"}
                                </p>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Banco</p>
                                  <p className="mt-1 font-bold text-zinc-200">{payment.banco || "--"}</p>
                                </div>
                                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Titular</p>
                                  <p className="mt-1 font-bold text-zinc-200">{payment.titular || "--"}</p>
                                </div>
                              </div>
                              {orderColor ? (
                                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Cor enviada</p>
                                  <p className="mt-1 font-bold text-zinc-200">{orderColor}</p>
                                </div>
                              ) : null}
                              <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => void handleCopyOrderPix(order)}
                                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase text-zinc-200 hover:bg-zinc-800"
                                >
                                  <Copy size={12} />
                                  Copiar PIX
                                </button>
                                {orderWhatsapp ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSendOrderReceiptWhatsapp(order)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-3 py-2 text-[10px] font-black uppercase text-[#8bf0b0] hover:bg-[#25D366]/20"
                                  >
                                    <MessageCircle size={12} />
                                    Enviar comprovante
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </article>
                  ))}
                </div>
              )}

              {historyOrders.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] uppercase font-black text-zinc-400">Finalizados</p>
                  {historyOrders.map((order) => (
                    <article key={order.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white">Pedido #{order.id.slice(0, 8).toUpperCase()}</p>
                          <p className="text-xs text-zinc-500">{formatOrderDateTime(order.updatedAt || order.createdAt)}</p>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded border ${orderStatusClass(order.status)}`}>
                          {orderStatusLabel(order.status)}
                        </span>
                      </div>
                      <div className="mt-3 text-xs text-zinc-300">
                        Qtd: {Number(order.quantidade || order.itens || 1)} • R$ {Number((order.total ?? order.price) || 0).toFixed(2)}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {pendingOrders.length === 0 && historyOrders.length === 0 && (
                <div className="p-4 rounded-xl border border-zinc-800 text-zinc-500 text-xs">
                  Voce ainda nao fez pedidos deste produto.
                </div>
              )}
            </section>
        </div>
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0b0b0c] shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Checkout da Loja</p>
                <h3 className="text-sm font-black uppercase text-white">
                  {checkoutStep === 1 ? "Confirmar Pedido" : checkoutStep === 2 ? "Pagamento via PIX" : "Pedido Registrado"}
                </h3>
              </div>
              <button
                onClick={() => {
                  if (creatingOrder) return;
                  setCheckoutOpen(false);
                  setCheckoutStep(1);
                }}
                className="p-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-4 pt-4">
              <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: checkoutStep === 1 ? "33%" : checkoutStep === 2 ? "66%" : "100%" }}
                />
              </div>
            </div>

            <div className="p-4 space-y-4">
              {checkoutStep === 1 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-400 font-bold uppercase">Produto</span>
                      <span className="text-sm font-bold text-white text-right">{produto.nome}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-400 font-bold uppercase">Quantidade</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCheckoutQuantity((prev) => Math.max(1, prev - 1))}
                          disabled={checkoutQuantity <= 1}
                          className="w-7 h-7 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-black"
                        >
                          -
                        </button>
                        <span className="text-sm font-bold text-white w-5 text-center">{checkoutQuantity}</span>
                        <button
                          onClick={() => setCheckoutQuantity((prev) => Math.min(checkoutMaxQuantity, prev + 1))}
                          disabled={checkoutQuantity >= checkoutMaxQuantity || isOutOfStock}
                          className="w-7 h-7 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-black disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500">
                      {isOutOfStock
                        ? "Sem estoque disponivel no momento."
                        : isSelectedColorUnavailable
                        ? "Sem estoque para a cor selecionada."
                        : "Estoque confirmado para este pedido."}
                    </p>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400 font-bold uppercase">Cor (opcional)</label>
                      <input
                        value={checkoutColor}
                        onChange={(e) => setCheckoutColor(e.target.value)}
                        placeholder="Ex: Preto, Verde, Azul"
                        className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                      />
                      {availableColors.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {availableColors.map((color) => {
                            const active = checkoutColor.trim().toLowerCase() === color.toLowerCase();
                            return (
                              <button
                                key={`checkout-color-${color}`}
                                type="button"
                                onClick={() => setCheckoutColor(color)}
                                className={`px-2 py-1 rounded-md border text-[10px] font-black uppercase transition ${
                                  active
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                    : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                                }`}
                              >
                                {color}
                              </button>
                            );
                          })}
                          {!!checkoutColor.trim() && (
                            <button
                              type="button"
                              onClick={() => setCheckoutColor("")}
                              className="px-2 py-1 rounded-md border border-zinc-700 bg-zinc-950 text-[10px] font-black uppercase text-zinc-500 hover:text-zinc-300"
                            >
                              Limpar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-zinc-800 pt-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-300 font-black uppercase">Valor</span>
                      <span className="text-xl font-black text-emerald-400">
                        R$ {checkoutTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => void handleCheckoutConfirmOrder()}
                    disabled={creatingOrder || isOutOfStock || isSelectedColorUnavailable}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
                  >
                    {creatingOrder ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                    {creatingOrder ? "Gerando pedido..." : "Confirmar Pedido"}
                  </button>
                </div>
              )}

              {checkoutStep === 2 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Wallet size={14} className="text-emerald-400" />
                      <p className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Pagamento via PIX</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">Chave PIX</p>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs font-mono text-white truncate">
                          {loadingPixData ? "Carregando..." : pixData.chave}
                        </p>
                        <button
                          onClick={() => void copyPix()}
                          className="p-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
                          title="Copiar chave PIX"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-zinc-500 font-bold uppercase text-[10px]">Banco</p>
                        <p className="text-zinc-300 font-bold mt-1">{pixData.banco}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 font-bold uppercase text-[10px]">Titular</p>
                        <p className="text-zinc-300 font-bold mt-1 truncate">{pixData.titular}</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-black/50 p-3 text-center">
                      <p className="text-[10px] uppercase font-bold text-zinc-500">Valor exato</p>
                      <p className="text-lg font-black text-emerald-400">R$ {checkoutTotal.toFixed(2)}</p>
                    </div>
                  </div>

                  <button
                    onClick={handleSendReceiptWhatsapp}
                    disabled={!checkoutOrderId}
                    className="w-full py-3 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-black text-xs font-black uppercase transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <MessageCircle size={16} fill="black" />
                    Enviar Comprovante no WhatsApp
                  </button>

                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Depois de pagar o PIX, envie o comprovante para o contato financeiro para liberacao manual do pedido.
                  </p>
                </div>
              )}

              {checkoutStep === 3 && (
                <div className="space-y-4 text-center">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <p className="text-sm font-black uppercase text-white">Pedido em analise</p>
                    <p className="text-xs text-zinc-400 mt-2">
                      Pedido #{checkoutOrderId?.slice(0, 8).toUpperCase() || "--"} gerado. Agora envie o comprovante no WhatsApp e acompanhe o status da compra.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setCheckoutOpen(false);
                      setCheckoutStep(1);
                    }}
                    className="w-full py-3 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-black uppercase"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isImageViewerOpen && (
        <div className="fixed inset-0 z-[95] bg-black/95 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Imagem do produto</p>
              <h3 className="text-sm font-black uppercase text-white">{produto.nome}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsImageViewerZoomed((previous) => !previous)}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase text-zinc-200 hover:bg-zinc-800"
              >
                {isImageViewerZoomed ? <Minimize2 size={14} /> : <ZoomIn size={14} />}
                {isImageViewerZoomed ? "Ajustar" : "Zoom 2x"}
              </button>
              <button
                type="button"
                onClick={() => setIsImageViewerOpen(false)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-200 hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="h-[calc(100vh-81px)] overflow-auto p-4">
            <div className="relative mx-auto flex min-h-full w-full max-w-6xl items-center justify-center">
              <div
                className={`relative w-full overflow-auto rounded-3xl border border-white/10 bg-black/60 transition-all duration-300 ${
                  isImageViewerZoomed ? "max-w-[1600px]" : "max-w-5xl"
                }`}
              >
                <div className={`relative h-[70vh] w-full ${isImageViewerZoomed ? "sm:h-[90vh]" : ""}`}>
                  <Image
                    src={produto.img}
                    alt={produto.nome}
                    fill
                    sizes="100vw"
                    className={
                      isImageViewerZoomed
                        ? "object-contain scale-[1.8] transition-transform duration-300"
                        : "object-contain transition-transform duration-300"
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

