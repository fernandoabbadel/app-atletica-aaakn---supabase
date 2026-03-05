"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, Star } from "lucide-react";

import { createStoreReview, fetchStoreProductDetail } from "../../../../lib/storePublicService";
import { useAuth } from "../../../../context/AuthContext";
import { useToast } from "../../../../context/ToastContext";

interface Produto {
  id: string;
  nome: string;
}

interface Order {
  id: string;
  status: "pendente" | "approved" | "rejected" | "delivered" | "cancelado";
  createdAt: TimestampLike | null;
  updatedAt?: TimestampLike | null;
}

interface Review {
  id: string;
  userId: string;
}

type TimestampLike = { toDate: () => Date };

const toMillis = (value?: TimestampLike | null): number => {
  if (!value || typeof value.toDate !== "function") return 0;
  return value.toDate().getTime();
};

export default function LojaProdutoReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();

  const productId = typeof params.id === "string" ? params.id : "";

  const [produto, setProduto] = useState<Produto | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reasonToastShown, setReasonToastShown] = useState(false);

  const refresh = useCallback(async () => {
    if (!productId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const bundle = await fetchStoreProductDetail({
        productId,
        userId: user?.uid || null,
        reviewsLimit: 120,
        ordersLimit: 20,
        forceRefresh: false,
      });

      setProduto(bundle.produto as unknown as Produto | null);
      const rows = (bundle.userOrders as unknown as Order[]).sort(
        (left, right) => toMillis(right.createdAt) - toMillis(left.createdAt)
      );
      setOrders(rows);
      setReviews(bundle.reviews as unknown as Review[]);
      setReasonToastShown(false);
    } catch (error: unknown) {
      console.error(error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao carregar dados para avaliacao.";
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, productId, user?.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approvedOrders = useMemo(
    () => orders.filter((order) => order.status === "approved"),
    [orders]
  );

  const eligibleApprovedOrders = useMemo(() => {
    return approvedOrders.filter((order) => {
      const reference = order.updatedAt || order.createdAt;
      if (!reference || typeof reference.toDate !== "function") return false;
      const days = Math.ceil(Math.abs(Date.now() - reference.toDate().getTime()) / (1000 * 60 * 60 * 24));
      return days <= 5;
    });
  }, [approvedOrders]);

  const userReviewCount = useMemo(() => {
    const uid = user?.uid || "";
    if (!uid) return 0;
    return reviews.filter((review) => review.userId === uid).length;
  }, [reviews, user?.uid]);

  const remainingReviewSlots = useMemo(
    () => Math.max(0, eligibleApprovedOrders.length - userReviewCount),
    [eligibleApprovedOrders.length, userReviewCount]
  );

  const canReview = remainingReviewSlots > 0;

  const reviewBlockReason = useMemo(() => {
    if (approvedOrders.length === 0) {
      return "Voce precisa de um pedido aprovado para avaliar.";
    }
    if (eligibleApprovedOrders.length === 0) {
      return "Prazo encerrado: a avaliacao vale por 5 dias apos a aprovacao.";
    }
    if (remainingReviewSlots <= 0) {
      return "Todas as avaliacoes permitidas para este produto ja foram usadas.";
    }
    return "";
  }, [approvedOrders.length, eligibleApprovedOrders.length, remainingReviewSlots]);

  useEffect(() => {
    if (loading || canReview || reasonToastShown) return;
    if (!reviewBlockReason) return;
    addToast(reviewBlockReason, "info");
    setReasonToastShown(true);
  }, [addToast, canReview, loading, reasonToastShown, reviewBlockReason]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !produto) return;
    if (!canReview) {
      addToast(reviewBlockReason || "Avaliacao indisponivel para este produto.", "info");
      return;
    }

    setSubmitting(true);
    try {
      await createStoreReview({
        productId: produto.id,
        userId: user.uid,
        userName: user.nome || "Aluno",
        userAvatar: user.foto || "",
        rating,
        comment,
      });

      addToast("Avaliacao enviada com sucesso.", "success");
      router.push(`/loja/${produto.id}`);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar avaliacao.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!produto) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        Produto nao encontrado.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-24">
      <header className="p-4 sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md border-b border-zinc-800 flex items-center gap-3">
        <Link href={`/loja/${produto.id}`} className="p-2 rounded-full border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-black uppercase">Avaliacao do Produto</h1>
          <p className="text-[11px] text-zinc-500 font-bold">{produto.nome}</p>
        </div>
      </header>

      <main className="p-6 max-w-xl mx-auto">
        {!canReview ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center">
            <AlertTriangle size={26} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-300 font-bold">
              {reviewBlockReason}
            </p>
            <Link
              href={`/loja/${produto.id}`}
              className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-black uppercase hover:border-emerald-500/40"
            >
              Voltar para o produto
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <h2 className="text-sm font-black uppercase">Como foi sua experiencia?</h2>
            <p className="text-[11px] text-zinc-500">
              Avaliacoes disponiveis agora: {remainingReviewSlots}
            </p>

            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRating(value)}>
                  <Star size={26} className={value <= rating ? "fill-yellow-500 text-yellow-500" : "text-zinc-600"} />
                </button>
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              required
              rows={5}
              placeholder="Escreva sua avaliacao"
              className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm outline-none focus:border-emerald-500"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-black uppercase disabled:opacity-60"
            >
              {submitting ? "Enviando..." : "Enviar avaliacao"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

