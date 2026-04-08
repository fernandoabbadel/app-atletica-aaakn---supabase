export const PUBLIC_PATHS = [
  "/login",
  "/",
  "/visitante",
  "/convite-necessario",
  "/nova-atletica",
  "/contato-usc",
  "/historico",
  "/cadastro",
  "/configuracoes/termos",
  "/empresa/cadastro",
  "/recuperar-senha",
  "/sem-permissao",
  "/banned",
  "/em-breve",
  "/nao-encontrado",
];

export const GUEST_ALLOWED_PATHS = [...PUBLIC_PATHS, "/dashboard"];

export const COMING_SOON_PATHS = ["/carrinho", "/checkout"];

export type AppPageDefinition = {
  path: string;
  label: string;
  permissionPath?: string;
};

const PATH_LABEL_OVERRIDES: Record<string, string> = {
  "/admin": "Admin Dashboard",
  "/admin/atletica": "Atletica",
  "/admin/dashboard-modulos": "Dashboard Modulos",
  "/admin/eventos/encerrados": "Admin Eventos Encerrados",
  "/admin/eventos/lista/[id]": "Admin Evento Detalhe",
  "/admin/ligas": "Admin Ligas",
  "/admin/master": "Admin Master",
  "/admin/boardround": "Admin BoardRound",
  "/admin/apadrinhamento": "Admin Apadrinhamento",
  "/admin/loja/pedidos-aprovados": "Loja Pedidos Aprovados",
  "/admin/permissoes": "Permissoes",
  "/admin/permissoes/usuarios": "Permissoes Usuarios",
  "/admin/scanner": "Scanner QR",
  "/admin/treinos/lista/[id]": "Admin Treino Lista",
  "/admin/usuarios/[id]": "Admin Usuario Detalhe",
  "/admin/usuarios/cadastro": "Admin Cadastro Config",
  "/boardround": "BoardRound",
  "/boardround/estatisticas": "BoardRound Estatisticas",
  "/boardround/ranking": "BoardRound Ranking",
  "/album/[turmaId]": "Album da Turma",
  "/empresa/[id]": "Empresa Parceira",
  "/empresa/[id]/historico": "Empresa Historico",
  "/eventos/[id]": "Evento Detalhe",
  "/historico/organograma": "Organograma",
  "/ligas_usc": "Ligas USC",
  "/loja/[id]": "Produto Loja",
  "/loja/[id]/review": "Review do Produto",
  "/master": "Dashboard Master",
  "/master/landing": "Landing USC",
  "/master/permissoes": "Permissoes Globais",
  "/master/permissoes/perfis-admin": "Perfis do Admin",
  "/master/solicitacoes": "Solicitacoes da Plataforma",
  "/master/tenants/[tenantId]": "Tenant Detalhe",
  "/master/tenants": "Tenants",
  "/nova-atletica": "Onboarding Atletica",
  "/parceiros/[id]": "Parceiro Detalhe",
  "/configuracoes/convites": "Meus Convites",
  "/configuracoes/convites/aprovados": "Convites Aprovados",
  "/perfil/[id]": "Perfil Publico",
  "/configuracoes/apadrinhamento": "Apadrinhamento",
  "/perfil/mini-vendor": "Perfil Publico Mini Vendor",
  "/perfil/mini-vendor/[id]": "Perfil Publico Mini Vendor",
  "/ranking/[turmaId]": "Ranking da Turma",
  "/treinos/[id]": "Treino Detalhe",
};

const ADMIN_PAGE_PATHS = [
  "/admin",
  "/admin/album",
  "/admin/apadrinhamento",
  "/admin/album/caca_calouro",
  "/admin/album/customizacao",
  "/admin/album/pontua_calouro",
  "/admin/album/pontua_geral",
  "/admin/atletica",
  "/admin/carteirinha",
  "/admin/comunidade",
  "/admin/configuracoes",
  "/admin/conquistas",
  "/admin/dashboard-modulos",
  "/admin/denuncias",
  "/admin/denuncias/banidos",
  "/admin/denuncias/comunidade",
  "/admin/denuncias/gym",
  "/admin/denuncias/suporte",
  "/admin/eventos",
  "/admin/eventos/encerrados",
  "/admin/eventos/lista/[id]",
  "/admin/fidelidade",
  "/admin/games",
  "/admin/guia",
  "/admin/gym",
  "/admin/historico",
  "/admin/historico/organograma",
  "/admin/lancamento",
  "/admin/lancamento/ativacoes",
  "/admin/lancamento/convites",
  "/admin/lancamento/pendentes",
  "/admin/landing",
  "/admin/ligas",
  "/admin/logs",
  "/admin/loja",
  "/admin/loja/categorias",
  "/admin/loja/pedidos-aprovados",
  "/admin/loja/pedidos-pendentes",
  "/admin/loja/produtos-desativados",
  "/admin/loja/produtos",
  "/admin/loja/review",
  "/admin/master",
  "/admin/master/lancamento",
  "/admin/master/lancamento/ativacoes",
  "/admin/master/lancamento/convites",
  "/admin/master/lancamento/pendentes",
  "/admin/mini-vendors",
  "/admin/mini-vendors/aprovacoes",
  "/admin/mini-vendors/cadastros",
  "/admin/parceiros",
  "/admin/parceiros/ativos",
  "/admin/parceiros/dados",
  "/admin/parceiros/empresas",
  "/admin/parceiros/historico",
  "/admin/permissoes",
  "/admin/permissoes/usuarios",
  "/admin/planos",
  "/admin/planos/auditoria",
  "/admin/planos/editar",
  "/admin/planos/historico",
  "/admin/planos/lista_atleta",
  "/admin/planos/lista_bicho_solto",
  "/admin/planos/lista_cardume_livre",
  "/admin/planos/lista_lenda",
  "/admin/scanner",
  "/admin/boardround",
  "/admin/treinos",
  "/admin/treinos/antigos",
  "/admin/treinos/lista/[id]",
  "/admin/turma",
  "/admin/usuarios",
  "/admin/usuarios/cadastro",
  "/admin/usuarios/[id]",
] as const;

