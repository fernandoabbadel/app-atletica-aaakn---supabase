"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Trophy,
  X,
} from "lucide-react";

import { useToast } from "@/context/ToastContext";
import { useTenantTheme } from "@/context/TenantThemeContext";
import {
  fetchCadastroConfig,
  getDefaultCadastroConfig,
  saveCadastroConfig,
  type CadastroConfig,
} from "@/lib/cadastroConfigService";
import {
  dedupeCadastroSportOptions,
  normalizeCadastroSportOption,
  type CadastroFieldKey,
  type CadastroSportOption,
} from "@/lib/cadastroOptions";
import { withTenantSlug } from "@/lib/tenantRouting";

const FIELD_DEFINITIONS: Array<{
  key: CadastroFieldKey;
  title: string;
  description: string;
}> = [
  {
    key: "instagram",
    title: "Instagram",
    description: "Campo para informar o @ no cadastro.",
  },
  {
    key: "bio",
    title: "Bio",
    description: "Texto curto usado no álbum e no perfil.",
  },
  {
    key: "statusRelacionamento",
    title: "Relacionamento",
    description: "Bloco de status e privacidade do relacionamento.",
  },
  {
    key: "pets",
    title: "Mascote",
    description: "Seleção de pets e mascote do usuário.",
  },
  {
    key: "esportes",
    title: "Modalidades",
    description: "Botões selecionáveis de modalidades esportivas.",
  },
];

const EMOJI_OPTIONS = [
  "⚽",
  "🏀",
  "🏐",
  "🎾",
  "🏓",
  "🏸",
  "🥎",
  "⚾",
  "🏉",
  "🏈",
  "🥏",
  "🎱",
  "🏏",
  "🏑",
  "🏒",
  "🥍",
  "🏹",
  "🥊",
  "🥋",
  "🤺",
  "⛳",
  "⛸️",
  "🎣",
  "🤿",
  "🏊",
  "🏄",
  "🚣",
  "🛶",
  "🚴",
  "🏋️",
  "🤸",
  "🤾",
  "🤽",
  "🏌️",
  "🏇",
  "🧘",
  "🧗",
  "🏂",
  "⛷️",
  "🏃",
  "💪",
  "🔥",
  "⭐",
  "🌟",
  "🏅",
  "🥇",
  "🥈",
  "🥉",
  "🏆",
  "🎖️",
  "👟",
  "🧢",
  "🎯",
  "🎉",
  "🚀",
  "🌊",
  "🏖️",
  "🌴",
  "☀️",
  "⚡",
  "🐶",
  "🐱",
  "🐺",
  "🐯",
  "🦁",
  "🦅",
  "🦈",
  "🐍",
  "🐉",
  "🐲",
  "🦍",
  "🦊",
  "🐆",
  "🦬",
  "🦄",
  "❤️",
  "🖤",
  "🤍",
  "💙",
  "💚",
  "💛",
  "🧡",
  "💜",
  "🤎",
  "👏",
  "🙌",
  "👊",
  "🤝",
  "😎",
  "🥳",
];

