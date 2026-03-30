"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  Globe,
  Instagram,
  LayoutTemplate,
  Linkedin,
  Loader2,
  MapPin,
  MessageSquare,
  Music2,
  Palette,
  Plus,
  Save,
  Share2,
  Smartphone,
  Trash2,
  Twitter,
  Users,
  Youtube,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import {
  LOADING_PHRASE_MAX_LENGTH,
  MAX_LOADING_PHRASES,
  type LandingConfig,
  type SocialLink,
} from "@/lib/adminLandingService";
import {
  EMAIL_MAX_LENGTH,
  normalizeEmailInput,
  normalizePhoneInput,
  PHONE_MAX_LENGTH,
} from "@/utils/contactFields";

type LandingEditorToastType = "success" | "error" | "info";

type LandingEditorShellProps = {
  scope: "platform" | "tenant";
  loading: boolean;
  saving: boolean;
  config: LandingConfig;
  setConfig: React.Dispatch<React.SetStateAction<LandingConfig>>;
  onSave: () => void;
  contextLabel: string;
  brandName: string;
  brandDescription: string;
  brandLogoUrl: string;
  brandLogoAlt: string;
  brandLogoUnoptimized?: boolean;
  accentColor: string;
  brandManagePath?: string;
  brandManageLabel?: string;
};

const updateReviewField = (
  reviews: LandingConfig["reviews"],
  index: number,
  field: "name" | "role" | "text" | "profileUrl",
  value: string
) =>
  reviews.map((review, reviewIndex) =>
    reviewIndex === index ? { ...review, [field]: value } : review
  );

