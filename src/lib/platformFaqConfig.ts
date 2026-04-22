export type PlatformFaqIcon =
  | "start"
  | "profile"
  | "card"
  | "events"
  | "store"
  | "training"
  | "admin"
  | "support";

export type PlatformFaqStep = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
};

export type PlatformFaqQuestion = {
  id: string;
  question: string;
  answer: string;
  imageUrl?: string;
  imageAlt?: string;
  likes?: number;
  dislikes?: number;
};

export type PlatformFaqSection = {
  id: string;
  title: string;
  description: string;
  audience: string;
  icon: PlatformFaqIcon;
  questions: PlatformFaqQuestion[];
};

export type PlatformFaqConfig = {
  eyebrow: string;
  heroTitle: string;
  heroHighlight: string;
  heroDescription: string;
  searchPlaceholder: string;
  supportTitle: string;
  supportDescription: string;
  supportCtaLabel: string;
  supportCtaHref: string;
  updatedLabel: string;
  steps: PlatformFaqStep[];
  sections: PlatformFaqSection[];
};

const MAX_STEPS = 8;
const MAX_SECTIONS = 16;
const MAX_QUESTIONS_PER_SECTION = 24;

const makeId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const trimField = (value: unknown, maxLength: number, fallback = ""): string =>
  asString(value, fallback).trim().slice(0, maxLength);

const asCount = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const FAQ_ICON_SET = new Set<PlatformFaqIcon>([
  "start",
  "profile",
  "card",
  "events",
  "store",
  "training",
  "admin",
  "support",
]);

const normalizeIcon = (value: unknown, fallback: PlatformFaqIcon): PlatformFaqIcon => {
  const icon = trimField(value, 40) as PlatformFaqIcon;
  return FAQ_ICON_SET.has(icon) ? icon : fallback;
};

