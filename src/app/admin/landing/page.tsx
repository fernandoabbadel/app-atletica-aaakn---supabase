"use client";

import React, { useMemo, useState, useEffect } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { 
  Save, LayoutTemplate, Palette, Users, 
  MessageSquare, MapPin, Share2, Plus, Trash2,
  Smartphone, Instagram, Linkedin, Twitter, Youtube, Music2, Globe, Building2, Loader2
} from "lucide-react";

// IMPORTS DO SISTEMA
import { useAuth } from "@/context/AuthContext"; 
import { useTenantTheme } from "@/context/TenantThemeContext";
import { useToast } from "@/context/ToastContext";
import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import {
  DEFAULT_LOADING_PHRASES,
  DEFAULT_LANDING_CONFIG,
  fetchLandingConfig,
  LOADING_PHRASE_MAX_LENGTH,
  MAX_LOADING_PHRASES,
  saveLandingConfig,
  type LandingConfig,
  type SocialLink,
} from "@/lib/adminLandingService";
import { logActivity } from "@/lib/logger"; 
import { isPermissionError } from "@/lib/backendErrors";
import { isPlatformMaster } from "@/lib/roles";
import { parseTenantScopedPath, withTenantSlug } from "@/lib/tenantRouting";
import {
  EMAIL_MAX_LENGTH,
  hasValidPhoneLength,
  isValidEmail,
  normalizeEmailInput,
  normalizePhoneInput,
  PHONE_MAX_LENGTH,
} from "@/utils/contactFields";

// --- TYPES & INTERFACES (Clean Code) ---

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const raw = error as { message?: unknown; details?: unknown; hint?: unknown };
    const message = [raw.message, raw.details, raw.hint]
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0)
      .join(" | ");
    if (message) return message;
  }
  return "Erro inesperado.";
};

// --- ESTADO INICIAL ---
const TENANT_INITIAL_CONFIG: LandingConfig = {
  tagline: "Gestão Esportiva 2.0",
  taglineColor: "#10b981",
  heroTitle: "SEJA UM",
  heroSubtitle: "Centralize sua vida universitária. Carteirinha, Loja e Eventos.",
  heroHighlight: "SUA ATLETICA",
  titleColor: "#ffffff",
  gradientStart: "#34d399", 
  gradientEnd: "#10b981",   
  statUsers: 120,
  statPosts: 340,
  statPartners: 12,
  address: "Campus principal",
  phone: "",
  whatsapp: "",
  email: "",
  loadingPhrases: [...DEFAULT_LOADING_PHRASES],
  socialLinks: [],
  reviews: []
};

const MASTER_INITIAL_CONFIG: LandingConfig = {
  ...DEFAULT_LANDING_CONFIG,
  heroTitle: "ENTRE PARA",
  heroHighlight: "SPOT CONNECT",
  heroSubtitle: "Plataforma oficial multi-atleticas.",
};

