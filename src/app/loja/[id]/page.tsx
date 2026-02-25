// src/app/loja/[id]/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  cancelStoreOrderRequest,
  createStoreOrder,
  createStoreReview,
  fetchStoreProductDetail,
  toggleStoreProductLike,
} from "../../../lib/storeService";
import { Timestamp } from "@/lib/supa/firestore";
import {
  AlertTriangle,
  ArrowLeft,
  Heart,
  Loader2,
  ShoppingBag,
  Star,
  X,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";

interface Produto {
  id: string;
  nome: string;
  preco: number;
  img: string;
  descricao: string;
  likes: string[];
  categoria: string;
}

interface Review {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  comment: string;
  createdAt: Timestamp | null;
}

interface Order {
  id: string;
  userId: string;
  userName: string;
  productId: string;
  productName: string;
  price: number;
  status: "pendente" | "approved" | "rejected" | "delivered" | "cancelado";
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

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

const orderMillis = (value?: Timestamp | null): number => {
  if (!value) return 0;
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  return 0;
};

const formatOrderDateTime = (value?: Timestamp | null): string => {
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

  const [produto, setProduto] = useState<Produto | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"detalhes" | "avaliacoes">("detalhes");

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  const productId = typeof params.id === "string" ? params.id : "";

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
          reviewsLimit: 60,
          ordersLimit: 50,
          forceRefresh,
        });

        setProduto(bundle.produto as unknown as Produto | null);

        const reviewsList = (bundle.reviews as unknown as Review[]).sort(
          (left, right) => orderMillis(right.createdAt) - orderMillis(left.createdAt)
        );
        setReviews(reviewsList);

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
    [addToast, productId, user?.uid]
  );

  useEffect(() => {
    void refreshProductData(true);
  }, [refreshProductData]);

  const latestApprovedOrder = useMemo(() => {
    return userOrders.find((order) => order.status === "approved") || null;
  }, [userOrders]);

  const canReview = useMemo(() => {
    if (!latestApprovedOrder) return false;

    const referenceDate = latestApprovedOrder.updatedAt || latestApprovedOrder.createdAt;
    if (!referenceDate || typeof referenceDate.toDate !== "function") return false;

    const diffMs = Date.now() - referenceDate.toDate().getTime();
    const diffDays = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    return diffDays <= 5;
  }, [latestApprovedOrder]);

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

  const handleBuy = async () => {
    if (!user || !produto) {
      router.push("/login");
      return;
    }

    const confirmed = window.confirm(`Confirmar pedido de ${produto.nome}?`);
    if (!confirmed) return;

    try {
      await createStoreOrder({
        userId: user.uid,
        userName: user.nome || "Aluno",
        productId: produto.id,
        productName: produto.nome,
        price: produto.preco,
      });

      addToast("Pedido enviado!", "success");
      await refreshProductData(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao realizar pedido.", "error");
    }
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

  const handleSubmitReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !produto) return;

    setSubmittingReview(true);
    try {
      await createStoreReview({
        productId: produto.id,
        userId: user.uid,
        userName: user.nome || "Aluno",
        userAvatar: user.foto || "",
        rating,
        comment,
      });

      setComment("");
      setRating(5);
      addToast("Avaliacao enviada!", "success");
      await refreshProductData(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao avaliar.", "error");
    } finally {
      setSubmittingReview(false);
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
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent z-10" />
        <button
          onClick={() => router.back()}
          className="absolute top-6 left-6 z-20 bg-black/40 backdrop-blur-md p-3 rounded-full text-white hover:bg-zinc-800 transition border border-white/10"
        >
          <ArrowLeft size={24} />
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
            <h1 className="text-3xl font-black text-white italic uppercase mt-2 leading-none">{produto.nome}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Heart size={14} className="text-red-500 fill-red-500" />
              <span className="text-xs text-zinc-400 font-bold">{produto.likes?.length || 0} curtidas</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black text-emerald-400">R$ {Number(produto.preco).toFixed(2)}</p>
          </div>
        </div>

        <div className="flex gap-4 border-b border-zinc-800 mb-6">
          <button
            onClick={() => setActiveTab("detalhes")}
            className={`pb-3 text-sm font-bold uppercase tracking-wide transition ${
              activeTab === "detalhes" ? "text-white border-b-2 border-emerald-500" : "text-zinc-500"
            }`}
          >
            Detalhes
          </button>
          <button
            onClick={() => setActiveTab("avaliacoes")}
            className={`pb-3 text-sm font-bold uppercase tracking-wide transition ${
              activeTab === "avaliacoes" ? "text-white border-b-2 border-emerald-500" : "text-zinc-500"
            }`}
          >
            Avaliacoes ({reviews.length})
          </button>
        </div>

        {activeTab === "detalhes" && (
          <div className="space-y-6 animate-in fade-in">
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{produto.descricao}</p>

            <button
              onClick={handleBuy}
              className="w-full py-4 bg-emerald-600 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-3 hover:bg-emerald-500 transition shadow-lg shadow-emerald-900/20 active:scale-95 text-white"
            >
              <ShoppingBag size={20} /> Comprar Agora
            </button>

            {latestApprovedOrder && (
              <Link
                href={`/loja/${produto.id}/review`}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs font-black uppercase hover:border-emerald-500/40 hover:text-emerald-300 transition"
              >
                <Star size={14} /> Avaliar em tela dedicada
              </Link>
            )}

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
                        <p className="text-xs text-zinc-300">R$ {Number(order.price || 0).toFixed(2)}</p>
                        <button
                          onClick={() => void handleCancelOrder(order.id)}
                          disabled={cancellingOrderId === order.id}
                          className="text-xs font-black uppercase text-red-400 hover:text-red-300 disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {cancellingOrderId === order.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                          Cancelar pedido
                        </button>
                      </div>
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
                      <div className="mt-3 text-xs text-zinc-300">R$ {Number(order.price || 0).toFixed(2)}</div>
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
        )}

        {activeTab === "avaliacoes" && (
          <div className="space-y-6 animate-in fade-in">
            {canReview ? (
              <form onSubmit={handleSubmitReview} className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 mb-6">
                <h3 className="text-sm font-bold text-white uppercase mb-3">Deixe sua avaliacao</h3>
                <div className="flex gap-2 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} type="button" onClick={() => setRating(star)}>
                      <Star size={24} className={star <= rating ? "fill-yellow-500 text-yellow-500" : "text-zinc-600"} />
                    </button>
                  ))}
                </div>
                <textarea
                  className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-sm text-white focus:border-emerald-500 outline-none"
                  placeholder="O que achou do produto?"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                />
                <button
                  disabled={submittingReview}
                  type="submit"
                  className="w-full mt-3 bg-emerald-600 py-2 rounded-lg font-bold text-xs uppercase hover:bg-emerald-500 transition"
                >
                  {submittingReview ? "Enviando..." : "Publicar Avaliacao"}
                </button>
              </form>
            ) : (
              <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-center">
                <AlertTriangle size={24} className="mx-auto text-red-500 mb-2" />
                <p className="text-xs text-red-400 font-bold">
                  Para avaliar, voce precisa de um pedido aprovado nos ultimos 5 dias.
                </p>
                {latestApprovedOrder && (
                  <Link
                    href={`/loja/${produto.id}/review`}
                    className="mt-3 inline-flex items-center gap-2 text-[11px] font-black uppercase text-red-300 hover:text-red-200"
                  >
                    Abrir tela de avaliacao
                  </Link>
                )}
              </div>
            )}

            <div className="space-y-4">
              {reviews.length === 0 && <p className="text-zinc-500 text-xs text-center italic">Seja o primeiro a avaliar.</p>}
              {reviews.map((rev) => (
                <div key={rev.id} className="border-b border-zinc-800 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="relative w-8 h-8 bg-zinc-800 rounded-full overflow-hidden">
                        <Image
                          src={rev.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(rev.userName)}`}
                          alt={rev.userName}
                          fill
                          sizes="32px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <span className="text-xs font-bold text-white">{rev.userName}</span>
                    </div>
                    <div className="flex text-yellow-500">
                      {[...Array(5)].map((_, index) => (
                        <Star key={index} size={10} className={index < rev.rating ? "fill-current" : "text-zinc-700"} />
                      ))}
                    </div>
                  </div>
                  <p className="text-zinc-400 text-xs leading-relaxed">{rev.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