export const DEFAULT_PLATFORM_FAQ_CONFIG: PlatformFaqConfig = {
  eyebrow: "Central de ajuda USC",
  heroTitle: "Tudo para usar a",
  heroHighlight: "plataforma inteira",
  heroDescription:
    "Um guia direto para aluno, visitante, parceiro, diretoria e master entenderem como navegar pela USC, abrir os módulos certos e resolver dúvidas sem depender de suporte manual.",
  searchPlaceholder: "Buscar por eventos, carteirinha, loja, treinos, admin...",
  supportTitle: "Ainda ficou alguma dúvida?",
  supportDescription:
    "Envie uma mensagem para o painel master com contexto do seu perfil, atlética e módulo. Assim a resposta chega para quem consegue resolver de verdade.",
  supportCtaLabel: "Falar com a USC",
  supportCtaHref: "/contato-usc",
  updatedLabel: "Guia oficial da plataforma",
  steps: [
    {
      id: "step_access",
      kicker: "01",
      title: "Entre na USC",
      description:
        "Use Google para sua conta oficial ou entre como visitante quando quiser conhecer a plataforma antes de se vincular.",
      actionLabel: "Abrir início",
      href: "/",
    },
    {
      id: "step_tenant",
      kicker: "02",
      title: "Escolha sua atletica",
      description:
        "A plataforma é multiatléticas. Quando existir uma atlética ativa, os links aparecem com o contexto dela e levam ao dashboard correto.",
      actionLabel: "Ver atléticas",
      href: "/visitante",
    },
    {
      id: "step_profile",
      kicker: "03",
      title: "Complete seu perfil",
      description:
        "Depois do login, preencha dados de cadastro, turma e contato para liberar carteirinha, convites e módulos internos.",
      actionLabel: "Meu perfil",
      href: "/cadastro",
    },
    {
      id: "step_modules",
      kicker: "04",
      title: "Use os modulos",
      description:
        "Dashboard, eventos, loja, planos, treinos, ligas, parceiros e comunidade ficam conectados pela mesma identidade da atlética.",
      actionLabel: "Abrir app",
      href: "/dashboard",
    },
  ],
  sections: [
    {
      id: "getting_started",
      title: "Primeiros passos",
      description: "Entrada, escolha da atlética, visitante e navegação inicial.",
      audience: "Aluno, visitante e diretoria",
      icon: "start",
      questions: [
        {
          id: "getting_started_login",
          question: "Como eu entro na plataforma USC?",
          answer:
            "Na página inicial, escolha entrar com Google para usar uma conta real. Visitantes podem conhecer a vitrine pública, mas recursos como cadastro completo, carteirinha, compras, convites e administração dependem de uma conta vinculada.",
        },
        {
          id: "getting_started_tenant",
          question: "O que muda quando eu estou dentro de uma atlética?",
          answer:
            "A USC funciona por contexto. Quando uma atlética está selecionada, os módulos passam a usar a identidade, os planos, os eventos, os parceiros e as permissões daquela atlética. Por isso links como dashboard, loja e admin podem aparecer com o slug da atlética.",
        },
        {
          id: "getting_started_guest",
          question: "O modo visitante serve para quê?",
          answer:
            "O visitante serve para explorar a plataforma sem cadastro completo. Ele é ideal para conhecer atléticas, ver páginas públicas e entender a experiência antes de entrar oficialmente em uma base.",
        },
      ],
    },
    {
      id: "profile_card",
      title: "Perfil e carteirinha",
      description: "Dados do aluno, status, documento digital e identidade visual.",
      audience: "Aluno",
      icon: "card",
      questions: [
        {
          id: "profile_complete",
          question: "Por que preciso completar o cadastro?",
          answer:
            "O cadastro conecta sua conta ao perfil real usado pela atlética. Ele ajuda a validar turma, contato, nascimento, matrícula e outros campos que podem ser exigidos para planos, eventos, treinos e carteirinha.",
        },
        {
          id: "profile_card_where",
          question: "Onde encontro minha carteirinha?",
          answer:
            "Depois de estar logado e com perfil válido, acesse Carteirinha pelo app. A carteirinha usa os dados do seu perfil e a identidade da atlética para apresentar seu documento digital.",
        },
        {
          id: "profile_public",
          question: "O que aparece no meu perfil público?",
          answer:
            "O perfil público pode mostrar foto, nome, turma, conquistas, estatísticas e informações que a plataforma usa para interação social. Dados sensíveis devem ficar restritos ao cadastro e às configurações.",
        },
      ],
    },
    {
      id: "plans_payments",
      title: "Planos e pagamentos",
      description: "Adesão, pedidos, benefícios e acompanhamento de status.",
      audience: "Aluno e diretoria",
      icon: "profile",
      questions: [
        {
          id: "plans_join",
          question: "Como entro em um plano da atletica?",
          answer:
            "Acesse Planos, escolha a opção disponível e envie a solicitação de adesão. A diretoria acompanha os pedidos no painel admin e o status volta para sua conta quando for aprovado ou revisado.",
        },
        {
          id: "plans_pending",
          question: "Onde vejo se meu pedido foi aprovado?",
          answer:
            "Pedidos de planos, loja e eventos aparecem em Configurações > Pedidos. Quando a atlética aprova uma solicitação, a plataforma atualiza seus dados e pode liberar benefícios ligados ao plano.",
        },
        {
          id: "plans_benefits",
          question: "Os benefícios do plano aparecem automaticamente?",
          answer:
            "Sim. Quando o pedido fica aprovado, a USC tenta sincronizar plano, badge, cor, ícone, prioridade e descontos no perfil. Se algo parecer incorreto, envie uma mensagem para suporte com o módulo e o plano esperado.",
        },
      ],
    },
    {
      id: "events_tickets",
      title: "Eventos e ingressos",
      description: "Compra, listas, QR Code, presença e scanner.",
      audience: "Aluno, vendas e admin",
      icon: "events",
      questions: [
        {
          id: "events_buy",
          question: "Como compro ingresso ou entro em uma lista?",
          answer:
            "Abra Eventos, escolha o evento, revise as informações e siga o fluxo de compra ou inscrição. Eventos podem ter lotes, lista, controle de presença e regras definidas pela atlética.",
        },
        {
          id: "events_ticket",
          question: "Onde fica meu ingresso?",
          answer:
            "Ingressos emitidos aparecem no fluxo público de ingresso e também nos seus pedidos. Guarde o QR Code e apresente na entrada quando a organização usar scanner.",
        },
        {
          id: "events_scan",
          question: "Quem pode escanear ingressos?",
          answer:
            "Perfis com permissão de vendas, treino ou administração podem acessar scanners conforme regras do tenant. O master da plataforma também consegue operar em contexto global quando necessário.",
        },
      ],
    },
    {
      id: "store_partners",
      title: "Loja e parceiros",
      description: "Produtos, pedidos, mini vendors, benefícios e empresas.",
      audience: "Aluno, parceiro e admin",
      icon: "store",
      questions: [
        {
          id: "store_buy",
          question: "Como funciona a loja?",
          answer:
            "A loja centraliza produtos da atlética, produtos de ligas e, quando ativo, mini vendors. Escolha o item, revise quantidade e informações e acompanhe o pedido em Configurações > Pedidos.",
        },
        {
          id: "store_vendor",
          question: "O que é um mini vendor?",
          answer:
            "Mini vendor é uma vitrine menor para vendedores internos ou parceiros autorizados. A diretoria pode aprovar, editar visibilidade, produtos e pedidos pelo painel admin.",
        },
        {
          id: "partners_benefits",
          question: "Onde vejo parceiros e benefícios?",
          answer:
            "A área Parceiros mostra empresas cadastradas, categorias, histórico e benefícios. Em landings de atléticas, parceiros oficiais também podem aparecer como vitrine pública.",
        },
      ],
    },
    {
      id: "training_leagues",
      title: "Treinos, ligas e comunidade",
      description: "Presença, modalidades, ligas USC, jogos e mural social.",
      audience: "Aluno, treinador e diretoria",
      icon: "training",
      questions: [
        {
          id: "training_presence",
          question: "Como confirmo presença em treino?",
          answer:
            "Entre em Treinos, abra o treino desejado e siga o fluxo de presença. Treinadores e admins podem revisar listas, chamada e histórico conforme a permissão recebida.",
        },
        {
          id: "league_manage",
          question: "O que são Ligas USC?",
          answer:
            "Ligas organizam modalidades, membros, eventos, loja e páginas públicas específicas. Elas ajudam a separar a operação de cada modalidade sem perder o vínculo com a atlética.",
        },
        {
          id: "community_use",
          question: "Como uso a comunidade?",
          answer:
            "A Comunidade concentra publicações, categorias e interações entre membros. Use com perfil real e respeite as regras da atlética, porque denúncias e moderação chegam ao painel admin.",
        },
      ],
    },
    {
      id: "admin_panel",
      title: "Painel admin da atletica",
      description: "Configuração, usuários, permissões, conteúdo e operação diária.",
      audience: "Diretoria e gestores",
      icon: "admin",
      questions: [
        {
          id: "admin_access",
          question: "Quem acessa o painel admin?",
          answer:
            "Acesso admin depende da role do usuário e das regras do tenant. Em geral, master tenant, admin geral, gestor, admin de treino, treinador e vendas veem apenas os módulos liberados para sua função.",
        },
        {
          id: "admin_landing",
          question: "Como edito a landing da minha atlética?",
          answer:
            "No painel admin da atlética, abra Landing. A diretoria consegue ajustar chamada principal, estatísticas, contatos, depoimentos e parceiros exibidos na página pública.",
        },
        {
          id: "admin_permissions",
          question: "Como controlo permissões?",
          answer:
            "Use as telas de permissões e usuários para revisar cargos e acesso. Mudanças de perfil devem ser feitas com cuidado, porque liberam módulos de gestão, vendas, treino, loja e moderação.",
        },
      ],
    },
    {
      id: "master_support",
      title: "Master USC e suporte",
      description: "Painel global, contato, criação de atléticas e ajuda oficial.",
      audience: "Master da plataforma",
      icon: "support",
      questions: [
        {
          id: "master_diff",
          question: "Qual a diferença entre master da plataforma e admin da atlética?",
          answer:
            "O master da plataforma cuida do ambiente USC inteiro: tenants, landing global, contatos, solicitações e permissões globais. O admin da atlética cuida da operação diária daquele tenant.",
        },
        {
          id: "support_contact",
          question: "Como mando uma dúvida para a USC?",
          answer:
            "Acesse Contato USC ou use o botão de suporte desta página. Explique o que tentou fazer, em qual módulo estava e qual atlética está usando. Isso reduz idas e vindas na resposta.",
        },
        {
          id: "new_tenant",
          question: "Como cadastrar uma nova atlética?",
          answer:
            "Use Cadastrar Atlética na landing global. O pedido passa pelo fluxo de onboarding, e o master da plataforma pode revisar, aprovar e configurar o tenant antes da operação começar.",
        },
      ],
    },
  ],
};

