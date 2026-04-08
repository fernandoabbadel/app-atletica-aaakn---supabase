"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trophy,
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
    description: "Texto curto usado no album e no perfil.",
  },
  {
    key: "statusRelacionamento",
    title: "Relacionamento",
    description: "Bloco de status e privacidade do relacionamento.",
  },
  {
    key: "pets",
    title: "Mascote",
    description: "Selecao de pets/mascote do usuario.",
  },
  {
    key: "esportes",
    title: "Modalidades",
    description: "Botoes selecionaveis de modalidades esportivas.",
  },
];

export default function AdminUsuariosCadastroPage() {
  const { addToast } = useToast();
  const { tenantId, tenantSlug } = useTenantTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CadastroConfig>(getDefaultCadastroConfig);
  const [newSportLabel, setNewSportLabel] = useState("");
  const [newSportIcon, setNewSportIcon] = useState("");

  const backHref = tenantSlug ? withTenantSlug(tenantSlug, "/admin/usuarios") : "/admin/usuarios";
  const visibleSportsCount = useMemo(
    () => draft.sportOptions.filter((option) => option.enabled).length,
    [draft.sportOptions]
  );

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
        console.error("Erro ao carregar configuracao do cadastro:", error);
        if (!mounted) return;
        setDraft(getDefaultCadastroConfig());
        addToast("Nao foi possivel carregar a configuracao do cadastro.", "error");
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
      sportOptions: dedupeCadastroSportOptions([
        ...prev.sportOptions,
        normalized,
      ]),
    }));
    setNewSportLabel("");
    setNewSportIcon("");
    addToast("Modalidade adicionada ao rascunho.", "success");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextConfig = await saveCadastroConfig(draft, { tenantId });
      setDraft(nextConfig);
      addToast("Configuracao do cadastro salva.", "success");
    } catch (error: unknown) {
      console.error("Erro ao salvar configuracao do cadastro:", error);
      addToast("Erro ao salvar configuracao do cadastro.", "error");
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
                Campos e modalidades da pagina de cadastro
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
            {saving ? "Salvando..." : "Salvar Configuracao"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-3 text-emerald-400">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Campos opcionais
                </p>
                <h2 className="text-sm font-black uppercase">Exibicao e obrigatoriedade</h2>
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
                          {currentField.enabled ? "Visivel" : "Oculto"}
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
                          {currentField.required ? "Obrigatorio" : "Opcional"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-3 text-emerald-400">
                <Sparkles size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Resumo
                </p>
                <h2 className="text-sm font-black uppercase">Como o cadastro vai aparecer</h2>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Blocos visiveis
                </p>
                <p className="mt-2 text-3xl font-black text-white">
                  {FIELD_DEFINITIONS.filter((field) => draft.fields[field.key].enabled).length}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Modalidades ativas
                </p>
                <p className="mt-2 text-3xl font-black text-white">{visibleSportsCount}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Modalidade destaque
                </p>
                <p className="mt-2 text-sm font-black uppercase text-emerald-300">
                  {draft.sportOptions.find((option) => option.enabled)?.label || "Nenhuma ativa"}
                </p>
              </div>
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
              <h2 className="text-sm font-black uppercase">Botoes selecionaveis do cadastro</h2>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_170px_140px]">
            <input
              value={newSportLabel}
              onChange={(event) => setNewSportLabel(event.target.value)}
              placeholder="Nome da nova modalidade"
              className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-500"
            />
            <input
              value={newSportIcon}
              onChange={(event) => setNewSportIcon(event.target.value)}
              placeholder="Emoji"
              className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={handleAddSport}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-[11px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <Plus size={14} />
              Adicionar
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {draft.sportOptions.map((sport) => (
              <div
                key={sport.id}
                className={`rounded-2xl border p-4 transition ${
                  sport.enabled
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-zinc-800 bg-black/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl">{sport.icon}</p>
                    <p className="mt-3 text-sm font-black uppercase text-white">{sport.label}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      {sport.id}
                    </p>
                  </div>

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
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
