"use client";

import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Heart, MessageCircle, MoreHorizontal, Flame, 
  Image as ImageIcon, ShieldCheck, Pin, X, Loader2, AlertTriangle, Send, Trash2, Flag,
  Crown, Star, Ghost, Lock, Zap, Gem, Trophy, Fish, User, 
  Swords, Skull, Rocket, Medal, ThumbsUp, LayoutGrid, UserPlus, Target
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // 🦈 Importando Image
import { db, storage } from "@/lib/backend";
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  arrayUnion,
  arrayRemove,
  deleteDoc,
  Timestamp,
  increment,
} from "@/lib/supa/firestore";
import { ref, uploadBytes, getDownloadURL } from "@/lib/supa/storage";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Security } from "../../lib/security";
import { compressImageFile } from "../../lib/imageCompression";
import { validateImageFile } from "../../lib/upload";
import {
  fetchCommunityComments,
  fetchCommunityConfig,
  fetchCommunityFeed,
} from "../../lib/communityService";

// --- TIPAGEM ---

interface AppConfig {
    titulo?: string;
    subtitulo?: string;
    capaUrl?: string;
    limitMessages?: boolean;
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
    blocked?: boolean;
    fixado?: boolean;
    isTreinador?: boolean;
    commentsDisabled?: boolean;
    createdAt: Timestamp | null;
    isRecent?: boolean; 
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
    createdAt: Timestamp | null;
}

// --- CONSTANTES ---

const CATEGORIAS_OFICIAIS = [
    "Geral", "Futebol", "Vôlei", "Basquete", "Handebol", 
    "Sinuca", "Truco", "Natação", "Bateria", "Cheerleaders", "Sugestões"
];

const PLAN_COLORS: Record<string, string> = {
    yellow: "text-yellow-400",
    emerald: "text-emerald-400",
    purple: "text-purple-400",
    blue: "text-blue-400",
    red: "text-red-500",
    zinc: "text-zinc-400"
};

// --- FUNÇÕES AUXILIARES ---