export default function AdminUsuariosCadastroPage() {
  const { addToast } = useToast();
  const { tenantId, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CadastroConfig>(getDefaultCadastroConfig);
  const [newSportLabel, setNewSportLabel] = useState("");
  const [newSportIcon, setNewSportIcon] = useState("");
  const [editingSportId, setEditingSportId] = useState("");
  const [editingSportLabel, setEditingSportLabel] = useState("");
  const [editingSportIcon, setEditingSportIcon] = useState("");

  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/usuarios") : "/admin/usuarios";

  useEffect(() => {
    let mounted = true;

    const loadConfig = async () => {
      setLoading(true);
      try {
        const nextConfig = await fetchCadastroConfig({
          tenantId,
          forceRefresh: true,
        });
        if (!mounted) return;
        setDraft(nextConfig);
      } catch (error: unknown) {
        console.error("Erro ao carregar configuração do cadastro:", error);
        if (!mounted) return;
        setDraft(getDefaultCadastroConfig());
        addToast("Não foi possível carregar a configuração do cadastro.", "error");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, [addToast, tenantId]);

  const toggleField = (fieldKey: CadastroFieldKey, property: "enabled" | "required") => {
    setDraft((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldKey]: {
          ...prev.fields[fieldKey],
          [property]: !prev.fields[fieldKey][property],
        },
      },
    }));
  };

  const toggleSportEnabled = (sportId: string) => {
    setDraft((prev) => ({
      ...prev,
      sportOptions: prev.sportOptions.map((option) =>
        option.id === sportId ? { ...option, enabled: !option.enabled } : option
      ),
    }));
  };

  const resetEditingSport = () => {
    setEditingSportId("");
    setEditingSportLabel("");
    setEditingSportIcon("");
  };

  const startEditingSport = (sport: CadastroSportOption) => {
    setEditingSportId(sport.id);
    setEditingSportLabel(sport.label);
    setEditingSportIcon(sport.icon);
  };

  const handleAddSport = () => {
    const normalized = normalizeCadastroSportOption({
      label: newSportLabel,
      icon: newSportIcon,
      enabled: true,
    });

    if (!normalized) {
      addToast("Informe pelo menos o nome da nova modalidade.", "info");
      return;
    }

    setDraft((prev) => ({
      ...prev,
      sportOptions: dedupeCadastroSportOptions([...prev.sportOptions, normalized]),
    }));
    setNewSportLabel("");
    setNewSportIcon("");
    addToast("Modalidade adicionada ao rascunho.", "success");
  };

  const handleSaveSportEdit = (sport: CadastroSportOption) => {
    const normalized = normalizeCadastroSportOption({
      id: sport.id,
      label: editingSportLabel,
      icon: editingSportIcon,
      enabled: sport.enabled,
    });

    if (!normalized) {
      addToast("Informe um nome válido para a modalidade.", "info");
      return;
    }

    setDraft((prev) => ({
      ...prev,
      sportOptions: dedupeCadastroSportOptions(
        prev.sportOptions.map((option) => (option.id === sport.id ? normalized : option))
      ),
    }));
    resetEditingSport();
    addToast("Botão da modalidade atualizado no rascunho.", "success");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextConfig = await saveCadastroConfig(draft, { tenantId });
      setDraft(nextConfig);
      resetEditingSport();
      addToast("Configuração do cadastro salva.", "success");
    } catch (error: unknown) {
      console.error("Erro ao salvar configuração do cadastro:", error);
      addToast("Erro ao salvar configuração do cadastro.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-emerald-400">
        <Loader2 className="animate-spin" size={26} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] pb-20 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#050505]/90 px-4 py-5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 transition hover:bg-zinc-800"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Cadastro</h1>
              <p className="text-[11px] font-bold text-zinc-500">
                Campos e modalidades da página de cadastro
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-[11px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Salvando..." : "Salvar configuração"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <section>
          <article className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-3 text-emerald-400">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Campos opcionais
                </p>
                <h2 className="text-sm font-black uppercase">Exibição e obrigatoriedade</h2>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {FIELD_DEFINITIONS.map((field) => {
                const currentField = draft.fields[field.key];
                return (
                  <div
                    key={field.key}
                    className="rounded-2xl border border-zinc-800 bg-black/30 p-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-black uppercase text-white">{field.title}</p>
                        <p className="mt-1 text-xs text-zinc-400">{field.description}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleField(field.key, "enabled")}
                          className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase transition ${
                            currentField.enabled
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                        >
                          {currentField.enabled ? "Visível" : "Oculto"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleField(field.key, "required")}
                          className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase transition ${
                            currentField.required
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                        >
                          {currentField.required ? "Obrigatório" : "Opcional"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-3 text-emerald-400">
              <Trophy size={18} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                Modalidades
              </p>
              <h2 className="text-sm font-black uppercase">Botões selecionáveis do cadastro</h2>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_140px]">
            <input
              value={newSportLabel}
              onChange={(event) => setNewSportLabel(event.target.value)}
              placeholder="Nome da nova modalidade"
              className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-500"
            />
            <select
              value={newSportIcon}
              onChange={(event) => setNewSportIcon(event.target.value)}
              className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-500"
            >
              <option value="">Escolha um emoji</option>
              {EMOJI_OPTIONS.map((emoji) => (
                <option key={emoji} value={emoji}>
                  {emoji}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddSport}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-[11px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <Plus size={14} />
              Adicionar
            </button>
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Use o dropdown para escolher o emoji da modalidade e o botão de editar para ajustar os
            cards já existentes.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {draft.sportOptions.map((sport) => {
              const isEditing = editingSportId === sport.id;
              return (
                <div
                  key={sport.id}
                  className={`rounded-2xl border p-4 transition ${
                    sport.enabled
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-zinc-800 bg-black/30"
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-2xl">{editingSportIcon || sport.icon}</p>
                        <button
                          type="button"
                          onClick={() => toggleSportEnabled(sport.id)}
                          className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase transition ${
                            sport.enabled
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                        >
                          {sport.enabled ? "Ativo" : "Oculto"}
                        </button>
                      </div>

                      <input
                        value={editingSportLabel}
                        onChange={(event) => setEditingSportLabel(event.target.value)}
                        placeholder="Nome da modalidade"
                        className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500"
                      />

                      <select
                        value={editingSportIcon}
                        onChange={(event) => setEditingSportIcon(event.target.value)}
                        className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500"
                      >
                        <option value="">Escolha um emoji</option>
                        {EMOJI_OPTIONS.map((emoji) => (
                          <option key={`${sport.id}-${emoji}`} value={emoji}>
                            {emoji}
                          </option>
                        ))}
                      </select>

                      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                        {sport.id}
                      </p>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={resetEditingSport}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-black uppercase text-zinc-300 transition hover:bg-zinc-800"
                        >
                          <X size={13} />
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveSportEdit(sport)}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20"
                        >
                          <Check size={13} />
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-2xl">{sport.icon}</p>
                        <p className="mt-3 text-sm font-black uppercase text-white">{sport.label}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          {sport.id}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => toggleSportEnabled(sport.id)}
                          className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase transition ${
                            sport.enabled
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-700 bg-zinc-900 text-zinc-400"
                          }`}
                        >
                          {sport.enabled ? "Ativo" : "Oculto"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditingSport(sport)}
                          className="inline-flex items-center justify-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] font-black uppercase text-blue-300 transition hover:bg-blue-500/20"
                        >
                          <Pencil size={11} />
                          Editar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
