"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  Pencil,
  ShoppingBag,
  Store,
  UserCheck,
  UserPlus,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { buildLoginPath } from "@/lib/authRedirect";
import {
  fetchMiniVendorPublicBundle,
  toggleFollowMiniVendor,
  toggleLikeMiniVendor,
  type MiniVendorPublicBundle,
  type MiniVendorPublicProduct,
} from "@/lib/miniVendorPublicService";
import { withTenantSlug } from "@/lib/tenantRouting";
import { collectUserPlanScope } from "@/lib/userPlanScope";

const getProductStatusLabel = (status?: MiniVendorPublicProduct["status"]): string => {
  if (status === "em_breve") return "Em breve";
  if (status === "esgotado") return "Esgotado";
  return "Ativo";
};

const getProductStatusClass = (status?: MiniVendorPublicProduct["status"]): string => {
  if (status === "em_breve") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (status === "esgotado") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
};

export default function MiniVendorPublicProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { tenantId, tenantSlug, tenantLogoUrl } = useTenantTheme();
  const { userPlanIds, userPlanNames } = useMemo(() => collectUserPlanScope(user), [user]);

  const miniVendorId = typeof params.id === "string" ? params.id : "";
  const [bundle, setBundle] = useState<MiniVendorPublicBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const [togglingLike, setTogglingLike] = useState(false);

  const tenantPath = useCallback(
    (path: string): string => (tenantSlug.trim() ? withTenantSlug(tenantSlug, path) : path),
    [tenantSlug]
  );

  const loadPage = useCallback(
    async (forceRefresh = false) => {
      const scopedTenantId = tenantId.trim() || asString(user?.tenant_id).trim();
      if (!scopedTenantId || !miniVendorId) {
        setBundle(null);
        return;
      }

      const result = await fetchMiniVendorPublicBundle({
        tenantId: scopedTenantId,
        miniVendorId,
        viewerUid: user?.uid,
        forceRefresh,
        maxProducts: 12,
        userPlanNames,
        userPlanIds,
      });
      setBundle(result);
    },
    [miniVendorId, tenantId, user?.tenant_id, user?.uid, userPlanIds, userPlanNames]
  );

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        await loadPage(false);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar mini vendor.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [addToast, loadPage]);

  const profile = bundle?.profile || null;
  const isOwner = Boolean(user?.uid) && user?.uid === profile?.userId;
  const coverImage = profile?.coverUrl || profile?.logoUrl || tenantLogoUrl || "/logo.png";
  const logoImage = profile?.logoUrl || tenantLogoUrl || "/logo.png";
  const whatsappHref =
    profile?.whatsappEnabled && profile.whatsapp.trim()
      ? `https://wa.me/${profile.whatsapp.replace(/\D/g, "")}`
      : "";
  const instagramHandle = (profile?.instagram || "").trim().replace(/^@/, "");
  const instagramHref =
    profile?.instagramEnabled && instagramHandle ? `https://instagram.com/${instagramHandle}` : "";
  const editHref = tenantPath("/configuracoes/mini-vendor/editar");

  const ensureAuthenticated = (): boolean => {
    if (user?.uid) return true;
    router.push(buildLoginPath(tenantPath(`/perfil/mini-vendor/${miniVendorId}`)));
    return false;
  };

  const handleToggleFollow = async () => {
    if (!bundle?.profile) return;
    if (!ensureAuthenticated()) return;

    try {
      setTogglingFollow(true);
      const result = await toggleFollowMiniVendor({
        tenantId: tenantId || user?.tenant_id || undefined,
        miniVendorId: bundle.profile.id,
        currentlyFollowing: bundle.isFollowing,
        viewer: {
          uid: user?.uid || "",
          nome: user?.nome || "Atleta",
          foto: user?.foto || "",
          turma: user?.turma || "",
        },
      });
      setBundle((previous) =>
        previous
          ? {
              ...previous,
              isFollowing: result.isFollowing,
              followersCount: result.followersCount,
            }
          : previous
      );
      addToast(result.isFollowing ? "Agora voce segue essa lojinha." : "Voce deixou de seguir essa lojinha.", result.isFollowing ? "success" : "info");
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Nao foi possivel seguir agora.", "error");
    } finally {
      setTogglingFollow(false);
    }
  };

  const handleToggleLike = async () => {
    if (!bundle?.profile) return;
    if (!ensureAuthenticated()) return;

    try {
      setTogglingLike(true);
      const result = await toggleLikeMiniVendor({
        tenantId: tenantId || user?.tenant_id || undefined,
        miniVendorId: bundle.profile.id,
        currentlyLiked: bundle.isLiked,
        viewer: {
          uid: user?.uid || "",
          nome: user?.nome || "Atleta",
          foto: user?.foto || "",
          turma: user?.turma || "",
        },
      });
      setBundle((previous) =>
        previous
          ? {
              ...previous,
              isLiked: result.isLiked,
              likesCount: result.likesCount,
            }
          : previous
      );
      addToast(result.isLiked ? "Lojinha curtida." : "Curtida removida.", result.isLiked ? "success" : "info");
    } catch (error: unknown) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Nao foi possivel curtir agora.", "error");
    } finally {
      setTogglingLike(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      const currentUrl = typeof window !== "undefined" ? window.location.href : tenantPath(`/perfil/mini-vendor/${miniVendorId}`);
      await navigator.clipboard.writeText(currentUrl);
      addToast("Link da lojinha copiado.", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Nao foi possivel copiar o link agora.", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="animate-spin text-emerald-500" size={36} />
      </div>
    );
  }

  if (!bundle || !profile) {
    return (
      <div className="min-h-screen bg-[#050505] px-6 py-20 text-center text-white">
        <div className="mx-auto max-w-sm rounded-[2rem] border border-zinc-800 bg-zinc-900 p-8">
          <Store size={32} className="mx-auto text-zinc-500" />
          <h1 className="mt-4 text-xl font-black uppercase">Mini vendor indisponivel</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Essa lojinha nao esta publica ou ainda nao foi aprovada.
          </p>
          <button
            onClick={() => router.back()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-black px-4 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800"
          >
            <ArrowLeft size={14} />
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-24 text-white">
      <div className="relative">
        <div className="relative h-56 w-full overflow-hidden bg-zinc-900 sm:h-72">
          <Image
            src={coverImage}
            alt={profile.storeName}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/25 to-[#050505]" />
          <button
            onClick={() => router.back()}
            className="absolute left-6 top-6 z-20 rounded-full border border-white/10 bg-black/40 p-2.5 backdrop-blur-md transition hover:bg-white hover:text-black"
          >
            <ArrowLeft size={18} />
          </button>
        </div>

        <div className="relative z-10 -mt-16 px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col items-center rounded-[2rem] border border-zinc-800 bg-[#050505]/96 px-6 pb-8 pt-4 shadow-[0_30px_100px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="relative -mt-12 h-28 w-28 overflow-hidden rounded-full border-4 border-[#050505] bg-black shadow-2xl shadow-black/40">
                <Image
                  src={logoImage}
                  alt={profile.storeName}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              </div>

              <div className="mt-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400">
                  Mini vendor publico
                </p>
                <h1 className="mt-2 flex items-center justify-center gap-2 text-3xl font-black uppercase italic tracking-tight">
                  {profile.storeName}
                  <Store size={18} className="text-blue-400" />
                </h1>
                <p className="mt-2 max-w-xl text-sm text-zinc-400">
                  {profile.description || "Lojinha aprovada dentro da store oficial da atletica."}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[10px] font-black uppercase text-blue-300">
                  Loja aprovada
                </span>
                {profile.whatsappEnabled && profile.whatsapp.trim() ? (
                  <span className="rounded-full border border-zinc-700 bg-black/40 px-3 py-1 text-[10px] font-black uppercase text-zinc-300">
                    WhatsApp ativo
                  </span>
                ) : null}
                {profile.instagramEnabled && instagramHandle ? (
                  <span className="rounded-full border border-zinc-700 bg-black/40 px-3 py-1 text-[10px] font-black uppercase text-zinc-300">
                    Instagram ativo
                  </span>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {isOwner ? (
                  <Link
                    href={editHref}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-6 py-2.5 text-xs font-black uppercase text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-300"
                  >
                    <Pencil size={14} />
                    Editar loja
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => void handleToggleFollow()}
                      disabled={togglingFollow}
                      className={`inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-xs font-black uppercase transition ${
                        bundle.isFollowing
                          ? "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                          : "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500"
                      } disabled:opacity-60`}
                    >
                      {togglingFollow ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : bundle.isFollowing ? (
                        <UserCheck size={14} />
                      ) : (
                        <UserPlus size={14} />
                      )}
                      {bundle.isFollowing ? "Seguindo" : "Seguir"}
                    </button>
                    <button
                      onClick={() => void handleToggleLike()}
                      disabled={togglingLike}
                      className={`inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-xs font-black uppercase transition ${
                        bundle.isLiked
                          ? "border-pink-500/30 bg-pink-500/10 text-pink-300 hover:bg-pink-500/20"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                      } disabled:opacity-60`}
                    >
                      {togglingLike ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Heart size={14} className={bundle.isLiked ? "fill-pink-400 text-pink-400" : ""} />
                      )}
                      {bundle.isLiked ? "Curtido" : "Curtir"}
                    </button>
                  </>
                )}

                <button
                  onClick={() => void handleCopyLink()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800"
                  aria-label="Copiar link da loja"
                >
                  <Copy size={16} />
                </button>
              </div>

              <div className="mt-6 grid w-full max-w-md grid-cols-3 gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                  <p className="text-2xl font-black text-white">{bundle.followersCount}</p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    Seguidores
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                  <p className="text-2xl font-black text-white">{bundle.likesCount}</p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    Curtidas
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                  <p className="text-2xl font-black text-white">{bundle.productsCount}</p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    Produtos
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {instagramHref ? (
                  <a
                    href={instagramHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-600 to-pink-500 text-white shadow-lg transition hover:scale-105"
                    aria-label="Instagram da loja"
                  >
                    <Instagram size={22} />
                  </a>
                ) : null}
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg transition hover:scale-105"
                    aria-label="WhatsApp da loja"
                  >
                    <MessageCircle size={22} />
                  </a>
                ) : null}
              </div>
            </div>

            <section className="mt-6 grid gap-4 md:grid-cols-2">
              <article className="rounded-[1.75rem] border border-zinc-800 bg-zinc-900/70 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                  Contato
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase text-zinc-500">WhatsApp</p>
                    <p className="mt-1 text-sm font-bold text-white">
                      {profile.whatsappEnabled && profile.whatsapp.trim()
                        ? profile.whatsapp
                        : "Nao divulgado"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase text-zinc-500">Instagram</p>
                    <p className="mt-1 text-sm font-bold text-white">
                      {profile.instagramEnabled && instagramHandle ? `@${instagramHandle}` : "Nao divulgado"}
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-[1.75rem] border border-zinc-800 bg-zinc-900/70 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                  Sobre a loja
                </p>
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                  <p className="text-sm leading-6 text-zinc-300">
                    {profile.description || "Essa lojinha ainda nao adicionou uma descricao detalhada."}
                  </p>
                </div>
              </article>
            </section>

            <section className="mt-6 rounded-[2rem] border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                    Catalogo
                  </p>
                  <h2 className="mt-2 text-lg font-black uppercase text-white">
                    Produtos da lojinha
                  </h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-black/30 px-3 py-1 text-[10px] font-black uppercase text-zinc-300">
                  {bundle.productsCount} item{bundle.productsCount === 1 ? "" : "s"}
                </span>
              </div>

              {bundle.products.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/20 p-6 text-sm text-zinc-400">
                  Nenhum produto publico dessa lojinha ainda.
                </div>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bundle.products.map((product) => {
                    const productHref = tenantPath(`/loja/${product.id}`);
                    const likesCount = product.likes.length;
                    return (
                      <Link
                        key={product.id}
                        href={productHref}
                        className="overflow-hidden rounded-3xl border border-zinc-800 bg-black/20 transition hover:border-zinc-700"
                      >
                        <div className="relative h-40 bg-black">
                          <Image
                            src={product.img || logoImage}
                            alt={product.nome}
                            fill
                            sizes="360px"
                            className="object-cover opacity-90"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                          <span
                            className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${getProductStatusClass(
                              product.status
                            )}`}
                          >
                            {getProductStatusLabel(product.status)}
                          </span>
                        </div>
                        <div className="space-y-2 p-4">
                          <p className="text-[10px] font-black uppercase tracking-wide text-zinc-500">
                            {product.categoria || profile.storeName}
                          </p>
                          <h3 className="line-clamp-2 text-sm font-black text-white">{product.nome}</h3>
                          <div className="flex items-center justify-between gap-3 pt-2">
                            <div>
                              <p className="text-xl font-black text-emerald-400">
                                R$ {Number(product.preco || 0).toFixed(2)}
                              </p>
                              <p className="mt-1 text-[10px] font-black uppercase text-zinc-500">
                                {likesCount} curtida{likesCount === 1 ? "" : "s"}
                              </p>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-emerald-400">
                              <ShoppingBag size={16} />
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