const normalizeStep = (
  raw: unknown,
  fallback: PlatformFaqStep,
  index: number
): PlatformFaqStep => {
  const obj = asObject(raw) ?? {};
  return {
    id: trimField(obj.id, 80, fallback.id) || makeId("step"),
    kicker: trimField(obj.kicker, 12, fallback.kicker || String(index + 1).padStart(2, "0")),
    title: trimField(obj.title, 80, fallback.title),
    description: trimField(obj.description, 260, fallback.description),
    actionLabel: trimField(obj.actionLabel, 40, fallback.actionLabel),
    href: trimField(obj.href, 180, fallback.href || "/"),
  };
};

const normalizeQuestion = (
  raw: unknown,
  fallback: PlatformFaqQuestion
): PlatformFaqQuestion => {
  const obj = asObject(raw) ?? {};
  return {
    id: trimField(obj.id, 80, fallback.id) || makeId("question"),
    question: trimField(obj.question, 180, fallback.question),
    answer: trimField(obj.answer, 1600, fallback.answer),
    imageUrl: trimField(obj.imageUrl, 600, fallback.imageUrl || "") || undefined,
    imageAlt: trimField(obj.imageAlt, 180, fallback.imageAlt || "") || undefined,
    likes: asCount(obj.likes ?? fallback.likes),
    dislikes: asCount(obj.dislikes ?? fallback.dislikes),
  };
};

