"use client";

import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Save, MessageSquare, AlertTriangle, 
  Trash2, Pin, ShieldAlert, Palette, Loader2, 
  Eye, Ban, MessageCircle, X, Search, CheckCircle, Lock, ExternalLink, Plus
} from "lucide-react";
import Link from "next/link";
import Image from "next/image"; // 🦈 Importando Image
import { useToast } from "../../../context/ToastContext";
import { useAuth } from "../../../context/AuthContext";
import { logActivity } from "../../../lib/logger";
import {
  deleteCommunityPost,
  fetchCommunityCommentPostId,
  deleteCommunityReport,
  fetchCommunityAdminPosts,
  fetchCommunityComments,
  fetchCommunityConfig,
  fetchCommunityReports,
  saveCommunityConfig,
  setCommunityPostPatch,
} from "../../../lib/communityService";
import type { DateLike } from "../../../lib/supabaseData";
import {
  DEFAULT_COMMUNITY_CATEGORIES,
  normalizeCommunityCategories,
  normalizeCommunityCategoryName,
} from "../../../constants/communityCategories";

// --- TIPAGENS (O Escudo do Código) ---
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

interface DenunciaData {
  id: string;
  postId: string;
  targetId?: string;
  targetType?: "post" | "comment";
  postText: string;
  reporterId: string;
  reason: string;
  timestamp: DateLike;
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

export default function AdminComunidadePage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  
  // Estados de Controle
  const [activeTab, setActiveTab] = useState<"config" | "posts" | "denuncias">("config");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");

  // Dados do Supabase
  const [config, setConfig] = useState<AppConfig>(normalizeCommunityConfig());
  const [posts, setPosts] = useState<PostData[]>([]);
  const [denuncias, setDenuncias] = useState<DenunciaData[]>([]);

  // Estados de Modais
  const [viewCommentsId, setViewCommentsId] = useState<string | null>(null);
  const [adminComments, setAdminComments] = useState<CommentData[]>([]);
  const coverPreviewSrc = toSafeImageSrc(config.capaUrl, "/carteirinha-bg.jpg");