export default function AdminLandingPage() {
  const router = useRouter();
  const pathname = usePathname() || "/admin/landing";
  const { user } = useAuth();
  const {
    tenantId: activeTenantId,
    tenantSigla,
    tenantName,
    tenantSlug,
    tenantLogoUrl,
    palette,
    loading: tenantThemeLoading,
  } = useTenantTheme();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pathInfo = useMemo(() => parseTenantScopedPath(pathname), [pathname]);
  const currentPath = pathInfo.scopedPath;
  const routeTenantSlug = pathInfo.tenantSlug.trim().toLowerCase();
  const normalizedTenantSlug = tenantSlug.trim().toLowerCase();
  const isMasterScope = currentPath === "/master/landing";
  const isPlatformMasterUser = isPlatformMaster(user);
  const fallbackConfig = useMemo(
    () => (isMasterScope ? MASTER_INITIAL_CONFIG : TENANT_INITIAL_CONFIG),
    [isMasterScope]
  );
  const [config, setConfig] = useState<LandingConfig>(fallbackConfig);
  const targetTenantId = isMasterScope ? undefined : activeTenantId || undefined;
  const contextLabel = isMasterScope
    ? "USC • Landing global"
    : `${tenantSigla || tenantName || "Tenant atual"} • Landing do tenant`;

  useEffect(() => {
    if (tenantThemeLoading) return;
    if (isMasterScope || routeTenantSlug) return;

    if (normalizedTenantSlug) {
      router.replace(withTenantSlug(normalizedTenantSlug, "/admin/landing"));
      return;
    }

    if (isPlatformMasterUser) {
      router.replace("/master/landing");
      return;
    }

    router.replace("/admin");
  }, [
    isMasterScope,
    isPlatformMasterUser,
    normalizedTenantSlug,
    routeTenantSlug,
    router,
    tenantThemeLoading,
  ]);

  // CARREGAR DADOS (COM BLINDAGEM ANTI-CRASH)
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const data = await fetchLandingConfig({
          fallbackConfig,
          tenantId: targetTenantId,
        });
        setConfig({
          ...fallbackConfig,
          ...data,
          socialLinks: data.socialLinks || fallbackConfig.socialLinks || [],
          reviews: data.reviews || fallbackConfig.reviews || [],
        });
      } catch (error: unknown) {
        if (isPermissionError(error)) {
          addToast("Sem permissão para carregar a configuração da landing.", "error");
        } else {
          const message = extractErrorMessage(error);
          console.error(`Erro ao carregar config: ${message}`);
          addToast(`Erro ao carregar configurações: ${message}`, "error");
        }
      } finally {
        setLoading(false);
      }
    };
    void fetchConfig();
  }, [addToast, fallbackConfig, targetTenantId]);

  // SALVAR DADOS
  const handleSave = async () => {
    if (config.email.trim() && !isValidEmail(config.email)) {
      addToast("Informe um email valido para a landing.", "error");
      return;
    }
    if (config.whatsapp.trim() && !hasValidPhoneLength(config.whatsapp)) {
      addToast("Informe um WhatsApp valido para a landing.", "error");
      return;
    }

    setSaving(true);
    try {
      await saveLandingConfig(config, { tenantId: targetTenantId });

      const refreshParams = new URLSearchParams({ refresh: "1" });
      if (isMasterScope) {
        refreshParams.set("scope", "platform");
      } else if (tenantSlug.trim()) {
        refreshParams.set("tenant", tenantSlug.trim().toLowerCase());
      }

      try {
        await fetch(`/api/public/landing?${refreshParams.toString()}`, {
          cache: "no-store",
        });
      } catch (refreshError: unknown) {
        console.warn("Falha ao atualizar cache publico da landing.", refreshError);
      }

      if (user) {
        await logActivity(
          user.uid,
          String(user.displayName || user.email || "Admin"), 
          "UPDATE",
          isMasterScope ? "Landing USC" : "Landing Tenant",
          `Atualizou ${isMasterScope ? "landing global" : "landing do tenant"}. Destaque: ${config.heroHighlight}`
        );
      }

      addToast(
        isMasterScope ? "Landing USC atualizada com sucesso." : "Landing do tenant atualizada com sucesso.",
        "success"
      );
    } catch (error: unknown) {
      if (isPermissionError(error)) {
        addToast("Sem permissão para salvar a landing.", "error");
      } else {
        const message = extractErrorMessage(error);
        console.error(`Erro ao salvar landing: ${message}`);
        addToast(`Falha ao salvar landing: ${message}`, "error");
      }
    } finally {
      setSaving(false);
    }
  };

  // --- HELPERS ---

  // Social Helpers
  const addSocial = () => {
    setConfig({
        ...config, 
        // FIX: Garante array antes de adicionar
        socialLinks: [...(config.socialLinks || []), { id: Date.now().toString(), platform: 'instagram', url: '' }]
    });
  };

  const removeSocial = (index: number) => {
      const newSocials = config.socialLinks.filter((_, i) => i !== index);
      setConfig({ ...config, socialLinks: newSocials });
  };

  const updateSocial = (index: number, field: keyof SocialLink, value: string) => {
      const newSocials = [...config.socialLinks];
      const current = newSocials[index];
      if (!current) return;

      if (field === "platform") {
        newSocials[index] = { ...current, platform: value as SocialLink["platform"] };
      } else {
        newSocials[index] = { ...current, [field]: value };
      }
      setConfig({ ...config, socialLinks: newSocials });
  };

  // Reviews Helpers
  const addReview = () => {
    setConfig({
      ...config,
      reviews: [...(config.reviews || []), { id: Date.now().toString(), name: "", role: "", text: "", profileUrl: "" }]
    });
  };

  const addLoadingPhrase = () => {
    if ((config.loadingPhrases || []).length >= MAX_LOADING_PHRASES) {
      addToast(`Limite de ${MAX_LOADING_PHRASES} frases atingido.`, "info");
      return;
    }

    setConfig({
      ...config,
      loadingPhrases: [...(config.loadingPhrases || []), ""],
    });
  };

  const removeLoadingPhrase = (index: number) => {
    const current = config.loadingPhrases || [];
    if (current.length <= 1) {
      addToast("Mantenha pelo menos 1 frase de carregamento.", "info");
      return;
    }

    setConfig({
      ...config,
      loadingPhrases: current.filter((_, phraseIndex) => phraseIndex !== index),
    });
  };

  const updateLoadingPhrase = (index: number, value: string) => {
    const nextLoadingPhrases = [...(config.loadingPhrases || [])];
    nextLoadingPhrases[index] = value.slice(0, LOADING_PHRASE_MAX_LENGTH);
    setConfig({ ...config, loadingPhrases: nextLoadingPhrases });
  };

  const removeReview = (index: number) => {
    const newReviews = config.reviews.filter((_, i) => i !== index);
    setConfig({ ...config, reviews: newReviews });
  };

  const getSocialIcon = (platform: string) => {
      switch(platform) {
          case 'instagram': return <Instagram size={16} className="text-pink-500"/>;
          case 'tiktok': return <Music2 size={16} className="text-cyan-400"/>;
          case 'twitter': return <Twitter size={16} className="text-blue-400"/>;
          case 'linkedin': return <Linkedin size={16} className="text-blue-600"/>;
          case 'youtube': return <Youtube size={16} className="text-red-500"/>;
          default: return <Globe size={16} className="text-zinc-400"/>;
      }
  };

  if (loading) return <div className="p-8 text-white">Carregando landing...</div>;

  return (
    <div className="min-h-screen bg-zinc-950 p-6 md:p-12 pb-32">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            <LayoutTemplate className="text-emerald-500" /> {isMasterScope ? "Landing USC" : "Editor da Landing"}
          </h1>
          <p className="sr-only" style={{ color: palette.primary }}>
            {tenantSigla || tenantName || "Modo Global"} • Landing ativa
          </p>
          <span
            className="mt-1 block text-sm font-bold uppercase tracking-[0.22em]"
            style={{ color: palette.primary }}
          >
            {contextLabel}
          </span>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-6 py-3 rounded-xl font-bold uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
        >
          {saving ? "Salvando..." : <><Save size={18} /> Publicar Alterações</>}
        </button>
      </header>

      <section className="mx-auto mb-8 flex max-w-7xl items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-lg">
          <Image
            src={isMasterScope ? PLATFORM_LOGO_URL : tenantLogoUrl || "/logo.png"}
            alt={isMasterScope ? "Logo USC" : `Logo ${tenantSigla || tenantName || "Tenant"}`}
            fill
            className="object-contain p-3"
            sizes="80px"
            unoptimized={!isMasterScope && (tenantLogoUrl || "").startsWith("http")}
            priority
          />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            {isMasterScope ? "Marca oficial da plataforma" : "Marca oficial da atletica"}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-white">
            <Building2 size={18} className="text-cyan-400" />
            {isMasterScope ? "USC - Universidade Spot Connect" : tenantName || tenantSigla || "Tenant atual"}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            {isMasterScope
              ? "Essa identidade aparece na landing publica da plataforma."
              : "Essa identidade aparece na landing publica do tenant."}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
        
        {/* === HERO & VISUAL === */}
        <section className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Palette className="text-blue-400" size={20} /> Identidade Visual & Texto
          </h2>
          
          <div className="space-y-4">
            
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Tagline (Badge)</label>
                    <input 
                        value={config.tagline}
                        onChange={(e) => setConfig({...config, tagline: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none"
                    />
                </div>
                <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Cor Badge</label>
                      <div className="flex items-center gap-2 h-full">
                          <input type="color" value={config.taglineColor} onChange={(e) => setConfig({...config, taglineColor: e.target.value})} className="w-10 h-10 rounded cursor-pointer border-none"/>
                      </div>
                </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Título Principal</label>
              <input 
                value={config.heroTitle}
                onChange={(e) => setConfig({...config, heroTitle: e.target.value})}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-emerald-500 uppercase mb-1">Destaque principal</label>
              <input 
                value={config.heroHighlight}
                onChange={(e) => setConfig({...config, heroHighlight: e.target.value})}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white font-black tracking-wider focus:border-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Subtítulo</label>
              <textarea 
                value={config.heroSubtitle}
                onChange={(e) => setConfig({...config, heroSubtitle: e.target.value})}
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-300 focus:border-emerald-500 outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-zinc-800">
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2">Cor Título</label>
                <input type="color" value={config.titleColor} onChange={(e) => setConfig({...config, titleColor: e.target.value})} className="w-full h-10 rounded cursor-pointer"/>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2">Gradiente Início</label>
                <input type="color" value={config.gradientStart} onChange={(e) => setConfig({...config, gradientStart: e.target.value})} className="w-full h-10 rounded cursor-pointer"/>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2">Gradiente Fim</label>
                <input type="color" value={config.gradientEnd} onChange={(e) => setConfig({...config, gradientEnd: e.target.value})} className="w-full h-10 rounded cursor-pointer"/>
              </div>
            </div>
          </div>
        </section>

        {/* === CONTATO, SOCIAL & STATS === */}
        <section className="space-y-6">
            
            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
                 <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-4">
                    <Users className="text-purple-400" size={20} /> Métricas (Stats)
                 </h2>
                 <div className="grid grid-cols-3 gap-3">
                     <div>
                         <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">
                           {isMasterScope ? "Socios totais" : "Atletas"}
                         </label>
                         <input type="number" value={config.statUsers} onChange={(e) => setConfig({...config, statUsers: Number(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white text-sm" />
                     </div>
                     <div>
                         <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">
                           {isMasterScope ? "Atleticas criadas" : "Treinos"}
                         </label>
                         <input type="number" value={config.statPosts} onChange={(e) => setConfig({...config, statPosts: Number(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white text-sm" />
                     </div>
                     <div>
                         <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Parceiros</label>
                         <input type="number" value={config.statPartners} onChange={(e) => setConfig({...config, statPartners: Number(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white text-sm" />
                     </div>
                 </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Share2 className="text-amber-400" size={20} /> Contato & Redes
                </h2>
                
                <div className="grid grid-cols-1 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12}/> Endereço</label>
                        <input value={config.address} onChange={(e) => setConfig({...config, address: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">E-mail</label>
                            <input type="email" maxLength={EMAIL_MAX_LENGTH} value={config.email} onChange={(e) => setConfig({...config, email: normalizeEmailInput(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none" />
                        </div>
                        <div>
                             <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">WhatsApp</label>
                             <div className="flex items-center gap-2">
                                <Smartphone size={16} className="text-green-500"/>
                                <input placeholder="55129..." maxLength={PHONE_MAX_LENGTH} inputMode="numeric" value={config.whatsapp} onChange={(e) => setConfig({...config, whatsapp: normalizePhoneInput(e.target.value)})} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none" />
                             </div>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-zinc-800">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold text-zinc-500 uppercase">Redes Sociais</label>
                            <button onClick={addSocial} className="text-[10px] bg-zinc-800 px-2 py-1 rounded hover:text-white transition">+ Add</button>
                        </div>
                        
                        <div className="space-y-2">
                            {(config.socialLinks || []).map((social, idx) => (
                                <div key={social.id} className="flex gap-2">
                                    <div className="w-10 flex items-center justify-center bg-zinc-900 rounded border border-zinc-800">
                                        {getSocialIcon(social.platform)}
                                    </div>
                                    <select 
                                        value={social.platform}
                                        onChange={(e) => updateSocial(idx, 'platform', e.target.value)}
                                        className="bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-400 outline-none"
                                    >
                                        <option value="instagram">Instagram</option>
                                        <option value="tiktok">TikTok</option>
                                        <option value="twitter">Twitter</option>
                                        <option value="linkedin">LinkedIn</option>
                                        <option value="youtube">YouTube</option>
                                        <option value="website">Site</option>
                                    </select>
                                    <input 
                                        value={social.url}
                                        placeholder="URL Completa"
                                        onChange={(e) => updateSocial(idx, 'url', e.target.value)}
                                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 text-xs text-white outline-none focus:border-emerald-500"
                                    />
                                    <button onClick={() => removeSocial(idx)} className="text-zinc-600 hover:text-red-500"><Trash2 size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-5">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Loader2 className="text-emerald-400" size={20} /> Loading do App
                        </h2>
                        <p className="mt-1 text-xs text-zinc-500">
                            Personalize as frases da tela de carregamento da tenant. Maximo de {MAX_LOADING_PHRASES} frases.
                        </p>
                    </div>
                    <button onClick={addLoadingPhrase} className="text-xs flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg transition">
                        <Plus size={14}/> Adicionar
                    </button>
                </div>

                <div className="space-y-3">
                    {(config.loadingPhrases || []).map((phrase, idx) => (
                        <div key={`loading-phrase-${idx}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                    Frase {idx + 1}
                                </span>
                                <div className="flex items-center gap-3">
                                    <span className={`text-[10px] font-bold ${phrase.length >= LOADING_PHRASE_MAX_LENGTH ? "text-yellow-400" : "text-zinc-500"}`}>
                                        {phrase.length}/{LOADING_PHRASE_MAX_LENGTH}
                                    </span>
                                    <button onClick={() => removeLoadingPhrase(idx)} className="text-zinc-600 hover:text-red-500">
                                        <Trash2 size={14}/>
                                    </button>
                                </div>
                            </div>
                            <input
                                value={phrase}
                                maxLength={LOADING_PHRASE_MAX_LENGTH}
                                onChange={(e) => updateLoadingPhrase(idx, e.target.value)}
                                placeholder="Ex: Preparando o cardume para entrar em campo."
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white focus:border-emerald-500 outline-none"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>

        {/* === DEPOIMENTOS === */}
        <section className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6 lg:col-span-2">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <MessageSquare className="text-purple-400" size={20} /> Depoimentos
            </h2>
            <button onClick={addReview} className="text-xs flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg transition">
              <Plus size={14}/> Adicionar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(config.reviews || []).map((review, idx) => (
              <div key={review.id} className="relative bg-zinc-950 border border-zinc-800 p-4 rounded-xl group hover:border-zinc-700 transition">
                <button 
                  onClick={() => removeReview(idx)}
                  className="absolute top-2 right-2 text-zinc-600 hover:text-red-500 p-1"
                >
                  <Trash2 size={14}/>
                </button>

                <div className="space-y-3 mt-2">
                  <input 
                    placeholder="Nome"
                    value={review.name}
                    onChange={(e) => {
                      const newReviews = [...config.reviews];
                      newReviews[idx].name = e.target.value;
                      setConfig({...config, reviews: newReviews});
                    }}
                    className="w-full bg-transparent border-b border-zinc-800 text-sm text-white font-bold focus:border-emerald-500 outline-none"
                  />
                  <input 
                    placeholder="Cargo (ex: T5 Medicina)"
                    value={review.role}
                    onChange={(e) => {
                      const newReviews = [...config.reviews];
                      newReviews[idx].role = e.target.value;
                      setConfig({...config, reviews: newReviews});
                    }}
                    className="w-full bg-transparent border-b border-zinc-800 text-xs text-zinc-400 focus:border-emerald-500 outline-none"
                  />
                  
                  {/* Link do Perfil */}
                  <div className="flex items-center gap-2 bg-zinc-900/50 p-2 rounded-lg border border-zinc-800/50">
                    <Users size={12} className="text-zinc-500"/>
                    <input 
                      placeholder="URL da Foto / Perfil"
                      value={review.profileUrl}
                      onChange={(e) => {
                        const newReviews = [...config.reviews];
                        newReviews[idx].profileUrl = e.target.value;
                        setConfig({...config, reviews: newReviews});
                      }}
                      className="w-full bg-transparent text-[10px] text-emerald-400 placeholder-zinc-600 focus:outline-none"
                    />
                  </div>

                  <textarea 
                    placeholder="O que essa pessoa disse?"
                    value={review.text}
                    onChange={(e) => {
                      const newReviews = [...config.reviews];
                      newReviews[idx].text = e.target.value;
                      setConfig({...config, reviews: newReviews});
                    }}
                    rows={3}
                    className="w-full bg-zinc-900/30 rounded p-2 text-xs text-zinc-300 italic resize-none outline-none focus:ring-1 ring-zinc-700"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
