"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  Palette,
  Pin,
  Plus,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import { withTenantSlug } from "@/lib/tenantRouting";
import {
  deleteCommunityPost,
  fetchCommunityAdminPosts,
  fetchCommunityComments,
  fetchCommunityConfig,
  saveCommunityConfig,
  setCommunityPostPatch,
} from "@/lib/communityService";
import type { DateLike } from "@/lib/supabaseData";
import { uploadImage, VERSIONED_PUBLIC_ASSET_CACHE_CONTROL } from "@/lib/upload";
import {
  DEFAULT_COMMUNITY_CATEGORIES,
  normalizeCommunityCategories,
  normalizeCommunityCategoryName,
} from "@/constants/communityCategories";

interface AppConfig {
  titulo: string;
  subtitulo: string;
  capaUrl: string;
  limitMessages: boolean;
  categorias: string[];
}

interface PostData {
  id: string;
  userName: string;
  handle: string;
  avatar: string;
  texto: string;
  createdAt: DateLike;
  blocked?: boolean;
  fixado?: boolean;
  commentsDisabled?: boolean;
  comentarios: number;
  denunciasCount: number;
}

interface CommentData {
  id: string;
  userName: string;
  avatar: string;
  texto: string;
  createdAt: DateLike;
}

const normalizeCommunityConfig = (value?: Partial<AppConfig> | null): AppConfig => ({
  titulo: typeof value?.titulo === "string" ? value.titulo : "",
  subtitulo: typeof value?.subtitulo === "string" ? value.subtitulo : "",
  capaUrl: typeof value?.capaUrl === "string" ? value.capaUrl : "",
  limitMessages: typeof value?.limitMessages === "boolean" ? value.limitMessages : true,
  categorias: normalizeCommunityCategories(value?.categorias ?? DEFAULT_COMMUNITY_CATEGORIES),
});

const isValidImageSrc = (value: string): boolean => {
  const src = value.trim();
  if (!src) return false;
  if (src.startsWith("/")) return true;
  try {
    const parsed = new URL(src);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const toSafeImageSrc = (value: string | null | undefined, fallback: string): string => {
  const src = typeof value === "string" ? value.trim() : "";
  return isValidImageSrc(src) ? src : fallback;
};

const formatDateTime = (value: DateLike): string => {
  if (value instanceof Date) return value.toLocaleString("pt-BR");
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString("pt-BR");
  }

  const raw = value as { toDate?: () => Date } | null;
  if (raw && typeof raw.toDate === "function") {
    const parsed = raw.toDate();
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("pt-BR");
    }
  }

  return "Sem data";
};