const normalizeSection = (
  raw: unknown,
  fallback: PlatformFaqSection
): PlatformFaqSection => {
  const obj = asObject(raw) ?? {};
  const fallbackQuestions = fallback.questions.length
    ? fallback.questions
    : [{ id: makeId("question"), question: "Nova pergunta", answer: "Resposta da pergunta." }];
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : fallbackQuestions;

  return {
    id: trimField(obj.id, 80, fallback.id) || makeId("section"),
    title: trimField(obj.title, 90, fallback.title),
    description: trimField(obj.description, 240, fallback.description),
    audience: trimField(obj.audience, 80, fallback.audience),
    icon: normalizeIcon(obj.icon, fallback.icon),
    questions: rawQuestions
      .slice(0, MAX_QUESTIONS_PER_SECTION)
      .map((entry, index) => normalizeQuestion(entry, fallbackQuestions[index] || fallbackQuestions[0])),
  };
};

export function sanitizePlatformFaqConfig(
  raw: unknown,
  fallbackConfig: PlatformFaqConfig = DEFAULT_PLATFORM_FAQ_CONFIG
): PlatformFaqConfig {
  const obj = asObject(raw) ?? {};
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : fallbackConfig.steps;
  const rawSections = Array.isArray(obj.sections) ? obj.sections : fallbackConfig.sections;

  const steps = rawSteps
    .slice(0, MAX_STEPS)
    .map((entry, index) =>
      normalizeStep(entry, fallbackConfig.steps[index] || fallbackConfig.steps[0], index)
    );
  const sections = rawSections
    .slice(0, MAX_SECTIONS)
    .map((entry, index) =>
      normalizeSection(entry, fallbackConfig.sections[index] || fallbackConfig.sections[0])
    );

  return {
    eyebrow: trimField(obj.eyebrow, 80, fallbackConfig.eyebrow),
    heroTitle: trimField(obj.heroTitle, 80, fallbackConfig.heroTitle),
    heroHighlight: trimField(obj.heroHighlight, 80, fallbackConfig.heroHighlight),
    heroDescription: trimField(obj.heroDescription, 420, fallbackConfig.heroDescription),
    searchPlaceholder: trimField(obj.searchPlaceholder, 120, fallbackConfig.searchPlaceholder),
    supportTitle: trimField(obj.supportTitle, 100, fallbackConfig.supportTitle),
    supportDescription: trimField(
      obj.supportDescription,
      360,
      fallbackConfig.supportDescription
    ),
    supportCtaLabel: trimField(obj.supportCtaLabel, 50, fallbackConfig.supportCtaLabel),
    supportCtaHref: trimField(obj.supportCtaHref, 180, fallbackConfig.supportCtaHref),
    updatedLabel: trimField(obj.updatedLabel, 80, fallbackConfig.updatedLabel),
    steps: steps.length ? steps : fallbackConfig.steps,
    sections: sections.length ? sections : fallbackConfig.sections,
  };
}