const MASTER_PAGE_PATHS = [
  "/master",
  "/master/contato",
  "/master/landing",
  "/master/lancamento",
  "/master/lancamento/ativacoes",
  "/master/lancamento/convites",
  "/master/lancamento/pendentes",
  "/master/permissoes",
  "/master/permissoes/perfis-admin",
  "/master/solicitacoes",
  "/master/tenants",
  "/master/tenants/[tenantId]",
] as const;

const MEMBER_PAGE_PATHS = [
  "/aguardando-aprovacao",
  "/banned",
  "/album",
  "/album/[turmaId]",
  "/cadastro",
  "/carrinho",
  "/carteirinha",
  "/checkout",
  "/comunidade",
  "/configuracoes",
  "/configuracoes/apadrinhamento",
  "/configuracoes/convites",
  "/configuracoes/convites/aprovados",
  "/configuracoes/lider-turma",
  "/configuracoes/mini-vendor",
  "/configuracoes/mini-vendor/editar",
  "/configuracoes/mini-vendor/pedidos-aprovados",
  "/configuracoes/mini-vendor/pedidos-pendentes",
  "/configuracoes/mini-vendor/produtos",
  "/configuracoes/pedidos",
  "/configuracoes/pedidos/eventos",
  "/configuracoes/pedidos/loja",
  "/configuracoes/pedidos/planos",
  "/configuracoes/seguranca",
  "/configuracoes/suporte",
  "/configuracoes/termos",
  "/conquistas",
  "/contato-usc",
  "/dashboard",
  "/em-breve",
  "/empresa",
  "/empresa/[id]",
  "/empresa/[id]/historico",
  "/empresa/cadastro",
  "/eventos",
  "/eventos/[id]",
  "/eventos/compra",
  "/fidelidade",
  "/games",
  "/guia",
  "/gym",
  "/gym/checkin",
  "/gym/checkin/details",
  "/historico",
  "/historico/organograma",
  "/ligas",
  "/ligas_usc",
  "/login",
  "/loja",
  "/loja/[id]",
  "/loja/[id]/review",
  "/nao-encontrado",
  "/nova-atletica",
  "/parceiros",
  "/parceiros/[id]",
  "/perfil",
  "/perfil/[id]",
  "/perfil/mini-vendor",
  "/perfil/mini-vendor/[id]",
  "/planos",
  "/planos/adesao",
  "/ranking",
  "/ranking/[turmaId]",
  "/sem-permissao",
  "/boardround",
  "/boardround/estatisticas",
  "/boardround/ranking",
  "/treinos",
  "/treinos/[id]",
  "/visitante",
  "/convite-necessario",
] as const;

const titleizeSegment = (segment: string): string =>
  segment
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const resolveAppPageLabel = (path: string): string => {
  const cleanPath = path.trim();
  if (PATH_LABEL_OVERRIDES[cleanPath]) {
    return PATH_LABEL_OVERRIDES[cleanPath];
  }

  const segments = cleanPath.split("/").filter(Boolean);
  if (!segments.length) return "Home";

  return segments.map((segment) => titleizeSegment(segment)).join(" / ");
};

const page = (
  path: string,
  options?: Pick<Partial<AppPageDefinition>, "label" | "permissionPath">
): AppPageDefinition => ({
  path,
  label: options?.label || resolveAppPageLabel(path),
  ...(options?.permissionPath ? { permissionPath: options.permissionPath } : {}),
});

export const APP_PAGES: AppPageDefinition[] = [
  ...ADMIN_PAGE_PATHS.map((path) =>
    path === "/admin/atletica"
      ? page(path, { permissionPath: "/admin/configuracoes" })
      : path === "/admin/boardround"
      ? page(path, { permissionPath: "/admin/sharkround" })
        : path === "/admin/historico/organograma"
          ? page(path, { permissionPath: "/admin/historico" })
      : path === "/admin/loja/pedidos-aprovados"
        ? page(path, { permissionPath: "/admin/loja" })
      : path === "/admin/usuarios/cadastro"
        ? page(path, { permissionPath: "/admin/usuarios" })
      : page(path)
  ),
  ...MASTER_PAGE_PATHS.map((path) => page(path)),
  ...MEMBER_PAGE_PATHS.map((path) =>
    path === "/boardround"
      ? page(path, { permissionPath: "/sharkround" })
      : path === "/boardround/estatisticas"
        ? page(path, { permissionPath: "/sharkround/estatisticas" })
        : path === "/boardround/ranking"
          ? page(path, { permissionPath: "/sharkround/ranking" })
          : path === "/ligas_usc"
            ? page(path, { permissionPath: "/ligas_unitau" })
            : path === "/historico/organograma"
              ? page(path, { permissionPath: "/historico" })
              : page(path)
  ),
].sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
