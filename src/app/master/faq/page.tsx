"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  ChevronDown,
  Copy,
  Dumbbell,
  Eye,
  GripVertical,
  HelpCircle,
  LifeBuoy,
  Loader2,
  ImageIcon,
  Plus,
  Save,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ImageResizeHelpLink } from "@/components/ImageResizeHelpLink";
import {
  DEFAULT_PLATFORM_FAQ_CONFIG,
  sanitizePlatformFaqConfig,
  type PlatformFaqConfig,
  type PlatformFaqIcon,
  type PlatformFaqQuestion,
  type PlatformFaqSection,
  type PlatformFaqStep,
} from "@/lib/platformFaqConfig";
import {
  fetchPlatformFaqConfig,
  savePlatformFaqConfig,
} from "@/lib/platformFaqService";
import { isPlatformMaster } from "@/lib/roles";
import { uploadImage, VERSIONED_PUBLIC_ASSET_CACHE_CONTROL } from "@/lib/upload";

type FaqTextField = Exclude<keyof PlatformFaqConfig, "steps" | "sections">;
type SectionTextField = Exclude<keyof PlatformFaqSection, "questions" | "icon">;
type QuestionTextField = "question" | "answer" | "imageUrl" | "imageAlt";
type StepTextField = Exclude<keyof PlatformFaqStep, "id">;

const FAQ_PRINT_MAX_BYTES = 200 * 1024;

const iconOptions: Array<{
  value: PlatformFaqIcon;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "start", label: "Primeiros passos", icon: BookOpen },
  { value: "profile", label: "Perfil", icon: UserCircle },
  { value: "card", label: "Carteirinha", icon: BadgeCheck },
  { value: "events", label: "Eventos", icon: Ticket },
  { value: "store", label: "Loja", icon: ShoppingBag },
  { value: "training", label: "Treinos", icon: Dumbbell },
  { value: "admin", label: "Admin", icon: Shield },
  { value: "support", label: "Suporte", icon: LifeBuoy },
];

const iconMap = iconOptions.reduce<Record<PlatformFaqIcon, LucideIcon>>(
  (acc, option) => {
    acc[option.value] = option.icon;
    return acc;
  },
  {} as Record<PlatformFaqIcon, LucideIcon>
);

const makeId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const createQuestion = (): PlatformFaqQuestion => ({
  id: makeId("question"),
  question: "Nova pergunta",
  answer: "Escreva uma resposta objetiva, com o caminho da tela e o que o usuário deve fazer.",
  imageUrl: "",
  imageAlt: "",
  likes: 0,
  dislikes: 0,
});

const createStep = (index: number): PlatformFaqStep => ({
  id: makeId("step"),
  kicker: String(index + 1).padStart(2, "0"),
  title: "Novo passo",
  description: "Explique o passo do fluxo principal.",
  actionLabel: "Abrir",
  href: "/",
});

const createSection = (): PlatformFaqSection => ({
  id: makeId("section"),
  title: "Nova seção",
  description: "Resumo do tema desta seção.",
  audience: "Público-alvo",
  icon: "start",
  questions: [createQuestion()],
});

const moveItem = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
};

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-black uppercase text-zinc-500">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          maxLength={maxLength}
          placeholder={placeholder}
          className="w-full resize-none rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-700 focus:border-red-400/60"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-red-400/60"
        />
      )}
    </label>
  );
}

