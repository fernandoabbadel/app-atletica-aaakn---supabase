"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, Star } from "lucide-react";

import {
  createStoreReview,
  fetchStoreProductDetail,
  fetchStoreProductReviewsPage,
  fetchStoreProductUserReviewCount,
} from "../../../../lib/storePublicService";
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
  userName: string;
  userAvatar?: string;
  rating: number;
  comment: string;
  createdAt?: TimestampLike | null;
}

type TimestampLike = { toDate: () => Date };
const REVIEWS_PAGE_SIZE = 20;

const toMillis = (value?: TimestampLike | null): number => {
  if (!value || typeof value.toDate !== "function") return 0;
  return value.toDate().getTime();
};

const formatReviewDate = (value?: TimestampLike | null): string => {
  if (!value || typeof value.toDate !== "function") return "";
  return value.toDate().toLocaleDateString("pt-BR");
};

export default function LojaProdutoReviewPage() {
  const params = useParams();
  const { user } = useAuth();
  const { addToast } = useToast();

  const productId = typeof params.id === "string" ? params.id : "";

  const [produto, setProduto] = useState<Produto | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [userReviewCount, setUserReviewCount] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [totalReviews, setTotalReviews] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reasonToastShown, setReasonToastShown] = useState(false);

  const refresh = useCallback(async (forceRefresh = false) => {
    if (!productId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [bundle, firstPage, currentUserReviewCount] = await Promise.all([
        fetchStoreProductDetail({
          productId,
          userId: user?.uid || null,
          reviewsLimit: 0,
          ordersLimit: 20,
          forceRefresh,
        }),
        fetchStoreProductReviewsPage({
          productId,
          page: 1,
          pageSize: REVIEWS_PAGE_SIZE,
          forceRefresh,
        }),
        user?.uid
          ? fetchStoreProductUserReviewCount({
              productId,
              userId: user.uid,
              forceRefresh,
            })
          : Promise.resolve(0),
      ]);

      setProduto(bundle.produto as unknown as Produto | null);
      const rows = (bundle.userOrders as unknown as Order[]).sort(
        (left, right) => toMillis(right.createdAt) - toMillis(left.createdAt)
      );
      setOrders(rows);
      setReviews(firstPage.reviews as unknown as Review[]);
      setUserReviewCount(currentUserReviewCount);
      setReviewsPage(1);
      setHasMoreReviews(firstPage.hasMore);
      setTotalReviews(firstPage.totalCount);
      setReasonToastShown(false);
    } catch (error: unknown) {
      console.error(error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Erro ao carregar dados para avaliação.";
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

  const hasExistingReview = userReviewCount > 0;
  const canReview = eligibleApprovedOrders.length > 0 && !hasExistingReview;

  const reviewBlockReason = useMemo(() => {
    if (approvedOrders.length === 0) {
      return "Você precisa de um pedido aprovado para avaliar.";
    }
    if (eligibleApprovedOrders.length === 0) {
      return "Prazo encerrado: a avaliação vale por 5 dias após a aprovação.";
    }
    if (hasExistingReview) {
      return "Você já avaliou este produto.";
    }
    return "";
  }, [approvedOrders.length, eligibleApprovedOrders.length, hasExistingReview]);

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
      addToast(reviewBlockReason || "Avaliação indisponível para este produto.", "info");
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

      addToast("Avaliação enviada com sucesso.", "success");
      setComment("");
      setRating(5);
      await refresh(true);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar avaliação.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadMoreReviews = async () => {
    if (!produto || loadingMoreReviews || !hasMoreReviews) return;

    const nextPage = reviewsPage + 1;
    setLoadingMoreReviews(true);
    try {
      const next = await fetchStoreProductReviewsPage({
        productId: produto.id,
        page: nextPage,
        pageSize: REVIEWS_PAGE_SIZE,
        forceRefresh: false,
      });

      setReviews((prev) => {
        const knownIds = new Set(prev.map((entry) => entry.id));
        const merged = [...prev];
        (next.reviews as unknown as Review[]).forEach((entry) => {
          if (knownIds.has(entry.id)) return;
          knownIds.add(entry.id);
          merged.push(entry);
        });
        return merged;
      });
      setReviewsPage(nextPage);
      setHasMoreReviews(next.hasMore);
      if (next.totalCount !== null) setTotalReviews(next.totalCount);
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao carregar mais avaliacoes.", "error");
    } finally {
      setLoadingMoreReviews(false);
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
        Produto não encontrado.
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
          <h1 className="text-lg font-black uppercase">Avaliação do Produto</h1>
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
              Avaliacao disponivel agora: 1
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
              placeholder="Escreva sua avaliação"
              className="w-full rounded-xl border border-zinc-700 bg-black p-3 text-sm outline-none focus:border-emerald-500"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-black uppercase disabled:opacity-60"
            >
              {submitting ? "Enviando..." : "Enviar avaliação"}
            </button>
          </form>
        )}

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-black uppercase text-white">Avaliacoes da Galera</h2>
          <p className="text-[11px] text-zinc-500 mt-1">
            Total: {totalReviews ?? reviews.length}
          </p>

          <div className="mt-4 space-y-4">
            {reviews.length === 0 && (
              <p className="text-zinc-500 text-xs text-center italic">Seja o primeiro a avaliar.</p>
            )}

            {reviews.map((review) => (
              <article key={review.id} className="border-b border-zinc-800 pb-4 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{review.userName || "Aluno"}</p>
                    {formatReviewDate(review.createdAt) && (
                      <p className="text-[11px] text-zinc-500">{formatReviewDate(review.createdAt)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 text-yellow-500">
                    {[1, 2, 3, 4, 5].map((index) => (
                      <Star
                        key={`${review.id}-star-${index}`}
                        size={12}
                        className={index <= Math.max(1, Math.min(5, review.rating || 0)) ? "fill-current" : "text-zinc-700"}
                      />
                    ))}
                  </div>
                </div>
                {review.comment?.trim() && (
                  <p className="mt-2 text-xs text-zinc-300 leading-relaxed">{review.comment}</p>
                )}
              </article>
            ))}
          </div>

          {hasMoreReviews && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => void handleLoadMoreReviews()}
                disabled={loadingMoreReviews}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
              >
                {loadingMoreReviews ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Carregando
                  </>
                ) : (
                  "Carregar mais avaliacoes"
                )}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