    // 1. CARREGAR DADOS COM LEITURA CONTROLADA
  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      setLoading(true);
      try {
        const [configData, postsData, reportsData] = await Promise.all([
          fetchCommunityConfig(),
          fetchCommunityAdminPosts(60),
          fetchCommunityReports(60),
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

        setDenuncias(
          reportsData.map(
            (row) =>
              ({
                id: row.id,
                ...(row.data as Omit<DenunciaData, "id">),
              }) as DenunciaData
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
  }, [addToast]);

  // 2. CARREGAR COMENTARIOS AO ABRIR MODAL (SEM SNAPSHOT)
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
  }, [viewCommentsId, addToast]);

// --- AÇÕES DE CONFIGURAÇÃO ---
  const handleSaveConfig = async () => {
    const cleanCoverUrl = config.capaUrl.trim();
    if (cleanCoverUrl && !isValidImageSrc(cleanCoverUrl)) {
      addToast("URL da capa invalida. Use '/imagem.png' ou URL https://", "error");
      return;
    }

    try {
      const normalizedCategories = normalizeCommunityCategories(config.categorias);
      await saveCommunityConfig({
        titulo: config.titulo,
        subtitulo: config.subtitulo,
        capaUrl: cleanCoverUrl,
        limitMessages: config.limitMessages,
        categorias: normalizedCategories,
      });
      setConfig((prev) => ({ ...prev, capaUrl: cleanCoverUrl, categorias: normalizedCategories }));
      addToast("Configuracoes da Resenha salvas!", "success");
    } catch (error: unknown) {
      console.error(error);
      addToast("Erro ao salvar config.", "error");
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

    setConfig((prev) => {
      const next = prev.categorias.filter((_, currentIndex) => currentIndex !== index);
      return { ...prev, categorias: next };
    });
  };

  // --- AÇÕES DE POSTAGEM ---
  const toggleBlockPost = async (id: string, currentStatus: boolean) => {
      try {
          const nextStatus = !currentStatus;
          await setCommunityPostPatch(id, { blocked: nextStatus });
          setPosts((prev) =>
              prev.map((post) => (post.id === id ? { ...post, blocked: nextStatus } : post))
          );
          addToast(currentStatus ? "Post desbloqueado e visivel." : "Post bloqueado (oculto).", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar status.", "error");
      }
  };

  const toggleCommentsLock = async (id: string, currentStatus: boolean) => {
      try {
          const nextStatus = !currentStatus;
          await setCommunityPostPatch(id, { commentsDisabled: nextStatus });
          setPosts((prev) =>
              prev.map((post) =>
                  post.id === id ? { ...post, commentsDisabled: nextStatus } : post
              )
          );
          addToast(currentStatus ? "Comentarios reabertos." : "Comentarios trancados.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao atualizar status.", "error");
      }
  };

  const togglePin = async (id: string, current: boolean) => {
      try {
          const nextStatus = !current;
          await setCommunityPostPatch(id, { fixado: nextStatus });
          setPosts((prev) =>
              prev.map((post) => (post.id === id ? { ...post, fixado: nextStatus } : post))
          );
          addToast(current ? "Post desafixado." : "Post fixado no topo!", "success");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao fixar.", "error");
      }
  };

  const deletePost = async (id: string) => {
      if (!confirm("Tem certeza que deseja EXCLUIR permanentemente este post?")) return;
      try {
          await deleteCommunityPost(id);
          setPosts((prev) => prev.filter((post) => post.id !== id));
          addToast("Post removido do banco de dados.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao excluir.", "error");
      }
  };

  // --- AÇÕES DE DENÚNCIA ---
  const resolveReportPostId = async (denuncia: DenunciaData): Promise<string> => {
      const postIdDireto = typeof denuncia.postId === "string" ? denuncia.postId.trim() : "";
      if (postIdDireto) return postIdDireto;

      const targetId = typeof denuncia.targetId === "string" ? denuncia.targetId.trim() : "";
      if (!targetId) return "";

      if (denuncia.targetType === "comment") {
          const mappedPostId = await fetchCommunityCommentPostId(targetId);
          return mappedPostId || "";
      }

      return targetId;
  };

  const handleOpenReportContext = async (denuncia: DenunciaData) => {
      try {
          const postId = await resolveReportPostId(denuncia);
          if (!postId) {
              addToast("Nao foi possivel abrir o contexto desta denuncia.", "info");
              return;
          }
          setViewCommentsId(postId);
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao abrir contexto da denuncia.", "error");
      }
  };

  const resolveDenuncia = async (denuncia: DenunciaData, action: "ban" | "ignore" | "lock") => {
      try {
          const postId = await resolveReportPostId(denuncia);

          if ((action === "ban" || action === "lock") && !postId) {
              addToast("Denuncia sem post vinculado. Use Ignorar.", "info");
              return;
          }

          if (action === "ban") {
              await setCommunityPostPatch(postId, { blocked: true });
              setPosts((prev) =>
                  prev.map((post) => (post.id === postId ? { ...post, blocked: true } : post))
              );
              addToast("Post bloqueado por violacao!", "info");
          }

          if (action === "lock") {
              await setCommunityPostPatch(postId, { commentsDisabled: true });
              setPosts((prev) =>
                  prev.map((post) =>
                      post.id === postId ? { ...post, commentsDisabled: true } : post
                  )
              );
              addToast("Comentarios trancados por precaucao!", "info");
          }

          await deleteCommunityReport(denuncia.id);
          setDenuncias((prev) => prev.filter((row) => row.id !== denuncia.id));

          if (user?.uid) {
              await logActivity(
                  user.uid,
                  user.nome || "Admin",
                  "DELETE",
                  "Denuncias/Comunidade",
                  `Excluiu denuncia ${denuncia.id} (acao: ${action})`
              ).catch(() => {});
          }

          if (action === "ignore") addToast("Denuncia ignorada/removida.", "info");
      } catch (error: unknown) {
          console.error(error);
          addToast("Erro ao resolver denuncia.", "error");
      }
  };

  // Filtro de Busca
  const filteredPosts = posts.filter(p => 
      p.userName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.texto?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#050505] text-white p-8 font-sans pb-32">
      
      {/* HEADER */}
      <header className="flex justify-between items-center mb-8 sticky top-0 z-20 bg-[#050505]/90 backdrop-blur-md py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-3 bg-zinc-900 rounded-full border border-zinc-800 hover:bg-zinc-800 transition"><ArrowLeft size={20} className="text-zinc-400"/></Link>
          <div>
              <h1 className="text-2xl font-black uppercase italic tracking-tighter">CMS Resenha</h1>
              <p className="text-[10px] text-zinc-500 font-bold uppercase">Gestão de Comunidade</p>
          </div>
        </div>
        
        {/* BARRA DE PESQUISA (Só aparece na aba Posts) */}
        {activeTab === "posts" && (
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"/>
                <input 
                    type="text" 
                    placeholder="Buscar postagem..." 
                    className="bg-zinc-900 border border-zinc-800 rounded-full pl-9 pr-4 py-2 text-xs w-64 focus:border-emerald-500 outline-none transition"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        )}
      </header>

      {/* NAVEGAÇÃO */}
      <div className="flex gap-4 border-b border-zinc-800 mb-8 pb-4 overflow-x-auto">
          <button onClick={() => setActiveTab("config")} className={`text-xs font-black uppercase px-6 py-3 rounded-xl transition flex items-center gap-2 ${activeTab === "config" ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20" : "bg-zinc-900 text-zinc-500 hover:text-white"}`}>
              <Palette size={14}/> Aparência
          </button>
          <button onClick={() => setActiveTab("posts")} className={`text-xs font-black uppercase px-6 py-3 rounded-xl transition flex items-center gap-2 ${activeTab === "posts" ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20" : "bg-zinc-900 text-zinc-500 hover:text-white"}`}>
              <MessageSquare size={14}/> Postagens ({posts.length})
          </button>
          <button onClick={() => setActiveTab("denuncias")} className={`text-xs font-black uppercase px-6 py-3 rounded-xl transition flex items-center gap-2 ${activeTab === "denuncias" ? "bg-red-600 text-white shadow-lg shadow-red-600/20" : "bg-zinc-900 text-zinc-500 hover:text-white"}`}>
              <ShieldAlert size={14}/> Denúncias 
              {denuncias.length > 0 && <span className="bg-white text-red-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{denuncias.length}</span>}
          </button>
      </div>

      <main className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {loading ? (
            <div className="flex justify-center py-32"><Loader2 className="animate-spin text-emerald-500" size={48}/></div>
        ) : (
            <>
                {/* --- ABA 1: CONFIGURAÇÕES --- */}
                {activeTab === "config" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <section className="bg-zinc-900 border border-zinc-800 rounded-[2rem] p-8 space-y-6">
                            <h3 className="font-bold flex items-center gap-2 text-emerald-400 text-lg uppercase"><Palette size={20}/> Identidade Visual</h3>
                            <div className="space-y-4">
                                <div><label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Título da Página</label><input type="text" className="input-admin" value={config.titulo || ""} onChange={e => setConfig({...config, titulo: e.target.value})}/></div>
                                <div><label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Subtítulo</label><input type="text" className="input-admin" value={config.subtitulo || ""} onChange={e => setConfig({...config, subtitulo: e.target.value})}/></div>
                                <div><label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">URL da Capa (Imagem)</label><input type="text" className="input-admin" value={config.capaUrl || ""} onChange={e => setConfig({...config, capaUrl: e.target.value})}/></div>
                                
                                <div className="flex items-center justify-between p-4 bg-black rounded-2xl border border-zinc-800 mt-4">
                                    <div>
                                        <p className="text-sm font-bold text-white">Paginação Rígida</p>
                                        <p className="text-[10px] text-zinc-500">Travar feed em 20 posts por vez</p>
                                    </div>
                                    <button 
                                        onClick={() => setConfig({...config, limitMessages: !config.limitMessages})}
                                        className={`w-12 h-6 rounded-full transition-colors relative ${config.limitMessages ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.limitMessages ? 'left-7' : 'left-1'}`}/>
                                    </button>
                                </div>

                                <div className="p-4 bg-black rounded-2xl border border-zinc-800 mt-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-white">Categorias Dinâmicas</p>
                                        <span className="text-[10px] text-zinc-500 uppercase">{config.categorias.length} categorias</span>
                                    </div>

                                    <div className="flex gap-2">
                                        <input
                                          type="text"
                                          className="input-admin flex-1 !mt-0"
                                          placeholder="Nova categoria"
                                          value={newCategoryName}
                                          onChange={(e) => setNewCategoryName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              handleAddCategory();
                                            }
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={handleAddCategory}
                                          className="px-3 rounded-xl border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition flex items-center justify-center"
                                        >
                                          <Plus size={14} />
                                        </button>
                                    </div>

                                    <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                                        {config.categorias.map((categoria, index) => (
                                          <div key={`${categoria}-${index}`} className="flex items-center gap-2">
                                              <input
                                                type="text"
                                                className="input-admin flex-1 !mt-0"
                                                value={categoria}
                                                maxLength={40}
                                                onChange={(e) => handleUpdateCategory(index, e.target.value)}
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleRemoveCategory(index)}
                                                className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition"
                                                title="Remover categoria"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                          </div>
                                        ))}
                                    </div>
                                </div>

                                <button onClick={handleSaveConfig} className="bg-emerald-500 hover:bg-emerald-400 text-black px-8 py-4 rounded-xl font-black uppercase text-xs flex items-center gap-2 w-full justify-center shadow-lg transition mt-4">
                                    <Save size={16}/> Salvar Alterações
                                </button>
                            </div>
                        </section>

                        <div className="bg-zinc-900 border border-zinc-800 rounded-[2rem] p-8 flex items-center justify-center relative overflow-hidden">
                            <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                            <div className="relative z-10 text-center">
                                <h3 className="text-xl font-black text-white uppercase mb-2">Preview da Capa</h3>
                                <div className="h-40 w-full bg-black rounded-xl overflow-hidden border border-zinc-700 shadow-2xl relative">
                                    {/* 🦈 Imagem Otimizada */}
                                    <Image 
                                      src={coverPreviewSrc} 
                                      alt="Preview Capa" 
                                      fill 
                                      sizes="100vw"
                                      className="object-cover opacity-60" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- ABA 2: POSTAGENS --- */}
                {activeTab === "posts" && (
                    <div className="grid gap-4">
                        {filteredPosts.map(post => (
                            <div key={post.id} className={`bg-zinc-900 border p-5 rounded-2xl flex items-start gap-5 transition hover:border-zinc-700 ${post.blocked ? 'border-red-900/50 bg-red-950/10 opacity-70' : 'border-zinc-800'} ${post.fixado ? 'border-emerald-500/30 bg-emerald-900/10' : ''}`}>
                                
                                {/* Avatar */}
                                <div className="relative shrink-0 w-12 h-12 rounded-full border-2 border-zinc-800 overflow-hidden">
                                    <Image 
                                        src={post.avatar || "https://github.com/shadcn.png"} 
                                        alt={post.userName} 
                                        fill 
                                        sizes="48px"
                                        className="object-cover" 
                                    />
                                    {post.fixado && <div className="absolute -top-2 -right-2 bg-emerald-500 text-black p-1 rounded-full z-10"><Pin size={10} fill="black"/></div>}
                                </div>

                                {/* Conteúdo */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <p className="text-sm font-bold text-white flex items-center gap-2">
                                            {post.userName} 
                                            <span className="text-zinc-500 font-normal text-xs lowercase">({post.handle})</span>
                                            {post.blocked && <span className="bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Bloqueado</span>}
                                        </p>
                                        <p className="text-[10px] text-zinc-600">{post.createdAt?.toDate().toLocaleString('pt-BR')}</p>
                                    </div>
                                    
                                    <p className="text-xs text-zinc-300 line-clamp-3 mb-2 bg-black/30 p-2 rounded-lg border border-zinc-800/50">{post.texto}</p>
                                    
                                    {/* Stats Rápidos */}
                                    <div className="flex gap-4 text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-3">
                                        <span className="flex items-center gap-1"><MessageCircle size={12}/> {post.comentarios} Coments</span>
                                        <span className="flex items-center gap-1"><ShieldAlert size={12} className={post.denunciasCount > 0 ? "text-red-500" : ""}/> {post.denunciasCount || 0} Denúncias</span>
                                    </div>

                                    {/* Botões de Ação */}
                                    <div className="flex flex-wrap gap-2">
                                        <button onClick={() => setViewCommentsId(post.id)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition"><Eye size={12}/> Ver Conversa</button>
                                        
                                        <button onClick={() => togglePin(post.id, !!post.fixado)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition ${post.fixado ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
                                            <Pin size={12}/> {post.fixado ? 'Desafixar' : 'Fixar no Topo'}
                                        </button>
                                        
                                        <button onClick={() => toggleCommentsLock(post.id, !!post.commentsDisabled)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition ${post.commentsDisabled ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
                                            {post.commentsDisabled ? <><Lock size={12}/> Destrancar</> : <><Lock size={12}/> Trancar Coments</>}
                                        </button>

                                        <button onClick={() => toggleBlockPost(post.id, !!post.blocked)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition ${post.blocked ? 'bg-red-500/10 text-red-500 border border-red-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
                                            {post.blocked ? <><CheckCircle size={12}/> Desbloquear</> : <><Ban size={12}/> Bloquear</>}
                                        </button>
                                        
                                        <button onClick={() => deletePost(post.id)} className="bg-red-900/10 text-red-500 hover:bg-red-900/30 border border-red-900/20 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition ml-auto">
                                            <Trash2 size={12}/> Excluir
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* --- ABA 3: DENÚNCIAS --- */}
                {activeTab === "denuncias" && (
                    <div className="grid gap-4 max-w-4xl mx-auto">
                        {denuncias.length === 0 && (
                            <div className="text-center py-20 bg-zinc-900 border border-zinc-800 border-dashed rounded-3xl">
                                <ShieldAlert size={40} className="text-emerald-500 mx-auto mb-4"/>
                                <p className="text-zinc-400 font-bold uppercase text-sm">Tudo tranquilo no oceano.</p>
                                <p className="text-zinc-600 text-xs">Nenhuma denúncia pendente.</p>
                            </div>
                        )}

                        {denuncias.map(den => (
                            <div key={den.id} className="bg-black/40 p-6 rounded-2xl border border-red-500/30 shadow-lg shadow-red-900/5 relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-600"></div>
                                <div className="flex flex-col md:flex-row gap-6">
                                    
                                    {/* Info da Denúncia */}
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="p-2 bg-red-500/10 text-red-500 rounded-lg"><AlertTriangle size={18}/></div>
                                            <span className="text-red-400 font-bold text-xs uppercase tracking-wide">Nova Denúncia</span>
                                            <span className="text-zinc-600 text-[10px] ml-auto">{den.timestamp?.toDate().toLocaleString()}</span>
                                        </div>
                                        
                                        <div className="mb-4">
                                            <p className="text-[10px] text-zinc-500 font-bold uppercase">Motivo Reportado</p>
                                            <p className="text-white font-bold text-sm bg-zinc-900 p-2 rounded-lg border border-zinc-800 mt-1">
                                                {den.reason || "Motivo não especificado"}
                                            </p>
                                        </div>

                                        <div>
                                            <p className="text-[10px] text-zinc-500 font-bold uppercase flex items-center gap-2">
                                                Conteúdo Denunciado 
                                                <button onClick={() => void handleOpenReportContext(den)} className="text-blue-400 underline flex items-center gap-1"><ExternalLink size={10}/> Ver Contexto</button>
                                            </p>
                                            {/* 🦈 EXIBIÇÃO DO TEXTO CORRETO DA MENSAGEM */}
                                            <p className="text-zinc-300 text-xs italic mt-1 line-clamp-3 bg-red-950/20 p-3 rounded border border-red-900/30">
                                                &quot;{den.postText || 'Carregando conteúdo...'}&quot;
                                            </p>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-zinc-800/50 flex items-center gap-2">
                                            <span className="text-[10px] text-zinc-500">Reportado por:</span>
                                            <Link href={`/admin/usuarios/${den.reporterId}`} className="text-[10px] font-bold text-emerald-500 hover:underline">
                                                Ver Usuário (ID: {den.reporterId.slice(0,6)}...)
                                            </Link>
                                        </div>
                                    </div>

                                    {/* Ações */}
                                    <div className="flex flex-col justify-center gap-3 min-w-[160px]">
                                        <button onClick={() => void resolveDenuncia(den, 'ban')} className="bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-2 shadow-lg transition">
                                            <Ban size={14}/> Bloquear Post
                                        </button>
                                        <button onClick={() => void resolveDenuncia(den, 'lock')} className="bg-yellow-600 hover:bg-yellow-500 text-white py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-2 shadow-lg transition">
                                            <Lock size={14}/> Trancar Coments
                                        </button>
                                        <button onClick={() => void resolveDenuncia(den, 'ignore')} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-2 border border-zinc-700 transition">
                                            <CheckCircle size={14}/> Ignorar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </>
        )}
      </main>

      {/* MODAL COMENTÁRIOS ADMIN (Para ver o contexto da denúncia) */}
      {viewCommentsId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6 animate-in fade-in" onClick={() => setViewCommentsId(null)}>
              <div className="bg-zinc-900 w-full max-w-lg rounded-3xl border border-zinc-800 p-6 h-[600px] flex flex-col shadow-2xl relative" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between mb-6 border-b border-zinc-800 pb-4">
                      <h3 className="font-black text-white uppercase text-lg">Histórico de Conversa</h3>
                      <button onClick={() => setViewCommentsId(null)} className="text-zinc-500 hover:text-white"><X size={20}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                      {adminComments.length === 0 && <p className="text-center text-zinc-600 text-sm py-10">Nenhum comentário neste post.</p>}
                      {adminComments.map(c => (
                          <div key={c.id} className="p-3 bg-black rounded-xl border border-zinc-800 flex gap-3">
                              <div className="relative w-8 h-8 shrink-0">
                                  <Image 
                                    src={c.avatar || "https://github.com/shadcn.png"} 
                                    alt={c.userName} 
                                    fill 
                                    sizes="32px"
                                    className="rounded-full object-cover border border-zinc-700" 
                                  />
                              </div>
                              <div>
                                  <p className="text-[10px] font-bold text-emerald-500 mb-0.5">{c.userName} <span className="text-zinc-600 font-normal"> - {c.createdAt?.toDate().toLocaleTimeString()}</span></p>
                                  <p className="text-xs text-zinc-300">{c.texto}</p>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      <style jsx global>{`
        .input-admin { width: 100%; background: #000; border: 1px solid #27272a; border-radius: 0.75rem; padding: 0.875rem; color: white; outline: none; margin-top: 4px; transition: border-color 0.2s; }
        .input-admin:focus { border-color: #10b981; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 10px; }
      `}</style>
    </div>
  );
}