export default function LandingEditorShell({
  scope,
  loading,
  saving,
  config,
  setConfig,
  onSave,
  contextLabel,
  brandName,
  brandDescription,
  brandLogoUrl,
  brandLogoAlt,
  brandLogoUnoptimized = false,
  accentColor,
  brandManagePath = "",
  brandManageLabel = "",
}: LandingEditorShellProps) {
  const { addToast } = useToast();
  const isPlatform = scope === "platform";

  const notify = (message: string, type: LandingEditorToastType = "info") => {
    addToast(message, type);
  };

  const addSocial = () => {
    setConfig((current) => ({
      ...current,
      socialLinks: [
        ...(current.socialLinks || []),
        { id: Date.now().toString(), platform: "instagram", url: "" },
      ],
    }));
  };

  const removeSocial = (index: number) => {
    setConfig((current) => ({
      ...current,
      socialLinks: current.socialLinks.filter((_, socialIndex) => socialIndex !== index),
    }));
  };

  const updateSocial = (
    index: number,
    field: keyof SocialLink,
    value: string
  ) => {
    setConfig((current) => {
      const nextSocials = [...current.socialLinks];
      const selectedSocial = nextSocials[index];
      if (!selectedSocial) return current;

      if (field === "platform") {
        nextSocials[index] = {
          ...selectedSocial,
          platform: value as SocialLink["platform"],
        };
      } else {
        nextSocials[index] = { ...selectedSocial, [field]: value };
      }

      return {
        ...current,
        socialLinks: nextSocials,
      };
    });
  };

  const addReview = () => {
    setConfig((current) => ({
      ...current,
      reviews: [
        ...(current.reviews || []),
        {
          id: Date.now().toString(),
          name: "",
          role: "",
          text: "",
          profileUrl: "",
        },
      ],
    }));
  };

  const removeReview = (index: number) => {
    setConfig((current) => ({
      ...current,
      reviews: current.reviews.filter((_, reviewIndex) => reviewIndex !== index),
    }));
  };

  const addLoadingPhrase = () => {
    if ((config.loadingPhrases || []).length >= MAX_LOADING_PHRASES) {
      notify(`Limite de ${MAX_LOADING_PHRASES} frases atingido.`);
      return;
    }

    setConfig((current) => ({
      ...current,
      loadingPhrases: [...(current.loadingPhrases || []), ""],
    }));
  };

  const removeLoadingPhrase = (index: number) => {
    const currentPhrases = config.loadingPhrases || [];
    if (currentPhrases.length <= 1) {
      notify("Mantenha pelo menos 1 frase de carregamento.");
      return;
    }

    setConfig((current) => ({
      ...current,
      loadingPhrases: current.loadingPhrases.filter(
        (_, phraseIndex) => phraseIndex !== index
      ),
    }));
  };

  const updateLoadingPhrase = (index: number, value: string) => {
    setConfig((current) => {
      const nextLoadingPhrases = [...(current.loadingPhrases || [])];
      nextLoadingPhrases[index] = value.slice(0, LOADING_PHRASE_MAX_LENGTH);
      return {
        ...current,
        loadingPhrases: nextLoadingPhrases,
      };
    });
  };

  const getSocialIcon = (platform: string) => {
    switch (platform) {
      case "instagram":
        return <Instagram size={16} className="text-pink-500" />;
      case "tiktok":
        return <Music2 size={16} className="text-cyan-400" />;
      case "twitter":
        return <Twitter size={16} className="text-blue-400" />;
      case "linkedin":
        return <Linkedin size={16} className="text-blue-600" />;
      case "youtube":
        return <Youtube size={16} className="text-red-500" />;
      default:
        return <Globe size={16} className="text-zinc-400" />;
    }
  };

  if (loading) {
    return <div className="p-8 text-white">Carregando landing...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 pb-32 pt-6 md:px-12">
      <header className="mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black text-white">
            <LayoutTemplate className="text-emerald-500" />
            {isPlatform ? "Landing USC" : "Editor da Landing"}
          </h1>
          <span
            className="mt-1 block text-sm font-bold uppercase tracking-[0.22em]"
            style={{ color: accentColor }}
          >
            {contextLabel}
          </span>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 font-bold uppercase tracking-wider text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Salvando..." : (
            <>
              <Save size={18} />
              Publicar Alteracoes
            </>
          )}
        </button>
      </header>

      <section className="mx-auto mb-8 flex max-w-7xl items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-lg">
          <Image
            src={brandLogoUrl}
            alt={brandLogoAlt}
            fill
            className="object-contain p-3"
            sizes="80px"
            unoptimized={brandLogoUnoptimized}
            priority
          />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            {isPlatform ? "Marca oficial da plataforma" : "Marca oficial da atletica"}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-white">
            <Building2 size={18} className="text-cyan-400" />
            {brandName}
          </h2>
          <p className="mt-1 text-xs text-zinc-400">{brandDescription}</p>
          {brandManagePath ? (
            <Link
              href={brandManagePath}
              className="mt-3 inline-flex rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300 transition hover:border-emerald-500 hover:text-white"
            >
              {brandManageLabel || "Editar marca"}
            </Link>
          ) : null}
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Palette className="text-blue-400" size={20} />
            Identidade Visual e Texto
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                  Tagline (Badge)
                </label>
                <input
                  value={config.tagline}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      tagline: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                  Cor Badge
                </label>
                <div className="flex h-full items-center gap-2">
                  <input
                    type="color"
                    value={config.taglineColor}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        taglineColor: event.target.value,
                      }))
                    }
                    className="h-10 w-10 cursor-pointer rounded border-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                Titulo Principal
              </label>
              <input
                value={config.heroTitle}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    heroTitle: event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-emerald-500">
                Destaque principal
              </label>
              <input
                value={config.heroHighlight}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    heroHighlight: event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-black tracking-wider text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                Subtitulo
              </label>
              <textarea
                value={config.heroSubtitle}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    heroSubtitle: event.target.value,
                  }))
                }
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300 outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-zinc-800 pt-4">
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase text-zinc-500">
                  Cor Titulo
                </label>
                <input
                  type="color"
                  value={config.titleColor}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      titleColor: event.target.value,
                    }))
                  }
                  className="h-10 w-full cursor-pointer rounded"
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase text-zinc-500">
                  Gradiente Inicio
                </label>
                <input
                  type="color"
                  value={config.gradientStart}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      gradientStart: event.target.value,
                    }))
                  }
                  className="h-10 w-full cursor-pointer rounded"
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase text-zinc-500">
                  Gradiente Fim
                </label>
                <input
                  type="color"
                  value={config.gradientEnd}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      gradientEnd: event.target.value,
                    }))
                  }
                  className="h-10 w-full cursor-pointer rounded"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Users className="text-purple-400" size={20} />
              Metricas (Stats)
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                  {isPlatform ? "Socios totais" : "Atletas"}
                </label>
                <input
                  type="number"
                  value={config.statUsers}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      statUsers: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                  {isPlatform ? "Atleticas criadas" : "Treinos"}
                </label>
                <input
                  type="number"
                  value={config.statPosts}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      statPosts: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                  Parceiros
                </label>
                <input
                  type="number"
                  value={config.statPartners}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      statPartners: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-sm text-white"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Share2 className="text-amber-400" size={20} />
              Contato e Redes
            </h2>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-bold uppercase text-zinc-500">
                  <MapPin size={12} />
                  Endereco
                </label>
                <input
                  value={config.address}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                    Telefone
                  </label>
                  <input
                    maxLength={PHONE_MAX_LENGTH}
                    value={config.phone}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        phone: normalizePhoneInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                    E-mail
                  </label>
                  <input
                    type="email"
                    maxLength={EMAIL_MAX_LENGTH}
                    value={config.email}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        email: normalizeEmailInput(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                    WhatsApp
                  </label>
                  <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-green-500" />
                    <input
                      placeholder="55129..."
                      maxLength={PHONE_MAX_LENGTH}
                      inputMode="numeric"
                      value={config.whatsapp}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          whatsapp: normalizePhoneInput(event.target.value),
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase text-zinc-500">
                    Redes Sociais
                  </label>
                  <button
                    onClick={addSocial}
                    className="rounded bg-zinc-800 px-2 py-1 text-[10px] transition hover:text-white"
                  >
                    + Add
                  </button>
                </div>

                <div className="space-y-2">
                  {(config.socialLinks || []).map((social, index) => (
                    <div key={social.id} className="flex gap-2">
                      <div className="flex w-10 items-center justify-center rounded border border-zinc-800 bg-zinc-900">
                        {getSocialIcon(social.platform)}
                      </div>
                      <select
                        value={social.platform}
                        onChange={(event) =>
                          updateSocial(index, "platform", event.target.value)
                        }
                        className="rounded border border-zinc-800 bg-zinc-950 text-xs text-zinc-400 outline-none"
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
                        onChange={(event) =>
                          updateSocial(index, "url", event.target.value)
                        }
                        className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-white outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => removeSocial(index)}
                        className="text-zinc-600 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                  <Loader2 className="text-emerald-400" size={20} />
                  Loading do App
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Personalize as frases da tela de carregamento da landing. Maximo de{" "}
                  {MAX_LOADING_PHRASES} frases.
                </p>
              </div>
              <button
                onClick={addLoadingPhrase}
                className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-white transition hover:bg-zinc-700"
              >
                <Plus size={14} />
                Adicionar
              </button>
            </div>

            <div className="space-y-3">
              {(config.loadingPhrases || []).map((phrase, index) => (
                <div
                  key={`loading-phrase-${index}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Frase {index + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-[10px] font-bold ${
                          phrase.length >= LOADING_PHRASE_MAX_LENGTH
                            ? "text-yellow-400"
                            : "text-zinc-500"
                        }`}
                      >
                        {phrase.length}/{LOADING_PHRASE_MAX_LENGTH}
                      </span>
                      <button
                        onClick={() => removeLoadingPhrase(index)}
                        className="text-zinc-600 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <input
                    value={phrase}
                    maxLength={LOADING_PHRASE_MAX_LENGTH}
                    onChange={(event) =>
                      updateLoadingPhrase(index, event.target.value)
                    }
                    placeholder="Ex: Preparando o cardume para entrar em campo."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-white outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <MessageSquare className="text-purple-400" size={20} />
              Depoimentos
            </h2>
            <button
              onClick={addReview}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-white transition hover:bg-zinc-700"
            >
              <Plus size={14} />
              Adicionar
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(config.reviews || []).map((review, index) => (
              <div
                key={review.id}
                className="group relative rounded-xl border border-zinc-800 bg-zinc-950 p-4 transition hover:border-zinc-700"
              >
                <button
                  onClick={() => removeReview(index)}
                  className="absolute right-2 top-2 p-1 text-zinc-600 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>

                <div className="mt-2 space-y-3">
                  <input
                    placeholder="Nome"
                    value={review.name}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        reviews: updateReviewField(
                          current.reviews,
                          index,
                          "name",
                          event.target.value
                        ),
                      }))
                    }
                    className="w-full border-b border-zinc-800 bg-transparent text-sm font-bold text-white outline-none focus:border-emerald-500"
                  />
                  <input
                    placeholder="Cargo (ex: T5 Medicina)"
                    value={review.role}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        reviews: updateReviewField(
                          current.reviews,
                          index,
                          "role",
                          event.target.value
                        ),
                      }))
                    }
                    className="w-full border-b border-zinc-800 bg-transparent text-xs text-zinc-400 outline-none focus:border-emerald-500"
                  />

                  <div className="flex items-center gap-2 rounded-lg border border-zinc-800/50 bg-zinc-900/50 p-2">
                    <Users size={12} className="text-zinc-500" />
                    <input
                      placeholder="URL da Foto / Perfil"
                      value={review.profileUrl}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          reviews: updateReviewField(
                            current.reviews,
                            index,
                            "profileUrl",
                            event.target.value
                          ),
                        }))
                      }
                      className="w-full bg-transparent text-[10px] text-emerald-400 placeholder-zinc-600 focus:outline-none"
                    />
                  </div>

                  <textarea
                    placeholder="O que essa pessoa disse?"
                    value={review.text}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        reviews: updateReviewField(
                          current.reviews,
                          index,
                          "text",
                          event.target.value
                        ),
                      }))
                    }
                    rows={3}
                    className="w-full resize-none rounded p-2 text-xs italic text-zinc-300 outline-none ring-zinc-700 focus:ring-1"
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
