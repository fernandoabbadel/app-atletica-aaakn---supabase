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
    "Um guia direto para aluno, visitante, parceiro, diretoria e master entenderem como navegar pela USC, abrir os modulos certos e resolver duvidas sem depender de suporte manual.",
  searchPlaceholder: "Buscar por eventos, carteirinha, loja, treinos, admin...",
  supportTitle: "Ainda ficou alguma duvida?",
  supportDescription:
    "Envie uma mensagem para o painel master com contexto do seu perfil, atletica e modulo. Assim a resposta chega para quem consegue resolver de verdade.",
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
      actionLabel: "Abrir inicio",
      href: "/",
    },
    {
      id: "step_tenant",
      kicker: "02",
      title: "Escolha sua atletica",
      description:
        "A plataforma e multi-atleticas. Quando existir uma atletica ativa, os links aparecem com o contexto dela e levam ao dashboard correto.",
      actionLabel: "Ver atleticas",
      href: "/visitante",
    },
    {
      id: "step_profile",
      kicker: "03",
      title: "Complete seu perfil",
      description:
        "Depois do login, preencha dados de cadastro, turma e contato para liberar carteirinha, convites e modulos internos.",
      actionLabel: "Meu perfil",
      href: "/cadastro",
    },
    {
      id: "step_modules",
      kicker: "04",
      title: "Use os modulos",
      description:
        "Dashboard, eventos, loja, planos, treinos, ligas, parceiros e comunidade ficam conectados pela mesma identidade da atletica.",
      actionLabel: "Abrir app",
      href: "/dashboard",
    },
  ],
  sections: [
    {
      id: "getting_started",
      title: "Primeiros passos",
      description: "Entrada, escolha da atletica, visitante e navegacao inicial.",
      audience: "Aluno, visitante e diretoria",
      icon: "start",
      questions: [
        {
          id: "getting_started_login",
          question: "Como eu entro na plataforma USC?",
          answer:
            "Na pagina inicial, escolha entrar com Google para usar uma conta real. Visitantes podem conhecer a vitrine publica, mas recursos como cadastro completo, carteirinha, compras, convites e administracao dependem de uma conta vinculada.",
        },
        {
          id: "getting_started_tenant",
          question: "O que muda quando eu estou dentro de uma atletica?",
          answer:
            "A USC funciona por contexto. Quando uma atletica esta selecionada, os modulos passam a usar a identidade, os planos, os eventos, os parceiros e as permissoes daquela atletica. Por isso links como dashboard, loja e admin podem aparecer com o slug da atletica.",
        },
        {
          id: "getting_started_guest",
          question: "O modo visitante serve para que?",
          answer:
            "O visitante serve para explorar a plataforma sem cadastro completo. Ele e ideal para conhecer atleticas, ver paginas publicas e entender a experiencia antes de entrar oficialmente em uma base.",
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
            "O cadastro conecta sua conta ao perfil real usado pela atletica. Ele ajuda a validar turma, contato, nascimento, matricula e outros campos que podem ser exigidos para planos, eventos, treinos e carteirinha.",
        },
        {
          id: "profile_card_where",
          question: "Onde encontro minha carteirinha?",
          answer:
            "Depois de estar logado e com perfil valido, acesse Carteirinha pelo app. A carteirinha usa os dados do seu perfil e a identidade da atletica para apresentar seu documento digital.",
        },
        {
          id: "profile_public",
          question: "O que aparece no meu perfil publico?",
          answer:
            "O perfil publico pode mostrar foto, nome, turma, conquistas, estatisticas e informacoes que a plataforma usa para interacao social. Dados sensiveis devem ficar restritos ao cadastro e as configuracoes.",
        },
      ],
    },
    {
      id: "plans_payments",
      title: "Planos e pagamentos",
      description: "Adesao, pedidos, beneficios e acompanhamento de status.",
      audience: "Aluno e diretoria",
      icon: "profile",
      questions: [
        {
          id: "plans_join",
          question: "Como entro em um plano da atletica?",
          answer:
            "Acesse Planos, escolha a opcao disponivel e envie a solicitacao de adesao. A diretoria acompanha os pedidos no painel admin e o status volta para sua conta quando for aprovado ou revisado.",
        },
        {
          id: "plans_pending",
          question: "Onde vejo se meu pedido foi aprovado?",
          answer:
            "Pedidos de planos, loja e eventos aparecem em Configuracoes > Pedidos. Quando a atletica aprova uma solicitacao, a plataforma atualiza seus dados e pode liberar beneficios ligados ao plano.",
        },
        {
          id: "plans_benefits",
          question: "Os beneficios do plano aparecem automaticamente?",
          answer:
            "Sim. Quando o pedido fica aprovado, a USC tenta sincronizar plano, badge, cor, icone, prioridade e descontos no perfil. Se algo parecer incorreto, envie uma mensagem para suporte com o modulo e o plano esperado.",
        },
      ],
    },
    {
      id: "events_tickets",
      title: "Eventos e ingressos",
      description: "Compra, listas, QR Code, presenca e scanner.",
      audience: "Aluno, vendas e admin",
      icon: "events",
      questions: [
        {
          id: "events_buy",
          question: "Como compro ingresso ou entro em uma lista?",
          answer:
            "Abra Eventos, escolha o evento, revise as informacoes e siga o fluxo de compra ou inscricao. Eventos podem ter lotes, lista, controle de presenca e regras definidas pela atletica.",
        },
        {
          id: "events_ticket",
          question: "Onde fica meu ingresso?",
          answer:
            "Ingressos emitidos aparecem no fluxo publico de ingresso e tambem nos seus pedidos. Guarde o QR Code e apresente na entrada quando a organizacao usar scanner.",
        },
        {
          id: "events_scan",
          question: "Quem pode escanear ingressos?",
          answer:
            "Perfis com permissao de vendas, treino ou administracao podem acessar scanners conforme regras do tenant. O master da plataforma tambem consegue operar em contexto global quando necessario.",
        },
      ],
    },
    {
      id: "store_partners",
      title: "Loja e parceiros",
      description: "Produtos, pedidos, mini vendors, beneficios e empresas.",
      audience: "Aluno, parceiro e admin",
      icon: "store",
      questions: [
        {
          id: "store_buy",
          question: "Como funciona a loja?",
          answer:
            "A loja centraliza produtos da atletica, produtos de ligas e, quando ativo, mini vendors. Escolha o item, revise quantidade e informacoes e acompanhe o pedido em Configuracoes > Pedidos.",
        },
        {
          id: "store_vendor",
          question: "O que e um mini vendor?",
          answer:
            "Mini vendor e uma vitrine menor para vendedores internos ou parceiros autorizados. A diretoria pode aprovar, editar visibilidade, produtos e pedidos pelo painel admin.",
        },
        {
          id: "partners_benefits",
          question: "Onde vejo parceiros e beneficios?",
          answer:
            "A area Parceiros mostra empresas cadastradas, categorias, historico e beneficios. Em landings de atleticas, parceiros oficiais tambem podem aparecer como vitrine publica.",
        },
      ],
    },
    {
      id: "training_leagues",
      title: "Treinos, ligas e comunidade",
      description: "Presenca, modalidades, ligas USC, jogos e mural social.",
      audience: "Aluno, treinador e diretoria",
      icon: "training",
      questions: [
        {
          id: "training_presence",
          question: "Como confirmo presenca em treino?",
          answer:
            "Entre em Treinos, abra o treino desejado e siga o fluxo de presenca. Treinadores e admins podem revisar listas, chamada e historico conforme a permissao recebida.",
        },
        {
          id: "league_manage",
          question: "O que sao Ligas USC?",
          answer:
            "Ligas organizam modalidades, membros, eventos, loja e paginas publicas especificas. Elas ajudam a separar a operacao de cada modalidade sem perder o vinculo com a atletica.",
        },
        {
          id: "community_use",
          question: "Como uso a comunidade?",
          answer:
            "A Comunidade concentra publicacoes, categorias e interacoes entre membros. Use com perfil real e respeite as regras da atletica, porque denuncias e moderacao chegam ao painel admin.",
        },
      ],
    },
    {
      id: "admin_panel",
      title: "Painel admin da atletica",
      description: "Configuracao, usuarios, permissoes, conteudo e operacao diaria.",
      audience: "Diretoria e gestores",
      icon: "admin",
      questions: [
        {
          id: "admin_access",
          question: "Quem acessa o painel admin?",
          answer:
            "Acesso admin depende da role do usuario e das regras do tenant. Em geral, master tenant, admin geral, gestor, admin de treino, treinador e vendas veem apenas os modulos liberados para sua funcao.",
        },
        {
          id: "admin_landing",
          question: "Como edito a landing da minha atletica?",
          answer:
            "No painel admin da atletica, abra Landing. A diretoria consegue ajustar chamada principal, estatisticas, contatos, depoimentos e parceiros exibidos na pagina publica.",
        },
        {
          id: "admin_permissions",
          question: "Como controlo permissoes?",
          answer:
            "Use as telas de permissoes e usuarios para revisar cargos e acesso. Mudancas de perfil devem ser feitas com cuidado, porque liberam modulos de gestao, vendas, treino, loja e moderacao.",
        },
      ],
    },
    {
      id: "master_support",
      title: "Master USC e suporte",
      description: "Painel global, contato, criacao de atleticas e ajuda oficial.",
      audience: "Master da plataforma",
      icon: "support",
      questions: [
        {
          id: "master_diff",
          question: "Qual a diferenca entre master da plataforma e admin da atletica?",
          answer:
            "O master da plataforma cuida do ambiente USC inteiro: tenants, landing global, contatos, solicitacoes e permissoes globais. O admin da atletica cuida da operacao diaria daquele tenant.",
        },
        {
          id: "support_contact",
          question: "Como mando uma duvida para a USC?",
          answer:
            "Acesse Contato USC ou use o botao de suporte desta pagina. Explique o que tentou fazer, em qual modulo estava e qual atletica esta usando. Isso reduz idas e vindas na resposta.",
        },
        {
          id: "new_tenant",
          question: "Como cadastrar uma nova atletica?",
          answer:
            "Use Cadastrar Atletica na landing global. O pedido passa pelo fluxo de onboarding, e o master da plataforma pode revisar, aprovar e configurar o tenant antes da operacao comecar.",
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