const formatCustomDate = (timestamp: Timestamp | null | undefined) => {
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

// 🦈 UserBadges tipado corretamente (Fim do any)
const UserBadges = ({ userData }: { userData: Partial<PostData | CommentData> }) => {
    const isAdmin = userData?.role?.includes('admin') || userData?.role === 'master';
    
    // 1. Definição dos Ícones
    const rawPlanIcon = userData?.plano_icon || 'user';
    const planIconName = String(rawPlanIcon).toLowerCase().trim();

    const rawPatentIcon = userData?.patente_icon || 'fish';
    const patentIconName = String(rawPatentIcon).toLowerCase().trim();
    
    // 2. Definição das Cores
    const rawPlanColor = userData?.plano_cor || "text-zinc-400";
    const planColorClass = rawPlanColor.startsWith('text-') ? rawPlanColor : (PLAN_COLORS[rawPlanColor] || "text-zinc-400");

    const rawPatentColor = userData?.patente_cor || "text-zinc-400";
    const patentColorClass = rawPatentColor.startsWith('text-') ? rawPatentColor : (PLAN_COLORS[rawPatentColor] || "text-zinc-400");

    // Mapa Visual Completo
    const icons: Record<string, React.ElementType> = { 
        ghost: Ghost, star: Star, crown: Crown, fish: Fish, 
        trophy: Trophy, gem: Gem, zap: Zap, swords: Swords, 
        skull: Skull, rocket: Rocket, medal: Medal, heart: Heart,
        thumbsup: ThumbsUp, layoutgrid: LayoutGrid, userplus: UserPlus, 
        target: Target, user: User 
    };
    
    const PlanIcon = icons[planIconName] || User;
    const PatentIcon = icons[patentIconName] || Fish;

    const tooltipText = `${userData?.patente || 'Novato'} • ${userData?.plano || 'Visitante'}`;

    return (
        <div className="flex items-center gap-1.5 ml-1 select-none" title={tooltipText}>
            {isAdmin && (
                <span className="flex items-center bg-red-500/10 p-0.5 rounded border border-red-500/20">
                    <ShieldCheck size={10} className="text-red-500" />
                </span>
            )}
            <span className={`flex items-center opacity-80 ${planColorClass}`}>
                <PlanIcon size={12} />
            </span>
            {planIconName !== patentIconName && (
                <span className={`flex items-center ${patentColorClass}`}> 
                    <PatentIcon size={14} className="drop-shadow-sm" />
                </span>
            )}
        </div>
    );
};

export default function ComunidadePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  
  const [activeTab, setActiveTab] = useState("Geral");
  const [activeFilter, setActiveFilter] = useState<"recent" | "likes" | "comments" | "hype">("recent");
  // 🦈 Removido setModalidades não utilizado
  const [modalidades] = useState<string[]>(CATEGORIAS_OFICIAIS);
  
  const [posts, setPosts] = useState<PostData[]>([]);
  const [allPostsRaw, setAllPostsRaw] = useState<PostData[]>([]);
  const [config, setConfig] = useState<AppConfig>({});
  const [loading, setLoading] = useState(true);
  
  const [newPostText, setNewPostText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  // 🦈 TRAVAS ANTI-SPAM
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
        const configData = await fetchCommunityConfig();
        if (!mounted || !configData) return;
        setConfig((prev) => ({ ...prev, ...(configData as Partial<AppConfig>) }));
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar configuracoes da comunidade.", "error");
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  useEffect(() => {
    let mounted = true;

    const loadPosts = async () => {
      setLoading(true);
      try {
        const rows = await fetchCommunityFeed(40);
        if (!mounted) return;

        let data = rows.map(
          (row) =>
            ({
              id: row.id,
              ...(row.data as Omit<PostData, "id">),
            }) as PostData
        );

        if (!user?.role?.includes("admin")) {
          data = data.filter((post) => !post.blocked);
        }

        const now = Date.now();
        data = data.map((post) => {
          const createdAt = post.createdAt instanceof Timestamp ? post.createdAt : null;
          const likes = Array.isArray(post.likes)
            ? post.likes.filter((item): item is string => typeof item === "string")
            : [];
          const hype = Array.isArray(post.hype)
            ? post.hype.filter((item): item is string => typeof item === "string")
            : [];

          return {
            ...post,
            createdAt,
            likes,
            hype,
            comentarios: typeof post.comentarios === "number" ? post.comentarios : 0,
            denunciasCount: typeof post.denunciasCount === "number" ? post.denunciasCount : 0,
            isRecent: createdAt
              ? now - createdAt.toDate().getTime() < 24 * 60 * 60 * 1000
              : false,
          };
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
  }, [user?.role, addToast]);

  useEffect(() => {
      const filteredByTab = allPostsRaw.filter((post) => post.categoria === activeTab);
      const ordered = [...filteredByTab];

      if (activeFilter === "recent") {
          ordered.sort(
              (a, b) =>
                  (b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0) -
                  (a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0)
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
  }, [allPostsRaw, activeTab, activeFilter, config.limitMessages]);

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
              });

              if (!mounted) return;

              const comments = rows.map((row) => {
                  const raw = row.data as Record<string, unknown>;
                  const rawLikes = raw.likes;
                  const likes = Array.isArray(rawLikes)
                      ? rawLikes.filter((item): item is string => typeof item === "string")
                      : [];

                  const rawCreatedAt = raw.createdAt;
                  const createdAt = rawCreatedAt instanceof Timestamp ? rawCreatedAt : null;

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
              if (mounted) addToast("Erro ao carregar comentarios.", "error");
          }
      };

      void loadComments();
      return () => {
          mounted = false;
      };
  }, [commentModal, addToast]);

  const getRecentCount = (cat: string) => {
      return allPostsRaw.filter((post) => post.categoria === cat && post.isRecent).length;
  };

  const handlePublish = async () => {
    if (!user) return addToast("Fa�a login!", "error");
    if (isPublishing) return;

    const securityCheck = await Security.canUserPost(user.uid);
    if (!securityCheck.allowed) return addToast(securityCheck.reason || "Aguarde...", "error");

    if (!newPostText.trim() && !imageFile) return;

    if (newPostText.length > 150) {
      return addToast("Maximo de 150 caracteres! Seja direto, Tubarao.", "error");
    }

    const oneDayAgo = new Date().getTime() - 24 * 60 * 60 * 1000;
    const userPostsToday = allPostsRaw.filter(
      (post) =>
        post.userId === user.uid &&
        post.categoria === activeTab &&
        post.createdAt &&
        post.createdAt.toDate().getTime() > oneDayAgo
    );

    if (userPostsToday.length > 0 && !user.role?.includes("admin")) {
      return addToast(`Voce ja postou em "${activeTab}" hoje. Volte amanha!`, "error");
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

        const optimizedImage = await compressImageFile(imageFile, {
          maxWidth: 1600,
          maxHeight: 1600,
          quality: 0.82,
        });

        const storageRef = ref(storage, `posts/${Date.now()}_${user.uid}`);
        await uploadBytes(storageRef, optimizedImage);
        imageUrl = await getDownloadURL(storageRef);
      }

      const safeUser = {
        userId: user.uid ? String(user.uid) : "",
        userName: user.nome || "An�nimo",
        handle: user.apelido ? `@${user.apelido}` : "@atleta",
        avatar: user.foto || "https://github.com/shadcn.png",

        plano_cor: user.plano_cor ? String(user.plano_cor) : "zinc",
        plano_icon: user.plano_icon ? String(user.plano_icon) : "user",
        plano: user.plano ? String(user.plano) : "Visitante",

        patente: user.patente ? String(user.patente) : "Novato",
        patente_icon: user.patente_icon || "Fish",
        patente_cor: user.patente_cor || "text-zinc-400",

        role: user.role ? String(user.role) : "user",
      };

      const createdDoc = await addDoc(collection(db, "posts"), {
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
        createdAt: serverTimestamp(),
      });

      if (user.uid) {
        await updateDoc(doc(db, "users", user.uid), {
          "stats.postsCount": increment(1),
        });
      }

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
        createdAt: Timestamp.now(),
        isRecent: true,
      };

      setAllPostsRaw((prev) => [optimisticPost, ...prev]);
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
      if (!user) return addToast("Fa�a login!", "error");
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

      if (myCommentsToday.length > 0 && !user.role?.includes("admin")) {
          return addToast("Voce ja comentou neste post hoje.", "error");
      }

      setIsPostingComment(true);
      try {
          const safeUser = {
              userId: user.uid ? String(user.uid) : "",
              userName: user.nome || "Anonimo",
              avatar: user.foto || "/logo.png",

              plano_cor: user.plano_cor ? String(user.plano_cor) : "zinc",
              plano_icon: user.plano_icon ? String(user.plano_icon) : "user",
              plano: user.plano ? String(user.plano) : "Membro",

              patente: user.patente ? String(user.patente) : "Novato",
              patente_icon: user.patente_icon || "Fish",
              patente_cor: user.patente_cor || "text-zinc-400",

              role: user.role ? String(user.role) : "user",
          };

          const createdCommentRef = await addDoc(collection(db, `posts/${commentModal}/comments`), {
              ...safeUser,
              texto: newComment,
              likes: [],
              createdAt: serverTimestamp(),
          });

          await updateDoc(doc(db, "posts", commentModal), {
              comentarios: increment(1),
          });

          if (user.uid) {
              await updateDoc(doc(db, "users", user.uid), {
                  "stats.commentsCount": increment(1),
              });
          }

          const optimisticComment: CommentData = {
              id: createdCommentRef.id,
              ...safeUser,
              texto: newComment,
              likes: [],
              createdAt: Timestamp.now(),
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
      if (post.userId !== user.uid && !user.role?.includes("admin")) return;
      if (!confirm("Tem certeza que quer apagar essa mensagem?")) return;

      try {
          await deleteDoc(doc(db, "posts", post.id));
          setAllPostsRaw((prev) => prev.filter((item) => item.id !== post.id));
          addToast("Mensagem apagada.", "info");
          setMenuOpen(null);
      } catch {
          addToast("Erro ao apagar.", "error");
      }
  };

  const handleDeleteComment = async (commentId: string) => {
      if (!user || !commentModal) return;
      if (!confirm("Excluir comentario?")) return;
      try {
          await deleteDoc(doc(db, `posts/${commentModal}/comments`, commentId));
          await updateDoc(doc(db, "posts", commentModal), { comentarios: increment(-1) });

          setCommentsList((prev) => prev.filter((comment) => comment.id !== commentId));
          setAllPostsRaw((prev) =>
              prev.map((post) =>
                  post.id === commentModal
                      ? { ...post, comentarios: Math.max(0, (post.comentarios || 0) - 1) }
                      : post
              )
          );

          addToast("Comentario removido.", "info");
          setCommentMenuOpen(null);
      } catch {
          addToast("Erro ao excluir.", "error");
      }
  };

  const handleReport = async () => {
      if (!user) return addToast("Fa�a login!", "error");
      if (!reportReason) return addToast("Selecione um motivo!", "error");
      if (!reportModal) return;

      const finalReason = reportReason === "Outros" ? `Outros: ${otherReasonText}` : reportReason;

      const postAlvo = posts.find((post) => post.id === reportModal);
      const textoSalvo = postAlvo ? postAlvo.texto : "Conteudo reportado";

      try {
          await addDoc(collection(db, "denuncias"), {
              targetId: reportModal,
              targetType: reportTargetType,
              postText: textoSalvo,
              reporterId: user.uid,
              reason: finalReason,
              timestamp: serverTimestamp(),
              status: "pendente",
          });

          if (reportTargetType === "post" && postAlvo) {
              await updateDoc(doc(db, "posts", reportModal), {
                  denunciasCount: increment(1),
              });

              setAllPostsRaw((prev) =>
                  prev.map((post) =>
                      post.id === reportModal
                          ? { ...post, denunciasCount: (post.denunciasCount || 0) + 1 }
                          : post
                  )
              );
          }

          addToast("Denuncia enviada.", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao enviar denuncia.", "error");
      } finally {
          setReportModal(null);
          setReportReason("");
          setOtherReasonText("");
      }
  };

  const handleTogglePin = async (post: PostData) => {
      if (!user?.role?.includes("admin")) return;

      try {
          const nextStatus = !post.fixado;
          await updateDoc(doc(db, "posts", post.id), { fixado: nextStatus });
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

  const toggleAction = async (postId: string, field: "likes" | "hype", list: string[]) => {
    if (!user) return;
    if (!user.uid) return;

    const postRef = doc(db, "posts", postId);
    const hasInteracted = list.includes(user.uid);

    const postData = posts.find((post) => post.id === postId);
    const authorId = postData?.userId;

    try {
      await updateDoc(postRef, { [field]: hasInteracted ? arrayRemove(user.uid) : arrayUnion(user.uid) });

      if (authorId && authorId !== user.uid) {
          const statField = field === "likes" ? "stats.likesReceived" : "stats.hypesReceived";
          await updateDoc(doc(db, "users", authorId), {
              [statField]: increment(hasInteracted ? -1 : 1),
          });
      }

      const myStatField = field === "likes" ? "stats.likesGiven" : "stats.hypesGiven";
      await updateDoc(doc(db, "users", user.uid), {
          [myStatField]: increment(hasInteracted ? -1 : 1),
      });

      setAllPostsRaw((prev) =>
          prev.map((post) => {
              if (post.id !== postId) return post;
              if (field === "likes") {
                  const nextLikes = hasInteracted
                      ? (post.likes || []).filter((id) => id !== user.uid)
                      : [...(post.likes || []), user.uid];
                  return { ...post, likes: nextLikes };
              }

              const nextHype = hasInteracted
                  ? (post.hype || []).filter((id) => id !== user.uid)
                  : [...(post.hype || []), user.uid];
              return { ...post, hype: nextHype };
          })
      );
    } catch (error: unknown) {
      console.error(error);
    }
  };

  const toggleCommentLike = async (comment: CommentData) => {
      if (!user || !commentModal) return;
      if (!user.uid) return;

      const commentRef = doc(db, `posts/${commentModal}/comments`, comment.id);
      const hasLiked = comment.likes?.includes(user.uid);
      const authorId = comment.userId;

      try {
          await updateDoc(commentRef, { likes: hasLiked ? arrayRemove(user.uid) : arrayUnion(user.uid) });

          if (authorId && authorId !== user.uid) {
              await updateDoc(doc(db, "users", authorId), {
                  "stats.likesReceived": increment(hasLiked ? -1 : 1),
              });
          }

          await updateDoc(doc(db, "users", user.uid), {
              "stats.likesGiven": increment(hasLiked ? -1 : 1),
          });

          setCommentsList((prev) => {
              const updated = prev.map((item) => {
                  if (item.id !== comment.id) return item;

                  const nextLikes = hasLiked
                      ? (item.likes || []).filter((id) => id !== user.uid)
                      : [...(item.likes || []), user.uid];

                  return { ...item, likes: nextLikes };
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
            className="object-cover opacity-40 blur-sm scale-110 group-hover:scale-100 transition duration-1000" 
            alt="Capa Comunidade"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/50 to-transparent" />
          <div className="absolute top-4 left-4 z-20"><Link href="/dashboard" className="p-2 bg-black/50 rounded-full text-white hover:bg-emerald-500 hover:text-black transition"><ArrowLeft size={24}/></Link></div>
          <div className="absolute bottom-4 left-6 z-20">
              <h1 className="text-3xl font-black italic uppercase tracking-tighter">{config.titulo || "Resenha Tubarão"}</h1>
              <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{config.subtitulo || "Onde o cardume se encontra"}</p>
          </div>
      </div>

      {/* ABAS DINÂMICAS */}
      <div className="sticky top-0 z-30 bg-[#050505]/95 backdrop-blur-md border-b border-zinc-900 overflow-x-auto custom-scrollbar">
          <div className="flex gap-2 p-3 min-w-max">
              {modalidades.map(mod => {
                  const recentCount = getRecentCount(mod);
                  return (
                      <button key={mod} onClick={() => setActiveTab(mod)} className={`relative px-4 py-2 rounded-full text-[10px] font-black uppercase transition-all border ${activeTab === mod ? 'bg-emerald-500 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                          {mod}
                          {recentCount > 0 && activeTab !== mod && (
                              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full border border-black animate-pulse">
                                  {recentCount > 9 ? '9+' : recentCount}
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
                        className="rounded-full object-cover" 
                        alt="Avatar"
                        unoptimized
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
                <label className="p-2 hover:bg-zinc-800 rounded-full cursor-pointer text-emerald-500"><ImageIcon size={20}/><input type="file" className="hidden" onChange={e => handleSelectImage(e.target.files?.[0] || null)}/></label>
                
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
                        <Link href={`/perfil/${post.userId}`}>
                            <div className="w-10 h-10 relative">
                                <Image src={post.avatar} fill className="rounded-full border border-zinc-800 object-cover" alt={post.userName} unoptimized/>
                            </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <Link href={`/perfil/${post.userId}`} className={`font-bold text-sm hover:underline transition ${PLAN_COLORS[post.plano_cor || "zinc"] || "text-zinc-200"}`}>
                                            {post.userName}
                                        </Link>
                                        <UserBadges userData={post} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-zinc-500">{post.handle}</p>
                                        <span className="text-[9px] text-zinc-600 font-mono">• {formatCustomDate(post.createdAt)}</span>
                                    </div>
                                </div>
                                <button onClick={() => setMenuOpen(menuOpen === post.id ? null : post.id)} className="text-zinc-600 hover:text-white p-1"><MoreHorizontal size={16}/></button>
                                {menuOpen === post.id && (
                                    <div className="absolute right-4 top-8 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-10 overflow-hidden min-w-[140px]">
                                            {user?.role?.includes('admin') && <button onClick={() => handleTogglePin(post)} className="w-full text-left px-4 py-3 text-xs font-bold text-white hover:bg-zinc-800 flex items-center gap-2"><Pin size={14}/> {post.fixado ? 'Desafixar' : 'Fixar'}</button>}
                                            {(user?.uid === post.userId || user?.role?.includes('admin')) && (
                                                <button onClick={() => handleDeletePost(post)} className="w-full text-left px-4 py-3 text-xs font-bold text-red-500 hover:bg-zinc-800 flex items-center gap-2"><Trash2 size={14}/> Excluir</button>
                                            )}
                                            <button onClick={() => {setReportModal(post.id); setReportTargetType("post"); setMenuOpen(null)}} className="w-full text-left px-4 py-3 text-xs font-bold text-yellow-500 hover:bg-zinc-800 flex items-center gap-2"><Flag size={14}/> Denunciar</button>
                                    </div>
                                )}
                            </div>

                            <p className="text-sm text-zinc-300 mt-2 whitespace-pre-line leading-relaxed break-words">{post.texto}</p>
                            {post.imagem && (
                                <div className="mt-3 relative w-full h-64 sm:h-96 rounded-xl overflow-hidden border border-zinc-800">
                                    <Image src={post.imagem} fill className="object-cover" alt="Post Image" unoptimized />
                                </div>
                            )}
                            
                            <div className="flex justify-between mt-4 max-w-xs text-zinc-500">
                                <button onClick={() => setCommentModal(post.id)} className="flex items-center gap-1.5 hover:text-blue-400 transition">
                                    <MessageCircle size={18}/> {post.comentarios || 0}
                                    {post.commentsDisabled && <Lock size={12} className="text-red-500 ml-1"/>}
                                </button>
                                <button onClick={() => toggleAction(post.id, "likes", post.likes || [])} className={`flex items-center gap-1.5 transition ${post.likes?.includes(user?.uid || "") ? 'text-red-500' : 'hover:text-red-500'}`}><Heart size={18} className={post.likes?.includes(user?.uid || "") ? "fill-red-500" : ""} /> {post.likes?.length || 0}</button>
                                <div className="group relative">
                                    <button onClick={() => toggleAction(post.id, "hype", post.hype || [])} className={`flex items-center gap-1.5 transition ${post.hype?.includes(user?.uid || "") ? 'text-orange-500' : 'hover:text-orange-500'}`}>
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
                              <Link href={`/perfil/${comment.userId}`}>
                                  <div className="w-8 h-8 relative">
                                      <Image src={comment.avatar} fill className="rounded-full object-cover border border-zinc-700" alt={comment.userName} unoptimized/>
                                  </div>
                              </Link>
                              <div className="flex-1">
                                  <div className="bg-zinc-800/50 p-3 rounded-2xl rounded-tl-none border border-zinc-800/50 w-full">
                                      <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                              <Link href={`/perfil/${comment.userId}`} className={`text-xs font-bold hover:underline ${PLAN_COLORS[comment.plano_cor || "zinc"] || "text-white"}`}>{comment.userName}</Link>
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
                                          {(user?.uid === comment.userId || user?.role?.includes('admin')) && (
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
                          <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Escreva..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 text-sm text-white outline-none focus:border-emerald-500" onKeyDown={e => e.key === 'Enter' && handleComment()}/>
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






