// src/lib/appRoutes.ts

// 1. ZONA SEGURA (PÃºblicas - Login, Erro, Em Breve)
// O RouteGuard ignora a verificaÃ§Ã£o para estas rotas para evitar loops.
export const PUBLIC_PATHS = [
  "/login",
  "/",
  "/visitante",
  "/historico",
  "/cadastro",
  "/configuracoes",
  "/configuracoes/termos",
  "/empresa/cadastro",
  "/recuperar-senha",
  "/sem-permissao",
  "/banned",
  "/em-breve",
  "/nao-encontrado"
];

// 2. ZONA DE DEGUSTAÃ‡ÃƒO (O que visitante logado como GUEST vÃª)
// Visitantes podem ver o Dashboard, Perfil BÃ¡sico e Lojas, mas com restriÃ§Ãµes de aÃ§Ã£o
export const GUEST_ALLOWED_PATHS = [
  ...PUBLIC_PATHS, // Inclui todas as publicas automaticamente
  "/dashboard",
];

// 3. ZONA DE OBRAS (Funcionalidades em desenvolvimento - redirecionam para Em Breve)
export const COMING_SOON_PATHS = [
  "/carrinho",
  "/checkout",
  // "/marketplace-futuro",
  // "/shark-tv"
];

// 4. MAPA DO SISTEMA (Lista completa para o Painel Admin - Gerenciador de PermissÃµes)
export const APP_PAGES = [
    // --- ADMINISTRAÃ‡ÃƒO ---
    { path: '/admin', label: 'Admin Dashboard' },
    { path: '/admin/album', label: 'Admin Album' },
    { path: '/admin/turma', label: 'Admin Turma' },
    { path: '/admin/carteirinha', label: 'Admin Carteirinha' },
    { path: '/admin/comunidade', label: 'Admin Comunidade' },
    { path: '/admin/configuracoes', label: 'Configuracoes (Admin)' },
    { path: '/admin/conquistas', label: 'Admin Conquistas' },
    { path: '/admin/denuncias', label: 'Denuncias' },
    { path: '/admin/eventos', label: 'Admin Eventos' },
    { path: '/admin/eventos/encerrados', label: '🗃️ Adm Eventos Encerrados' },
    { path: '/admin/fidelidade', label: 'Admin Fidelidade' },
    { path: '/admin/games', label: 'Admin Games' },
    { path: '/admin/guia', label: 'Admin Guia' },
    { path: '/admin/gym', label: 'Admin Gym' },
    { path: '/admin/historico', label: 'Admin Historico' },
    { path: '/admin/landing', label: 'Landing' },
    { path: '/admin/lancamento', label: 'Lancamento' },
    { path: '/admin/lancamento/ativacoes', label: 'Lancamento - Ativacoes' },
    { path: '/admin/lancamento/convites', label: 'Lancamento - Convites' },
    { path: '/admin/lancamento/pendentes', label: 'Lancamento - Pendentes' },
    { path: '/admin/ligas', label: 'Admin Ligas' },
    { path: '/admin/logs', label: 'Logs do Sistema' },
    { path: '/admin/loja', label: 'Admin Loja' },
    { path: '/master', label: 'Dashboard Master' },
    { path: '/master/landing', label: 'Landing USC' },
    { path: '/master/permissoes', label: 'Permissoes Globais' },
    { path: '/master/solicitacoes', label: 'Solicitacoes da Plataforma' },
    { path: '/admin/parceiros', label: 'Admin Parceiros' },
    { path: '/admin/permissoes', label: 'Permissoes' },
    { path: '/admin/planos', label: 'Admin Planos' },
    { path: '/admin/scanner', label: 'Scanner QR' },
    { path: '/admin/sharkround', label: 'Admin SharkRound' },
    { path: '/admin/treinos', label: 'Admin Treinos' },
    { path: '/admin/treinos/antigos', label: 'Admin Treinos Antigos' },
    { path: '/admin/usuarios', label: 'Gerenciar Usuarios' },

    // --- PÃšBLICO / MEMBROS ---
    { path: '/aguardando-aprovacao', label: '⏳ Aguardando Aprovação' },
    { path: '/album', label: 'Album' },
    { path: '/carteirinha', label: 'Carteirinha' },
    { path: '/comunidade', label: 'Comunidade' },
    { path: '/configuracoes', label: 'Ajustes' },
    { path: '/conquistas', label: 'Conquistas' },
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/empresa', label: 'Painel Empresa' },
    { path: '/eventos', label: 'Eventos' },
    { path: '/fidelidade', label: 'Fidelidade' },
    { path: '/games', label: 'Games' },
    { path: '/guia', label: 'Guia' },
    { path: '/gym', label: 'Gym / Check-in' },
    { path: '/historico', label: 'Historico' },
    { path: '/ligas', label: 'Ligas' },
    { path: '/ligas_unitau', label: 'Ligas Unitau' },
    { path: '/loja', label: 'Loja' },
    { path: '/nova-atletica', label: '🏫 Onboarding Atletica' },
    { path: '/parceiros', label: 'Parceiros' },
    { path: '/perfil', label: 'Perfil' },
    { path: '/planos', label: 'Planos' },
    { path: '/ranking', label: 'Ranking' },
    { path: '/sharkround', label: 'SharkRound' },
    { path: '/treinos', label: 'Treinos' },
    { path: '/visitante', label: 'Vitrine de Atleticas' },
].sort((a, b) => a.path.localeCompare(b.path));