export default function AdminComunidadePage() {
  const { addToast } = useToast();
  const { tenantId: activeTenantId, tenantSlug } = useTenantTheme();
  const [activeTab, setActiveTab] = useState<"config" | "posts" | "denuncias">("config");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [config, setConfig] = useState<AppConfig>(normalizeCommunityConfig());
  const [posts, setPosts] = useState<PostData[]>([]);
  const [viewCommentsId, setViewCommentsId] = useState<string | null>(null);
  const [adminComments, setAdminComments] = useState<CommentData[]>([]);
  const [uploadingCover, setUploadingCover] = useState(false);

  const coverPreviewSrc = toSafeImageSrc(config.capaUrl, "/carteirinha-bg.jpg");

  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      setLoading(true);
      try {
        const [configData, postsData] = await Promise.all([
          fetchCommunityConfig({ tenantId: activeTenantId || undefined }),
          fetchCommunityAdminPosts(60, { tenantId: activeTenantId || undefined }),
        ]);

        if (!mounted) return;

        if (configData) {
          setConfig(normalizeCommunityConfig(configData as Partial<AppConfig>));
        }

        setPosts(
          postsData.map(
            (row) =>
              ({
                id: row.id,
                ...(row.data as Omit<PostData, "id">),
              }) as PostData
          )
        );
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar dados da comunidade.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadInitialData();
    return () => {
      mounted = false;
    };
  }, [activeTenantId, addToast]);

  useEffect(() => {
    if (!viewCommentsId) {
      setAdminComments([]);
      return;
    }

    let mounted = true;
    const loadComments = async () => {
      try {
        const rows = await fetchCommunityComments(viewCommentsId, {
          order: "desc",
          maxResults: 60,
          tenantId: activeTenantId || undefined,
        });
        if (!mounted) return;
        setAdminComments(
          rows.map(
            (row) =>
              ({
                id: row.id,
                ...(row.data as Omit<CommentData, "id">),
              }) as CommentData
          )
        );
      } catch (error: unknown) {
        console.error(error);
        if (mounted) addToast("Erro ao carregar comentarios.", "error");
      }
    };

    void loadComments();
    return () => {
      mounted = false;
    };
  }, [addToast, viewCommentsId, activeTenantId]);

  const filteredPosts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return posts;
    return posts.filter(
      (post) =>
        post.userName?.toLowerCase().includes(term) ||
        post.texto?.toLowerCase().includes(term)
    );
  }, [posts, searchTerm]);

  const handleSaveConfig = async () => {
    const cleanCoverUrl = config.capaUrl.trim();
    if (cleanCoverUrl && !isValidImageSrc(cleanCoverUrl)) {
      addToast("URL da capa invalida. Use '/imagem.png' ou URL https://", "error");
      return;
    }

    try {
      const normalizedCategories = normalizeCommunityCategories(config.categorias);
      const nextConfig = {
        titulo: config.titulo,
        subtitulo: config.subtitulo,
        capaUrl: cleanCoverUrl,
        limitMessages: config.limitMessages,
        categorias: normalizedCategories,
      };
      await saveCommunityConfig(nextConfig, {
        tenantId: activeTenantId || undefined,
      });
      setConfig(nextConfig);
      addToast("Configurações da comunidade salvas!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar configurações.", "error");
    }
  };

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || uploadingCover) {
      input.value = "";
      return;
    }

    try {
      setUploadingCover(true);
      const { url, error } = await uploadImage(
        file,
        `community/${activeTenantId || "global"}/covers`,
        {
          scopeKey: "admin:community:cover",
          maxBytes: 3 * 1024 * 1024,
          maxWidth: 2400,
          maxHeight: 1800,
          maxPixels: 3_600_000,
          compressionMaxWidth: 1800,
          compressionMaxHeight: 1200,
          compressionMaxBytes: 220 * 1024,
          fileName: "community-cover",
          upsert: true,
          versionStrategy: "file-metadata",
          cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
        }
      );

      if (error || !url) {
        addToast(`Capa invalida: ${error || "Falha no upload."}`, "error");
        return;
      }

      setConfig((previous) => ({ ...previous, capaUrl: url }));
      addToast(
        "Capa enviada com sucesso. O arquivo foi reduzido para economizar storage e egress.",
        "success"
      );
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao enviar capa da comunidade.", "error");
    } finally {
      setUploadingCover(false);
      input.value = "";
    }
  };

  const handleAddCategory = () => {
    const cleanName = normalizeCommunityCategoryName(newCategoryName);
    if (!cleanName) {
      addToast("Digite um nome de categoria.", "info");
      return;
    }

    const alreadyExists = config.categorias.some(
      (item) => item.toLowerCase() === cleanName.toLowerCase()
    );
    if (alreadyExists) {
      addToast("Essa categoria já existe.", "info");
      return;
    }

    setConfig((prev) => ({ ...prev, categorias: [...prev.categorias, cleanName] }));
    setNewCategoryName("");
  };

  const handleUpdateCategory = (index: number, value: string) => {
    setConfig((prev) => {
      const next = [...prev.categorias];
      next[index] = value;
      return { ...prev, categorias: next };
    });
  };

  const handleRemoveCategory = (index: number) => {
    if (config.categorias.length <= 1) {
      addToast("A comunidade precisa de pelo menos 1 categoria.", "info");
      return;
    }

    setConfig((prev) => ({
      ...prev,
      categorias: prev.categorias.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const toggleBlockPost = async (id: string, currentStatus: boolean) => {
    try {
      const nextStatus = !currentStatus;
      await setCommunityPostPatch(id, { blocked: nextStatus }, {
        tenantId: activeTenantId || undefined,
      });
      setPosts((prev) =>
        prev.map((post) => (post.id === id ? { ...post, blocked: nextStatus } : post))
      );
      addToast(
        currentStatus ? "Post desbloqueado e visivel." : "Post bloqueado (oculto).",
        "info"
      );
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar status do post.", "error");
    }
  };

  const toggleCommentsLock = async (id: string, currentStatus: boolean) => {
    try {
      const nextStatus = !currentStatus;
      await setCommunityPostPatch(id, { commentsDisabled: nextStatus }, {
        tenantId: activeTenantId || undefined,
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === id ? { ...post, commentsDisabled: nextStatus } : post
        )
      );
      addToast(currentStatus ? "Comentarios reabertos." : "Comentarios trancados.", "info");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao atualizar comentarios.", "error");
    }
  };

  const togglePin = async (id: string, currentStatus: boolean) => {
    try {
      const nextStatus = !currentStatus;
      await setCommunityPostPatch(id, { fixado: nextStatus }, {
        tenantId: activeTenantId || undefined,
      });
      setPosts((prev) =>
        prev.map((post) => (post.id === id ? { ...post, fixado: nextStatus } : post))
      );
      addToast(currentStatus ? "Post desafixado." : "Post fixado no topo!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao fixar postagem.", "error");
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir permanentemente esta postagem?")) return;

    try {
      await deleteCommunityPost(id, {
        tenantId: activeTenantId || undefined,
      });
      setPosts((prev) => prev.filter((post) => post.id !== id));
      addToast("Post removido.", "info");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao excluir postagem.", "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pb-32 font-sans text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-8 py-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href={tenantSlug ? withTenantSlug(tenantSlug, "/admin") : "/admin"}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-3 transition hover:bg-zinc-800"
            >
              <ArrowLeft size={20} className="text-zinc-400" />
            </Link>
            <div>
              <h1 className="text-2xl font-black uppercase italic tracking-tighter">
                CMS Comunidade
              </h1>
              <p className="text-[10px] font-bold uppercase text-zinc-500">
                Gestao de comunidade
              </p>
            </div>
          </div>

          {activeTab === "posts" && (
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                placeholder="Buscar postagem..."
                className="w-64 rounded-full border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-4 text-xs outline-none transition focus:border-brand"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-8 flex gap-4 overflow-x-auto border-b border-zinc-800 pb-4">
          <button
            onClick={() => setActiveTab("config")}
            className={`flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-black uppercase transition ${
              activeTab === "config"
                ? "bg-brand-primary text-black shadow-brand"
                : "bg-zinc-900 text-zinc-500 hover:text-white"
            }`}
          >
            <Palette size={14} /> Aparencia
          </button>
          <button
            onClick={() => setActiveTab("posts")}
            className={`flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-black uppercase transition ${
              activeTab === "posts"
                ? "bg-brand-primary text-black shadow-brand"
                : "bg-zinc-900 text-zinc-500 hover:text-white"
            }`}
          >
            <MessageSquare size={14} /> Postagens ({posts.length})
          </button>
          <button
            onClick={() => setActiveTab("denuncias")}
            className={`flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-black uppercase transition ${
              activeTab === "denuncias"
                ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                : "bg-zinc-900 text-zinc-500 hover:text-white"
            }`}
          >
            <ShieldAlert size={14} /> Denuncias
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-32">
            <Loader2 size={48} className="animate-spin text-brand" />
          </div>
        ) : (
          <>
            {activeTab === "config" && (
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <section className="space-y-6 rounded-[2rem] border border-zinc-800 bg-zinc-900 p-8">
                  <h3 className="flex items-center gap-2 text-lg font-bold uppercase text-brand">
                    <Palette size={20} /> Identidade visual
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                        Título da página
                      </label>
                      <input
                        type="text"
                        className="input-admin"
                        value={config.titulo}
                        onChange={(event) =>
                          setConfig((prev) => ({ ...prev, titulo: event.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                        Subtitulo
                      </label>
                      <input
                        type="text"
                        className="input-admin"
                        value={config.subtitulo}
                        onChange={(event) =>
                          setConfig((prev) => ({ ...prev, subtitulo: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-black/35 p-4">
                      <label className="block text-[10px] font-bold uppercase text-zinc-500">
                        Capa da comunidade
                      </label>
                      <div className="relative h-40 w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        <Image
                          src={coverPreviewSrc}
                          alt="Preview da capa da comunidade"
                          fill
                          sizes="100vw"
                          className="object-cover"
                          unoptimized={coverPreviewSrc.startsWith("http")}
                        />
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-brand/40 bg-brand-primary/10 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-brand transition hover:bg-brand-primary/15">
                        <Upload size={14} />
                        {uploadingCover ? "Enviando..." : "Adicionar capa"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={uploadingCover}
                          onChange={(event) => void handleCoverUpload(event)}
                        />
                      </label>
                      <ImageResizeHelpLink label="Diminuir a capa no favicon.io/favicon-converter" />
                      <p className="text-[11px] text-zinc-500">
                        PNG, JPG ou WEBP at&eacute; 3MB. A imagem &eacute; comprimida para ajudar
                        no plano free do Supabase.
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between rounded-2xl border border-zinc-800 bg-black p-4">
                      <div>
                        <p className="text-sm font-bold text-white">Paginacao rigida</p>
                        <p className="text-[10px] uppercase text-zinc-500">
                          Travar feed em 20 posts por vez
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            limitMessages: !prev.limitMessages,
                          }))
                        }
                        className={`relative h-6 w-12 rounded-full transition-colors ${
                          config.limitMessages ? "bg-brand-primary" : "bg-zinc-700"
                        }`}
                      >
                        <div
                          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                            config.limitMessages ? "left-7" : "left-1"
                          }`}
                        />
                      </button>
                    </div>

                    <div className="mt-4 space-y-3 rounded-2xl border border-zinc-800 bg-black p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-white">Categorias dinâmicas</p>
                        <span className="text-[10px] uppercase text-zinc-500">
                          {config.categorias.length} categorias
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="input-admin !mt-0 flex-1"
                          placeholder="Nova categoria"
                          value={newCategoryName}
                          onChange={(event) => setNewCategoryName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleAddCategory();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleAddCategory}
                          className="flex items-center justify-center rounded-xl border border-brand/40 px-3 text-brand transition hover:bg-brand-primary/10"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {config.categorias.map((categoria, index) => (
                          <div key={`${categoria}-${index}`} className="flex items-center gap-2">
                            <input
                              type="text"
                              className="input-admin !mt-0 flex-1"
                              value={categoria}
                              maxLength={40}
                              onChange={(event) =>
                                handleUpdateCategory(index, event.target.value)
                              }
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveCategory(index)}
                              className="rounded-lg border border-red-500/30 p-2 text-red-400 transition hover:bg-red-500/10"
                              title="Remover categoria"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => void handleSaveConfig()}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-8 py-4 text-xs font-black uppercase text-black transition hover:opacity-90"
                    >
                      <Save size={16} /> Salvar alteracoes
                    </button>
                  </div>
                </section>

                <div className="relative overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-900 p-8">
                  <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />
                  <div className="relative z-10 text-center">
                    <h3 className="mb-2 text-xl font-black uppercase text-white">
                      Preview da capa
                    </h3>
                    <div className="relative h-40 w-full overflow-hidden rounded-xl border border-zinc-700 bg-black shadow-2xl">
                      <Image
                        src={coverPreviewSrc}
                        alt="Preview Capa"
                        fill
                        sizes="100vw"
                        className="object-cover opacity-60"
                      />
                    </div>
                    <h4 className="mt-6 text-3xl font-black italic uppercase tracking-tighter text-white">
                      {config.titulo || "Comunidade"}
                    </h4>
                    <p className="mt-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                      {config.subtitulo || "Espaço oficial da atlética"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "posts" && (
              <div className="space-y-4">
                {filteredPosts.length === 0 && (
                  <div className="rounded-[2rem] border border-zinc-800 border-dashed bg-zinc-900 py-20 text-center">
                    <MessageSquare size={40} className="mx-auto mb-4 text-zinc-500" />
                    <p className="text-sm font-bold uppercase text-zinc-400">
                      Nenhuma postagem encontrada.
                    </p>
                  </div>
                )}

                {filteredPosts.map((post) => (
                  <article
                    key={post.id}
                    className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6"
                  >
                    <div className="flex flex-col justify-between gap-4 lg:flex-row">
                      <div className="flex-1">
                        <div className="mb-3 flex items-center gap-3">
                          <div className="relative h-12 w-12 overflow-hidden rounded-full border border-zinc-700">
                            <Image
                              src={post.avatar || "https://github.com/shadcn.png"}
                              alt={post.userName || "Usuário"}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <p className="font-bold text-white">{post.userName || "Usuário"}</p>
                            <p className="text-[11px] text-zinc-500">
                              {post.handle || "@sem-handle"} • {formatDateTime(post.createdAt)}
                            </p>
                          </div>
                        </div>

                        <p className="rounded-2xl border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-200">
                          {post.texto || "Post sem texto."}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-3 text-[11px] font-bold uppercase text-zinc-500">
                          <span>{post.comentarios || 0} comentarios</span>
                          <span className={post.denunciasCount > 0 ? "text-red-400" : ""}>
                            {post.denunciasCount || 0} denuncias
                          </span>
                          {post.fixado ? <span className="text-brand">Fixado</span> : null}
                          {post.blocked ? <span className="text-red-400">Bloqueado</span> : null}
                          {post.commentsDisabled ? (
                            <span className="text-amber-400">Comentarios trancados</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex min-w-[220px] flex-col gap-3">
                        <button
                          onClick={() => setViewCommentsId(post.id)}
                          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-4 py-3 text-xs font-black uppercase text-zinc-200 transition hover:bg-zinc-800"
                        >
                          <ExternalLink size={14} /> Ver comentarios
                        </button>
                        <button
                          onClick={() => void togglePin(post.id, Boolean(post.fixado))}
                          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-black/40 px-4 py-3 text-xs font-black uppercase text-zinc-200 transition hover:bg-zinc-800"
                        >
                          <Pin size={14} /> {post.fixado ? "Desafixar" : "Fixar"}
                        </button>
                        <button
                          onClick={() =>
                            void toggleCommentsLock(post.id, Boolean(post.commentsDisabled))
                          }
                          className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 transition hover:bg-amber-500/20"
                        >
                          <Lock size={14} />{" "}
                          {post.commentsDisabled ? "Abrir comentarios" : "Trancar comentarios"}
                        </button>
                        <button
                          onClick={() => void toggleBlockPost(post.id, Boolean(post.blocked))}
                          className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-black uppercase text-red-200 transition hover:bg-red-500/20"
                        >
                          <Ban size={14} /> {post.blocked ? "Desbloquear" : "Bloquear"}
                        </button>
                        <button
                          onClick={() => void handleDeletePost(post.id)}
                          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-xs font-black uppercase text-zinc-300 transition hover:bg-zinc-800"
                        >
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {activeTab === "denuncias" && (
              <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-900 p-8 text-center">
                <ShieldAlert size={40} className="mx-auto mb-4 text-red-400" />
                <p className="text-lg font-black uppercase text-white">Denuncias centralizadas</p>
                <p className="mt-3 text-sm text-zinc-400">
                  A moderacao da comunidade agora fica na central de denuncias do tenant.
                </p>
                <Link
                  href="/admin/denuncias/comunidade"
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-wide text-red-200 transition hover:bg-red-500/20"
                >
                  <ShieldAlert size={14} /> Abrir central de denuncias
                </Link>
              </div>
            )}
          </>
        )}
      </main>

      {viewCommentsId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6"
          onClick={() => setViewCommentsId(null)}
        >
          <div
            className="relative flex h-[600px] w-full max-w-lg flex-col rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex justify-between border-b border-zinc-800 pb-4">
              <h3 className="text-lg font-black uppercase text-white">Histórico de conversa</h3>
              <button
                onClick={() => setViewCommentsId(null)}
                className="text-zinc-500 transition hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-2">
              {adminComments.length === 0 && (
                <p className="py-10 text-center text-sm text-zinc-600">
                  Nenhum comentario neste post.
                </p>
              )}
              {adminComments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex gap-3 rounded-xl border border-zinc-800 bg-black p-3"
                >
                  <div className="relative h-8 w-8 shrink-0">
                    <Image
                      src={comment.avatar || "https://github.com/shadcn.png"}
                      alt={comment.userName}
                      fill
                      sizes="32px"
                      className="rounded-full border border-zinc-700 object-cover"
                    />
                  </div>
                  <div>
                    <p className="mb-0.5 text-[10px] font-bold text-brand">
                      {comment.userName}{" "}
                      <span className="font-normal text-zinc-600">
                        - {formatDateTime(comment.createdAt)}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-300">{comment.texto}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .input-admin {
          width: 100%;
          margin-top: 4px;
          border-radius: 0.75rem;
          border: 1px solid #27272a;
          background: #000;
          padding: 0.875rem;
          color: white;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-admin:focus {
          border-color: var(--tenant-primary, #10b981);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          border-radius: 9999px;
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
