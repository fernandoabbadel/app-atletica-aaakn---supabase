"use client";

import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Heart, MessageCircle, MoreHorizontal, Flame, 
  Image as ImageIcon, ShieldCheck, Pin, X, Loader2, AlertTriangle, Send, Trash2, Flag,
  Lock, Fish, Store, User
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "../../context/AuthContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "../../context/ToastContext";
import { Security } from "../../lib/security";
import {
  buildDraftAssetFileName,
  sanitizeStoragePathSegment,
  uploadImage,
  validateImageFile,
  VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
} from "../../lib/upload";
import {
  createCommunityComment,
  createCommunityPost,
  createCommunityReport,
  fetchCommunityCategoryBadgeCounts,
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityComments,
  fetchCommunityConfig,
  fetchCommunityFeedByCategory,
  markCommunityCategoryRead,
  setCommunityPostPatch,
  toggleCommunityCommentLike,
  toggleCommunityPostReaction,
} from "../../lib/communityService";
import { nowDateLike, type DateLike } from "../../lib/supabaseData";
import {
  DEFAULT_COMMUNITY_CATEGORIES,
  normalizeCommunityCategories,
} from "../../constants/communityCategories";
import { resolvePlanIcon, resolvePlanTextClass, resolveUserPlanIcon } from "../../constants/planVisuals";
import { isAdminLikeRole, resolveEffectiveAccessRole } from "@/lib/roles";
import { withTenantSlug } from "@/lib/tenantRouting";

// --- TIPAGEM ---

interface AppConfig {
    titulo?: string;
    subtitulo?: string;
    capaUrl?: string;
    limitMessages?: boolean;
    categorias?: string[];
}

interface PostData {
    id: string;
    userId: string;
    userName: string;
    handle: string;
    avatar: string;
    texto: string;
    imagem?: string | null;
    likes: string[];
    hype: string[];
    comentarios: number;
    denunciasCount: number;
    categoria: string;
    
    // Dados Visuais (Snapshot)
    plano_cor?: string;
    plano_icon?: string;
    plano?: string;
    patente?: string; 
    patente_icon?: string; 
    patente_cor?: string; 
    
    role?: string;
    tenant_role?: string;
    blocked?: boolean;
    fixado?: boolean;
    isTreinador?: boolean;
    commentsDisabled?: boolean;
    createdAt: DateLike | null;
}

interface CommentData {
    id: string;
    userId: string;
    userName: string;
    avatar: string;
    texto: string;
    likes: string[];
    
    plano_cor?: string;
    plano_icon?: string;
    plano?: string;
    patente?: string;
    patente_icon?: string; 
    patente_cor?: string; 
    
    role?: string;
    tenant_role?: string;
    createdAt: DateLike | null;
}

// --- CONSTANTES ---

const RECENT_BADGE_WINDOW_DAYS = 2;

// --- FUNÇÕES AUXILIARES ---

const isDateLike = (value: unknown): value is DateLike =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function";

const formatCustomDate = (timestamp: DateLike | null | undefined) => {
    if (!timestamp) return "env...";
    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `${diffMin} min`;
    if (diffHours < 24) return `${diffHours} h`;
    if (diffDays <= 7) return `${diffDays} d`;
    if (diffDays <= 30) return `${Math.floor(diffDays / 7)} sem`;
    return "mais de 1 mês";
};

// --- COMPONENTES ---

