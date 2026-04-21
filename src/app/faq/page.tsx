"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ChevronDown,
  Dumbbell,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { PLATFORM_LOGO_URL } from "@/constants/platformBrand";
import {
  DEFAULT_PLATFORM_FAQ_CONFIG,
  type PlatformFaqConfig,
  type PlatformFaqIcon,
  type PlatformFaqSection,
} from "@/lib/platformFaqConfig";
import { fetchPlatformFaqConfig } from "@/lib/platformFaqService";

const FAQ_THEME_STYLE = {
  "--tenant-primary": "#2563eb",
  "--tenant-accent": "#60a5fa",
  "--tenant-primary-rgb": "37 99 235",
} as React.CSSProperties;

const sectionIconMap: Record<PlatformFaqIcon, LucideIcon> = {
  start: BookOpen,
  profile: UserCircle,
  card: BadgeCheck,
  events: Ticket,
  store: ShoppingBag,
  training: Dumbbell,
  admin: Shield,
  support: LifeBuoy,
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const sectionMatchesQuery = (section: PlatformFaqSection, query: string): boolean => {
  const haystack = normalizeText(
    [section.title, section.description, section.audience].join(" ")
  );
  return haystack.includes(query);
};

const questionMatchesQuery = (
  question: PlatformFaqSection["questions"][number],
  query: string
): boolean => normalizeText(`${question.question} ${question.answer}`).includes(query);

export default function FaqPage() {
  const [config, setConfig] = useState<PlatformFaqConfig>(DEFAULT_PLATFORM_FAQ_CONFIG);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState(
    DEFAULT_PLATFORM_FAQ_CONFIG.sections[0]?.id || ""
  );
  const [openQuestionId, setOpenQuestionId] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const payload = await fetchPlatformFaqConfig();
        if (!mounted) return;
        setConfig(payload.config);
        setActiveSectionId(payload.config.sections[0]?.id || "");
      } catch (error: unknown) {
        console.warn("Falha ao carregar FAQ, usando fallback local.", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const normalizedQuery = normalizeText(query.trim());
  const totalQuestions = useMemo(
    () => config.sections.reduce((sum, section) => sum + section.questions.length, 0),
    [config.sections]
  );

  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return config.sections;

    return config.sections
      .map((section) => {
        const sectionMatch = sectionMatchesQuery(section, normalizedQuery);
        const matchingQuestions = section.questions.filter((question) =>
          questionMatchesQuery(question, normalizedQuery)
        );

        return {
          ...section,
          questions: sectionMatch ? section.questions : matchingQuestions,
        };
      })
      .filter((section) => section.questions.length > 0 || sectionMatchesQuery(section, normalizedQuery));
  }, [config.sections, normalizedQuery]);

  const contentSections = normalizedQuery
    ? visibleSections
    : config.sections.filter((section) => section.id === activeSectionId);
  const activeSection =
    config.sections.find((section) => section.id === activeSectionId) || config.sections[0];
  const matchCount = visibleSections.reduce((sum, section) => sum + section.questions.length, 0);

  const handleSectionClick = (sectionId: string) => {
    setActiveSectionId(sectionId);
    setOpenQuestionId("");
    if (query.trim()) {
      setQuery("");
    }
  };

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#02050d] text-white"
      style={FAQ_THEME_STYLE}
    >
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,99,235,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,0.08)_1px,transparent_1px)] bg-[size:56px_56px] opacity-25" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(37,99,235,0.18),rgba(2,5,13,0.2)_34%,rgba(2,5,13,0.96)_70%)]" />
      </div>

      <header className="relative z-20 border-b border-white/10 bg-[#02050d]/[0.78] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src={PLATFORM_LOGO_URL}
              alt="Logo USC"
              width={42}
              height={42}
              className="object-contain"
              priority
            />
            <div>
              <p className="text-xs font-black uppercase text-zinc-100">
                Universidade Spot Connect
              </p>
              <p className="text-xs font-bold uppercase text-zinc-500">USC</p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-zinc-100 transition hover:bg-white/10"
            >
              Inicio
            </Link>
            <Link
              href="/contato-usc"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-zinc-100 transition hover:bg-white/10"
            >
              Contato
            </Link>
            <Link
              href="/nova-atletica"
              className="rounded-lg border border-brand bg-brand-soft px-3 py-2 text-xs font-black uppercase text-brand-accent transition hover:bg-brand-soft-strong"
            >
              Cadastrar Atletica
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-14 pt-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-end lg:pb-20 lg:pt-18">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand bg-brand-soft px-3 py-1.5 text-xs font-black uppercase text-brand-accent">
              <Sparkles size={14} />
              {config.eyebrow}
            </div>

            <div className="max-w-4xl space-y-5">
              <h1 className="text-4xl font-black uppercase leading-[1.02] text-white sm:text-5xl lg:text-7xl">
                {config.heroTitle}
                <span className="block bg-[linear-gradient(90deg,#93c5fd,#2563eb,#60a5fa)] bg-clip-text text-transparent">
                  {config.heroHighlight}
                </span>
              </h1>
              <p className="max-w-3xl text-base font-medium leading-relaxed text-zinc-300 sm:text-lg">
                {config.heroDescription}
              </p>
            </div>

            <div className="relative max-w-3xl">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-accent" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpenQuestionId("");
                }}
                className="h-16 w-full rounded-2xl border border-white/10 bg-white px-14 text-base font-bold text-zinc-950 outline-none transition placeholder:text-zinc-500 focus:border-brand-strong focus:ring-4 focus:ring-blue-500/[0.15]"
                placeholder={config.searchPlaceholder}
              />
            </div>

            <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <p className="text-3xl font-black text-white">{config.sections.length}</p>
                <p className="mt-1 text-xs font-bold uppercase text-zinc-500">Secoes</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <p className="text-3xl font-black text-white">{totalQuestions}</p>
                <p className="mt-1 text-xs font-bold uppercase text-zinc-500">Respostas</p>
              </div>
              <div className="rounded-2xl border border-brand bg-brand-soft p-4">
                <p className="text-3xl font-black text-brand-accent">
                  {normalizedQuery ? matchCount : "24/7"}
                </p>
                <p className="mt-1 text-xs font-bold uppercase text-zinc-400">
                  {normalizedQuery ? "Encontradas" : config.updatedLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="brand-icon-chip h-11 w-11">
                <LayoutDashboard size={20} />
              </div>
              <div>
                <h2 className="text-lg font-black uppercase text-white">Comece por aqui</h2>
                <p className="text-sm text-zinc-400">Fluxo rapido para entender o app.</p>
              </div>
            </div>

            <div className="space-y-3">
              {config.steps.map((step) => (
                <Link
                  key={step.id}
                  href={step.href || "/"}
                  className="group grid gap-3 rounded-2xl border border-white/10 bg-black/[0.35] p-4 transition hover:border-brand hover:bg-white/[0.08] sm:grid-cols-[64px_1fr_auto] sm:items-center"
                >
                  <div className="text-3xl font-black text-blue-500/[0.28]">{step.kicker}</div>
                  <div>
                    <h3 className="text-sm font-black uppercase text-white">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                      {step.description}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-brand-accent">
                    {step.actionLabel}
                    <ArrowRight size={14} className="transition group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#050814]/[0.92] px-4 py-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase text-brand-accent">Categorias</p>
                <h2 className="mt-2 text-2xl font-black uppercase text-white">
                  Navegue pelo modulo
                </h2>
              </div>
              {loading ? (
                <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500">
                  <Loader2 size={16} className="animate-spin" /> Atualizando conteudo
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {config.sections.map((section) => {
                const Icon = sectionIconMap[section.icon] || HelpCircle;
                const isActive = activeSection?.id === section.id && !normalizedQuery;

                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => handleSectionClick(section.id)}
                    className={`group min-h-[190px] rounded-2xl border p-5 text-left transition ${
                      isActive
                        ? "border-brand-strong bg-brand-soft-strong shadow-brand"
                        : "border-white/10 bg-white/[0.04] hover:border-brand hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <span className="brand-icon-chip h-11 w-11">
                        <Icon size={20} />
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-xs font-black text-zinc-400">
                        {section.questions.length} artigos
                      </span>
                    </div>
                    <h3 className="text-base font-black uppercase text-white">{section.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {section.description}
                    </p>
                    <p className="mt-4 text-xs font-black uppercase text-brand-accent">
                      {section.audience}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section id="faq-content" className="mx-auto max-w-7xl px-4 py-14">
          <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
            <aside className="hidden lg:block">
              <div className="sticky top-[calc(var(--master-topbar-height)+24px)] space-y-2">
                {config.sections.map((section) => {
                  const Icon = sectionIconMap[section.icon] || HelpCircle;
                  const isActive = activeSection?.id === section.id && !normalizedQuery;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => handleSectionClick(section.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-black uppercase transition ${
                        isActive
                          ? "border-brand bg-brand-soft text-brand-accent"
                          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-white"
                      }`}
                    >
                      <Icon size={16} />
                      {section.title}
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="space-y-8">
              {contentSections.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
                  <HelpCircle className="mx-auto text-brand-accent" size={34} />
                  <h2 className="mt-4 text-xl font-black uppercase text-white">
                    Nada encontrado
                  </h2>
                  <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
                    Tente buscar por outro termo ou abra uma categoria acima.
                  </p>
                </div>
              ) : (
                contentSections.map((section) => {
                  const Icon = sectionIconMap[section.icon] || HelpCircle;
                  return (
                    <article key={section.id} className="space-y-4">
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="brand-icon-chip mt-1 h-12 w-12">
                          <Icon size={22} />
                        </div>
                        <div>
                          <p className="text-sm font-black uppercase text-brand-accent">
                            {section.audience}
                          </p>
                          <h2 className="mt-1 text-3xl font-black uppercase text-white">
                            {section.title}
                          </h2>
                          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
                            {section.description}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {section.questions.map((item) => {
                          const isOpen = openQuestionId === item.id;
                          return (
                            <div
                              key={item.id}
                              className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
                            >
                              <button
                                type="button"
                                onClick={() => setOpenQuestionId(isOpen ? "" : item.id)}
                                className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
                                aria-expanded={isOpen}
                              >
                                <span className="text-base font-black text-white">
                                  {item.question}
                                </span>
                                <ChevronDown
                                  className={`shrink-0 text-brand-accent transition ${
                                    isOpen ? "rotate-180" : ""
                                  }`}
                                  size={20}
                                />
                              </button>
                              {isOpen ? (
                                <div className="border-t border-white/10 px-5 py-5">
                                  <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                                    {item.answer}
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-[#050814] px-4 py-14">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-3xl border border-brand bg-brand-soft p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="brand-icon-chip h-12 w-12 shrink-0">
                <MessageCircle size={22} />
              </div>
              <div>
                <h2 className="text-2xl font-black uppercase text-white">
                  {config.supportTitle}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-300">
                  {config.supportDescription}
                </p>
              </div>
            </div>
            <Link
              href={config.supportCtaHref || "/contato-usc"}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-4 text-sm font-black uppercase text-zinc-950 transition hover:bg-zinc-200"
            >
              {config.supportCtaLabel}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
