export const PUBLIC_PATHS = [
  "/login",
  "/",
  "/visitante",
  "/nova-atletica",
  "/contato-usc",
  "/historico",
  "/cadastro",
  "/configuracoes",
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
  "/admin/ligas": "Admin Ligas",
  "/admin/master": "Admin Master",
  "/admin/permissoes": "Permissoes",
  "/admin/permissoes/usuarios": "Permissoes Usuarios",
  "/admin/scanner": "Scanner QR",
  "/ligas_unitau": "Ligas Unitau",
  "/master": "Dashboard Master",
  "/master/landing": "Landing USC",
  "/master/permissoes": "Permissoes Globais",
  "/master/permissoes/perfis-admin": "Perfis do Admin",
  "/master/solicitacoes": "Solicitacoes da Plataforma",
  "/master/tenants": "Tenants",
  "/nova-atletica": "Onboarding Atletica",
  "/perfil/mini-vendor": "Perfil Publico Mini Vendor",
};

const ADMIN_PAGE_PATHS = [
  "/admin",
  "/admin/album",
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
  "/admin/fidelidade",
  "/admin/games",
  "/admin/guia",
  "/admin/gym",
  "/admin/historico",
  "/admin/lancamento",
  "/admin/lancamento/ativacoes",
  "/admin/lancamento/convites",
  "/admin/lancamento/pendentes",
  "/admin/landing",
  "/admin/ligas",
  "/admin/logs",
  "/admin/loja",
  "/admin/loja/categorias",
  "/admin/loja/pedidos-pendentes",
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
  "/admin/sharkround",
  "/admin/treinos",
  "/admin/treinos/antigos",
  "/admin/turma",
  "/admin/usuarios",
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
] as const;

const MEMBER_PAGE_PATHS = [
  "/aguardando-aprovacao",
  "/album",
  "/carteirinha",
  "/comunidade",
  "/configuracoes",
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
  "/empresa",
  "/empresa/cadastro",
  "/eventos",
  "/eventos/compra",
  "/fidelidade",
  "/games",
  "/guia",
  "/gym",
  "/gym/checkin",
  "/gym/checkin/details",
  "/historico",
  "/ligas",
  "/ligas_unitau",
  "/loja",
  "/nova-atletica",
  "/parceiros",
  "/perfil",
  "/perfil/mini-vendor",
  "/planos",
  "/planos/adesao",
  "/ranking",
  "/sharkround",
  "/sharkround/estatisticas",
  "/sharkround/ranking",
  "/treinos",
  "/visitante",
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
      : page(path)
  ),
  ...MASTER_PAGE_PATHS.map((path) => page(path)),
  ...MEMBER_PAGE_PATHS.map((path) => page(path)),
].sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