// UserBadges tipado corretamente (fim do any)
const UserBadges = ({ userData }: { userData: Partial<PostData | CommentData> }) => {
    const isAdmin = isAdminLikeRole(resolveEffectiveAccessRole(userData));
    const isMiniVendor = userData?.tenant_role === "mini_vendor" && !isAdmin;
    const normalizeIcon = (value: string | undefined) =>
      String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const isDisplayLabel = (value: string | undefined): value is string => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      const normalized = raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalized !== "visitante" && normalized !== "visitor";
    };

    const planIconName = normalizeIcon(userData?.plano_icon);
    const patentIconName = normalizeIcon(userData?.patente_icon);
    const planColorClass = resolvePlanTextClass(userData?.plano_cor, "text-zinc-400");
    const patentColorClass = resolvePlanTextClass(userData?.patente_cor, "text-zinc-400");
    const PlanIcon = planIconName ? resolveUserPlanIcon(userData?.plano_icon, userData?.plano, User) : null;
    const PatentIcon = patentIconName ? resolvePlanIcon(userData?.patente_icon, Fish) : null;

    const tooltipParts = [userData?.patente, userData?.plano]
      .filter(isDisplayLabel);
    const tooltipText = tooltipParts.join(" • ");

    return (
        <div className="flex items-center gap-1.5 ml-1 select-none" title={tooltipText || undefined}>
            {isAdmin && (
                <span className="flex items-center bg-red-500/10 p-0.5 rounded border border-red-500/20">
                    <ShieldCheck size={10} className="text-red-500" />
                </span>
            )}
            {isMiniVendor && (
                <span className="flex items-center bg-blue-500/10 p-0.5 rounded border border-blue-500/20">
                    <Store size={10} className="text-blue-400" />
                </span>
            )}
            {PlanIcon && (
                <span className={`flex items-center opacity-80 ${planColorClass}`}>
                    <PlanIcon size={12} />
                </span>
            )}
            {PatentIcon && planIconName !== patentIconName && (
                <span className={`flex items-center ${patentColorClass}`}>
                    <PatentIcon size={14} className="drop-shadow-sm" />
                </span>
            )}
        </div>
    );
};
export default function ComunidadePage() {
  const { user } = useAuth();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const { addToast } = useToast();
  const effectiveUserRole = resolveEffectiveAccessRole(user);
  const isAdminModerator = isAdminLikeRole(effectiveUserRole);
  
  const [activeTab, setActiveTab] = useState(DEFAULT_COMMUNITY_CATEGORIES[0] || "Geral");
  const [activeFilter, setActiveFilter] = useState<"recent" | "likes" | "comments" | "hype">("recent");
  const [modalidades, setModalidades] = useState<string[]>(DEFAULT_COMMUNITY_CATEGORIES);
  
  const [posts, setPosts] = useState<PostData[]>([]);
  const [allPostsRaw, setAllPostsRaw] = useState<PostData[]>([]);
  const [config, setConfig] = useState<AppConfig>({});
  const [recentByCategory, setRecentByCategory] = useState<Record<string, number>>({});
  const [unreadByCategory, setUnreadByCategory] = useState<Record<string, number>>({});
  const [countsRefreshToken, setCountsRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  
  const [newPostText, setNewPostText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  // TRAVAS ANTI-SPAM
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPostingComment, setIsPostingComment] = useState(false);

  const [reportModal, setReportModal] = useState<string | null>(null);
  const [reportTargetType, setReportTargetType] = useState<"post" | "comment">("post");
  const [reportReason, setReportReason] = useState("");
  const [otherReasonText, setOtherReasonText] = useState("");
  
  const [commentModal, setCommentModal] = useState<string | null>(null);
  const [commentsList, setCommentsList] = useState<CommentData[]>([]);
  const [newComment, setNewComment] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [commentMenuOpen, setCommentMenuOpen] = useState<string | null>(null);

  const handleSelectImage = (file: File | null) => {
      if (!file) {
          setImageFile(null);
          return;
      }

      const validationError = validateImageFile(file);
      if (validationError) {
          addToast(validationError, "error");
          return;
      }

      setImageFile(file);
  };

  useEffect(() => {
    let mounted = true;

    const loadConfig = async () => {
      try {
        const configData = await fetchCommunityConfig({
          tenantId: activeTenantId || user?.tenant_id || undefined,
        });
        if (!mounted) return;

        const rawConfig = (configData as Partial<AppConfig> | null) ?? {};
        const normalizedConfig = {
          ...rawConfig,
          categorias: normalizeCommunityCategories(rawConfig.categorias),
        };

        setConfig((prev) => ({ ...prev, ...normalizedConfig }));
        setModalidades(normalizedConfig.categorias);
        setActiveTab((prev) =>
          normalizedConfig.categorias.includes(prev)
            ? prev
            : normalizedConfig.categorias[0] || DEFAULT_COMMUNITY_CATEGORIES[0] || "Geral"
        );
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar configuracoes da comunidade.", "error");
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast, user?.tenant_id]);

  useEffect(() => {
    let mounted = true;

    const loadPosts = async () => {
      if (!activeTab) {
        setAllPostsRaw([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const rows = await fetchCommunityFeedByCategory({
          categoria: activeTab,
          maxResults: 120,
          includeBlocked: isAdminModerator,
          tenantId: activeTenantId || user?.tenant_id || undefined,
        });

        if (!mounted) return;

        const data = rows.map((row) => {
          const raw = row.data as Record<string, unknown>;
          const createdAt = isDateLike(raw.createdAt) ? raw.createdAt : null;
          const likes = Array.isArray(raw.likes)
            ? raw.likes.filter((item): item is string => typeof item === "string")
            : [];
          const hype = Array.isArray(raw.hype)
            ? raw.hype.filter((item): item is string => typeof item === "string")
            : [];

          return {
            id: row.id,
            ...(raw as Omit<PostData, "id" | "likes" | "hype" | "createdAt">),
            categoria: typeof raw.categoria === "string" ? raw.categoria : activeTab,
            createdAt,
            likes,
            hype,
            comentarios: typeof raw.comentarios === "number" ? raw.comentarios : 0,
            denunciasCount: typeof raw.denunciasCount === "number" ? raw.denunciasCount : 0,
          } as PostData;
        });

        setAllPostsRaw(data);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar feed da comunidade.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadPosts();
    return () => {
      mounted = false;
    };
  }, [activeTab, activeTenantId, addToast, isAdminModerator, user?.tenant_id]);

  useEffect(() => {
    const ordered = [...allPostsRaw];

    if (activeFilter === "recent") {
      ordered.sort(
        (a, b) =>
          (isDateLike(b.createdAt) ? b.createdAt.toMillis() : 0) -
          (isDateLike(a.createdAt) ? a.createdAt.toMillis() : 0)
      );
    }
    if (activeFilter === "likes") {
      ordered.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
    }
    if (activeFilter === "comments") {
      ordered.sort((a, b) => (b.comentarios || 0) - (a.comentarios || 0));
    }
    if (activeFilter === "hype") {
      ordered.sort((a, b) => (b.hype?.length || 0) - (a.hype?.length || 0));
    }

    const maxVisiblePosts = config.limitMessages === false ? 100 : 20;
    setPosts(ordered.slice(0, maxVisiblePosts));
  }, [allPostsRaw, activeFilter, config.limitMessages]);

  useEffect(() => {
    if (modalidades.length === 0) {
      setRecentByCategory({});
      setUnreadByCategory({});
      return;
    }

    let mounted = true;
    const loadBadges = async () => {
      try {
        const badgeCounts = await fetchCommunityCategoryBadgeCounts({
          userId: user?.uid,
          categorias: modalidades,
          includeBlocked: isAdminModerator,
          windowDays: RECENT_BADGE_WINDOW_DAYS,
          tenantId: activeTenantId || user?.tenant_id || undefined,
        });
        if (!mounted) return;
        setRecentByCategory(badgeCounts.recentCounts);
        setUnreadByCategory(badgeCounts.unreadCounts);
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao atualizar badges da comunidade.", "error");
      }
    };

    void loadBadges();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast, countsRefreshToken, isAdminModerator, modalidades, user?.tenant_id, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!activeTab) return;
    if (!modalidades.includes(activeTab)) return;

    let active = true;
    const markCurrentTabAsRead = async () => {
      try {
        await markCommunityCategoryRead({
          userId: user.uid,
          categoria: activeTab,
          tenantId: activeTenantId || user?.tenant_id || undefined,
        });
        if (!active) return;
        setUnreadByCategory((prev) => ({ ...prev, [activeTab]: 0 }));
      } catch (error: unknown) {
        console.error(error);
      }
    };

    void markCurrentTabAsRead();
    return () => {
      active = false;
    };
  }, [activeTab, modalidades, user?.uid, user?.tenant_id, activeTenantId]);

  useEffect(() => {
      if (!commentModal) {
          setCommentsList([]);
          return;
      }

      let mounted = true;
      const loadComments = async () => {
          try {
              const rows = await fetchCommunityComments(commentModal, {
                  order: "asc",
                  maxResults: 60,
                  tenantId: activeTenantId || user?.tenant_id || undefined,
              });

              if (!mounted) return;

              const comments = rows.map((row) => {
                  const raw = row.data as Record<string, unknown>;
                  const rawLikes = raw.likes;
                  const likes = Array.isArray(rawLikes)
                      ? rawLikes.filter((item): item is string => typeof item === "string")
                      : [];

                  const rawCreatedAt = raw.createdAt;
                  const createdAt = isDateLike(rawCreatedAt) ? rawCreatedAt : null;

                  return {
                      id: row.id,
                      ...(raw as Omit<CommentData, "id" | "likes" | "createdAt">),
                      likes,
                      createdAt,
                  } as CommentData;
              });

              comments.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
              setCommentsList(comments);
          } catch (error: unknown) {
              console.error(error);
              if (mounted) addToast("Erro ao carregar comentários.", "error");
          }
      };

      void loadComments();
      return () => {
          mounted = false;
      };
  }, [commentModal, addToast, activeTenantId, user?.tenant_id]);

  const handlePublish = async () => {
    if (!user) return addToast("Faça login!", "error");
    if (isPublishing) return;

    const securityCheck = await Security.canUserPost(user.uid);
    if (!securityCheck.allowed) return addToast(securityCheck.reason || "Aguarde...", "error");

    if (!newPostText.trim() && !imageFile) return;

    const exceedsPostLimit = newPostText.length > 150;
    if (exceedsPostLimit) {
      return addToast("Maximo de 150 caracteres por postagem.", "error");
    }

    if (false && newPostText.length > 150) {
      return addToast("Maximo de 150 caracteres por postagem.", "error");
    }

    const oneDayAgo = new Date().getTime() - 24 * 60 * 60 * 1000;
    const userPostsToday = allPostsRaw.filter(
      (post) =>
        post.userId === user.uid &&
        post.categoria === activeTab &&
        post.createdAt &&
        post.createdAt.toDate().getTime() > oneDayAgo
    );

    if (userPostsToday.length > 0 && !isAdminModerator) {
      return addToast(`Você já postou em "${activeTab}" hoje. Volte amanhã!`, "error");
    }

    setIsPublishing(true);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const validationError = validateImageFile(imageFile);
        if (validationError) {
          addToast(validationError, "error");
          return;
        }

        const tenantScope = sanitizeStoragePathSegment(activeTenantId || user?.tenant_id || "global");
        const userScope = sanitizeStoragePathSegment(user.uid || "anon");
        const uploaded = await uploadImage(
          imageFile,
          `posts/${tenantScope}/${userScope}/drafts/${sanitizeStoragePathSegment(activeTab || "geral")}`,
          {
          scopeKey: `comunidade:post:${tenantScope}:${activeTab}`,
          fileName: buildDraftAssetFileName(activeTab || "post"),
          cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
          maxBytes: 2 * 1024 * 1024,
          maxWidth: 2000,
          maxHeight: 2000,
          maxPixels: 3_000_000,
          compressionMaxWidth: 1600,
          compressionMaxHeight: 1600,
          compressionMaxBytes: 200 * 1024,
          quality: 0.82,
          rateLimitMax: 3,
        });
        if (uploaded.error || !uploaded.url) {
          addToast(uploaded.error || "Falha no upload da imagem.", "error");
          return;
        }
        imageUrl = uploaded.url;
      }

      const safeUser = {
        userId: user.uid ? String(user.uid) : "",
        userName: user.nome || "Anônimo",
        handle: user.apelido ? `@${user.apelido}` : "@atleta",
        avatar: user.foto || "https://github.com/shadcn.png",
        plano_cor: typeof user.plano_cor === "string" ? user.plano_cor : undefined,
        plano_icon: typeof user.plano_icon === "string" ? user.plano_icon : undefined,
        plano: typeof user.plano === "string" ? user.plano : undefined,
        patente: typeof user.patente === "string" ? user.patente : undefined,
        patente_icon: typeof user.patente_icon === "string" ? user.patente_icon : undefined,
        patente_cor: typeof user.patente_cor === "string" ? user.patente_cor : undefined,

        role: effectiveUserRole,
        tenant_role: user.tenant_role ? String(user.tenant_role) : "",
      };

      const createdDoc = await createCommunityPost({
        ...safeUser,
        texto: newPostText,
        imagem: imageUrl,
        likes: [],
        hype: [],
        comentarios: 0,
        denunciasCount: 0,
        categoria: activeTab,
        blocked: false,
        commentsDisabled: false,
      }, {
        tenantId: activeTenantId || user?.tenant_id || undefined,
      });

      const optimisticPost: PostData = {
        id: createdDoc.id,
        ...safeUser,
        texto: newPostText,
        imagem: imageUrl,
        likes: [],
        hype: [],
        comentarios: 0,
        denunciasCount: 0,
        categoria: activeTab,
        blocked: false,
        commentsDisabled: false,
        createdAt: nowDateLike(),
      };

      setAllPostsRaw((prev) => [optimisticPost, ...prev]);
      setRecentByCategory((prev) => ({ ...prev, [activeTab]: (prev[activeTab] ?? 0) + 1 }));
      setUnreadByCategory((prev) => ({ ...prev, [activeTab]: 0 }));
      setCountsRefreshToken((prev) => prev + 1);
      setNewPostText("");
      setImageFile(null);
      addToast("Postado!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao postar.", "error");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleComment = async () => {
      if (!user) return addToast("Faça login!", "error");
      if (!newComment.trim()) return;
      if (!commentModal) return;
      if (isPostingComment) return;

      const oneDayAgo = new Date().getTime() - 24 * 60 * 60 * 1000;
      const myCommentsToday = commentsList.filter(
          (comment) =>
              comment.userId === user.uid &&
              comment.createdAt &&
              comment.createdAt.toDate().getTime() > oneDayAgo
      );

      if (myCommentsToday.length > 0 && !isAdminModerator) {
          return addToast("Você já comentou neste post hoje.", "error");
      }

      setIsPostingComment(true);
      try {
          const safeUser = {
              userId: user.uid ? String(user.uid) : "",
              userName: user.nome || "Anônimo",
              avatar: user.foto || "/logo.png",
              plano_cor: typeof user.plano_cor === "string" ? user.plano_cor : undefined,
              plano_icon: typeof user.plano_icon === "string" ? user.plano_icon : undefined,
              plano: typeof user.plano === "string" ? user.plano : undefined,
              patente: typeof user.patente === "string" ? user.patente : undefined,
              patente_icon: typeof user.patente_icon === "string" ? user.patente_icon : undefined,
              patente_cor: typeof user.patente_cor === "string" ? user.patente_cor : undefined,

              role: effectiveUserRole,
              tenant_role: user.tenant_role ? String(user.tenant_role) : "",
          };

          const createdCommentRef = await createCommunityComment({
              postId: commentModal,
              tenantId: activeTenantId || user?.tenant_id || undefined,
              data: {
                  ...safeUser,
                  texto: newComment,
                  likes: [],
              },
          });

          const optimisticComment: CommentData = {
              id: createdCommentRef.id,
              ...safeUser,
              texto: newComment,
              likes: [],
              createdAt: nowDateLike(),
          };

          setCommentsList((prev) => {
              const updated = [optimisticComment, ...prev];
              updated.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
              return updated;
          });

          setAllPostsRaw((prev) =>
              prev.map((post) =>
                  post.id === commentModal
                      ? { ...post, comentarios: (post.comentarios || 0) + 1 }
                      : post
              )
          );

          setNewComment("");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao comentar.", "error");
      } finally {
          setIsPostingComment(false);
      }
  };

  const handleDeletePost = async (post: PostData) => {
      if (!user) return;
      if (post.userId !== user.uid && !isAdminModerator) return;
      if (!confirm("Tem certeza que quer apagar essa mensagem?")) return;

      try {
          await deleteCommunityPost(post.id, {
            tenantId: activeTenantId || user?.tenant_id || undefined,
          });
          setAllPostsRaw((prev) => prev.filter((item) => item.id !== post.id));
          setCountsRefreshToken((prev) => prev + 1);
          addToast("Mensagem apagada.", "info");
          setMenuOpen(null);
      } catch {
          addToast("Erro ao apagar.", "error");
      }
  };

  const handleDeleteComment = async (commentId: string) => {
      if (!user || !commentModal) return;
      if (!confirm("Excluir comentário?")) return;
      try {
          await deleteCommunityComment(commentModal, commentId, {
            tenantId: activeTenantId || user?.tenant_id || undefined,
          });

          setCommentsList((prev) => prev.filter((comment) => comment.id !== commentId));
          setAllPostsRaw((prev) =>
              prev.map((post) =>
                  post.id === commentModal
                      ? { ...post, comentarios: Math.max(0, (post.comentarios || 0) - 1) }
                      : post
              )
          );

          addToast("Comentário removido.", "info");
          setCommentMenuOpen(null);
      } catch {
          addToast("Erro ao excluir.", "error");
      }
  };

  const handleReport = async () => {
      if (!user) return addToast("Faça login!", "error");
      if (!reportReason) return addToast("Selecione um motivo!", "error");
      if (!reportModal) return;

      const finalReason = reportReason === "Outros" ? `Outros: ${otherReasonText}` : reportReason;

      const postAlvo = posts.find((post) => post.id === reportModal);
      const textoSalvo = postAlvo ? postAlvo.texto : "Conteúdo reportado";

      try {
          await createCommunityReport({
              targetId: reportModal,
              targetType: reportTargetType,
              postText: textoSalvo,
              reporterId: user.uid,
              reason: finalReason,
              tenantId: activeTenantId || user?.tenant_id || undefined,
          });

          if (reportTargetType === "post" && postAlvo) {
              setAllPostsRaw((prev) =>
                  prev.map((post) =>
                      post.id === reportModal
                          ? { ...post, denunciasCount: (post.denunciasCount || 0) + 1 }
                          : post
                  )
              );
          }

          addToast("Denúncia enviada.", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao enviar denúncia.", "error");
      } finally {
          setReportModal(null);
          setReportReason("");
          setOtherReasonText("");
      }
  };

  const handleTogglePin = async (post: PostData) => {
      if (!isAdminModerator) return;

      try {
          const nextStatus = !post.fixado;
          await setCommunityPostPatch(post.id, { fixado: nextStatus }, {
            tenantId: activeTenantId || user?.tenant_id || undefined,
          });
          setAllPostsRaw((prev) =>
              prev.map((item) =>
                  item.id === post.id ? { ...item, fixado: nextStatus } : item
              )
          );
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar destaque do post.", "error");
      } finally {
          setMenuOpen(null);
      }
  };

  const toggleAction = async (postId: string, field: "likes" | "hype") => {
    if (!user) return;
    if (!user.uid) return;

    try {
      const result = await toggleCommunityPostReaction({
          postId,
          field,
          userId: user.uid,
          tenantId: activeTenantId || user?.tenant_id || undefined,
      });

      setAllPostsRaw((prev) =>
          prev.map((post) => {
              if (post.id !== postId) return post;
              if (field === "likes") {
                  return { ...post, likes: result.values };
              }

              return { ...post, hype: result.values };
          })
      );
    } catch (error: unknown) {
      console.error(error);
    }
  };

  const toggleCommentLike = async (comment: CommentData) => {
      if (!user || !commentModal) return;
      if (!user.uid) return;

      try {
          const result = await toggleCommunityCommentLike({
              postId: commentModal,
              commentId: comment.id,
              userId: user.uid,
              tenantId: activeTenantId || user?.tenant_id || undefined,
          });

          setCommentsList((prev) => {
              const updated = prev.map((item) => {
                  if (item.id !== comment.id) return item;
                  return { ...item, likes: result.values };
              });

              updated.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
              return updated;
          });
      } catch (error: unknown) {
          console.error(error);
      }
  };

  const currentPostCommentsDisabled = posts.find((post) => post.id === commentModal)?.commentsDisabled;

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans pb-24">
      {/* CAPA & HEADER */}
      <div className="h-48 w-full relative overflow-hidden group">
          <Image 
            src={config.capaUrl || "/carteirinha-bg.jpg"} 
            fill
            sizes="100vw"
            className="object-cover opacity-40 blur-sm scale-110 group-hover:scale-100 transition duration-1000" 
            alt="Capa Comunidade"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/50 to-transparent" />
          <div className="absolute top-4 left-4 z-20"><Link href={tenantSlug ? withTenantSlug(tenantSlug, "/dashboard") : "/dashboard"} className="p-2 bg-black/50 rounded-full text-white hover:bg-emerald-500 hover:text-black transition"><ArrowLeft size={24}/></Link></div>
          <div className="absolute bottom-4 left-6 z-20">
              <h1 className="text-3xl font-black italic uppercase tracking-tighter">{config.titulo || "Comunidade da Atletica"}</h1>
              <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{config.subtitulo || "Espaco oficial da atletica"}</p>
          </div>
      </div>

      {/* ABAS DINÂMICAS */}
      <div className="sticky top-0 z-30 bg-[#050505]/95 backdrop-blur-md border-b border-zinc-900 overflow-x-auto custom-scrollbar">
          <div className="flex gap-2 p-3 min-w-max">
              {modalidades.map(mod => {
                  const unreadCount = unreadByCategory[mod] ?? 0;
                  const recentCount = recentByCategory[mod] ?? 0;
                  const badgeCount = unreadCount > 0 ? unreadCount : recentCount;
                  const isUnreadBadge = unreadCount > 0;
                  return (
                      <button key={mod} onClick={() => setActiveTab(mod)} className={`relative px-4 py-2 rounded-full text-[10px] font-black uppercase transition-all border ${activeTab === mod ? 'bg-emerald-500 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                          {mod}
                          {badgeCount > 0 && activeTab !== mod && (
                              <span
                                className={`absolute -top-1 -right-1 text-[8px] min-w-4 h-4 px-1 flex items-center justify-center rounded-full border border-black ${
                                  isUnreadBadge ? "bg-emerald-500 text-black animate-pulse" : "bg-red-500 text-white"
                                }`}
                                title={isUnreadBadge ? "Mensagens não lidas" : "Mensagens recentes (2 dias)"}
                              >
                                  {badgeCount > 9 ? '9+' : badgeCount}
                              </span>
                          )}
                      </button>
                  )
              })}
          </div>
      </div>

      {/* FILTROS */}
      <div className="flex justify-around border-b border-zinc-900 bg-zinc-900/30 p-2 text-[10px] uppercase font-bold text-zinc-500">
          <button onClick={() => setActiveFilter('recent')} className={`flex items-center gap-1 hover:text-white ${activeFilter === 'recent' ? 'text-emerald-500' : ''}`}>Recentes</button>
          <button onClick={() => setActiveFilter('likes')} className={`flex items-center gap-1 hover:text-white ${activeFilter === 'likes' ? 'text-red-500' : ''}`}>Em Alta</button>
          <button onClick={() => setActiveFilter('comments')} className={`flex items-center gap-1 hover:text-white ${activeFilter === 'comments' ? 'text-blue-500' : ''}`}>Polêmicos</button>
          <button onClick={() => setActiveFilter('hype')} className={`flex items-center gap-1 hover:text-white ${activeFilter === 'hype' ? 'text-orange-500' : ''}`}>Hypados</button>
      </div>

      <main className="max-w-2xl mx-auto">
        {/* POSTAR */}
        <div className="p-4 border-b border-zinc-900 bg-zinc-900/20">
            <div className="flex gap-3">
                <div className="relative w-10 h-10 shrink-0">
                    <Image 
                        src={user?.foto || "https://github.com/shadcn.png"} 
                        fill 
                        sizes="40px"
                        className="rounded-full object-cover" 
                        alt="Avatar"
                    />
                </div>
                <div className="flex-1 relative">
                    <textarea 
                        value={newPostText} 
                        onChange={e => setNewPostText(e.target.value)} 
                        placeholder={`Mandar um salve na aba ${activeTab}...`} 
                        className="bg-transparent w-full resize-none text-sm outline-none pt-2 placeholder:text-zinc-600 h-20"
                        maxLength={150} 
                    />
                    <span className={`absolute bottom-0 right-0 text-[9px] font-bold ${newPostText.length >= 140 ? "text-red-500" : "text-zinc-600"}`}>
                        {newPostText.length}/150
                    </span>
                </div>
            </div>
            <div className="flex justify-between items-center mt-3">
                <label className="p-2 hover:bg-zinc-800 rounded-full cursor-pointer text-emerald-500"><ImageIcon size={20}/><input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={isPublishing} onChange={e => handleSelectImage(e.target.files?.[0] || null)}/></label>
                
                <button 
                    onClick={handlePublish} 
                    disabled={isPublishing} 
                    className={`px-6 py-2 rounded-full font-black uppercase text-xs transition shadow-lg flex items-center gap-2 ${isPublishing ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                >
                    {isPublishing ? <><Loader2 className="animate-spin" size={14}/> Enviando...</> : "Publicar"}
                </button>
            </div>
        </div>

        {/* FEED */}
        <div className="divide-y divide-zinc-900">
            {loading ? <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-emerald-500" size={40}/></div> : posts.map(post => (
                <div key={post.id} className={`p-4 hover:bg-zinc-900/10 transition group relative ${post.blocked ? 'opacity-50 grayscale' : ''}`}>
                    
                    {post.blocked && <div className="bg-red-500/10 text-red-500 text-[10px] font-bold uppercase px-2 py-1 mb-2 rounded border border-red-500/20 inline-block">🚫 Post Bloqueado (Admin)</div>}

                    <div className="flex gap-3">
                        <Link href={tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${post.userId}`) : `/perfil/${post.userId}`}>
                            <div className="w-10 h-10 relative">
                                <Image src={post.avatar} fill sizes="40px" className="rounded-full border border-zinc-800 object-cover" alt={post.userName}/>
                            </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <Link href={tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${post.userId}`) : `/perfil/${post.userId}`} className={`font-bold text-sm hover:underline transition ${resolvePlanTextClass(post.plano_cor, "text-zinc-200")}`}>
                                            {post.userName}
                                        </Link>
                                        <UserBadges userData={post} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-zinc-500">{post.handle}</p>
                                        <span className="text-[9px] text-zinc-600 font-mono">⬢ {formatCustomDate(post.createdAt)}</span>
                                    </div>
                                </div>
                                <button onClick={() => setMenuOpen(menuOpen === post.id ? null : post.id)} className="text-zinc-600 hover:text-white p-1"><MoreHorizontal size={16}/></button>
                                {menuOpen === post.id && (
                                    <div className="absolute right-4 top-8 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-10 overflow-hidden min-w-[140px]">
                                            {isAdminModerator && <button onClick={() => handleTogglePin(post)} className="w-full text-left px-4 py-3 text-xs font-bold text-white hover:bg-zinc-800 flex items-center gap-2"><Pin size={14}/> {post.fixado ? 'Desafixar' : 'Fixar'}</button>}
                                            {(user?.uid === post.userId || isAdminModerator) && (
                                                <button onClick={() => handleDeletePost(post)} className="w-full text-left px-4 py-3 text-xs font-bold text-red-500 hover:bg-zinc-800 flex items-center gap-2"><Trash2 size={14}/> Excluir</button>
                                            )}
                                            <button onClick={() => {setReportModal(post.id); setReportTargetType("post"); setMenuOpen(null)}} className="w-full text-left px-4 py-3 text-xs font-bold text-yellow-500 hover:bg-zinc-800 flex items-center gap-2"><Flag size={14}/> Denunciar</button>
                                    </div>
                                )}
                            </div>

                            <p className="text-sm text-zinc-300 mt-2 whitespace-pre-line leading-relaxed break-words">{post.texto}</p>
                            {post.imagem && (
                                <div className="mt-3 relative w-full h-64 sm:h-96 rounded-xl overflow-hidden border border-zinc-800">
                                    <Image src={post.imagem} fill sizes="(max-width: 640px) 100vw, 640px" className="object-cover" alt="Post Image" />
                                </div>
                            )}
                            
                            <div className="flex justify-between mt-4 max-w-xs text-zinc-500">
                                <button onClick={() => setCommentModal(post.id)} className="flex items-center gap-1.5 hover:text-blue-400 transition">
                                    <MessageCircle size={18}/> {post.comentarios || 0}
                                    {post.commentsDisabled && <Lock size={12} className="text-red-500 ml-1"/>}
                                </button>
                                <button onClick={() => toggleAction(post.id, "likes")} className={`flex items-center gap-1.5 transition ${post.likes?.includes(user?.uid || "") ? 'text-red-500' : 'hover:text-red-500'}`}><Heart size={18} className={post.likes?.includes(user?.uid || "") ? "fill-red-500" : ""} /> {post.likes?.length || 0}</button>
                                <div className="group relative">
                                    <button onClick={() => toggleAction(post.id, "hype")} className={`flex items-center gap-1.5 transition ${post.hype?.includes(user?.uid || "") ? 'text-orange-500' : 'hover:text-orange-500'}`}>
                                        <Flame size={18} className={post.hype?.includes(user?.uid || "") ? "fill-orange-500" : ""}/> <span className="text-[10px]">{post.hype?.length || 0}</span>
                                    </button>
                                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-orange-500 text-black text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap">Dar um Hype!</span>
                                </div>
                                <div className="flex items-center gap-1 text-blue-500/50 cursor-default" title="Denúncias"><Flag size={16} className={post.denunciasCount > 0 ? "fill-blue-900 text-blue-500" : ""}/> {post.denunciasCount > 0 && <span className="text-[10px]">{post.denunciasCount}</span>}</div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
            {posts.length === 0 && !loading && <div className="py-20 text-center text-zinc-600 text-sm">Seja o primeiro a postar em <b>{activeTab}</b>! 🚀</div>}
        </div>
      </main>

      {/* MODAL COMENTÁRIOS */}
      {commentModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setCommentModal(null)}>
              <div className="bg-zinc-900 w-full max-w-md h-[80vh] sm:rounded-3xl rounded-t-3xl border border-zinc-800 flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900 sm:rounded-t-3xl">
                      <h3 className="font-bold text-white flex items-center gap-2">Comentários {currentPostCommentsDisabled && <Lock size={14} className="text-red-500"/>}</h3>
                      <button onClick={() => setCommentModal(null)}><X size={20} className="text-zinc-500"/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                      {commentsList.length === 0 && <p className="text-center text-zinc-600 text-xs py-10">Nenhum comentário ainda.</p>}
                      {commentsList.map(comment => (
                          <div key={comment.id} className="flex gap-3 group">
                              <Link href={tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${comment.userId}`) : `/perfil/${comment.userId}`}>
                                  <div className="w-8 h-8 relative">
                                      <Image src={comment.avatar} fill sizes="32px" className="rounded-full object-cover border border-zinc-700" alt={comment.userName}/>
                                  </div>
                              </Link>
                              <div className="flex-1">
                                  <div className="bg-zinc-800/50 p-3 rounded-2xl rounded-tl-none border border-zinc-800/50 w-full">
                                      <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                              <Link href={tenantSlug ? withTenantSlug(tenantSlug, `/perfil/${comment.userId}`) : `/perfil/${comment.userId}`} className={`text-xs font-bold hover:underline ${resolvePlanTextClass(comment.plano_cor, "text-white")}`}>{comment.userName}</Link>
                                              <UserBadges userData={comment}/> 
                                              <span className="text-[8px] text-zinc-600 ml-auto">{formatCustomDate(comment.createdAt)}</span>
                                          </div>
                                          <button onClick={() => setCommentMenuOpen(commentMenuOpen === comment.id ? null : comment.id)} className="text-zinc-500 hover:text-white"><MoreHorizontal size={14}/></button>
                                      </div>
                                      <p className="text-xs text-zinc-300 mt-1">{comment.texto}</p>
                                  </div>
                                  
                                  <div className="flex items-center gap-4 mt-1 ml-2">
                                      <button onClick={() => toggleCommentLike(comment)} className={`text-[10px] font-bold flex items-center gap-1 ${comment.likes?.includes(user?.uid || "") ? 'text-red-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                                          <Heart size={12} className={comment.likes?.includes(user?.uid || "") ? "fill-red-500" : ""}/> {comment.likes?.length || 0}
                                      </button>
                                  </div>

                                  {commentMenuOpen === comment.id && (
                                      <div className="absolute ml-8 -mt-8 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-20 overflow-hidden min-w-[120px]">
                                          {(user?.uid === comment.userId || isAdminModerator) && (
                                              <button onClick={() => handleDeleteComment(comment.id)} className="w-full text-left px-3 py-2 text-[10px] font-bold text-red-500 hover:bg-zinc-800 flex items-center gap-2"><Trash2 size={12}/> Excluir</button>
                                          )}
                                          <button onClick={() => {setReportModal(comment.id); setReportTargetType("comment"); setCommentMenuOpen(null)}} className="w-full text-left px-3 py-2 text-[10px] font-bold text-yellow-500 hover:bg-zinc-800 flex items-center gap-2"><Flag size={12}/> Denunciar</button>
                                      </div>
                                  )}
                              </div>
                          </div>
                      ))}
                  </div>
                  {!currentPostCommentsDisabled ? (
                      <div className="p-3 border-t border-zinc-800 bg-black flex gap-2 sm:rounded-b-3xl">
                          <input type="text" value={newComment} onChange={e => setNewComment(e.target.value.slice(0, 220))} maxLength={220} placeholder="Escreva..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 text-sm text-white outline-none focus:border-emerald-500" onKeyDown={e => e.key === 'Enter' && handleComment()}/>
                          <button onClick={handleComment} disabled={!newComment.trim() || isPostingComment} className={`p-2.5 rounded-full text-white transition ${isPostingComment ? 'bg-zinc-700 opacity-50' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                              {isPostingComment ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>}
                          </button>
                      </div>
                  ) : (
                      <div className="p-4 bg-red-900/20 text-red-500 text-xs font-bold text-center border-t border-red-900/30">
                          <Lock size={14} className="inline mr-2"/> Comentários desativados pela moderação.
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* MODAL DENÚNCIA */}
      {reportModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4" onClick={() => setReportModal(null)}>
              <div className="bg-zinc-900 w-full max-w-sm p-6 rounded-3xl border border-zinc-800 space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="text-center">
                      <AlertTriangle size={40} className="text-red-500 mx-auto mb-2"/>
                      <h3 className="font-black uppercase text-lg">Reportar {reportTargetType === 'post' ? 'Post' : 'Comentário'}</h3>
                  </div>
                  <div className="space-y-2">
                      {["Conteúdo Ofensivo", "Spam / Propaganda", "Fake News", "Assédio", "Outros"].map(reason => (
                          <button key={reason} onClick={() => setReportReason(reason)} className={`w-full p-3 rounded-xl text-xs font-bold text-left border transition ${reportReason === reason ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>{reason}</button>
                      ))}
                      {reportReason === "Outros" && (
                          <input type="text" maxLength={50} placeholder="Descreva (max 50 chars)..." className="w-full bg-black border border-zinc-700 rounded-xl p-3 text-xs text-white outline-none focus:border-red-500" value={otherReasonText} onChange={e => setOtherReasonText(e.target.value)}/>
                      )}
                  </div>
                  <button onClick={handleReport} className="w-full bg-red-600 py-3 rounded-xl font-black uppercase text-xs hover:bg-red-500 transition">Enviar Denúncia</button>
              </div>
          </div>
      )}
    </div>
  );
}