export default function MasterFaqPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [config, setConfig] = useState<PlatformFaqConfig>(DEFAULT_PLATFORM_FAQ_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(
    DEFAULT_PLATFORM_FAQ_CONFIG.sections[0]?.id || ""
  );
  const [dirty, setDirty] = useState(false);
  const [uploadingQuestionImageId, setUploadingQuestionImageId] = useState("");

  const canAccess = isPlatformMaster(user);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) {
      addToast("Área exclusiva do master da plataforma.", "error");
      router.replace("/sem-permissao");
      return;
    }

    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchPlatformFaqConfig({ forceRefresh: true });
        if (!mounted) return;
        setConfig(payload.config);
        setActiveSectionId(payload.config.sections[0]?.id || "");
        setDirty(false);
      } catch (error: unknown) {
        if (!mounted) return;
        console.error("Falha ao carregar FAQ:", error);
        addToast("Não foi possível carregar o FAQ salvo. Usando fallback local.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [addToast, authLoading, canAccess, router]);

  const activeSection = useMemo(
    () => config.sections.find((section) => section.id === activeSectionId) || config.sections[0],
    [activeSectionId, config.sections]
  );

  const updateConfig = (updater: (current: PlatformFaqConfig) => PlatformFaqConfig) => {
    setDirty(true);
    setConfig((current) => sanitizePlatformFaqConfig(updater(current), current));
  };

  const updateRootField = (field: FaqTextField, value: string) => {
    updateConfig((current) => ({ ...current, [field]: value }));
  };

  const updateStep = (stepId: string, field: StepTextField, value: string) => {
    updateConfig((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === stepId ? { ...step, [field]: value } : step
      ),
    }));
  };

  const addStep = () => {
    updateConfig((current) => ({
      ...current,
      steps: [...current.steps, createStep(current.steps.length)],
    }));
  };

  const removeStep = (stepId: string) => {
    updateConfig((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== stepId),
    }));
  };

  const moveStep = (stepId: string, direction: -1 | 1) => {
    updateConfig((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      return { ...current, steps: moveItem(current.steps, index, direction) };
    });
  };

  const updateSection = (sectionId: string, field: SectionTextField, value: string) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, [field]: value } : section
      ),
    }));
  };

  const updateSectionIcon = (sectionId: string, icon: PlatformFaqIcon) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, icon } : section
      ),
    }));
  };

  const addSection = () => {
    const section = createSection();
    updateConfig((current) => ({
      ...current,
      sections: [...current.sections, section],
    }));
    setActiveSectionId(section.id);
  };

  const duplicateSection = (section: PlatformFaqSection) => {
    const copy: PlatformFaqSection = {
      ...section,
      id: makeId("section"),
      title: `${section.title} cópia`.slice(0, 90),
      questions: section.questions.map((question) => ({
        ...question,
        id: makeId("question"),
      })),
    };
    updateConfig((current) => ({
      ...current,
      sections: [...current.sections, copy],
    }));
    setActiveSectionId(copy.id);
  };

  const removeSection = (sectionId: string) => {
    if (config.sections.length <= 1) {
      addToast("Mantenha pelo menos uma seção no FAQ.", "error");
      return;
    }

    const nextActive = config.sections.find((section) => section.id !== sectionId)?.id || "";
    updateConfig((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
    }));
    if (activeSectionId === sectionId) setActiveSectionId(nextActive);
  };

  const moveSection = (sectionId: string, direction: -1 | 1) => {
    updateConfig((current) => {
      const index = current.sections.findIndex((section) => section.id === sectionId);
      return { ...current, sections: moveItem(current.sections, index, direction) };
    });
  };

  const updateQuestion = (
    sectionId: string,
    questionId: string,
    field: QuestionTextField,
    value: string
  ) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId ? { ...question, [field]: value } : question
              ),
            }
          : section
      ),
    }));
  };

  const handleQuestionImageUpload = async (
    sectionId: string,
    questionId: string,
    file?: File | null
  ) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      addToast("Envie uma imagem em JPG, PNG ou WEBP.", "error");
      return;
    }
    if (file.size > FAQ_PRINT_MAX_BYTES) {
      addToast("O print precisa ter até 200 KB. Reduza o arquivo no Squoosh antes de enviar.", "error");
      return;
    }

    setUploadingQuestionImageId(questionId);
    try {
      const { url, error } = await uploadImage(file, `faq/prints/${sectionId}/${questionId}`, {
        scopeKey: `faq:${sectionId}:${questionId}`,
        fileName: "print",
        upsert: true,
        maxBytes: FAQ_PRINT_MAX_BYTES,
        compressionMaxBytes: FAQ_PRINT_MAX_BYTES,
        versionStrategy: "file-metadata",
        allowOriginalOnCompressionFail: true,
        cacheControl: VERSIONED_PUBLIC_ASSET_CACHE_CONTROL,
      });
      if (!url || error) {
        throw new Error(error || "Falha ao enviar imagem.");
      }
      updateQuestion(sectionId, questionId, "imageUrl", url);
      addToast("Print enviado para a pergunta. Salve o FAQ para publicar.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Falha ao enviar imagem.";
      addToast(message, "error");
    } finally {
      setUploadingQuestionImageId("");
    }
  };

  const addQuestion = (sectionId: string) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? { ...section, questions: [...section.questions, createQuestion()] }
          : section
      ),
    }));
  };

  const removeQuestion = (sectionId: string, questionId: string) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions:
                section.questions.length > 1
                  ? section.questions.filter((question) => question.id !== questionId)
                  : section.questions,
            }
          : section
      ),
    }));
  };

  const moveQuestion = (sectionId: string, questionId: string, direction: -1 | 1) => {
    updateConfig((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const index = section.questions.findIndex((question) => question.id === questionId);
        return { ...section, questions: moveItem(section.questions, index, direction) };
      }),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = await savePlatformFaqConfig(config);
      setConfig(payload.config);
      setActiveSectionId(payload.config.sections[0]?.id || "");
      setDirty(false);
      addToast("FAQ USC atualizado com sucesso.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Falha ao salvar FAQ.";
      addToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) return null;

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-red-300">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  const ActiveIcon = activeSection ? iconMap[activeSection.icon] || HelpCircle : HelpCircle;

  return (
    <div className="min-h-screen bg-[#050505] pb-12 text-white">
      <header className="sticky top-[var(--master-topbar-height)] z-30 -mx-6 border-b border-red-500/[0.15] bg-[#050505]/[0.92] px-6 py-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/master"
              className="rounded-full border border-zinc-800 bg-zinc-900 p-2 transition hover:bg-zinc-800"
              title="Voltar ao master"
            >
              <ArrowLeft size={18} className="text-zinc-300" />
            </Link>
            <div>
              <p className="text-xs font-black uppercase text-red-300">Plataforma USC</p>
              <h1 className="text-xl font-black uppercase text-white">FAQ global</h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-black uppercase text-zinc-200 transition hover:bg-zinc-800"
            >
              <Eye size={14} /> Ver página
            </Link>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/[0.35] bg-red-500 px-4 py-2.5 text-xs font-black uppercase text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {dirty ? "Salvar alterações" : "Salvar"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 py-6 xl:grid-cols-[420px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-3xl border border-red-500/[0.15] bg-[linear-gradient(135deg,rgba(127,29,29,0.2),rgba(10,10,10,0.94))] p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/[0.15] text-red-200">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-sm font-black uppercase text-white">Hero da página</h2>
                <p className="text-xs text-zinc-500">Topo do /faq público.</p>
              </div>
            </div>

            <div className="space-y-4">
              <TextField
                label="Selo"
                value={config.eyebrow}
                maxLength={80}
                onChange={(value) => updateRootField("eyebrow", value)}
              />
              <TextField
                label="Título"
                value={config.heroTitle}
                maxLength={80}
                onChange={(value) => updateRootField("heroTitle", value)}
              />
              <TextField
                label="Destaque"
                value={config.heroHighlight}
                maxLength={80}
                onChange={(value) => updateRootField("heroHighlight", value)}
              />
              <TextField
                label="Descrição"
                value={config.heroDescription}
                maxLength={420}
                multiline
                onChange={(value) => updateRootField("heroDescription", value)}
              />
              <TextField
                label="Placeholder da busca"
                value={config.searchPlaceholder}
                maxLength={120}
                onChange={(value) => updateRootField("searchPlaceholder", value)}
              />
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase text-white">Passos rápidos</h2>
                <p className="text-xs text-zinc-500">Bloco Comece por aqui.</p>
              </div>
              <button
                type="button"
                onClick={addStep}
                className="rounded-xl border border-zinc-700 bg-black p-2 text-zinc-300 transition hover:bg-zinc-800"
                title="Adicionar passo"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {config.steps.map((step, index) => (
                <details
                  key={step.id}
                  className="rounded-2xl border border-zinc-800 bg-black/40 p-3"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <GripVertical size={14} className="shrink-0 text-zinc-600" />
                      <span className="truncate text-sm font-black uppercase text-white">
                        {step.kicker} - {step.title}
                      </span>
                    </span>
                    <ChevronDown size={16} className="shrink-0 text-zinc-500" />
                  </summary>
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Numero"
                        value={step.kicker}
                        maxLength={12}
                        onChange={(value) => updateStep(step.id, "kicker", value)}
                      />
                      <TextField
                        label="Link"
                        value={step.href}
                        maxLength={180}
                        onChange={(value) => updateStep(step.id, "href", value)}
                      />
                    </div>
                    <TextField
                      label="Título"
                      value={step.title}
                      maxLength={80}
                      onChange={(value) => updateStep(step.id, "title", value)}
                    />
                    <TextField
                      label="Descrição"
                      value={step.description}
                      maxLength={260}
                      multiline
                      onChange={(value) => updateStep(step.id, "description", value)}
                    />
                    <TextField
                      label="Botao"
                      value={step.actionLabel}
                      maxLength={40}
                      onChange={(value) => updateStep(step.id, "actionLabel", value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => moveStep(step.id, -1)}
                        disabled={index === 0}
                        className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                      >
                        Subir
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(step.id, 1)}
                        disabled={index === config.steps.length - 1}
                        className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                      >
                        Descer
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStep(step.id)}
                        disabled={config.steps.length <= 1}
                        className="ml-auto rounded-lg border border-red-500/20 px-3 py-2 text-xs font-black uppercase text-red-300 disabled:opacity-40"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-black uppercase text-white">Suporte final</h2>
              <p className="text-xs text-zinc-500">Chamada no rodapé do FAQ.</p>
            </div>
            <div className="space-y-4">
              <TextField
                label="Título"
                value={config.supportTitle}
                maxLength={100}
                onChange={(value) => updateRootField("supportTitle", value)}
              />
              <TextField
                label="Descrição"
                value={config.supportDescription}
                maxLength={360}
                multiline
                onChange={(value) => updateRootField("supportDescription", value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Texto do botão"
                  value={config.supportCtaLabel}
                  maxLength={50}
                  onChange={(value) => updateRootField("supportCtaLabel", value)}
                />
                <TextField
                  label="Link do botão"
                  value={config.supportCtaHref}
                  maxLength={180}
                  onChange={(value) => updateRootField("supportCtaHref", value)}
                />
              </div>
              <TextField
                label="Label de atualizacao"
                value={config.updatedLabel}
                maxLength={80}
                onChange={(value) => updateRootField("updatedLabel", value)}
              />
            </div>
          </section>
        </aside>

        <section className="space-y-4">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black uppercase text-white">Seções do FAQ</h2>
                <p className="text-xs text-zinc-500">
                  Cada seção vira um card e uma área de perguntas no /faq.
                </p>
              </div>
              <button
                type="button"
                onClick={addSection}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-black uppercase text-red-200 transition hover:bg-red-500/20"
              >
                <Plus size={14} /> Nova seção
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {config.sections.map((section, index) => {
                const Icon = iconMap[section.icon] || HelpCircle;
                const isActive = activeSection?.id === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSectionId(section.id)}
                    className={`min-h-[154px] rounded-2xl border p-4 text-left transition ${
                      isActive
                        ? "border-red-400/60 bg-red-500/10"
                        : "border-zinc-800 bg-black/[0.35] hover:border-zinc-700"
                    }`}
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/[0.15] text-red-200">
                        <Icon size={18} />
                      </span>
                      <span className="text-xs font-black text-zinc-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 text-sm font-black uppercase text-white">
                      {section.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-xs text-zinc-500">
                      {section.description}
                    </p>
                    <p className="mt-3 text-xs font-black uppercase text-red-300">
                      {section.questions.length} perguntas
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {activeSection ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/[0.15] text-red-200">
                    <ActiveIcon size={22} />
                  </span>
                  <div>
                    <h2 className="text-lg font-black uppercase text-white">
                      Editando seção
                    </h2>
                    <p className="text-xs text-zinc-500">{activeSection.id}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => duplicateSection(activeSection)}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:bg-zinc-800"
                  >
                    <Copy size={14} /> Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(activeSection.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-black px-3 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 size={14} /> Remover
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção"
                  value={activeSection.title}
                  maxLength={90}
                  onChange={(value) => updateSection(activeSection.id, "title", value)}
                />
                <TextField
                  label="Publico alvo"
                  value={activeSection.audience}
                  maxLength={80}
                  onChange={(value) => updateSection(activeSection.id, "audience", value)}
                />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
                <TextField
                  label="Descrição do card"
                  value={activeSection.description}
                  maxLength={240}
                  multiline
                  onChange={(value) => updateSection(activeSection.id, "description", value)}
                />
                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase text-zinc-500">Ícone</span>
                  <select
                    value={activeSection.icon}
                    onChange={(event) =>
                      updateSectionIcon(activeSection.id, event.target.value as PlatformFaqIcon)
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60"
                  >
                    {iconOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-zinc-950">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveSection(activeSection.id, -1)}
                  disabled={config.sections[0]?.id === activeSection.id}
                  className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                >
                  Subir seção
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(activeSection.id, 1)}
                  disabled={config.sections[config.sections.length - 1]?.id === activeSection.id}
                  className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                >
                  Descer seção
                </button>
              </div>

              <div className="mt-8 border-t border-zinc-800 pt-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black uppercase text-white">Perguntas</h3>
                    <p className="text-xs text-zinc-500">
                      Edite o titulo e a resposta de cada item expansivo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addQuestion(activeSection.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-black uppercase text-red-200 transition hover:bg-red-500/20"
                  >
                    <Plus size={14} /> Nova pergunta
                  </button>
                </div>

                <div className="space-y-4">
                  {activeSection.questions.map((question, index) => (
                    <div
                      key={question.id}
                      className="rounded-2xl border border-zinc-800 bg-black/[0.35] p-4"
                    >
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-zinc-500">
                          <GripVertical size={14} />
                          Pergunta {index + 1}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => moveQuestion(activeSection.id, question.id, -1)}
                            disabled={index === 0}
                            className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                          >
                            Subir
                          </button>
                          <button
                            type="button"
                            onClick={() => moveQuestion(activeSection.id, question.id, 1)}
                            disabled={index === activeSection.questions.length - 1}
                            className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-black uppercase text-zinc-400 disabled:opacity-40"
                          >
                            Descer
                          </button>
                          <button
                            type="button"
                            onClick={() => removeQuestion(activeSection.id, question.id)}
                            disabled={activeSection.questions.length <= 1}
                            className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-black uppercase text-red-300 disabled:opacity-40"
                          >
                            Remover
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <TextField
                          label="Pergunta"
                          value={question.question}
                          maxLength={180}
                          onChange={(value) =>
                            updateQuestion(activeSection.id, question.id, "question", value)
                          }
                        />
                        <TextField
                          label="Resposta"
                          value={question.answer}
                          maxLength={1600}
                          multiline
                          onChange={(value) =>
                            updateQuestion(activeSection.id, question.id, "answer", value)
                          }
                        />
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase text-white">Print de apoio</p>
                              <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                                Campo opcional. Use JPG, PNG ou WEBP com até 200 KB. Reduza no{" "}
                                <ImageResizeHelpLink label="Squoosh" /> antes de enviar.
                              </p>
                            </div>
                            <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-[11px] font-black uppercase text-zinc-400">
                              👍 {question.likes || 0}
                              <span className="text-zinc-700">/</span>
                              👎 {question.dislikes || 0}
                            </div>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
                            <div className="relative flex min-h-28 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black">
                              {question.imageUrl ? (
                                <Image
                                  src={question.imageUrl}
                                  alt={question.imageAlt || question.question}
                                  fill
                                  sizes="180px"
                                  className="object-cover"
                                  unoptimized
                                />
                              ) : (
                                <ImageIcon size={24} className="text-zinc-700" />
                              )}
                            </div>
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs font-black uppercase text-blue-200 transition hover:bg-blue-500/20">
                                  {uploadingQuestionImageId === question.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <ImageIcon size={14} />
                                  )}
                                  Adicionar print
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    disabled={uploadingQuestionImageId === question.id}
                                    onChange={(event) => {
                                      const file = event.target.files?.[0] ?? null;
                                      event.target.value = "";
                                      void handleQuestionImageUpload(activeSection.id, question.id, file);
                                    }}
                                  />
                                </label>
                                {question.imageUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updateQuestion(activeSection.id, question.id, "imageUrl", "");
                                      updateQuestion(activeSection.id, question.id, "imageAlt", "");
                                    }}
                                    className="rounded-xl border border-red-500/20 px-4 py-2.5 text-xs font-black uppercase text-red-300 hover:bg-red-500/10"
                                  >
                                    Remover imagem
                                  </button>
                                ) : null}
                              </div>
                              <TextField
                                label="URL do print"
                                value={question.imageUrl || ""}
                                maxLength={600}
                                onChange={(value) =>
                                  updateQuestion(activeSection.id, question.id, "imageUrl", value)
                                }
                              />
                              <TextField
                                label="Texto alternativo"
                                value={question.imageAlt || ""}
                                maxLength={180}
                                onChange={(value) =>
                                  updateQuestion(activeSection.id, question.id, "imageAlt", value)
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
